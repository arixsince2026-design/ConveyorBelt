import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const METRICS = [
  { value: "temperature", label: "Temperature", unit: "°C" },
  { value: "vibration", label: "Vibration", unit: "mm/s" },
  { value: "speed", label: "Speed", unit: "m/s" },
  { value: "load_percentage", label: "Load", unit: "%" },
] as const;

type MetricKey = (typeof METRICS)[number]["value"];

const RANGES = [
  { value: "24h", label: "24h", hours: 24 },
  { value: "7d", label: "7 days", hours: 24 * 7 },
  { value: "30d", label: "30 days", hours: 24 * 30 },
] as const;

type RangeKey = (typeof RANGES)[number]["value"];

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

interface ReadingRow {
  belt_name: string;
  metric_value: number;
  timestamp: string;
}

export const PerformanceChart = () => {
  const [metric, setMetric] = useState<MetricKey>("temperature");
  const [range, setRange] = useState<RangeKey>("24h");
  const [readings, setReadings] = useState<ReadingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    const fetchReadings = async () => {
      setLoading(true);
      const hours = RANGES.find((r) => r.value === range)!.hours;
      const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

      const { data, error } = await supabase
        .from("sensor_readings")
        .select(`${metric}, timestamp, conveyor_belts(name)`)
        .gte("timestamp", since)
        .order("timestamp", { ascending: true })
        .limit(5000);

      if (error) {
        toast({
          title: "Failed to load readings",
          description: error.message,
          variant: "destructive",
        });
        setReadings([]);
      } else {
        setReadings(
          (data || []).map((row: Record<string, unknown>) => ({
            belt_name: (row.conveyor_belts as { name: string } | null)?.name ?? "Unknown",
            metric_value: Number(row[metric]),
            timestamp: row.timestamp as string,
          }))
        );
      }
      setLoading(false);
    };

    fetchReadings();
    const channel = supabase
      .channel(`sensor_readings_${metric}_${range}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sensor_readings" },
        () => fetchReadings()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [metric, range, toast]);

  const chartData = useMemo(() => {
    const hours = RANGES.find((r) => r.value === range)!.hours;
    const bucketMs = hours <= 24 ? 3600 * 1000 : hours <= 24 * 7 ? 6 * 3600 * 1000 : 24 * 3600 * 1000;

    const buckets = new Map<number, Record<string, string | number | null>>();
    for (const reading of readings) {
      const ts = new Date(reading.timestamp).getTime();
      const bucketKey = Math.floor(ts / bucketMs) * bucketMs;
      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, { time: new Date(bucketKey).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: hours <= 24 ? "numeric" : undefined,
        }) });
      }
      const bucket = buckets.get(bucketKey)!;
      // Average multiple readings of the same belt within one bucket
      const key = reading.belt_name;
      const existing = bucket[key];
      bucket[key] =
        typeof existing === "number"
          ? (existing + reading.metric_value) / 2
          : reading.metric_value;
    }

    return Array.from(buckets.entries())
      .sort(([a], [b]) => a - b)
      .map(([, bucket]) => bucket);
  }, [readings, range]);

  const beltNames = useMemo(
    () => Array.from(new Set(readings.map((r) => r.belt_name))).sort(),
    [readings]
  );

  const activeMetric = METRICS.find((m) => m.value === metric)!;

  return (
    <Card className="p-6 bg-gradient-to-br from-card to-card/50">
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Sensor Trends by Belt</h3>
            <p className="text-sm text-muted-foreground">
              Live {activeMetric.label.toLowerCase()} readings from the sensor_readings table
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Tabs value={metric} onValueChange={(v) => setMetric(v as MetricKey)}>
              <TabsList>
                {METRICS.map((m) => (
                  <TabsTrigger key={m.value} value={m.value} className="text-xs">
                    {m.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Tabs value={range} onValueChange={(v) => setRange(v as RangeKey)}>
              <TabsList>
                {RANGES.map((r) => (
                  <TabsTrigger key={r.value} value={r.value} className="text-xs">
                    {r.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground py-12 text-center">Loading readings...</p>
        ) : chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground py-12 text-center">
            No sensor readings in this period. Upload CSV data or insert readings to see trends.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                label={{
                  value: activeMetric.unit,
                  angle: -90,
                  position: "insideLeft",
                  fill: "hsl(var(--muted-foreground))",
                }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "var(--radius)",
                }}
              />
              <Legend />
              {beltNames.map((name, i) => (
                <Line
                  key={name}
                  type="monotone"
                  dataKey={name}
                  name={name}
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
};
