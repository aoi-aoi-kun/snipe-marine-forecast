/** 16-point compass labels (気象庁式・風の吹き出し元). */
export const DIRECTIONS_16 = [
  "北",
  "北北東",
  "北東",
  "東北東",
  "東",
  "東南東",
  "南東",
  "南南東",
  "南",
  "南南西",
  "南西",
  "西南西",
  "西",
  "西北西",
  "北西",
  "北北西",
] as const;

export type WindLabel16 = (typeof DIRECTIONS_16)[number];

const LABEL_ALIASES: Record<string, WindLabel16> = {
  北: "北",
  北北東: "北北東",
  北東: "北東",
  東北東: "東北東",
  東: "東",
  東南東: "東南東",
  南東: "南東",
  南南東: "南南東",
  南: "南",
  南南西: "南南西",
  南西: "南西",
  西南西: "西南西",
  西: "西",
  西北西: "西北西",
  北西: "北西",
  北北西: "北北西",
  // Occasional compact / alternate spellings
  N: "北",
  NNE: "北北東",
  NE: "北東",
  ENE: "東北東",
  E: "東",
  ESE: "東南東",
  SE: "南東",
  SSE: "南南東",
  S: "南",
  SSW: "南南西",
  SW: "南西",
  WSW: "西南西",
  W: "西",
  WNW: "西北西",
  NW: "北西",
  NNW: "北北西",
};

/** Meteorological direction, degrees clockwise from north, where the wind comes from. */
export function windFromDegrees(u: number, v: number): number {
  const degrees = (270 - (Math.atan2(v, u) * 180) / Math.PI) % 360;
  return (degrees + 360) % 360;
}

/** Snap degrees to the nearest of 16 compass points (0, 22.5, …). */
export function snapTo16(degrees: number): number {
  const normalized = ((degrees % 360) + 360) % 360;
  return (Math.round(normalized / 22.5) % 16) * 22.5;
}

export function windFromLabel(degrees: number): WindLabel16 {
  const index = Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16;
  return DIRECTIONS_16[index];
}

function normalizeLabel(label: string): string {
  return label
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, "")
    .trim();
}

/** Map a Japanese 16-point label to degrees (from). Unknown / calm labels return null. */
export function degreesFromLabel(label: string): number | null {
  const key = normalizeLabel(label);
  if (!key || key === "無風" || key === "静穏" || key === "-" || key === "—") {
    return null;
  }
  const canonical = LABEL_ALIASES[key];
  if (!canonical) return null;
  const index = DIRECTIONS_16.indexOf(canonical);
  return index * 22.5;
}

export function windSector8(degrees: number): number {
  return Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
}

export function windSector16(degrees: number): number {
  return Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16;
}
