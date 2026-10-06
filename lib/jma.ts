import { jstDateKey, jstParts } from "./time";
import type { ActiveWarning, JmaDay, PopSlot } from "./types";
import { weatherCodeLabel } from "./weather-codes";
import { warningName } from "./warning-codes";

const EAST_CODE = "140010";
const WEEKLY_CODE = "140000";
const KAMAKURA_CODE = "1420400";
const INACTIVE = new Set(["解除", "発表警報・注意報はなし"]);

type Area = {
  area?: { name?: string; code?: string };
  weathers?: string[];
  winds?: string[];
  waves?: string[];
  weatherCodes?: string[];
  pops?: string[];
  reliabilities?: string[];
  tempsMin?: string[];
  tempsMax?: string[];
};

type TimeSeries = {
  timeDefines?: string[];
  areas?: Area[];
};

type ForecastDoc = {
  publishingOffice?: string;
  reportDatetime?: string;
  timeSeries?: TimeSeries[];
};

type WarningKind = {
  code?: string;
  status?: string;
  additions?: string[];
  properties?: {
    significancyPart?: {
      locals?: { areaName?: string; additions?: string[] }[];
    };
  }[];
};

type WarningArea = { areaCode?: string; kinds?: WarningKind[] };

type WarningBulletin = {
  reportDatetime?: string;
  warning?: {
    class20Items?: WarningArea[];
  };
};

function clean(text: string | undefined): string | null {
  if (!text) return null;
  const normalized = text.replaceAll("\u3000", " ").replace(/\s+/g, " ").trim();
  return normalized || null;
}

function numberOrNull(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function areaByCode(series: TimeSeries | undefined, code: string): Area | undefined {
  return series?.areas?.find((area) => area.area?.code === code);
}

function dateOf(iso: string): string {
  return jstDateKey(Date.parse(iso));
}

function popLabel(iso: string): string {
  const start = jstParts(Date.parse(iso));
  const endHour = (start.hour + 6) % 24;
  const endLabel = start.hour + 6 === 24 ? 24 : endHour;
  return `${start.hour}–${endLabel}時`;
}

function indexForDate(times: string[] | undefined, date: string): number {
  if (!times) return -1;
  return times.findIndex((time) => dateOf(time) === date);
}

export function parseJmaForecast(
  raw: unknown,
  dates: string[],
): { office: string; reportDatetime: string | null; days: JmaDay[] } {
  const docs = Array.isArray(raw) ? (raw as ForecastDoc[]) : [];
  const short = docs[0];
  const weekly = docs[1];
  const shortNarrative = short?.timeSeries?.[0];
  const shortPop = short?.timeSeries?.[1];
  const weekNarrative = weekly?.timeSeries?.[0];
  const weekTemp = weekly?.timeSeries?.[1];
  const east = areaByCode(shortNarrative, EAST_CODE);
  const eastPop = areaByCode(shortPop, EAST_CODE);
  const week = areaByCode(weekNarrative, WEEKLY_CODE);
  const yokohama = weekTemp?.areas?.find((area) => area.area?.name === "横浜");

  const days = dates.map((date): JmaDay => {
    const shortIndex = indexForDate(shortNarrative?.timeDefines, date);
    const weekIndex = indexForDate(weekNarrative?.timeDefines, date);
    const pops: PopSlot[] = [];
    shortPop?.timeDefines?.forEach((time, index) => {
      if (dateOf(time) !== date) return;
      const percent = numberOrNull(eastPop?.pops?.[index]);
      if (percent === null) return;
      pops.push({ label: popLabel(time), percent });
    });

    if (shortIndex >= 0) {
      return {
        date,
        source: "short",
        weatherText: clean(east?.weathers?.[shortIndex]),
        windText: clean(east?.winds?.[shortIndex]),
        waveText: clean(east?.waves?.[shortIndex]),
        pops,
        dailyPop:
          pops.length > 0 ? null : numberOrNull(week?.pops?.[weekIndex]),
        reliability: null,
        yokohamaMinC: null,
        yokohamaMaxC: null,
      };
    }

    if (weekIndex >= 0) {
      const code = week?.weatherCodes?.[weekIndex];
      return {
        date,
        source: "weekly",
        weatherText: code ? weatherCodeLabel(code) : null,
        windText: null,
        waveText: null,
        pops: [],
        dailyPop: numberOrNull(week?.pops?.[weekIndex]),
        reliability: clean(week?.reliabilities?.[weekIndex]),
        yokohamaMinC: numberOrNull(yokohama?.tempsMin?.[weekIndex]),
        yokohamaMaxC: numberOrNull(yokohama?.tempsMax?.[weekIndex]),
      };
    }

    return {
      date,
      source: null,
      weatherText: null,
      windText: null,
      waveText: null,
      pops,
      dailyPop: null,
      reliability: null,
      yokohamaMinC: null,
      yokohamaMaxC: null,
    };
  });

  return {
    office: short?.publishingOffice ?? weekly?.publishingOffice ?? "横浜地方気象台",
    reportDatetime: short?.reportDatetime ?? weekly?.reportDatetime ?? null,
    days,
  };
}

function notesOf(kind: WarningKind): string[] {
  const notes = new Set<string>();
  for (const addition of kind.additions ?? []) notes.add(addition);
  for (const property of kind.properties ?? []) {
    for (const local of property.significancyPart?.locals ?? []) {
      if (local.areaName) notes.add(local.areaName);
      for (const addition of local.additions ?? []) notes.add(addition);
    }
  }
  return [...notes];
}

export function parseWarnings(raw: unknown): ActiveWarning[] {
  const bulletins = (Array.isArray(raw) ? raw : []) as WarningBulletin[];
  const ordered = [...bulletins].sort((a, b) =>
    (a.reportDatetime ?? "").localeCompare(b.reportDatetime ?? ""),
  );
  const current = new Map<string, ActiveWarning & { inactive: boolean }>();

  for (const bulletin of ordered) {
    const area = bulletin.warning?.class20Items?.find(
      (item) => item.areaCode === KAMAKURA_CODE,
    );
    if (!area?.kinds) continue;
    const cleared = area.kinds.some(
      (kind) => !kind.code && kind.status === "発表警報・注意報はなし",
    );
    if (cleared) current.clear();
    for (const kind of area.kinds) {
      if (!kind.code || !kind.status) continue;
      const inactive = INACTIVE.has(kind.status);
      current.set(kind.code, {
        code: kind.code,
        name: warningName(kind.code),
        status: kind.status,
        notes: notesOf(kind),
        severe: warningName(kind.code).includes("警報"),
        inactive,
      });
    }
  }

  return [...current.values()]
    .filter((warning) => !warning.inactive)
    .map((warning) => ({
      code: warning.code,
      name: warning.name,
      status: warning.status,
      notes: warning.notes,
      severe: warning.severe,
    }))
    .sort((a, b) => Number(a.code) - Number(b.code));
}
