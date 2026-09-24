import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertTriangle, CheckCircle2, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { BeltStatusCard } from "@/components/dashboard/BeltStatusCard";
import { AlertsPanel } from "@/components/dashboard/AlertsPanel";
import { PerformanceChart } from "@/components/dashboard/PerformanceChart";
import { AiDiagnosisDialog } from "@/components/AiDiagnosisDialog";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/errors";

interface Belt {
  id: string;
  name: string;
  location: string;
  status: string;
  speed: number;
  load_percentage: number;
  temperature: number;
  vibration: number;
  last_maintenance: string | null;
}

const Dashboard = () => {
  const [belts, setBelts] = useState<Belt[]>([]);
  const [loading, setLoading] = useState(true);
  const [diagnosisBelt, setDiagnosisBelt] = useState<Belt | null>(null);
  const { toast } = useToast();

  const fetchBelts = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("conveyor_belts")
        .select("*")
        .order("name");

      if (error) throw error;
      setBelts(data || []);
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: errorMessage(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchBelts();

    // Subscribe to realtime updates
    const channel = supabase
      .channel("conveyor_belts_changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conveyor_belts",
        },
        () => {
          fetchBelts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchBelts]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground">Loading dashboard...</div>
      </div>
    );
  }

  const stats = {
    operational: belts.filter((b) => b.status === "operational").length,
    warning: belts.filter((b) => b.status === "warning").length,
    critical: belts.filter((b) => b.status === "critical").length,
    total: belts.length,
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 space-y-4 md:space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold tracking-tight">
          Conveyor Belt Monitoring System
        </h1>
        <p className="text-sm md:text-base text-muted-foreground">
          Real-time IoT monitoring and predictive maintenance
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 md:p-6 border-status-operational/20 bg-gradient-to-br from-card to-card/50">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs md:text-sm text-muted-foreground">Operational</p>
              <p className="text-2xl md:text-3xl font-bold text-status-operational">
                {stats.operational}
              </p>
            </div>
            <CheckCircle2 className="h-8 w-8 md:h-10 md:w-10 text-status-operational" />
          </div>
        </Card>

        <Card className="p-4 md:p-6 border-status-warning/20 bg-gradient-to-br from-card to-card/50">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs md:text-sm text-muted-foreground">Warning</p>
              <p className="text-2xl md:text-3xl font-bold text-status-warning">
                {stats.warning}
              </p>
            </div>
            <AlertTriangle className="h-8 w-8 md:h-10 md:w-10 text-status-warning" />
          </div>
        </Card>

        <Card className="p-4 md:p-6 border-status-critical/20 bg-gradient-to-br from-card to-card/50">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs md:text-sm text-muted-foreground">Critical</p>
              <p className="text-2xl md:text-3xl font-bold text-status-critical">
                {stats.critical}
              </p>
            </div>
            <Activity className="h-8 w-8 md:h-10 md:w-10 text-status-critical" />
          </div>
        </Card>

        <Card className="p-4 md:p-6 border-primary/20 bg-gradient-to-br from-card to-card/50">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs md:text-sm text-muted-foreground">Total Belts</p>
              <p className="text-2xl md:text-3xl font-bold">{stats.total}</p>
            </div>
            <Wrench className="h-8 w-8 md:h-10 md:w-10 text-primary" />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl md:text-2xl font-semibold">Belt Status</h2>
            <Badge variant="outline" className="text-xs">
              Live Updates
            </Badge>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {belts.map((belt) => (
              <BeltStatusCard
                key={belt.id}
                belt={{
                  id: belt.name,
                  name: belt.name,
                  status: belt.status as "operational" | "warning" | "critical",
                  speed: Number(belt.speed),
                  load: Number(belt.load_percentage),
                  temperature: Number(belt.temperature),
                  vibration: Number(belt.vibration),
                  runtime: 0,
                }}
                onDiagnose={() => setDiagnosisBelt(belt)}
              />
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-xl md:text-2xl font-semibold">Active Alerts</h2>
          <AlertsPanel />
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl md:text-2xl font-semibold">Performance Metrics</h2>
        <PerformanceChart />
      </div>

      <AiDiagnosisDialog
        belt={diagnosisBelt}
        open={diagnosisBelt !== null}
        onOpenChange={(open) => !open && setDiagnosisBelt(null)}
      />
    </div>
  );
};

export default Dashboard;
