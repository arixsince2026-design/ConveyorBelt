import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, AlertCircle, Info, Bell, Check, Wrench } from "lucide-react";
import { useAlerts, AlertStatus } from "@/hooks/useAlerts";

const formatTime = (iso: string | null) => {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m ago`;
  return new Date(iso).toLocaleDateString();
};

const statusFilters: { value: AlertStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "acknowledged", label: "Ack'd" },
  { value: "resolved", label: "Resolved" },
];

export const AlertsPanel = () => {
  const [filter, setFilter] = useState<AlertStatus | "all">("active");
  const { alerts, loading, canManageAlerts, updateAlertStatus } = useAlerts(filter);

  const getIcon = (type: string) => {
    switch (type) {
      case "critical":
        return <AlertCircle className="h-5 w-5 text-status-critical" />;
      case "warning":
        return <AlertTriangle className="h-5 w-5 text-status-warning" />;
      case "info":
        return <Info className="h-5 w-5 text-status-info" />;
      default:
        return <Bell className="h-5 w-5" />;
    }
  };

  const getBadgeVariant = (type: string) => {
    switch (type) {
      case "critical":
        return "destructive" as const;
      case "warning":
        return "secondary" as const;
      case "info":
        return "outline" as const;
      default:
        return "default" as const;
    }
  };

  return (
    <Card className="bg-gradient-to-br from-card to-card/50">
      <div className="flex items-center gap-1 border-b border-border p-2">
        {statusFilters.map((f) => (
          <Button
            key={f.value}
            size="sm"
            variant={filter === f.value ? "default" : "ghost"}
            className="h-7 text-xs"
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>
      <ScrollArea className="h-[560px]">
        <div className="p-4 space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground p-4">Loading alerts...</p>
          ) : alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4">No alerts in this view.</p>
          ) : (
            alerts.map((alert) => (
              <Card
                key={alert.id}
                className="p-4 border-l-4 transition-all hover:shadow-md"
                style={{
                  borderLeftColor:
                    alert.priority === "critical"
                      ? "hsl(var(--status-critical))"
                      : alert.priority === "warning"
                      ? "hsl(var(--status-warning))"
                      : "hsl(var(--status-info))",
                }}
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      {getIcon(alert.priority)}
                      <div className="space-y-1">
                        <h4 className="font-semibold text-sm">{alert.title}</h4>
                        <Badge variant="outline" className="text-xs">
                          {alert.belt_name}
                        </Badge>
                      </div>
                    </div>
                    <Badge variant={getBadgeVariant(alert.priority)} className="text-xs capitalize">
                      {alert.priority}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground pl-7">{alert.description}</p>
                  <div className="flex items-center justify-between pl-7">
                    <p className="text-xs text-muted-foreground">
                      {formatTime(alert.created_at)}
                      {alert.status !== "active" && (
                        <span className="capitalize"> · {alert.status}</span>
                      )}
                    </p>
                    {canManageAlerts && alert.status !== "resolved" && (
                      <div className="flex gap-1">
                        {alert.status === "active" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs gap-1"
                            onClick={() => updateAlertStatus(alert.id, "acknowledged")}
                          >
                            <Bell className="h-3 w-3" />
                            Acknowledge
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs gap-1 text-status-operational"
                          onClick={() => updateAlertStatus(alert.id, "resolved")}
                        >
                          {alert.status === "acknowledged" ? (
                            <Wrench className="h-3 w-3" />
                          ) : (
                            <Check className="h-3 w-3" />
                          )}
                          Resolve
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>
    </Card>
  );
};
