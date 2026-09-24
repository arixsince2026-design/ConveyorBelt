import { Threshold, BeltValues } from "@/lib/alertRules";
import { predictBeltRisk, ReadingPoint } from "@/lib/predictions";

export interface BeltSnapshot {
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

export interface AlertSummary {
  title: string;
  priority: string;
  status: string;
  created_at: string | null;
}

export interface MaintenanceSummary {
  maintenance_type: string;
  description: string | null;
  downtime_hours: number | null;
  cost: number | null;
  performed_at: string | null;
}

export interface DiagnosisStep {
  title: string;
  finding: string;
}

export interface DiagnosisReport {
  beltName: string;
  riskScore: number;
  riskLabel: string;
  daysToFailure: number | null;
  trend: "stable" | "degrading" | "improving";
  rootCauses: string[];
  recommendedActions: string[];
  summary: string;
}

export interface DiagnosisResult {
  steps: DiagnosisStep[];
  report: DiagnosisReport;
  factsForLlm: string;
}

const UNITS: Record<string, string> = {
  temperature: "°C",
  vibration: "mm/s",
  load_percentage: "%",
  speed: "m/s",
};

const LABELS: Record<string, string> = {
  temperature: "Temperature",
  vibration: "Vibration",
  load_percentage: "Load",
  speed: "Speed",
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "never";

const daysSince = (iso: string | null): number | null =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 3600 * 1000)) : null;

