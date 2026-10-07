const DIRECTIONS = [
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

/** Meteorological direction, degrees clockwise from north, where the wind comes from. */
export function windFromDegrees(u: number, v: number): number {
  const degrees = (270 - (Math.atan2(v, u) * 180) / Math.PI) % 360;
  return (degrees + 360) % 360;
}

export function windFromLabel(degrees: number): string {
  const index = Math.round(degrees / 22.5) % 16;
  return DIRECTIONS[index];
}

/** Map a Japanese 16-point label to degrees (from). Unknown labels return null. */
export function degreesFromLabel(label: string): number | null {
  const index = DIRECTIONS.indexOf(label as (typeof DIRECTIONS)[number]);
  if (index < 0) return null;
  return index * 22.5;
}

export function windSector8(degrees: number): number {
  return Math.round(degrees / 45) % 8;
}
