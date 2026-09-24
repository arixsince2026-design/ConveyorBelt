import { useEffect, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import Papa from "papaparse";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Download, TrendingUp, TrendingDown, Minus, Loader2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/errors";

interface Belt {
  id: string;
  name: string;
  status: string;
  temperature: number | null;
  vibration: number | null;
  speed: number | null;
  load_percentage: number | null;
}

interface AlertRow {
  status: string;
  priority: string;
  created_at: string | null;
  resolved_at: string | null;
}

interface MaintenanceRow {
  maintenance_type: string;
  downtime_hours: number | null;
  cost: number | null;
  performed_at: string | null;
}

interface Kpi {
  metric: string;
  value: string;
  trend: "up" | "down" | "flat";
  change: string;
}

interface GeneratedReport {
  id: string;
  title: string;
  date: string;
  type: string;
  status: string;
  kpis: Kpi[];
  summary: string[];
}

const last30DaysISO = () => new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

const fmtHours = (h: number) => (h >= 1 ? `${h.toFixed(1)} hrs` : `${Math.round(h * 60)} min`);

const Reports = () => {
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [insights, setInsights] = useState<string[]>([]);
  const [belts, setBelts] = useState<Belt[]>([]);
  const [reports, setReports] = useState<GeneratedReport[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const since = last30DaysISO();
        const [beltsRes, alertsRes, maintRes] = await Promise.all([
          supabase.from("conveyor_belts").select("*").order("name"),
          supabase.from("alerts").select("status, priority, created_at, resolved_at"),
          supabase.from("maintenance_logs").select("*").gte("performed_at", since),
        ]);

        if (beltsRes.error) throw beltsRes.error;
        if (alertsRes.error) throw alertsRes.error;
        if (maintRes.error) throw maintRes.error;

        const beltData = (beltsRes.data || []) as Belt[];
        const alertData = (alertsRes.data || []) as AlertRow[];
        const maintData = (maintRes.data || []) as MaintenanceRow[];
        setBelts(beltData);

        const total = beltData.length || 1;
        const operational = beltData.filter((b) => b.status === "operational").length;
        const critical = beltData.filter((b) => b.status === "critical").length;
        const activeAlerts = alertData.filter((a) => a.status !== "resolved");
        const resolvedAlerts = alertData.filter((a) => a.status === "resolved" && a.resolved_at && a.created_at);
        const avgResponseHrs =
          resolvedAlerts.length > 0
            ? resolvedAlerts.reduce(
                (sum, a) => sum + (new Date(a.resolved_at!).getTime() - new Date(a.created_at!).getTime()) / 3600000,
                0
              ) / resolvedAlerts.length
            : 0;
        const totalCost = maintData.reduce((s, m) => s + (m.cost ?? 0), 0);
        const totalDowntime = maintData.reduce((s, m) => s + (m.downtime_hours ?? 0), 0);
        const criticalAlerts30 = alertData.filter(
          (a) => a.priority === "critical" && a.created_at && new Date(a.created_at) > new Date(since)
        ).length;

        setKpis([
          {
            metric: "Belt Availability",
            value: `${Math.round((operational / total) * 100)}%`,
            trend: operational / total > 0.8 ? "up" : operational / total > 0.5 ? "flat" : "down",
            change: `${operational}/${total} operational`,
          },
          {
            metric: "Active Alerts",
            value: String(activeAlerts.length),
            trend: activeAlerts.length === 0 ? "up" : activeAlerts.length < 5 ? "flat" : "down",
            change: `${criticalAlerts30} critical in 30d`,
          },
          {
            metric: "Avg. Resolution Time",
            value: resolvedAlerts.length ? fmtHours(avgResponseHrs) : "—",
            trend: avgResponseHrs < 4 ? "up" : avgResponseHrs < 24 ? "flat" : "down",
            change: `${resolvedAlerts.length} resolved`,
          },
          {
            metric: "Maintenance Events (30d)",
            value: String(maintData.length),
            trend: "flat",
            change: `${fmtHours(totalDowntime)} downtime`,
          },
          {
            metric: "Maintenance Cost (30d)",
            value: `$${totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
            trend: totalCost > 10000 ? "down" : "flat",
            change: `${maintData.length} events`,
          },
          {
            metric: "Critical Belts",
            value: String(critical),
            trend: critical === 0 ? "up" : "down",
            change: critical === 0 ? "all healthy" : "attention needed",
          },
        ]);

        const insightList: string[] = [];
        if (critical > 0) {
          const criticalBelts = beltData.filter((b) => b.status === "critical");
          insightList.push(
            `${criticalBelts.map((b) => b.name).join(", ")} ${criticalBelts.length === 1 ? "is" : "are"} in critical state and ${criticalBelts.length === 1 ? "requires" : "require"} immediate inspection.`
          );
        }
        if (activeAlerts.length > 0) {
          insightList.push(`${activeAlerts.length} active alert${activeAlerts.length === 1 ? "" : "s"} awaiting resolution.`);
        }
        if (maintData.length > 0) {
          insightList.push(
            `${maintData.length} maintenance events recorded in the last 30 days (${fmtHours(totalDowntime)} downtime, $${totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })} cost).`
          );
        }
        if (resolvedAlerts.length > 0) {
          insightList.push(`Average alert resolution time is ${fmtHours(avgResponseHrs)} across ${resolvedAlerts.length} resolved alerts.`);
        }
        if (insightList.length === 0) {
          insightList.push("No critical issues detected. All belts within normal operating parameters.");
        }
        setInsights(insightList);
      } catch (error: unknown) {
        toast({
          title: "Failed to load report data",
          description: errorMessage(error),
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [toast]);

  const exportPdf = (report: GeneratedReport) => {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("ConveyorWatch", 14, 18);
    doc.setFontSize(12);
    doc.text(report.title, 14, 26);
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`Generated: ${report.date}`, 14, 32);
    doc.setTextColor(0);

    autoTable(doc, {
      startY: 38,
      head: [["Metric", "Value", "Detail"]],
      body: report.kpis.map((k) => [k.metric, k.value, k.change]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [41, 128, 185] },
    });

    const finalY =
      (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 100;
    autoTable(doc, {
      startY: finalY + 8,
      head: [["Executive Summary"]],
      body: report.summary.map((s) => [s]),
      styles: { fontSize: 9, cellWidth: 180 },
      headStyles: { fillColor: [41, 128, 185] },
      theme: "grid",
    });

    doc.save(`${report.id}.pdf`);
  };

  const exportCsv = () => {
    const csv = Papa.unparse(
      kpis.map((k) => ({ metric: k.metric, value: k.value, detail: k.change }))
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `kpi-report-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const generateReport = () => {
    setGenerating(true);
    const date = new Date();
    const report: GeneratedReport = {
      id: `RPT-${date.toISOString().slice(0, 10)}-${String(reports.length + 1).padStart(3, "0")}`,
      title: "Operational Performance Summary",
      date: date.toLocaleString(),
      type: "Performance",
      status: "completed",
      kpis,
      summary: insights,
    };
    // Simulate brief generation time so the UX reflects the work being done
    setTimeout(() => {
      setReports((prev) => [report, ...prev]);
      setGenerating(false);
      toast({ title: "Report generated", description: `${report.id} is ready to download.` });
    }, 600);
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case "up":
        return <TrendingUp className="h-4 w-4 text-status-operational" />;
      case "down":
        return <TrendingDown className="h-4 w-4 text-status-critical" />;
      default:
        return <Minus className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const trendColor = (trend: string) =>
    trend === "up"
      ? "text-status-operational"
      : trend === "down"
      ? "text-status-critical"
      : "text-muted-foreground";

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 space-y-4 md:space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold tracking-tight">Management Reports</h1>
        <p className="text-sm md:text-base text-muted-foreground">
          KPIs computed live from your belts, alerts, and maintenance records
        </p>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading report data...
        </div>
      ) : (
        <>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold">Key Performance Indicators</h2>
              <div className="flex gap-2">
                <Button variant="outline" className="gap-2" onClick={exportCsv}>
                  <Download className="h-4 w-4" />
                  Export CSV
                </Button>
                <Button className="gap-2" onClick={generateReport} disabled={generating}>
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  Generate KPI Report (PDF)
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {kpis.map((kpi) => (
                <Card key={kpi.metric} className="p-6 bg-gradient-to-br from-card to-card/50">
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">{kpi.metric}</p>
                    <div className="flex items-end justify-between">
                      <p className="text-3xl font-bold">{kpi.value}</p>
                      <div className="flex items-center gap-1">
                        {getTrendIcon(kpi.trend)}
                        <span className={`text-sm font-semibold ${trendColor(kpi.trend)}`}>
                          {kpi.change}
                        </span>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-2xl font-semibold">Generated Reports</h2>
            <Card className="bg-gradient-to-br from-card to-card/50">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Report ID</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        No reports generated yet this session. Use "Generate KPI Report" above.
                      </TableCell>
                    </TableRow>
                  ) : (
                    reports.map((report) => (
                      <TableRow key={report.id}>
                        <TableCell className="font-medium">{report.id}</TableCell>
                        <TableCell>{report.title}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{report.type}</Badge>
                        </TableCell>
                        <TableCell>{report.date}</TableCell>
                        <TableCell>
                          <Badge className="capitalize">{report.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-2"
                            onClick={() => exportPdf(report)}
                          >
                            <Download className="h-4 w-4" />
                            Download
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-6 bg-gradient-to-br from-card to-card/50">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Executive Summary</h3>
                <div className="space-y-3 text-sm">
                  {insights.map((insight, i) => (
                    <p key={i} className="text-muted-foreground">{insight}</p>
                  ))}
                </div>
              </div>
            </Card>

            <Card className="p-6 bg-gradient-to-br from-card to-card/50">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Belt Status Snapshot</h3>
                <div className="space-y-2">
                  {belts.map((belt) => (
                    <div key={belt.id} className="flex items-center justify-between text-sm border-b border-border/50 pb-2">
                      <div>
                        <span className="font-medium">{belt.name}</span>
                        <span className="text-muted-foreground ml-2 text-xs">
                          {belt.temperature}°C · {belt.vibration} mm/s
                        </span>
                      </div>
                      <Badge
                        variant={
                          belt.status === "critical"
                            ? "destructive"
                            : belt.status === "warning"
                            ? "secondary"
                            : "default"
                        }
                        className="capitalize"
                      >
                        {belt.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
};

export default Reports;
