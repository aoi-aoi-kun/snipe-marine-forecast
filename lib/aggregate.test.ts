import assert from "node:assert/strict";
import test from "node:test";
import { buildWindows, type HourSample } from "./aggregate";
import { HOUR_MS, windowStarts } from "./time";
import { windFromDegrees, windFromLabel } from "./wind";

const now = Date.parse("2026-10-06T06:20:00.000Z");

test("wind direction is the direction the wind comes from", () => {
  assert.equal(windFromLabel(windFromDegrees(0, -1)), "北");
  assert.equal(windFromLabel(windFromDegrees(0, 1)), "南");
  assert.equal(windFromLabel(windFromDegrees(1, 0)), "西");
  assert.equal(windFromLabel(windFromDegrees(-1, 0)), "東");
  assert.equal(windFromLabel(windFromDegrees(-1, -1)), "北東");
});

test("builds nine 12-hour windows through 96 hours", () => {
  assert.equal(windowStarts(now).length, 9);
});

test("aggregates only the hours still ahead in the current window", () => {
  const start = Date.parse("2026-10-06T03:00:00.000Z");
  const hours: HourSample[] = [];
  let precip = 0;
  for (let time = start; time <= start + 12 * HOUR_MS; time += HOUR_MS) {
    precip += 0.1;
    hours.push({
      validMs: time,
      tempC: 20 + ((time - start) / HOUR_MS) * 0.1,
      u: -1,
      v: -1,
      cloudPct: 90,
      precipRunMm: precip,
    });
  }

  const windows = buildWindows(hours, now);
  assert.equal(windows.length, 9);
  assert.equal(windows[0].available, true);
  assert.equal(windows[0].weather, "くもり");
  assert.equal(windows[0].windFromLabel, "北東");
  assert.ok((windows[0].precipMm ?? 0) < 1);
  assert.equal(windows[0].partialFrom, "2026-10-06T06:00:00.000Z");
  assert.equal(windows[1].available, false);

  hours.forEach((hour) => {
    hour.precipRunMm = ((hour.validMs - start) / HOUR_MS) * 0.2;
  });
  const rainy = buildWindows(hours, now)[0];
  assert.equal(rainy.weather, "雨");
  assert.ok((rainy.precipMm ?? 0) >= 1);
});

test("labels calm wind when the vector average is near zero", () => {
  const start = Date.parse("2026-10-06T15:00:00.000Z");
  const later = Date.parse("2026-10-06T15:00:00.000Z");
  const hours: HourSample[] = [];
  for (let time = start; time <= start + 12 * HOUR_MS; time += HOUR_MS) {
    hours.push({
      validMs: time,
      tempC: 18,
      u: time % (2 * HOUR_MS) === 0 ? 0.1 : -0.1,
      v: 0,
      cloudPct: 10,
      precipRunMm: 0,
    });
  }
  const window = buildWindows(hours, later)[0];
  assert.equal(window.available, true);
  assert.equal(window.weather, "晴れ");
  assert.equal(window.windFromLabel, "風向なし");
  assert.equal(window.partialFrom, null);
});
