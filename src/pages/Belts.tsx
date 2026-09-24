import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Loader2, SlidersHorizontal, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { useToast } from "@/hooks/use-toast";
import { useRoles } from "@/hooks/useRoles";
import {
  evaluateThresholds,
  fetchThresholds as fetchBeltThresholds,
  createAlertsForViolations,
} from "@/lib/alertRules";
import { errorMessage } from "@/lib/errors";
import { AiDiagnosisDialog } from "@/components/AiDiagnosisDialog";

interface Belt {
  id: string;
  name: string;
  location: string;
  status: string;
  speed: number | null;
  load_percentage: number | null;
  temperature: number | null;
  vibration: number | null;
  last_maintenance: string | null;
}

interface ThresholdRow {
  id: string;
  belt_id: string | null;
  metric: string;
  warning_value: number;
  critical_value: number;
}

const EMPTY_FORM = {
  name: "",
  location: "",
  status: "operational",
  speed: "4.5",
  load_percentage: "70",
  temperature: "40",
  vibration: "2",
};

const METRICS = [
  { key: "temperature", label: "Temperature (°C)" },
  { key: "vibration", label: "Vibration (mm/s)" },
  { key: "load_percentage", label: "Load (%)" },
  { key: "speed", label: "Speed (m/s)" },
];