export const diagnoseBelt = (
  belt: BeltSnapshot,
  current: BeltValues,
  history: ReadingPoint[],
  alerts: AlertSummary[],
  maintenance: MaintenanceSummary[],
  thresholds: Threshold[]
): DiagnosisResult => {
  const steps: DiagnosisStep[] = [];

  // Step 1: current sensor snapshot vs thresholds
  const breaches: { metric: string; severity: "warning" | "critical"; value: number; threshold: number }[] = [];
  for (const t of thresholds) {
    const value = current[t.metric as keyof BeltValues];
    if (value == null) continue;
    const isCritical =
      t.direction === "above" ? value >= t.critical_value : value <= t.critical_value;
    const isWarning =
      t.direction === "above" ? value >= t.warning_value : value <= t.warning_value;
    if (isCritical || isWarning) {
      breaches.push({
        metric: t.metric,
        severity: isCritical ? "critical" : "warning",
        value,
        threshold: isCritical ? t.critical_value : t.warning_value,
      });
    }
  }
  steps.push({
    title: "Reading live sensor snapshot",
    finding:
      breaches.length === 0
        ? `All metrics within thresholds (temp ${current.temperature}${UNITS.temperature}, vibration ${current.vibration}${UNITS.vibration}, load ${current.load_percentage}${UNITS.load_percentage}, speed ${current.speed}${UNITS.speed}).`
        : breaches
            .map(
              (b) =>
                `${LABELS[b.metric]} ${b.value}${UNITS[b.metric]} is ${b.severity === "critical" ? "past the critical" : "above the warning"} threshold of ${b.threshold}${UNITS[b.metric]}.`
            )
            .join(" "),
  });

  // Step 2: historical trend
  const prediction = predictBeltRisk(belt.name, current, history, thresholds);
  if (history.length >= 5) {
    const first = history[0];
    const last = history[history.length - 1];
    const spanDays = Math.max(
      1,
      Math.round(
        (new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime()) / (24 * 3600 * 1000)
      )
    );
    steps.push({
      title: `Analyzing ${history.length} readings over ${spanDays} day(s)`,
      finding:
        prediction.trend === "degrading"
          ? `Metrics show a degrading trend${prediction.daysToFailure !== null ? ` — projected to cross the critical threshold in ~${prediction.daysToFailure} day(s)` : " — continued deterioration expected"}.`
          : prediction.trend === "improving"
          ? "Metrics are trending back toward normal operating range."
          : "No significant trend detected — metrics are stable across the period.",
    });
  } else {
    steps.push({
      title: "Analyzing historical readings",
      finding: `Only ${history.length} reading(s) available in the last 30 days — trend analysis needs more history. Upload sensor CSVs or connect live telemetry for deeper analysis.`,
    });
  }

  // Step 3: alert history
  const activeAlerts = alerts.filter((a) => a.status !== "resolved");
  const criticalCount = alerts.filter((a) => a.priority === "critical").length;
  steps.push({
    title: "Reviewing alert history",
    finding:
      alerts.length === 0
        ? "No alerts recorded for this belt."
        : `${alerts.length} alert(s) on record (${criticalCount} critical). ${activeAlerts.length} currently open: ${activeAlerts.slice(0, 3).map((a) => `"${a.title}"`).join(", ") || "none"}.`,
  });

  // Step 4: maintenance records
  const lastMaintDays = daysSince(belt.last_maintenance);
  const lastMaint = maintenance[0];
  steps.push({
    title: "Inspecting maintenance records",
    finding:
      maintenance.length === 0
        ? `No maintenance has been logged${belt.last_maintenance ? `; belt record says last serviced ${belt.last_maintenance} (${lastMaintDays} days ago)` : " and the belt has never been marked serviced"}.`
        : `${maintenance.length} logged event(s). Last: ${lastMaint.maintenance_type} maintenance on ${fmtDate(lastMaint.performed_at)}${lastMaint.description ? ` — "${lastMaint.description}"` : ""}. Belt record shows last serviced ${fmtDate(belt.last_maintenance)}${lastMaintDays !== null ? ` (${lastMaintDays} days ago)` : ""}.`,
  });

  // Step 5: correlation / root cause
  const rootCauses: string[] = [];
  for (const b of breaches) {
    if (b.metric === "vibration") {
      rootCauses.push(
        b.severity === "critical"
          ? `Vibration at ${b.value}${UNITS.vibration} strongly indicates mechanical wear (bearing, roller, or misalignment).`
          : `Elevated vibration (${b.value}${UNITS.vibration}) suggests early-stage mechanical wear or belt misalignment.`
      );
    } else if (b.metric === "temperature") {
      rootCauses.push(
        b.severity === "critical"
          ? `Temperature at ${b.value}${UNITS.temperature} points to friction build-up or motor/drive overheating — inspect bearings and drive components.`
          : `Rising temperature (${b.value}${UNITS.temperature}) may indicate increasing friction; watch for coupling with vibration.`
      );
    } else if (b.metric === "load_percentage") {
      rootCauses.push(
        `Load at ${b.value}${UNITS.load_percentage} is ${b.severity === "critical" ? "at unsafe levels" : "high"} — sustained overloading accelerates wear on all components.`
      );
    } else if (b.metric === "speed") {
      rootCauses.push(
        `Speed at ${b.value}${UNITS.speed} is below the expected floor — possible slippage, motor strain, or deliberate slowdown under mechanical stress.`
      );
    }
  }
  if (prediction.trend === "degrading" && rootCauses.length === 0) {
    rootCauses.push(
      "No threshold breaches yet, but the degradation trend warrants early investigation before values reach warning levels."
    );
  }
  if (rootCauses.length === 0) {
    rootCauses.push("No mechanical or operational anomalies detected — the belt is operating normally.");
  }
  const highVibrationWithLoad = breaches.some((b) => b.metric === "load_percentage") && breaches.some((b) => b.metric === "vibration");
  if (highVibrationWithLoad) {
    rootCauses.push("High load combined with high vibration is a classic overload-damage pattern: vibration is likely a symptom of running above rated capacity.");
  }
  if (lastMaintDays !== null && lastMaintDays > 60 && breaches.length > 0) {
    rootCauses.push(`Overdue maintenance (${lastMaintDays} days since last service) increases the likelihood that wear is the underlying cause.`);
  }
  steps.push({
    title: "Correlating findings",
    finding: rootCauses.join(" "),
  });

  // Recommended actions
  const actions: string[] = [];
  const criticalBreaches = breaches.filter((b) => b.severity === "critical");
  if (criticalBreaches.length > 0) {
    actions.push(
      `Schedule immediate inspection of ${criticalBreaches.map((b) => LABELS[b.metric].toLowerCase()).join(" and ")} — belt status should be treated as critical.`
    );
  } else if (breaches.length > 0) {
    actions.push("Plan a maintenance visit within the week and re-check readings after any adjustment.");
  }
  if (highVibrationWithLoad) {
    actions.push("Reduce load below 80% and observe whether vibration follows; if it does, prioritize a load-balancing review over mechanical repair.");
  }
  if (breaches.some((b) => b.metric === "vibration")) {
    actions.push("Have a technician check roller bearings and belt alignment (vibration checklist).");
  }
  if (breaches.some((b) => b.metric === "temperature")) {
    actions.push("Verify cooling/motor ventilation and inspect for friction hot spots with a thermal camera.");
  }
  if (lastMaintDays !== null && lastMaintDays > 60) {
    actions.push(`Belt is ${lastMaintDays} days past service — add it to the next preventive maintenance cycle.`);
  }
  if (actions.length === 0) {
    actions.push("No action needed — continue routine monitoring.");
  }

  const summary =
    `${belt.name} (${belt.location}) scores ${prediction.riskScore}/100 on the risk index — ${prediction.label.toLowerCase()}. ` +
    (breaches.length > 0
      ? `${breaches.length} metric(s) are outside thresholds${prediction.trend === "degrading" ? " and the trend is worsening" : ""}. `
      : "All metrics are within thresholds. ") +
    (prediction.daysToFailure !== null
      ? `At the current trend, the critical threshold is projected to be crossed in about ${prediction.daysToFailure} day(s). `
      : "") +
    `The most likely explanation: ${rootCauses[0]}`;

  const report: DiagnosisReport = {
    beltName: belt.name,
    riskScore: prediction.riskScore,
    riskLabel: prediction.label,
    daysToFailure: prediction.daysToFailure,
    trend: prediction.trend,
    rootCauses,
    recommendedActions: actions,
    summary,
  };

  const factsForLlm = [
    `Belt: ${belt.name} (${belt.location}), status: ${belt.status}`,
    `Current: temp ${current.temperature}${UNITS.temperature}, vibration ${current.vibration}${UNITS.vibration}, load ${current.load_percentage}${UNITS.load_percentage}, speed ${current.speed}${UNITS.speed}`,
    `Risk score: ${prediction.riskScore}/100 (${prediction.label}), trend: ${prediction.trend}${prediction.daysToFailure !== null ? `, est. days to critical: ${prediction.daysToFailure}` : ""}`,
    `Threshold breaches: ${breaches.length ? breaches.map((b) => `${LABELS[b.metric]}=${b.value}${UNITS[b.metric]} (${b.severity}, limit ${b.threshold}${UNITS[b.metric]})`).join("; ") : "none"}`,
    `Alerts: ${alerts.length} total, ${criticalCount} critical, ${activeAlerts.length} open`,
    `Maintenance: ${maintenance.length} logged events, last serviced ${fmtDate(belt.last_maintenance)}${lastMaintDays !== null ? ` (${lastMaintDays} days ago)` : ""}`,
  ].join("\n");

  return { steps, report, factsForLlm };
};
