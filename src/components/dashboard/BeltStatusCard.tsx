import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Gauge, Thermometer, Activity, Clock, Sparkles } from "lucide-react";

interface BeltStatusCardProps {
  belt: {
    id: string;
    name: string;
    status: "operational" | "warning" | "critical" | "maintenance";
    speed: number;
    load: number;
    temperature: number;
    vibration: number;
    runtime: number;
  };
  onDiagnose?: () => void;
}

export const BeltStatusCard = ({ belt, onDiagnose }: BeltStatusCardProps) => {
  const statusColors = {
    operational: "text-status-operational border-status-operational/20",
    warning: "text-status-warning border-status-warning/20",
    critical: "text-status-critical border-status-critical/20",
    maintenance: "text-status-maintenance border-status-maintenance/20",
  };

  const statusBadgeVariants = {
    operational: "default" as const,
    warning: "secondary" as const,
    critical: "destructive" as const,
    maintenance: "outline" as const,
  };

  return (
    <Card
      className={`p-6 transition-all hover:shadow-lg ${
        statusColors[belt.status]
      } bg-gradient-to-br from-card to-card/50`}
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-lg">{belt.name}</h3>
            <p className="text-sm text-muted-foreground">{belt.id}</p>
          </div>
          <div className="flex items-center gap-2">
            {onDiagnose && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1 text-xs"
                onClick={onDiagnose}
                title="Run AI diagnostic"
              >
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Diagnose
              </Button>
            )}
            <Badge variant={statusBadgeVariants[belt.status]} className="capitalize">
              {belt.status}
            </Badge>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-muted-foreground" />
              <span>Speed</span>
            </div>
            <span className="font-medium">{belt.speed} m/s</span>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <span>Load</span>
              </div>
              <span className="font-medium">{belt.load}%</span>
            </div>
            <Progress value={belt.load} className="h-2" />
          </div>

          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <Thermometer className="h-4 w-4 text-muted-foreground" />
              <span>Temperature</span>
            </div>
            <span className="font-medium">{belt.temperature}°C</span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <span>Vibration</span>
            </div>
            <span className={`font-medium ${belt.vibration > 5 ? "text-status-critical" : ""}`}>
              {belt.vibration} mm/s
            </span>
          </div>

          <div className="flex items-center justify-between text-sm pt-2 border-t border-border">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span>Runtime</span>
            </div>
            <span className="font-medium">{belt.runtime}h</span>
          </div>
        </div>
      </div>
    </Card>
  );
};
