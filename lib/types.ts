export type WindowForecast = {
  start: string;
  end: string;
  partialFrom: string | null;
  available: boolean;
  weather: "晴れ" | "くもり" | "雨" | null;
  precipMm: number | null;
  tempMinC: number | null;
  tempMaxC: number | null;
  windFromDeg: number | null;
  windFromLabel: string | null;
  windMeanMs: number | null;
  windMaxMs: number | null;
};

export type ActiveWarning = {
  code: string;
  name: string;
  status: string;
  notes: string[];
  severe: boolean;
};

export type ForecastResponse = {
  point: { lat: number; lon: number; name: string };
  generatedAt: string;
  gfs: {
    initTime: string;
    ageHours: number;
    fetchedAt: string;
    degraded: boolean;
    windows: WindowForecast[];
  } | null;
  jma: {
    fetchedAt: string;
    degraded: boolean;
    warnings: ActiveWarning[];
  } | null;
  errors: string[];
};
