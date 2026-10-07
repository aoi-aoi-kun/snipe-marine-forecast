import { degreesFromLabel } from "./wind";
import { JST_OFFSET_MS, jstParts } from "./time";

export const ENOWIN_BASE = "http://enowin.japaneast.cloudapp.azure.com";
export const ENOWIN_SOURCE = "江の島ヨットハーバー（enowin）";

export type HarborSample = {
  atMs: number;
  meanMs: number;
  maxMs: number;
  fromLabel: string | null;
  fromDeg: number | null;
};

const USER_AGENT = "shichirigahama-forecast/1.0 (local coastal forecast; harbor nowcast)";

function jstYmd(utcMs: number): string {
  const parts = jstParts(utcMs);
  return [
    parts.year,
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function parseClock(text: string): number | null {
  const match = text.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)) - JST_OFFSET_MS;
}

function parseSpeed(text: string): number | null {
  const match = text.replace(/,/g, "").match(/(-?\d+(?:\.\d+)?)\s*m\/s/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/** Parse a daily enowin HTML table into 5-minute harbor samples. */
export function parseEnowinHtml(html: string): HarborSample[] {
  const rows = html.match(/<TR>\s*[\s\S]*?<\/TR>/gi) ?? [];
  const samples: HarborSample[] = [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<TD[^>]*>([\s\S]*?)<\/TD>/gi)].map((match) =>
      decodeEntities(match[1]),
    );
    if (cells.length < 5) continue;
    if (cells[0].includes("日時")) continue;
    const atMs = parseClock(cells[0]);
    const meanMs = parseSpeed(cells[1]);
    const maxMs = parseSpeed(cells[3]);
    if (atMs === null || meanMs === null || maxMs === null) continue;
    const fromLabel = cells[2] && cells[2] !== "-" ? cells[2] : null;
    samples.push({
      atMs,
      meanMs,
      maxMs,
      fromLabel,
      fromDeg: fromLabel ? degreesFromLabel(fromLabel) : null,
    });
  }
  samples.sort((a, b) => a.atMs - b.atMs);
  return samples;
}

/** Parse an enowin daily CSV (time, mean, max). Direction is absent. */
export function parseEnowinCsv(text: string): HarborSample[] {
  const samples: HarborSample[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("時間")) continue;
    const [stamp, meanRaw, maxRaw] = trimmed.split(",");
    if (!stamp || meanRaw === undefined || maxRaw === undefined) continue;
    const atMs = Date.parse(stamp);
    const meanMs = Number(meanRaw);
    const maxMs = Number(maxRaw);
    if (!Number.isFinite(atMs) || !Number.isFinite(meanMs) || !Number.isFinite(maxMs)) continue;
    samples.push({
      atMs,
      meanMs,
      maxMs,
      fromLabel: null,
      fromDeg: null,
    });
  }
  samples.sort((a, b) => a.atMs - b.atMs);
  return samples;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const bust = url.includes("?") ? `&t=${Date.now()}` : `?t=${Date.now()}`;
    const response = await fetch(`${url}${bust}`, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,text/csv,*/*",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function mergeSamples(primary: HarborSample[], secondary: HarborSample[]): HarborSample[] {
  const byTime = new Map<number, HarborSample>();
  for (const sample of secondary) byTime.set(sample.atMs, sample);
  for (const sample of primary) {
    const previous = byTime.get(sample.atMs);
    byTime.set(
      sample.atMs,
      previous
        ? {
            ...sample,
            fromLabel: sample.fromLabel ?? previous.fromLabel,
            fromDeg: sample.fromDeg ?? previous.fromDeg,
          }
        : sample,
    );
  }
  return [...byTime.values()].sort((a, b) => a.atMs - b.atMs);
}

async function fetchDay(ymd: string): Promise<HarborSample[]> {
  const [html, csv] = await Promise.all([
    fetchText(`${ENOWIN_BASE}/${ymd}.html`),
    fetchText(`${ENOWIN_BASE}/${ymd}.csv`),
  ]);
  const fromHtml = html ? parseEnowinHtml(html) : [];
  const fromCsv = csv ? parseEnowinCsv(csv) : [];
  if (fromHtml.length === 0 && fromCsv.length === 0) {
    const archivedHtml = await fetchText(`${ENOWIN_BASE}/${ymd.slice(0, 4)}/${ymd}.html`);
    const archivedCsv = await fetchText(`${ENOWIN_BASE}/${ymd.slice(0, 4)}/${ymd}.csv`);
    return mergeSamples(
      archivedHtml ? parseEnowinHtml(archivedHtml) : [],
      archivedCsv ? parseEnowinCsv(archivedCsv) : [],
    );
  }
  return mergeSamples(fromHtml, fromCsv);
}

/** Fetch harbor samples for today and the previous `lookbackDays` Japan-time days. */
export async function fetchHarborSamples(
  nowMs: number,
  lookbackDays = 2,
): Promise<HarborSample[]> {
  const days: string[] = [];
  for (let offset = 0; offset <= lookbackDays; offset++) {
    days.push(jstYmd(nowMs - offset * 24 * 60 * 60 * 1000));
  }
  const batches = await Promise.all(days.map((ymd) => fetchDay(ymd)));
  const byTime = new Map<number, HarborSample>();
  for (const batch of batches) {
    for (const sample of batch) byTime.set(sample.atMs, sample);
  }
  return [...byTime.values()].sort((a, b) => a.atMs - b.atMs);
}
