import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseOpenMeteoHours } from "./open-meteo-archive";
import { WINDOW_MS } from "./time";
import { windFromDegrees } from "./wind";

describe("open-meteo archive parse", () => {
  it("keeps 3-hour marks and converts meteorological wind to u/v", () => {
    const nowMs = Date.parse("2026-10-08T12:00:00Z");
    const hours = parseOpenMeteoHours(
      {
        time: [
          "2026-10-08T00:00",
          "2026-10-08T01:00",
          "2026-10-08T03:00",
          "2026-10-09T00:00",
        ],
        wind_speed_10m: [5, 6, 4, 7],
        wind_gusts_10m: [8, 9, 6, 10],
        wind_direction_10m: [180, 180, 90, 0],
      },
      nowMs,
    );
    assert.equal(hours.length, 2);
    assert.ok(hours.every((hour) => hour.validMs % WINDOW_MS === 0));
    assert.ok(Math.abs(Math.hypot(hours[0].u, hours[0].v) - 5) < 0.01);
    assert.ok(Math.abs(windFromDegrees(hours[0].u, hours[0].v) - 180) < 0.5);
    assert.equal(hours[0].gustMs, 8);
  });
});
