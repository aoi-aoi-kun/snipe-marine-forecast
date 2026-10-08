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
  windGustMs: number | null;
  noDeparture: boolean;
  harborAdjusted?: boolean;
  harborAdjustNote?: string | null;
  mosAdjusted?: boolean;
  mosAdjustNote?: string | null;
};

export type HarborObservation = {
  at: string;
  meanMs: number;
  maxMs: number;
  fromLabel: string | null;
  fromDeg: number | null;
};

export type HarborNowcastPoint = {
  minutesAhead: number;
  meanMs: number;
  rawMeanMs?: number;
  fromDeg: number | null;
  fromLabel: string | null;
  rawFromDeg?: number | null;
};

export type NowcastSkill = {
  caseCount: number;
  calibrated: boolean;
  note: string;
  horizons: {
    minutesAhead: number;
    count: number;
    maeCalibrated: number;
    maeRaw: number;
    dampen: number;
    skillVsPersistence: number;
  }[];
};

export type HarborAlert = {
  kind: "ramp" | "threshold" | "rising" | "stale";
  level: "info" | "watch";
  message: string;
};

export type HarborBundle = {
  source: string;
  pointName: string;
  note: string;
  fetchedAt: string;
  degraded: boolean;
  latest: HarborObservation | null;
  recent: HarborObservation[];
  riseRateMsPerHour: number | null;
  directionChangeDeg: number | null;
  nowcast: HarborNowcastPoint[];
  nowcastSkill: NowcastSkill;
  alerts: HarborAlert[];
  pattern: {
    storedEvents: number;
    match: {
      score: number;
      boostFactor: number;
      sampleAt: string;
      note: string;
    } | null;
  };
  mos: {
    pairCount: number;
    binCount: number;
    activeBins: number;
    lastBackfillAt: string | null;
    note: string;
    meta?: {
      mosLambda: number;
      patternLambda: number;
      mosCases: number;
      patternCases: number;
      mosReady: boolean;
      patternReady: boolean;
      note: string;
    };
    continuous: {
      started: boolean;
      intervalMinutes: number;
      lastTickAt: string | null;
      lastTickError: string | null;
    };
  };
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
  ifs: {
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
  harbor: HarborBundle | null;
  errors: string[];
};
