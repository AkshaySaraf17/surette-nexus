export type GapVerdict = "in_line" | "below" | "above";

/**
 * How to describe a town's median home value against the Market Lab model: only call it higher or
 * lower when the gap is bigger than the model's typical error; otherwise it's "in line".
 */
export function gapVerdict(gapPct: number, typicalErrorPct: number): GapVerdict {
  if (Math.abs(gapPct) <= typicalErrorPct) return "in_line";
  return gapPct < 0 ? "below" : "above";
}
