import { useEffect, useMemo, useState } from "react";
import { Upload, Loader2, CircleCheck, CircleX, Database } from "lucide-react";
import Papa from "papaparse";
import { z } from "zod";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  evaluateThresholds,
  fetchThresholds,
  createAlertsForViolations,
  BeltValues,
} from "@/lib/alertRules";
import { errorMessage } from "@/lib/errors";

interface MachineData {
  [key: string]: string | number;
}

const HEADER_ALIASES: Record<string, string> = {
  belt: "belt_name",
  belt_name: "belt_name",
  beltname: "belt_name",
  name: "belt_name",
  speed: "speed",
  belt_speed: "speed",
  load: "load_percentage",
  load_percentage: "load_percentage",
  load_percent: "load_percentage",
  "load %": "load_percentage",
  temperature: "temperature",
  temp: "temperature",
  vibration: "vibration",
  vib: "vibration",
  timestamp: "timestamp",
  time: "timestamp",
  datetime: "timestamp",
  date: "timestamp",
};

const normalizeHeaders = (row: MachineData): MachineData => {
  const normalized: MachineData = {};
  for (const [key, value] of Object.entries(row)) {
    const canonical = HEADER_ALIASES[key.trim().toLowerCase()] ?? key.trim().toLowerCase();
    normalized[canonical] = value;
  }
  return normalized;
};

const readingSchema = z.object({
  belt_name: z.string().trim().min(1, "belt name is required"),
  speed: z.coerce.number().min(0).max(20),
  load_percentage: z.coerce.number().min(0).max(100),
  temperature: z.coerce.number().min(-50).max(300),
  vibration: z.coerce.number().min(0).max(100),
  timestamp: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return new Date().toISOString();
      const d = new Date(v);
      return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    }),
});

type ParsedReading = z.infer<typeof readingSchema>;

interface RowResult {
  row: number;
  status: "ok" | "error";
  message: string;
}

