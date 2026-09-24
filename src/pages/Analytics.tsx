import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, TrendingUp, AlertCircle, Wrench, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { fetchThresholds } from "@/lib/alertRules";
import { errorMessage } from "@/lib/errors";
import { predictBeltRisk, ReadingPoint, BeltPrediction } from "@/lib/predictions";

interface Belt {
  id: string;
  name: string;
  status: string;
  speed: number | null;
  load_percentage: number | null;
  temperature: number | null;
  vibration: number | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const riskColor = (risk: number) =>
  risk >= 70 ? "hsl(var(--status-critical))" : risk >= 40 ? "hsl(var(--status-warning))" : "hsl(var(--status-operational))";

const Analytics = () => {
  const [loading, setLoading] = useState(true);
  const [predictions, setPredictions] = useState<{ belt: Belt; prediction: BeltPrediction }[]>([]);
  const [breakdownHistory, setBreakdownHistory] = useState<{ month: string; count: number }[]>([]);
  const [maintenanceTypes, setMaintenanceTypes] = useState<{ name: string; value: number; color: string }[]>([]);
  const [stats, setStats] = useState({ avgRisk: 0, highRisk: 0, imminent: 0, maint30d: 0 });
  const [actions, setActions] = useState<{ badge: string; badgeVariant: "destructive" | "secondary" | "outline"; belt: string; text: string }[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
        const since6m = new Date(Date.now() - 182 * 24 * 3600 * 1000).toISOString();

        const [beltsRes, readingsRes, alertsRes, maintRes, thresholds] = await Promise.all([
          supabase.from("conveyor_belts").select("*").order("name"),
          supabase
            .from("sensor_readings")
            .select("belt_id, speed, load_percentage, temperature, vibration, timestamp")
            .gte("timestamp", since30)
            .order("timestamp", { ascending: true })
            .limit(5000),
          supabase
            .from("alerts")
            .select("priority, created_at, status")
            .gte("created_at", since6m),
          supabase.from("maintenance_logs").select("maintenance_type, performed_at"),
          fetchThresholds(),
        ]);

        if (beltsRes.error) throw beltsRes.error;
        if (readingsRes.error) throw readingsRes.error;
        if (alertsRes.error) throw alertsRes.error;
        if (maintRes.error) throw maintRes.error;

        const belts = (beltsRes.data || []) as Belt[];
        const readings = (readingsRes.data || []) as (ReadingPoint & { belt_id: string })[];
        const alerts = alertsRes.data || [];
        const maint = maintRes.data || [];

        const historyByBelt = new Map<string, ReadingPoint[]>();
        for (const r of readings) {
          if (!historyByBelt.has(r.belt_id)) historyByBelt.set(r.belt_id, []);
          historyByBelt.get(r.belt_id)!.push({
            timestamp: r.timestamp,
            temperature: Number(r.temperature),
            vibration: Number(r.vibration),
            load_percentage: Number(r.load_percentage),
            speed: Number(r.speed),
          });
        }

        const preds = belts.map((belt) => {
          const history = historyByBelt.get(belt.id) ?? [];
          const current = {
            temperature: Number(belt.temperature ?? 0),
            vibration: Number(belt.vibration ?? 0),
            load_percentage: Number(belt.load_percentage ?? 0),
            speed: Number(belt.speed ?? 0),
          };
          return { belt, prediction: predictBeltRisk(belt.name, current, history, thresholds) };
        });
        setPredictions(preds);

        const avgRisk = preds.length
          ? Math.round(preds.reduce((s, p) => s + p.prediction.riskScore, 0) / preds.length)
          : 0;
        const highRisk = preds.filter((p) => p.prediction.riskScore >= 40).length;
        const imminent = preds.filter(
          (p) => p.prediction.daysToFailure !== null && p.prediction.daysToFailure <= 30
        ).length;
        const maint30d = maint.filter(
          (m) => m.performed_at && new Date(m.performed_at) > new Date(since30)
        ).length;
        setStats({ avgRisk, highRisk, imminent, maint30d });

        // Breakdown history: alerts grouped by month over the last 6 months
        const monthCounts = new Map<string, number>();
        for (let i = 5; i >= 0; i--) {
          const d = new Date();
          d.setMonth(d.getMonth() - i);
          monthCounts.set(`${MONTHS[d.getMonth()]} ${d.getFullYear()}`, 0);
        }
        for (const alert of alerts) {
          if (!alert.created_at) continue;
          const d = new Date(alert.created_at);
          const key = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
          if (monthCounts.has(key)) monthCounts.set(key, monthCounts.get(key)! + 1);
        }
        setBreakdownHistory(
          Array.from(monthCounts.entries()).map(([month, count]) => ({ month, count }))
        );

        // Maintenance distribution from maintenance_logs
        const typeCounts = new Map<string, number>();
        for (const m of maint) {
          const type = m.maintenance_type || "Other";
          typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
        }
        const palette = ["hsl(var(--chart-1))", "hsl(var(--chart-3))", "hsl(var(--chart-2))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];
        setMaintenanceTypes(
          Array.from(typeCounts.entries()).map(([name, value], i) => ({
            name: name.charAt(0).toUpperCase() + name.slice(1),
            value,
            color: palette[i % palette.length],
          }))
        );

        // Rule-based recommended actions from predictions
        const sorted = [...preds].sort((a, b) => b.prediction.riskScore - a.prediction.riskScore);
        const recommended = sorted
          .filter((p) => p.prediction.riskScore >= 20 || p.belt.status !== "operational")
          .slice(0, 3)
          .map((p) => {
            const critical = p.prediction.riskScore >= 70 || p.belt.status === "critical";
            const high = p.prediction.riskScore >= 40 || p.belt.status === "warning";
            return {
              badge: critical ? "URGENT" : high ? "HIGH PRIORITY" : "MONITOR",
              badgeVariant: (critical ? "destructive" : high ? "secondary" : "outline") as
                | "destructive"
                | "secondary"
                | "outline",
              belt: p.belt.name,
              text:
                critical
                  ? `Immediate inspection required. ${p.prediction.drivers[0]}. Schedule emergency maintenance.`
                  : high
                  ? `Plan maintenance within the week. ${p.prediction.drivers[0]}.`
                  : `Keep on the watch list. ${p.prediction.drivers[0]}.`,
            };
          });
        setActions(recommended);
      } catch (error: unknown) {
        toast({
          title: "Failed to load analytics",
          description: errorMessage(error),
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [toast]);

  const trendInfo = useMemo(
    () =>
      predictions.map((p) => ({
        name: p.belt.name,
        risk: p.prediction.riskScore,
        label: p.prediction.label,
      })),
    [predictions]
  );

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 space-y-4 md:space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold tracking-tight">Predictive Analytics</h1>
        <p className="text-sm md:text-base text-muted-foreground">
          Risk scoring computed from live sensor trends and thresholds
        </p>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Computing predictions...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-6 bg-gradient-to-br from-card to-card/50">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Avg. Risk Score</p>
                  <p className="text-3xl font-bold">{stats.avgRisk}%</p>
                </div>
                <Brain className="h-10 w-10 text-primary" />
              </div>
            </Card>

            <Card className="p-6 bg-gradient-to-br from-card to-card/50">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">High-Risk Belts</p>
                  <p className="text-3xl font-bold text-status-warning">{stats.highRisk}</p>
                </div>
                <AlertCircle className="h-10 w-10 text-status-warning" />
              </div>
            </Card>

            <Card className="p-6 bg-gradient-to-br from-card to-card/50">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Critical Within 30d</p>
                  <p className="text-3xl font-bold text-status-critical">{stats.imminent}</p>
                </div>
                <TrendingUp className="h-10 w-10 text-status-critical" />
              </div>
            </Card>

            <Card className="p-6 bg-gradient-to-br from-card to-card/50">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Maintenance Events (30d)</p>
                  <p className="text-3xl font-bold">{stats.maint30d}</p>
                </div>
                <Wrench className="h-10 w-10 text-status-info" />
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-6 bg-gradient-to-br from-card to-card/50">
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold">Breakdown Risk Assessment</h3>
                  <p className="text-sm text-muted-foreground">Predicted failure probability per belt</p>
                </div>
                <div className="space-y-4">
                  {trendInfo.map((item) => (
                    <div key={item.name} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{item.name}</span>
                          <Badge
                            variant={
                              item.risk >= 70
                                ? "destructive"
                                : item.risk >= 40
                                ? "secondary"
                                : "outline"
                            }
                          >
                            {item.label}
                          </Badge>
                        </div>
                        <span className="text-sm font-semibold">{item.risk}%</span>
                      </div>
                      <Progress value={item.risk} className="h-3" />
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            <Card className="p-6 bg-gradient-to-br from-card to-card/50">
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold">Alert History</h3>
                  <p className="text-sm text-muted-foreground">6-month alert volume trend</p>
                </div>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={breakdownHistory}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" />
                    <YAxis allowDecimals={false} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "var(--radius)",
                      }}
                    />
                    <Bar dataKey="count" fill={riskColor(50)} radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-6 bg-gradient-to-br from-card to-card/50">
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold">Maintenance Distribution</h3>
                  <p className="text-sm text-muted-foreground">Maintenance type breakdown from logs</p>
                </div>
                {maintenanceTypes.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-12 text-center">
                    No maintenance logged yet. Record events on the Maintenance page.
                  </p>
                ) : (
                  <div className="flex items-center justify-center">
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie
                          data={maintenanceTypes}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          outerRadius={80}
                          dataKey="value"
                        >
                          {maintenanceTypes.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </Card>

            <Card className="p-6 bg-gradient-to-br from-card to-card/50">
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold">Recommended Actions</h3>
                  <p className="text-sm text-muted-foreground">Generated from current risk drivers</p>
                </div>
                <div className="space-y-3">
                  {actions.length === 0 ? (
                    <Card className="p-4 border-status-operational/20">
                      <p className="text-sm text-muted-foreground">
                        All belts are low risk. No actions recommended.
                      </p>
                    </Card>
                  ) : (
                    actions.map((action) => (
                      <Card
                        key={action.belt}
                        className={`p-4 ${
                          action.badgeVariant === "destructive"
                            ? "border-status-critical/20"
                            : action.badgeVariant === "secondary"
                            ? "border-status-warning/20"
                            : "border-status-info/20"
                        }`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Badge variant={action.badgeVariant}>{action.badge}</Badge>
                            <span className="font-semibold">{action.belt}</span>
                          </div>
                          <p className="text-sm">{action.text}</p>
                        </div>
                      </Card>
                    ))
                  )}
                </div>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
};

export default Analytics;