const Belts = () => {
  const [belts, setBelts] = useState<Belt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Belt | null>(null);
  const [deleting, setDeleting] = useState<Belt | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [thresholdBelt, setThresholdBelt] = useState<Belt | null>(null);
  const [diagnosisBelt, setDiagnosisBelt] = useState<Belt | null>(null);
  const [globalThresholds, setGlobalThresholds] = useState<ThresholdRow[]>([]);
  const [beltThresholds, setBeltThresholds] = useState<ThresholdRow[]>([]);
  const [thresholdDraft, setThresholdDraft] = useState<Record<string, { warning: string; critical: string }>>({});
  const { toast } = useToast();
  const { isAdmin, isOperator, canEdit, loading: rolesLoading } = useRoles();

  const fetchBelts = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("conveyor_belts").select("*").order("name");
    if (error) {
      toast({ title: "Failed to load belts", description: error.message, variant: "destructive" });
    } else {
      setBelts((data || []) as Belt[]);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchBelts();
    supabase
      .from("alert_thresholds")
      .select("id, belt_id, metric, warning_value, critical_value")
      .is("belt_id", null)
      .then(({ data }) => setGlobalThresholds((data || []) as ThresholdRow[]));
  }, [fetchBelts]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (belt: Belt) => {
    setEditing(belt);
    setForm({
      name: belt.name,
      location: belt.location,
      status: belt.status,
      speed: String(belt.speed ?? ""),
      load_percentage: String(belt.load_percentage ?? ""),
      temperature: String(belt.temperature ?? ""),
      vibration: String(belt.vibration ?? ""),
    });
    setDialogOpen(true);
  };

  const saveBelt = async () => {
    if (!form.name.trim() || !form.location.trim()) {
      toast({ title: "Name and location are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      location: form.location.trim(),
      status: form.status,
      speed: Number(form.speed) || 0,
      load_percentage: Number(form.load_percentage) || 0,
      temperature: Number(form.temperature) || 0,
      vibration: Number(form.vibration) || 0,
    };

    try {
      if (editing) {
        const { error } = await supabase
          .from("conveyor_belts")
          .update(payload)
          .eq("id", editing.id);
        if (error) throw error;

        const thresholds = await fetchBeltThresholds(editing.id);
        const violations = evaluateThresholds(
          {
            temperature: payload.temperature,
            vibration: payload.vibration,
            load_percentage: payload.load_percentage,
            speed: payload.speed,
          },
          thresholds
        );
        const created = await createAlertsForViolations(editing.id, payload.name, violations);
        toast({
          title: "Belt updated",
          description: created > 0 ? `${created} alert(s) generated from threshold check.` : undefined,
        });
      } else {
        const { error } = await supabase.from("conveyor_belts").insert(payload);
        if (error) throw error;
        toast({ title: "Belt created", description: `${payload.name} added.` });
      }
      setDialogOpen(false);
      fetchBelts();
    } catch (error: unknown) {
      toast({ title: "Save failed", description: errorMessage(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const deleteBelt = async () => {
    if (!deleting) return;
    const { error } = await supabase.from("conveyor_belts").delete().eq("id", deleting.id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Belt deleted", description: `${deleting.name} removed.` });
      fetchBelts();
    }
    setDeleting(null);
  };

  const openThresholds = async (belt: Belt) => {
    setThresholdBelt(belt);
    const { data } = await supabase
      .from("alert_thresholds")
      .select("id, belt_id, metric, warning_value, critical_value")
      .eq("belt_id", belt.id);
    const overrides = (data || []) as ThresholdRow[];
    setBeltThresholds(overrides);

    const draft: Record<string, { warning: string; critical: string }> = {};
    for (const metric of METRICS) {
      const override = overrides.find((o) => o.metric === metric.key);
      const base = globalThresholds.find((g) => g.metric === metric.key);
      const src = override ?? base;
      draft[metric.key] = {
        warning: String(src?.warning_value ?? ""),
        critical: String(src?.critical_value ?? ""),
      };
    }
    setThresholdDraft(draft);
  };

  const saveThresholds = async () => {
    if (!thresholdBelt) return;
    setSaving(true);
    try {
      for (const metric of METRICS) {
        const draft = thresholdDraft[metric.key];
        if (!draft) continue;
        const warning = Number(draft.warning);
        const critical = Number(draft.critical);
        if (isNaN(warning) || isNaN(critical)) continue;

        const existing = beltThresholds.find((o) => o.metric === metric.key);
        const direction = metric.key === "speed" ? "below" : "above";
        if (existing) {
          await supabase
            .from("alert_thresholds")
            .update({ warning_value: warning, critical_value: critical })
            .eq("id", existing.id);
        } else {
          await supabase.from("alert_thresholds").insert({
            belt_id: thresholdBelt.id,
            metric: metric.key,
            direction,
            warning_value: warning,
            critical_value: critical,
          });
        }
      }
      toast({ title: "Thresholds saved", description: `Alert rules updated for ${thresholdBelt.name}.` });
      setThresholdBelt(null);
    } catch (error: unknown) {
      toast({ title: "Save failed", description: errorMessage(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const statusBadge = (status: string) => (
    <Badge
      variant={
        status === "critical" ? "destructive" : status === "warning" ? "secondary" : "default"
      }
      className="capitalize"
    >
      {status}
    </Badge>
  );

  if (loading || rolesLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading belts...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Belt Management</h1>
          <p className="text-sm md:text-base text-muted-foreground">
            Add, update, and configure alert thresholds for conveyor belts
          </p>
        </div>
        {isAdmin && (
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" /> Add Belt
          </Button>
        )}
      </header>

      {!canEdit && (
        <Card className="p-4 border-status-info/20 bg-status-info/5">
          <p className="text-sm text-muted-foreground">
            You have view-only access. Ask an admin or operator to make changes.
          </p>
        </Card>
      )}

      <Card className="bg-gradient-to-br from-card to-card/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Speed</TableHead>
              <TableHead>Load</TableHead>
              <TableHead>Temp</TableHead>
              <TableHead>Vibration</TableHead>
              <TableHead>Last Maintenance</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {belts.map((belt) => (
              <TableRow key={belt.id}>
                <TableCell className="font-medium">{belt.name}</TableCell>
                <TableCell>{belt.location}</TableCell>
                <TableCell>{statusBadge(belt.status)}</TableCell>
                <TableCell>{belt.speed} m/s</TableCell>
                <TableCell>{belt.load_percentage}%</TableCell>
                <TableCell>{belt.temperature}°C</TableCell>
                <TableCell>{belt.vibration} mm/s</TableCell>
                <TableCell>
                  {belt.last_maintenance
                    ? new Date(belt.last_maintenance).toLocaleDateString()
                    : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      title="Run AI diagnostic"
                      onClick={() => setDiagnosisBelt(belt)}
                    >
                      <Sparkles className="h-4 w-4 text-primary" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      title="Alert thresholds"
                      onClick={() => openThresholds(belt)}
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                    </Button>
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        title="Edit"
                        onClick={() => openEdit(belt)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {isAdmin && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-status-critical"
                        title="Delete"
                        onClick={() => setDeleting(belt)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : "Add Belt"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Changes are checked against alert thresholds on save."
                : "Register a new conveyor belt in the system."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="belt-name">Name</Label>
              <Input
                id="belt-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Belt E-5"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="belt-location">Location</Label>
              <Input
                id="belt-location"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="Section E - Smelter 2"
              />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="operational">Operational</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(
              [
                ["speed", "Speed (m/s)"],
                ["load_percentage", "Load (%)"],
                ["temperature", "Temperature (°C)"],
                ["vibration", "Vibration (mm/s)"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={`belt-${key}`}>{label}</Label>
                <Input
                  id={`belt-${key}`}
                  type="number"
                  step="0.1"
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveBelt} disabled={saving} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Save Changes" : "Create Belt"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!thresholdBelt} onOpenChange={(open) => !open && setThresholdBelt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alert Thresholds — {thresholdBelt?.name}</DialogTitle>
            <DialogDescription>
              Empty fields fall back to global defaults. Warning &lt; Critical for rising metrics;
              for speed, lower values trigger alerts.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {METRICS.map((metric) => {
              const base = globalThresholds.find((g) => g.metric === metric.key);
              return (
                <div key={metric.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
                  <div>
                    <p className="text-sm font-medium">{metric.label}</p>
                    {base && (
                      <p className="text-xs text-muted-foreground">
                        Default: warn {base.warning_value} / crit {base.critical_value}
                      </p>
                    )}
                  </div>
                  <Input
                    className="w-24"
                    type="number"
                    step="0.1"
                    placeholder="Warn"
                    value={thresholdDraft[metric.key]?.warning ?? ""}
                    onChange={(e) =>
                      setThresholdDraft({
                        ...thresholdDraft,
                        [metric.key]: {
                          ...thresholdDraft[metric.key],
                          warning: e.target.value,
                        },
                      })
                    }
                  />
                  <Input
                    className="w-24"
                    type="number"
                    step="0.1"
                    placeholder="Crit"
                    value={thresholdDraft[metric.key]?.critical ?? ""}
                    onChange={(e) =>
                      setThresholdDraft({
                        ...thresholdDraft,
                        [metric.key]: {
                          ...thresholdDraft[metric.key],
                          critical: e.target.value,
                        },
                      })
                    }
                  />
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setThresholdBelt(null)}>
              Cancel
            </Button>
            <Button onClick={saveThresholds} disabled={saving} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Thresholds
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AiDiagnosisDialog
        belt={diagnosisBelt}
        open={diagnosisBelt !== null}
        onOpenChange={(open) => !open && setDiagnosisBelt(null)}
      />

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the belt along with its sensor readings, alerts, and
              maintenance logs. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteBelt} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Belts;
