import { Threshold, BeltValues } from "@/lib/alertRules";

export interface ReadingPoint {
  timestamp: string;
  temperature: number;
  vibration: number;
  load_percentage: number;
  speed: number;
}

export interface BeltPrediction {
  riskScore: number; // 0-100
  label: "Low Risk" | "Moderate Risk" | "High Risk" | "Critical";
  drivers: string[];
  daysToFailure: number | null;
  trend: "stable" | "degrading" | "improving";
}

const METRIC_WEIGHTS: Record<keyof BeltValues, number> = {
  vibration: 0.35,
  temperature: 0.3,
  load_percentage: 0.2,
  speed: 0.15,
};

const METRIC_UNITS: Record<keyof BeltValues, string> = {
  temperature: "°C",
  vibration: "mm/s",
  load_percentage: "%",
  speed: "m/s",
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Severity of a single metric relative to its thresholds: 0 = healthy,
 * 1 = at/past the critical threshold. Handles both "above" metrics
 * (temperature, vibration, load) and "below" metrics (speed).
 */
const metricSeverity = (metric: keyof BeltValues, value: number, thresholds: Threshold[]): number => {
  const t = thresholds.find((th) => th.metric === metric);
  if (!t) return 0;
  if (t.direction === "above") {
    if (value <= t.warning_value) return 0;
    return clamp((value - t.warning_value) / (t.critical_value - t.warning_value), 0, 1);
  }
  if (value >= t.warning_value) return 0;
  return clamp((t.warning_value - value) / (t.warning_value - t.critical_value), 0, 1);
};

/** Least-squares slope of y over x (days). */
const slopePerDay = (points: { x: number; y: number }[]): number => {
  const n = points.length;
  if (n < 2) return 0;
  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - meanX) * (p.y - meanY);
    den += (p.x - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
};

export const predictBeltRisk = (
  beltName: string,
  current: BeltValues,
  history: ReadingPoint[],
  thresholds: Threshold[]
): BeltPrediction => {
  const metrics = Object.keys(METRIC_WEIGHTS) as (keyof BeltValues)[];

  // Weighted severity from the current values
  let risk = 0;
  const drivers: string[] = [];
  let worstMetric: keyof BeltValues = "vibration";
  let worstSeverity = -1;

  for (const metric of metrics) {
    const severity = metricSeverity(metric, current[metric], thresholds);
    risk += METRIC_WEIGHTS[metric] * severity;
    if (severity > worstSeverity) {
      worstSeverity = severity;
      worstMetric = metric;
    }
    if (severity >= 0.75) {
      drivers.push(
        `${metric === "load_percentage" ? "Load" : metric[0].toUpperCase() + metric.slice(1)} at ${current[metric]}${METRIC_UNITS[metric]} — near/past critical threshold`
      );
    } else if (severity >= 0.4) {
      drivers.push(
        `${metric === "load_percentage" ? "Load" : metric[0].toUpperCase() + metric.slice(1)} elevated at ${current[metric]}${METRIC_UNITS[metric]}`
      );
    }
  }

  // Trend component from history of the worst metric
  let daysToFailure: number | null = null;
  let trend: BeltPrediction["trend"] = "stable";
  const t = thresholds.find((th) => th.metric === worstMetric);
  if (history.length >= 5 && t) {
    const t0 = new Date(history[0].timestamp).getTime();
    const points = history.map((h) => ({
      x: (new Date(h.timestamp).getTime() - t0) / (24 * 3600 * 1000),
      y: h[worstMetric],
    }));
    const slope = slopePerDay(points);
    const degrading = t.direction === "above" ? slope > 0 : slope < 0;
    const improving = t.direction === "above" ? slope < 0 : slope > 0;

    const spanDays = Math.max(points[points.length - 1].x, 0.5);
    const significantChange =
      Math.abs(slope) * spanDays > (t.critical_value - t.warning_value) * 0.15;

    if (degrading && significantChange) {
      trend = "degrading";
      // Trend adds up to 20 points of risk
      const trendBonus = clamp(Math.abs(slope) * spanDays / (t.critical_value - t.warning_value), 0, 1) * 20;
      risk += trendBonus;
      drivers.push(
        `${worstMetric === "load_percentage" ? "Load" : worstMetric[0].toUpperCase() + worstMetric.slice(1)} trending ${t.direction === "above" ? "upward" : "downward"} (${slope >= 0 ? "+" : ""}${slope.toFixed(2)}${METRIC_UNITS[worstMetric]}/day)`
      );
      if (Math.abs(slope) > 0) {
        const distance =
          t.direction === "above"
            ? t.critical_value - current[worstMetric]
            : current[worstMetric] - t.critical_value;
        if (distance > 0) {
          const days = distance / Math.abs(slope);
          if (days < 365) daysToFailure = Math.max(1, Math.round(days));
        }
      }
    } else if (improving && significantChange) {
      trend = "improving";
      risk = Math.max(0, risk - 5);
    }
  }

  risk = Math.round(clamp(risk * 100, 0, 100));
  const label: BeltPrediction["label"] =
    risk >= 70 ? "Critical" : risk >= 40 ? "High Risk" : risk >= 20 ? "Moderate Risk" : "Low Risk";

  if (drivers.length === 0) {
    drivers.push(`All metrics within normal operating range on ${beltName}`);
  }
  if (daysToFailure !== null && daysToFailure <= 30) {
    drivers.unshift(`Estimated ${daysToFailure} day(s) to critical threshold at current trend`);
  }

  return { riskScore: risk, label, drivers, daysToFailure, trend };
};
