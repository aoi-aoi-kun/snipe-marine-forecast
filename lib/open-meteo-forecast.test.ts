import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseOpenMeteoForecastHours } from "./open-meteo-forecast";
import { HOUR_MS } from "./time";

describe("open-meteo forecast parse", () => {
  it("keeps UTC 3-hour samples with cumulative precip", () => {
    const nowMs = Date.parse("2026-10-08T05:00:00Z");
    const hours = parseOpenMeteoForecastHours(
      {
        time: [
          "2026-10-08T03:00",
          "2026-10-08T04:00",
          "2026-10-08T05:00",
          "2026-10-08T06:00",
          "2026-10-08T09:00",
        ],
        temperature_2m: [20, 21, 22, 23, 24],
        cloud_cover: [10, 20, 30, 40, 50],
        precipitation: [0, 0.2, 0, 0.5, 0],
        wind_speed_10m: [3, 3.5, 4, 4.5, 5],
        wind_gusts_10m: [5, 5.5, 6, 6.5, 7],
        wind_direction_10m: [90, 90, 180, 180, 270],
      },
      nowMs,
    );
    assert.deepEqual(
      hours.map((hour) => hour.validMs),
      [
        Date.parse("2026-10-08T03:00:00Z"),
        Date.parse("2026-10-08T06:00:00Z"),
        Date.parse("2026-10-08T09:00:00Z"),
      ],
    );
    // Hourly 0.2 at 04z is included before the 06z sample.
    assert.ok(Math.abs(hours[1].precipRunMm - 0.7) < 1e-9);
    assert.equal(hours[1].gustMs, 6.5);
    assert.ok(Math.abs(Math.hypot(hours[1].u, hours[1].v) - 4.5) < 0.01);
  });

  it("drops samples outside the near horizon", () => {
    const nowMs = Date.parse("2026-10-08T05:00:00Z");
    const hours = parseOpenMeteoForecastHours(
      {
        time: ["2026-10-20T00:00", "2026-10-08T06:00"],
        temperature_2m: [20, 21],
        cloud_cover: [0, 0],
        precipitation: [0, 0],
        wind_speed_10m: [2, 3],
        wind_gusts_10m: [3, 4],
        wind_direction_10m: [0, 90],
      },
      nowMs,
    );
    assert.equal(hours.length, 1);
    assert.equal(hours[0].validMs, nowMs + HOUR_MS);
  });
});
