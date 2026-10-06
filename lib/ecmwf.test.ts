import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  gribUrl,
  ifsCycleCandidates,
  neededSteps,
  parseIndex,
  parsePointValues,
  samplesFromValues,
  selectFields,
} from "./ecmwf";
import { forecastWindows, HOUR_MS } from "./time";

const execFileAsync = promisify(execFile);
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

test("builds the open-data file url", () => {
  const init = Date.parse("2026-10-06T00:00:00.000Z");
  assert.equal(
    gribUrl(init, 3),
    "https://data.ecmwf.int/forecasts/20261006/00z/ifs/0p25/oper/20261006000000-3h-oper-fc.grib2",
  );
});

test("uses 00 and 12 UTC cycles", () => {
  const cycles = ifsCycleCandidates(Date.parse("2026-10-06T06:20:00.000Z"));
  assert.deepEqual(cycles, [
    Date.parse("2026-10-06T00:00:00.000Z"),
    Date.parse("2026-10-05T12:00:00.000Z"),
    Date.parse("2026-10-05T00:00:00.000Z"),
    Date.parse("2026-10-04T12:00:00.000Z"),
  ]);
});

test("needed steps stay on 3-hour marks through the horizon", () => {
  const init = Date.parse("2026-10-06T00:00:00.000Z");
  const now = Date.parse("2026-10-06T06:20:00.000Z");
  const steps = neededSteps(init, now);
  const horizonEnd = forecastWindows(now).at(-1)!.end;
  assert.equal(steps[0], 3);
  assert.ok(steps.every((step, index) => index === 0 || step - steps[index - 1] === 3));
  assert.ok(steps.at(-1)! <= 144);
  assert.ok(init + steps.at(-1)! * HOUR_MS >= horizonEnd);
});

test("selects the surface fields for one step", () => {
  const entries = parseIndex(
    [
      '{"param":"10u","step":"3","levtype":"sfc","_offset":10,"_length":20}',
      '{"param":"10v","step":"3","levtype":"sfc","_offset":30,"_length":20}',
      '{"param":"2t","step":"3","levtype":"sfc","_offset":50,"_length":20}',
      '{"param":"tcc","step":"3","levtype":"sfc","_offset":70,"_length":20}',
      '{"param":"tp","step":"3","levtype":"sfc","_offset":90,"_length":20}',
      '{"param":"t","step":"3","levtype":"pl","_offset":1,"_length":2}',
      '{"param":"10u","step":"0","levtype":"sfc","_offset":2,"_length":3}',
    ].join("\n"),
  );
  const fields = selectFields(entries, 3);
  assert.deepEqual(
    fields.map((field) => field.param),
    ["10u", "10v", "2t", "tcc", "tp"],
  );
  assert.equal(selectFields(entries, 6).length, 0);
});

test("converts ECMWF units at the grid point", () => {
  const [sample] = samplesFromValues(Date.parse("2026-10-06T00:00:00.000Z"), [
    { param: "2t", step: 3, value: 293.15 },
    { param: "10u", step: 3, value: -2 },
    { param: "10v", step: 3, value: 0 },
    { param: "tcc", step: 3, value: 0.25 },
    { param: "tp", step: 3, value: 0.0015 },
  ]);
  assert.equal(sample.validMs, Date.parse("2026-10-06T03:00:00.000Z"));
  assert.equal(sample.tempC, 20);
  assert.equal(sample.u, -2);
  assert.equal(sample.cloudPct, 25);
  assert.equal(sample.precipRunMm, 1.5);
});

test("reads the published grid point from a GRIB message", async () => {
  const file = path.join(fixtures, "ecmwf-tp0.grib2");
  const { stdout } = await execFileAsync(
    "grib_ls",
    ["-j", "-l", "35.25,139.5,1", "-p", "shortName,step", file],
    { maxBuffer: 1024 * 1024 },
  );
  const values = parsePointValues(stdout);
  assert.equal(values.length, 1);
  assert.equal(values[0].param, "tp");
  assert.equal(values[0].step, 0);
  assert.equal(values[0].value, 0);
  assert.equal(readFileSync(file).length, 224);
});
