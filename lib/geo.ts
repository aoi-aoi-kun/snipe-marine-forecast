/** ECMWF IFS 0.25° grid cell centered on the offshore forecast point. */
export const GRID_STEP_DEG = 0.25;

export const OFFSHORE_POINT = {
  lat: 35.25,
  lon: 139.5,
  name: "七里ヶ浜沖",
  caption: "予報格子の代表点（ECMWF IFS 0.25°）",
} as const;

/** Enoshima Yacht Harbor observation used by enowin (harbor-side, not offshore). */
export const HARBOR_POINT = {
  lat: 35.3094,
  lon: 139.4822,
  name: "江の島ヨットハーバー",
  caption: "5分ごとの実況（enowin）",
} as const;

export type LatLon = { lat: number; lon: number };

export function gridCellBounds(center: LatLon, stepDeg = GRID_STEP_DEG) {
  const half = stepDeg / 2;
  return {
    south: center.lat - half,
    north: center.lat + half,
    west: center.lon - half,
    east: center.lon + half,
  };
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: LatLon, b: LatLon): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Approximate km per degree at this latitude (for map scale labels). */
export function kmPerDegreeLon(lat: number): number {
  return 111.32 * Math.cos((lat * Math.PI) / 180);
}

export function kmPerDegreeLat(): number {
  return 110.574;
}

export const OFFSHORE_GRID = gridCellBounds(OFFSHORE_POINT);
export const HARBOR_TO_OFFSHORE_KM = haversineKm(HARBOR_POINT, OFFSHORE_POINT);
