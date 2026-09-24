import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/errors";

type AlertRow = {
  id: string;
  belt_id: string;
  priority: string;
  title: string;
  description: string;
  status: string;
  created_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  conveyor_belts: { name: string } | null;
};

export type AlertStatus = "active" | "acknowledged" | "resolved";

export interface AlertWithBelt {
  id: string;
  belt_id: string;
  belt_name: string;
  priority: string;
  title: string;
  description: string;
  status: AlertStatus;
  created_at: string | null;
  resolved_at: string | null;
}

export const useAlerts = (statusFilter?: AlertStatus | "all") => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [alerts, setAlerts] = useState<AlertWithBelt[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAlerts = useCallback(async () => {
    try {
      let query = supabase
        .from("alerts")
        .select("*, conveyor_belts(name)")
        .order("created_at", { ascending: false })
        .limit(100);

      if (statusFilter && statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      setAlerts(
        (data || []).map((row: AlertRow) => ({
          id: row.id,
          belt_id: row.belt_id,
          belt_name: row.conveyor_belts?.name ?? "Unknown belt",
          priority: row.priority,
          title: row.title,
          description: row.description,
          status: row.status as AlertStatus,
          created_at: row.created_at,
          resolved_at: row.resolved_at,
        }))
      );
    } catch (error: unknown) {
      toast({
        title: "Failed to load alerts",
        description: errorMessage(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, toast]);

  useEffect(() => {
    fetchAlerts();

    const channel = supabase
      .channel("alerts_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alerts" },
        () => fetchAlerts()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchAlerts]);

  const [canManageAlerts, setCanManageAlerts] = useState(false);
  useEffect(() => {
    if (!user) {
      setCanManageAlerts(false);
      return;
    }
    Promise.all([
      supabase.rpc("has_role", { _user_id: user.id, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: user.id, _role: "operator" }),
    ]).then(([admin, operator]) => {
      setCanManageAlerts(!!admin.data || !!operator.data);
    });
  }, [user]);

  const updateAlertStatus = async (alertId: string, status: AlertStatus) => {
    if (!user) return;
    const updates: {
      status: string;
      resolved_at?: string;
      resolved_by?: string;
    } = { status };
    if (status === "resolved") {
      updates.resolved_at = new Date().toISOString();
      updates.resolved_by = user.id;
    }
    const { error } = await supabase
      .from("alerts")
      .update(updates)
      .eq("id", alertId);
    if (error) {
      toast({
        title: "Update failed",
        description: errorMessage(error),
        variant: "destructive",
      });
    }
  };

  return { alerts, loading, canManageAlerts, updateAlertStatus, refresh: fetchAlerts };
};
