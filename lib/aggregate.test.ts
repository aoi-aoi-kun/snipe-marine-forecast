import assert from "node:assert/strict";
import test from "node:test";
import { buildWindows, departureBlocked, type HourSample } from "./aggregate";
import { forecastWindows, HOUR_MS } from "./time";
import { windFromDegrees, windFromLabel } from "./wind";

const now = Date.parse("2026-10-06T06:20:00.000Z");

test("wind direction is the direction the wind comes from", () => {
  assert.equal(windFromLabel(windFromDegrees(0, -1)), "北");
  assert.equal(windFromLabel(windFromDegrees(0, 1)), "南");
  assert.equal(windFromLabel(windFromDegrees(1, 0)), "西");
  assert.equal(windFromLabel(windFromDegrees(-1, 0)), "東");
  assert.equal(windFromLabel(windFromDegrees(-1, -1)), "北東");
});

test("uses 3-hour steps through 144 hours", () => {
  const windows = forecastWindows(now);
  assert.equal(windows.length, 49);
  assert.ok(windows.every((window) => window.end - window.start === 3 * HOUR_MS));
  assert.equal(windows[0].start, Date.parse("2026-10-06T06:00:00.000Z"));
  assert.equal(windows[0].end, Date.parse("2026-10-06T09:00:00.000Z"));
  assert.equal(windows.at(-1)!.start, Date.parse("2026-10-12T06:00:00.000Z"));
  assert.equal(windows.at(-1)!.end, Date.parse("2026-10-12T09:00:00.000Z"));
  assert.ok(windows.at(-1)!.start < now + 144 * HOUR_MS);
  assert.ok(windows.at(-1)!.end >= now + 144 * HOUR_MS);
  for (let index = 1; index < windows.length; index += 1) {
    assert.equal(windows[index].start, windows[index - 1].end);
  }
});

test("aggregates the single 3-hour sample in each window", () => {
  const start = Date.parse("2026-10-06T06:00:00.000Z");
  const hours: HourSample[] = [];
  let precip = 0;
  for (let time = start; time <= start + 6 * HOUR_MS; time += 3 * HOUR_MS) {
    precip += 0.2;
    hours.push({
      validMs: time,
      tempC: 20,
      u: -1,
      v: -1,
      cloudPct: 90,
      precipRunMm: precip,
      gustMs: 4,
    });
  }

  const windows = buildWindows(hours, now);
  assert.equal(windows.length, 49);
  assert.equal(windows[0].available, true);
  assert.equal(windows[0].weather, "くもり");
  assert.equal(windows[0].windFromLabel, "北東");
  assert.equal(windows[0].partialFrom, null);
  assert.equal(windows[0].windMeanMs, windows[0].windMaxMs);
  assert.ok((windows[0].precipMm ?? 0) < 1);
  assert.equal(windows[0].windGustMs, 4);
  assert.equal(windows[0].noDeparture, false);
  assert.equal(windows[2].available, false);
  assert.equal(windows[2].noDeparture, false);

  const atNine = hours.find((hour) => hour.validMs === start + 3 * HOUR_MS);
  const atSix = hours.find((hour) => hour.validMs === start);
  assert.ok(atNine && atSix);
  atNine.precipRunMm = atSix.precipRunMm + 1.2;
  const rainy = buildWindows(hours, now)[0];
  assert.equal(rainy.weather, "雨");
  assert.ok((rainy.precipMm ?? 0) >= 1);
});

test("labels calm wind when the vector average is near zero", () => {
  const start = Date.parse("2026-10-06T15:00:00.000Z");
  const later = Date.parse("2026-10-06T15:00:00.000Z");
  const hours: HourSample[] = [];
  for (let time = start; time <= start + 12 * HOUR_MS; time += 3 * HOUR_MS) {
    hours.push({
      validMs: time,
      tempC: 18,
      u: time % (2 * HOUR_MS) === 0 ? 0.1 : -0.1,
      v: 0,
      cloudPct: 10,
      precipRunMm: 0,
      gustMs: 1,
    });
  }
  const window = buildWindows(hours, later)[0];
  assert.equal(window.available, true);
  assert.equal(window.weather, "晴れ");
  assert.equal(window.windFromLabel, "風向なし");
  assert.equal(window.partialFrom, null);
  assert.equal(window.noDeparture, false);
});

test("departure is impossible at 10 m/s mean or 13 m/s gust", () => {
  assert.equal(departureBlocked(10, 0), true);
  assert.equal(departureBlocked(9.9, 12.9), false);
  assert.equal(departureBlocked(9, 13), true);

  const start = Date.parse("2026-10-06T06:00:00.000Z");
  const hours: HourSample[] = [0, 3].map((step) => ({
    validMs: start + step * HOUR_MS,
    tempC: 20,
    u: step === 0 ? 9 : 0,
    v: 0,
    cloudPct: 10,
    precipRunMm: 0,
    gustMs: step === 0 ? 0 : 13,
  }));
  const blocked = buildWindows(hours, now)[0];
  assert.equal(blocked.available, true);
  assert.equal(blocked.windMeanMs, 9);
  assert.equal(blocked.windGustMs, 13);
  assert.equal(blocked.noDeparture, true);
});