const UploadAnalysis = () => {
  const [uploadedData, setUploadedData] = useState<MachineData[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState("");
  const [results, setResults] = useState<RowResult[]>([]);
  const [belts, setBelts] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    supabase
      .from("conveyor_belts")
      .select("id, name")
      .order("name")
      .then(({ data }) => setBelts(data || []));
  }, []);

  const validRows = useMemo(
    () => results.filter((r) => r.status === "ok").length,
    [results]
  );

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setLoading(true);
    setResults([]);

    Papa.parse(file, {
      complete: (results) => {
        try {
          const data = (results.data as MachineData[]).filter((row) =>
            Object.values(row).some((val) => val !== "")
          );
          setUploadedData(data);
          toast({
            title: "Upload Complete",
            description: `${data.length} rows loaded. Review and import below.`,
          });
        } catch (error) {
          console.error("Upload error:", error);
          toast({
            title: "Upload Failed",
            description: error instanceof Error ? error.message : "Failed to load data",
            variant: "destructive",
          });
        } finally {
          setLoading(false);
        }
      },
      header: true,
      skipEmptyLines: true,
    });
  };

  const importToDatabase = async () => {
    if (uploadedData.length === 0 || belts.length === 0) return;
    setImporting(true);

    const beltMap = new Map(belts.map((b) => [b.name.trim().toLowerCase(), b.id]));
    const thresholds = await fetchThresholds();
    const rowResults: RowResult[] = [];
    const inserts: {
      belt_id: string;
      speed: number;
      load_percentage: number;
      temperature: number;
      vibration: number;
      timestamp: string;
      _belt_name: string;
      _values: BeltValues;
    }[] = [];

    uploadedData.forEach((raw, index) => {
      const rowNo = index + 1;
      const normalized = normalizeHeaders(raw);
      const parsed = readingSchema.safeParse(normalized);

      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        rowResults.push({
          row: rowNo,
          status: "error",
          message: `${issue.path.join(".") || "row"}: ${issue.message}`,
        });
        return;
      }

      const beltId = beltMap.get(parsed.data.belt_name.toLowerCase());
      if (!beltId) {
        rowResults.push({
          row: rowNo,
          status: "error",
          message: `Unknown belt "${parsed.data.belt_name}". Expected one of: ${belts.map((b) => b.name).join(", ")}`,
        });
        return;
      }

      rowResults.push({ row: rowNo, status: "ok", message: "Validated" });
      inserts.push({
        belt_id: beltId,
        speed: parsed.data.speed,
        load_percentage: parsed.data.load_percentage,
        temperature: parsed.data.temperature,
        vibration: parsed.data.vibration,
        timestamp: parsed.data.timestamp,
        _belt_name: parsed.data.belt_name,
        _values: {
          temperature: parsed.data.temperature,
          vibration: parsed.data.vibration,
          load_percentage: parsed.data.load_percentage,
          speed: parsed.data.speed,
        },
      });
    });

    let alertsCreated = 0;
    try {
      // Insert in chunks to stay within request size limits
      const CHUNK = 200;
      for (let i = 0; i < inserts.length; i += CHUNK) {
        const chunk = inserts.slice(i, i + CHUNK);
        const { error } = await supabase.from("sensor_readings").insert(
          chunk.map(({ _belt_name, _values, ...row }) => row)
        );
        if (error) throw error;

        // Evaluate thresholds against the latest reading per belt in this chunk
        const latestByBelt = new Map<string, (typeof chunk)[number]>();
        for (const row of chunk) {
          const prev = latestByBelt.get(row.belt_id);
          if (!prev || new Date(row.timestamp) > new Date(prev.timestamp)) {
            latestByBelt.set(row.belt_id, row);
          }
        }
        for (const row of latestByBelt.values()) {
          const violations = evaluateThresholds(row._values, thresholds);
          alertsCreated += await createAlertsForViolations(
            row.belt_id,
            row._belt_name,
            violations
          );
        }
      }

      toast({
        title: "Import complete",
        description: `${inserts.length} readings stored${alertsCreated > 0 ? `, ${alertsCreated} alert(s) generated` : ""}.`,
      });
    } catch (error: unknown) {
      toast({
        title: "Import failed",
        description: errorMessage(error),
        variant: "destructive",
      });
    } finally {
      setResults(rowResults);
      setImporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Machine Data Upload</h1>
            <p className="text-muted-foreground mt-1">
              Upload CSV sensor readings. Validated rows are stored in sensor_readings and checked
              against alert thresholds.
            </p>
          </div>
        </div>

        <Card className="p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-center w-full">
              <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-lg cursor-pointer border-border hover:border-primary bg-card hover:bg-accent/50 transition-colors">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-12 h-12 mb-3 text-muted-foreground" />
                  <p className="mb-2 text-sm text-foreground">
                    <span className="font-semibold">Click to upload</span> or drag and drop
                  </p>
                  <p className="text-xs text-muted-foreground">
                    CSV with columns: belt, speed, load, temperature, vibration, timestamp
                  </p>
                  {fileName && (
                    <p className="mt-2 text-sm font-medium text-primary">{fileName}</p>
                  )}
                </div>
                <input
                  type="file"
                  className="hidden"
                  accept=".csv"
                  onChange={handleFileUpload}
                  disabled={loading}
                />
              </label>
            </div>

            {loading && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Loading CSV data...</p>
                <div className="h-2 w-full rounded-full bg-accent animate-pulse" />
              </div>
            )}

            {uploadedData.length > 0 && !loading && (
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {uploadedData.length} rows loaded · {belts.length} belts available
                </p>
                <Button onClick={importToDatabase} disabled={importing} className="gap-2">
                  {importing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Database className="h-4 w-4" />
                  )}
                  Validate &amp; Import
                </Button>
              </div>
            )}
          </div>
        </Card>

        {results.length > 0 && (
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-xl font-semibold">Import Results</h2>
              <Badge className="gap-1 bg-status-operational/15 text-status-operational hover:bg-status-operational/15">
                <CircleCheck className="h-3 w-3" /> {validRows} valid
              </Badge>
              <Badge variant="destructive" className="gap-1">
                <CircleX className="h-3 w-3" /> {results.length - validRows} rejected
              </Badge>
            </div>
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="p-2 font-medium">Row</th>
                    <th className="p-2 font-medium">Status</th>
                    <th className="p-2 font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {results
                    .filter((r) => r.status === "error")
                    .concat(results.filter((r) => r.status === "ok").slice(0, 20))
                    .map((r) => (
                      <tr key={r.row} className="border-b border-border/50">
                        <td className="p-2">{r.row}</td>
                        <td className="p-2">
                          {r.status === "ok" ? (
                            <CircleCheck className="h-4 w-4 text-status-operational" />
                          ) : (
                            <CircleX className="h-4 w-4 text-status-critical" />
                          )}
                        </td>
                        <td className="p-2 text-muted-foreground">{r.message}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {uploadedData.length > 0 && results.length === 0 && !loading && (
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-4">Uploaded Data Preview</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {Object.keys(uploadedData[0]).map((key) => (
                      <th key={key} className="text-left p-2 font-medium text-foreground">
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {uploadedData.slice(0, 10).map((row, index) => (
                    <tr key={index} className="border-b border-border">
                      {Object.values(row).map((value, idx) => (
                        <td key={idx} className="p-2 text-muted-foreground">
                          {String(value)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {uploadedData.length > 10 && (
                <p className="text-sm text-muted-foreground mt-2">
                  Showing 10 of {uploadedData.length} rows
                </p>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};

export default UploadAnalysis;
