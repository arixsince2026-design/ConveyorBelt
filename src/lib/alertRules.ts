import { supabase } from "@/integrations/supabase/client";

export type MetricKey = "temperature" | "vibration" | "load_percentage" | "speed";

export interface Threshold {
  metric: MetricKey;
  direction: "above" | "below";
  warning_value: number;
  critical_value: number;
}

export interface BeltValues {
  temperature: number;
  vibration: number;
  load_percentage: number;
  speed: number;
}

const METRIC_LABELS: Record<MetricKey, string> = {
  temperature: "Temperature",
  vibration: "Vibration",
  load_percentage: "Load",
  speed: "Speed",
};

const UNIT_LABELS: Record<MetricKey, string> = {
  temperature: "°C",
  vibration: "mm/s",
  load_percentage: "%",
  speed: "m/s",
};

/** Fallbacks matching the seeded global thresholds, used if the table is empty. */
const DEFAULT_THRESHOLDS: Threshold[] = [
  { metric: "temperature", direction: "above", warning_value: 60, critical_value: 75 },
  { metric: "vibration", direction: "above", warning_value: 5, critical_value: 7.5 },
  { metric: "load_percentage", direction: "above", warning_value: 90, critical_value: 97 },
  { metric: "speed", direction: "below", warning_value: 2.5, critical_value: 1.5 },
];

export const fetchThresholds = async (beltId?: string): Promise<Threshold[]> => {
  const { data, error } = await supabase
    .from("alert_thresholds")
    .select("metric, direction, warning_value, critical_value, belt_id")
    .is("belt_id", null)
    .order("metric");
  if (error) return DEFAULT_THRESHOLDS;

  const global = (data || []) as Threshold[];
  if (!beltId) return global;

  const { data: overrides } = await supabase
    .from("alert_thresholds")
    .select("metric, direction, warning_value, critical_value, belt_id")
    .eq("belt_id", beltId);

  const overrideMap = new Map(
    ((overrides || []) as Threshold[]).map((t) => [t.metric, t])
  );
  return global.map((t) => overrideMap.get(t.metric) ?? t);
};

interface Violation {
  metric: MetricKey;
  priority: "warning" | "critical";
  threshold: number;
  actual: number;
}

export const evaluateThresholds = (
  values: BeltValues,
  thresholds: Threshold[]
): Violation[] => {
  const violations: Violation[] = [];
  for (const t of thresholds) {
    const actual = values[t.metric];
    if (actual == null) continue;
    const breached = t.direction === "above" ? actual > t.critical_value : actual < t.critical_value;
    const warned = t.direction === "above" ? actual > t.warning_value : actual < t.warning_value;
    if (breached) {
      violations.push({ metric: t.metric, priority: "critical", threshold: t.critical_value, actual });
    } else if (warned) {
      violations.push({ metric: t.metric, priority: "warning", threshold: t.warning_value, actual });
    }
  }
  return violations;
};

const violationTitle = (v: Violation) =>
  `${METRIC_LABELS[v.metric]} ${v.priority === "critical" ? "Critical" : "Warning"}`;

/**
 * Creates alerts for threshold violations, skipping ones that already have an
 * active alert with the same title for the same belt (deduplication).
 */
export const createAlertsForViolations = async (
  beltId: string,
  beltName: string,
  violations: Violation[]
): Promise<number> => {
  if (violations.length === 0) return 0;

  const { data: existing } = await supabase
    .from("alerts")
    .select("title")
    .eq("belt_id", beltId)
    .neq("status", "resolved");
  const existingTitles = new Set((existing || []).map((a) => a.title));

  const toInsert = violations
    .filter((v) => !existingTitles.has(violationTitle(v)))
    .map((v) => ({
      belt_id: beltId,
      priority: v.priority,
      title: violationTitle(v),
      description:
        `${METRIC_LABELS[v.metric]} at ${v.actual}${UNIT_LABELS[v.metric]} on ${beltName} ` +
        `(threshold ${v.threshold}${UNIT_LABELS[v.metric]}).`,
      status: "active",
    }));

  if (toInsert.length === 0) return 0;
  const { error } = await supabase.from("alerts").insert(toInsert);
  if (error) throw error;
  return toInsert.length;
};
