import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CheckCircle2,
  Copy,
  Download,
  Loader2,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Minus,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { fetchThresholds } from "@/lib/alertRules";
import { ReadingPoint } from "@/lib/predictions";
import {
  diagnoseBelt,
  BeltSnapshot,
  AlertSummary,
  MaintenanceSummary,
  DiagnosisResult,
} from "@/lib/diagnosis";

interface AiDiagnosisDialogProps {
  belt: BeltSnapshot | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STEP_DELAY_MS = 450;

export const AiDiagnosisDialog = ({ belt, open, onOpenChange }: AiDiagnosisDialogProps) => {
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [narrative, setNarrative] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const { toast } = useToast();
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    if (!open || !belt) return;

    let cancelled = false;
    setRunning(true);
    setResult(null);
    setNarrative(null);
    setVisibleSteps(0);

    const run = async () => {
      try {
        const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
        const [thresholds, readingsRes, alertsRes, maintRes] = await Promise.all([
          fetchThresholds(belt.id),
          supabase
            .from("sensor_readings")
            .select("temperature, vibration, load_percentage, speed, timestamp")
            .eq("belt_id", belt.id)
            .gte("timestamp", since)
            .order("timestamp", { ascending: true })
            .limit(2000),
          supabase
            .from("alerts")
            .select("title, priority, status, created_at")
            .eq("belt_id", belt.id)
            .order("created_at", { ascending: false })
            .limit(50),
          supabase
            .from("maintenance_logs")
            .select("maintenance_type, description, downtime_hours, cost, performed_at")
            .eq("belt_id", belt.id)
            .order("performed_at", { ascending: false })
            .limit(20),
        ]);

        if (cancelled) return;

        const history: ReadingPoint[] = (readingsRes.data || []).map((r: Record<string, unknown>) => ({
          timestamp: r.timestamp as string,
          temperature: Number(r.temperature),
          vibration: Number(r.vibration),
          load_percentage: Number(r.load_percentage),
          speed: Number(r.speed),
        }));
        const alerts: AlertSummary[] = alertsRes.data || [];
        const maintenance: MaintenanceSummary[] = maintRes.data || [];

        const current = {
          temperature: Number(belt.temperature ?? 0),
          vibration: Number(belt.vibration ?? 0),
          load_percentage: Number(belt.load_percentage ?? 0),
          speed: Number(belt.speed ?? 0),
        };

        const diagnosis = diagnoseBelt(belt, current, history, alerts, maintenance, thresholds);
        if (cancelled) return;
        setResult(diagnosis);

        // Reveal investigation steps one by one, agent-style
        for (let i = 1; i <= diagnosis.steps.length; i++) {
          await new Promise((res) => {
            const t = window.setTimeout(res, i === 1 ? 200 : STEP_DELAY_MS);
            timersRef.current.push(t);
          });
          if (cancelled) return;
          setVisibleSteps(i);
        }

        // Optional LLM narrative — silently skipped if not configured/deployed
        try {
          const { data, error } = await supabase.functions.invoke("ai-diagnose", {
            body: { facts: diagnosis.factsForLlm, beltName: belt.name },
          });
          if (!cancelled && !error && data?.narrative) {
            setNarrative(data.narrative as string);
          }
        } catch {
          // Edge Function not deployed or LLM not configured — deterministic report stands alone
        }
      } finally {
        if (!cancelled) setRunning(false);
      }
    };

    run();
    return () => {
      cancelled = true;
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [open, belt]);

  const buildReportText = () => {
    if (!result) return "";
    const r = result.report;
    const lines = [
      `ConveyorWatch — AI Diagnostic Report`,
      `Belt: ${r.beltName}`,
      `Generated: ${new Date().toLocaleString()}`,
      ``,
      `RISK SCORE: ${r.riskScore}/100 (${r.riskLabel})`,
      `TREND: ${r.trend}${r.daysToFailure !== null ? ` — est. ${r.daysToFailure} day(s) to critical threshold` : ""}`,
      ``,
      `INVESTIGATION STEPS`,
      ...result.steps.map((s, i) => `${i + 1}. ${s.title}\n   ${s.finding}`),
      ``,
      `ROOT CAUSE ANALYSIS`,
      ...r.rootCauses.map((c) => `- ${c}`),
      ``,
      `RECOMMENDED ACTIONS`,
      ...r.recommendedActions.map((a) => `- ${a}`),
      ``,
      `SUMMARY`,
      r.summary,
    ];
    if (narrative) {
      lines.push(``, `AI NARRATIVE`, narrative);
    }
    return lines.join("\n");
  };

  const downloadReport = () => {
    const blob = new Blob([buildReportText()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `diagnosis-${result?.report.beltName.replace(/\s+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const copyReport = async () => {
    await navigator.clipboard.writeText(buildReportText());
    toast({ title: "Copied", description: "Diagnostic report copied to clipboard." });
  };

  const riskBadgeVariant = (score: number) =>
    score >= 70 ? "destructive" : score >= 40 ? "secondary" : "default";

  const TrendIcon = () => {
    if (!result) return null;
    if (result.report.trend === "degrading")
      return <TrendingDown className="h-4 w-4 text-status-critical" />;
    if (result.report.trend === "improving")
      return <TrendingUp className="h-4 w-4 text-status-operational" />;
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Diagnostic — {belt?.name}
          </DialogTitle>
          <DialogDescription>
            The agent investigates sensor trends, thresholds, alerts, and maintenance history, then
            produces a root-cause report.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[55vh] pr-4">
          <div className="space-y-4">
            <div className="space-y-2">
              {result?.steps.slice(0, Math.max(visibleSteps, running ? 0 : result.steps.length)).map((step, i) => (
                <div key={i} className="flex gap-3 items-start">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 text-status-operational shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{step.title}</p>
                    <p className="text-sm text-muted-foreground">{step.finding}</p>
                  </div>
                </div>
              ))}
              {running && (
                <div className="flex gap-3 items-center text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {visibleSteps === 0
                    ? "Gathering data..."
                    : result
                    ? "Correlating findings..."
                    : "Investigating..."}
                </div>
              )}
            </div>

            {result && visibleSteps >= result.steps.length && (
              <div className="space-y-4 border-t border-border pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={riskBadgeVariant(result.report.riskScore)}>
                    Risk {result.report.riskScore}/100 — {result.report.riskLabel}
                  </Badge>
                  <Badge variant="outline" className="gap-1 capitalize">
                    <TrendIcon />
                    {result.report.trend}
                  </Badge>
                  {result.report.daysToFailure !== null && (
                    <Badge variant="outline" className="text-status-critical">
                      ~{result.report.daysToFailure} day(s) to critical
                    </Badge>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-semibold mb-1">Root Cause Analysis</h4>
                  <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-4">
                    {result.report.rootCauses.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h4 className="text-sm font-semibold mb-1">Recommended Actions</h4>
                  <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-4">
                    {result.report.recommendedActions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h4 className="text-sm font-semibold mb-1">Summary</h4>
                  <p className="text-sm text-muted-foreground">{result.report.summary}</p>
                </div>

                {narrative && (
                  <div className="border border-primary/20 bg-primary/5 rounded-md p-3">
                    <h4 className="text-sm font-semibold mb-1 flex items-center gap-1">
                      <Sparkles className="h-3 w-3" /> AI Narrative
                    </h4>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{narrative}</p>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="gap-2" onClick={copyReport}>
                    <Copy className="h-3 w-3" /> Copy
                  </Button>
                  <Button size="sm" variant="outline" className="gap-2" onClick={downloadReport}>
                    <Download className="h-3 w-3" /> Download Report
                  </Button>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
