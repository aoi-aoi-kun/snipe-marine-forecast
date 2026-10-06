import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseJmaForecast, parseWarnings } from "./jma";

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "kanagawa-forecast.json",
);

test("keeps short-range text and weekly text on separate days", () => {
  const raw = JSON.parse(readFileSync(fixture, "utf8"));
  const parsed = parseJmaForecast(raw, [
    "2026-10-06",
    "2026-10-07",
    "2026-10-08",
    "2026-10-09",
    "2026-10-10",
  ]);
  assert.equal(parsed.office, "横浜地方気象台");
  const today = parsed.days[0];
  assert.equal(today.source, "short");
  assert.match(today.weatherText ?? "", /くもり/);
  assert.match(today.windText ?? "", /海上/);
  assert.match(today.windText ?? "", /北東/);
  assert.match(today.waveText ?? "", /うねり/);
  assert.deepEqual(
    today.pops.map((pop) => pop.label),
    ["12–18時", "18–24時"],
  );

  const dayAfter = parsed.days[2];
  assert.equal(dayAfter.source, "short");
  assert.equal(dayAfter.dailyPop, 10);
  assert.equal(dayAfter.windText === null, false);

  const weekly = parsed.days[3];
  assert.equal(weekly.source, "weekly");
  assert.equal(weekly.weatherText, "晴れ時々くもり");
  assert.equal(weekly.windText, null);
  assert.equal(weekly.waveText, null);
  assert.equal(weekly.reliability, "A");
  assert.equal(weekly.yokohamaMinC, 16);
  assert.equal(weekly.yokohamaMaxC, 25);
});

test("merges Kamakura warnings and drops cancelled codes", () => {
  const warnings = parseWarnings([
    {
      reportDatetime: "2026-10-05T13:09:00+09:00",
      warning: {
        class20Items: [
          {
            areaCode: "1420400",
            kinds: [
              {
                code: "16",
                status: "継続",
                additions: ["うねり"],
              },
            ],
          },
        ],
      },
    },
    {
      reportDatetime: "2026-10-05T20:16:00+09:00",
      warning: {
        class20Items: [
          {
            areaCode: "1420400",
            kinds: [
              {
                code: "15",
                status: "発表",
                properties: [
                  {
                    significancyPart: { locals: [{ areaName: "相模湾" }] },
                  },
                ],
              },
              { code: "14", status: "解除" },
            ],
          },
        ],
      },
    },
  ]);
  assert.deepEqual(
    warnings.map((warning) => [warning.name, warning.severe, warning.notes]),
    [
      ["強風注意報", false, ["相模湾"]],
      ["波浪注意報", false, ["うねり"]],
    ],
  );
});
