import { useCallback, useEffect, useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useRoles } from "@/hooks/useRoles";
import { errorMessage } from "@/lib/errors";

interface MaintenanceLog {
  id: string;
  belt_id: string;
  belt_name: string;
  maintenance_type: string;
  description: string | null;
  downtime_hours: number | null;
  cost: number | null;
  performed_at: string | null;
  performed_by: string;
}

const EMPTY_FORM = {
  belt_id: "",
  maintenance_type: "preventive",
  description: "",
  downtime_hours: "",
  cost: "",
};

const Maintenance = () => {
  const [logs, setLogs] = useState<MaintenanceLog[]>([]);
  const [belts, setBelts] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const { user } = useAuth();
  const { canEdit } = useRoles();
  const { toast } = useToast();

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [logsRes, beltsRes] = await Promise.all([
      supabase
        .from("maintenance_logs")
        .select("*, conveyor_belts(name)")
        .order("performed_at", { ascending: false })
        .limit(200),
      supabase.from("conveyor_belts").select("id, name").order("name"),
    ]);
    if (logsRes.error) {
      toast({ title: "Failed to load maintenance logs", description: logsRes.error.message, variant: "destructive" });
    } else {
      setLogs(
        ((logsRes.data || []) as {
          id: string;
          belt_id: string;
          maintenance_type: string;
          description: string | null;
          downtime_hours: number | null;
          cost: number | null;
          performed_at: string | null;
          performed_by: string;
          conveyor_belts: { name: string } | null;
        }[]).map((row) => ({
          id: row.id,
          belt_id: row.belt_id,
          belt_name: row.conveyor_belts?.name ?? "Unknown belt",
          maintenance_type: row.maintenance_type,
          description: row.description,
          downtime_hours: row.downtime_hours,
          cost: row.cost,
          performed_at: row.performed_at,
          performed_by: row.performed_by,
        }))
      );
    }
    if (beltsRes.error) {
      toast({ title: "Failed to load belts", description: beltsRes.error.message, variant: "destructive" });
    } else {
      setBelts(beltsRes.data || []);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const saveLog = async () => {
    if (!form.belt_id) {
      toast({ title: "Select a belt", variant: "destructive" });
      return;
    }
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("maintenance_logs").insert({
        belt_id: form.belt_id,
        maintenance_type: form.maintenance_type,
        description: form.description.trim() || null,
        downtime_hours: form.downtime_hours ? Number(form.downtime_hours) : null,
        cost: form.cost ? Number(form.cost) : null,
        performed_by: user.id,
        performed_at: new Date().toISOString(),
      });
      if (error) throw error;

      const { error: beltError } = await supabase
        .from("conveyor_belts")
        .update({ last_maintenance: new Date().toISOString(), status: "operational" })
        .eq("id", form.belt_id);
      if (beltError) throw beltError;

      toast({ title: "Maintenance logged", description: "Belt marked as serviced and operational." });
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      fetchData();
    } catch (error: unknown) {
      toast({ title: "Save failed", description: errorMessage(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const typeBadgeVariant = (type: string) =>
    type === "corrective" ? "destructive" : type === "predictive" ? "secondary" : "default";

  const totalCost = logs.reduce((s, l) => s + (l.cost ?? 0), 0);
  const totalDowntime = logs.reduce((s, l) => s + (l.downtime_hours ?? 0), 0);

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Maintenance Log</h1>
          <p className="text-sm md:text-base text-muted-foreground">
            Track maintenance events, downtime, and costs
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => setDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Log Maintenance
          </Button>
        )}
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 bg-gradient-to-br from-card to-card/50">
          <p className="text-sm text-muted-foreground">Total Events</p>
          <p className="text-2xl font-bold">{logs.length}</p>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-card to-card/50">
          <p className="text-sm text-muted-foreground">Total Downtime</p>
          <p className="text-2xl font-bold">{totalDowntime.toFixed(1)} hrs</p>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-card to-card/50">
          <p className="text-sm text-muted-foreground">Total Cost</p>
          <p className="text-2xl font-bold">${totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
        </Card>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading logs...
        </div>
      ) : (
        <Card className="bg-gradient-to-br from-card to-card/50">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Belt</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Downtime</TableHead>
                <TableHead>Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No maintenance logged yet.
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>
                      {log.performed_at ? new Date(log.performed_at).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="font-medium">{log.belt_name}</TableCell>
                    <TableCell>
                      <Badge variant={typeBadgeVariant(log.maintenance_type)} className="capitalize">
                        {log.maintenance_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">
                      {log.description || "—"}
                    </TableCell>
                    <TableCell>{log.downtime_hours != null ? `${log.downtime_hours} hrs` : "—"}</TableCell>
                    <TableCell>
                      {log.cost != null ? `$${log.cost.toLocaleString()}` : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log Maintenance</DialogTitle>
            <DialogDescription>
              Records the event and marks the belt as serviced and operational.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Belt</Label>
              <Select value={form.belt_id} onValueChange={(v) => setForm({ ...form, belt_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a belt" />
                </SelectTrigger>
                <SelectContent>
                  {belts.map((belt) => (
                    <SelectItem key={belt.id} value={belt.id}>
                      {belt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={form.maintenance_type}
                onValueChange={(v) => setForm({ ...form, maintenance_type: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="preventive">Preventive</SelectItem>
                  <SelectItem value="corrective">Corrective</SelectItem>
                  <SelectItem value="predictive">Predictive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="maint-desc">Description</Label>
              <Textarea
                id="maint-desc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Replaced idler rollers, tensioned belt..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="maint-downtime">Downtime (hours)</Label>
                <Input
                  id="maint-downtime"
                  type="number"
                  step="0.1"
                  min="0"
                  value={form.downtime_hours}
                  onChange={(e) => setForm({ ...form, downtime_hours: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maint-cost">Cost ($)</Label>
                <Input
                  id="maint-cost"
                  type="number"
                  step="1"
                  min="0"
                  value={form.cost}
                  onChange={(e) => setForm({ ...form, cost: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveLog} disabled={saving} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Log
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Maintenance;
