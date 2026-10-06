import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { decodeGrib, extractPoint, valueAt } from "./grib";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

test("reads the 5 by 5 temperature subset at 35.25N 139.5E", () => {
  const bytes = new Uint8Array(readFileSync(path.join(fixtures, "temp-5x5.grib2")));
  const fields = decodeGrib(bytes);
  assert.equal(fields.length, 1);
  const value = valueAt(fields[0], 35.25, 139.5);
  assert.ok(Math.abs(value - 299.2103125) < 0.02);
});

test("reads wind, temperature, cloud, and run-total precipitation", () => {
  const bytes = new Uint8Array(readFileSync(path.join(fixtures, "point-f006.grib2")));
  const sample = extractPoint(bytes, 35.25, 139.5);
  assert.equal(sample.forecastHour, 6);
  assert.ok(Math.abs(sample.tempK - 298.133) < 0.01);
  assert.ok(Math.abs(sample.u - -8.20503) < 0.01);
  assert.ok(Math.abs(sample.v - -5.07331) < 0.01);
  assert.ok(Math.abs(sample.cloudPct - 26.2) < 0.05);
  assert.equal(sample.precipRunMm, 0);
});
