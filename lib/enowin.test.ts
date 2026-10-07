import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEnowinCsv, parseEnowinHtml } from "./enowin";
import { buildNowcast, detectRampEvents } from "./nowcast";
import { applyHarborBoost, matchPattern, mergePatternEvents, toPatternEvent } from "./pattern";
import type { WindowForecast } from "./aggregate";
import { degreesFromLabel } from "./wind";

const sampleHtml = `<table>
<TR><TD>日時</TD><TD>平均風速</TD><TD>平均風向</TD><TD>最大風速</TD><TD>最大時風向</TD></TR>
<TR>
<TD>2026/10/07&nbsp;10:00&nbsp;</TD>
<TD><B>3.0&nbsp;m/s</B></TD>
<TD><B>南</B></TD>
<TD><B>4.0&nbsp;m/s</B></TD>
<TD><B>南</B></TD>
</TR>
<TR>
<TD>2026/10/07&nbsp;10:05&nbsp;</TD>
<TD><B>3.2&nbsp;m/s</B></TD>
<TD><B>南</B></TD>
<TD><B>4.2&nbsp;m/s</B></TD>
<TD><B>南</B></TD>
</TR>
</table>`;

describe("enowin parse", () => {
  it("reads HTML rows with direction", () => {
    const samples = parseEnowinHtml(sampleHtml);
    assert.equal(samples.length, 2);
    assert.equal(samples[0].meanMs, 3);
    assert.equal(samples[0].fromLabel, "南");
    assert.equal(samples[0].fromDeg, degreesFromLabel("南"));
    assert.equal(samples[1].maxMs, 4.2);
  });

  it("reads CSV without direction", () => {
    const samples = parseEnowinCsv(`時間,平均風速,最大風速
2026-10-07T10:00:00+09:00,3.0,4.0
2026-10-07T10:05:00+09:00,3.2,4.2
`);
    assert.equal(samples.length, 2);
    assert.equal(samples[1].meanMs, 3.2);
    assert.equal(samples[1].fromLabel, null);
  });
});

describe("nowcast and ramps", () => {
  it("projects rising wind and raises a ramp alert", () => {
    const base = Date.parse("2026-10-07T01:00:00Z");
    const samples = Array.from({ length: 7 }, (_, index) => ({
      atMs: base + index * 5 * 60_000,
      meanMs: 3 + index * 0.6,
      maxMs: 4 + index * 0.6,
      fromLabel: "南",
      fromDeg: 180,
    }));
    const result = buildNowcast(samples, base + 30 * 60_000);
    assert.ok(result.riseRateMsPerHour !== null && result.riseRateMsPerHour > 5);
    assert.ok(result.nowcast.some((point) => point.minutesAhead === 30));
    assert.ok(result.alerts.some((alert) => alert.kind === "ramp"));
  });

  it("warns when nowcast mean exceeds 10 m/s", () => {
    const base = Date.parse("2026-10-07T01:00:00Z");
    const samples = Array.from({ length: 7 }, (_, index) => ({
      atMs: base + index * 5 * 60_000,
      meanMs: 8 + index * 0.7,
      maxMs: 10 + index * 0.7,
      fromLabel: "南",
      fromDeg: 180,
    }));
    const result = buildNowcast(samples, base + 30 * 60_000);
    assert.ok(result.nowcast.some((point) => point.meanMs > 10));
    assert.ok(
      result.alerts.some(
        (alert) => alert.level === "watch" && alert.message.includes("ナウキャストが 10 m/s"),
      ),
    );
  });

  it("detects ramp events of 2.5 m/s in 30 minutes", () => {
    const base = Date.parse("2026-10-07T01:00:00Z");
    const samples = [
      { atMs: base, meanMs: 3, maxMs: 4, fromLabel: "南", fromDeg: 180 },
      { atMs: base + 10 * 60_000, meanMs: 4, maxMs: 5, fromLabel: "南", fromDeg: 180 },
      { atMs: base + 20 * 60_000, meanMs: 5.2, maxMs: 6.5, fromLabel: "南南西", fromDeg: 202.5 },
      { atMs: base + 30 * 60_000, meanMs: 6.2, maxMs: 8, fromLabel: "南南西", fromDeg: 202.5 },
    ];
    const events = detectRampEvents(samples);
    assert.equal(events.length, 1);
    assert.ok(events[0].riseMs >= 2.5);
  });
});

describe("pattern learning", () => {
  it("matches a similar precursor and boosts near windows", () => {
    const atMs = Date.parse("2026-10-06T02:00:00Z");
    const event = toPatternEvent(
      {
        atMs,
        beforeMeanMs: 3,
        peakMeanMs: 8,
        riseMs: 3.5,
        riseMinutes: 25,
        fromDeg: 180,
      },
      [
        {
          start: new Date(atMs - 3600_000).toISOString(),
          end: new Date(atMs + 2 * 3600_000).toISOString(),
          partialFrom: null,
          available: true,
          weather: "晴れ",
          precipMm: 0,
          tempMinC: 20,
          tempMaxC: 21,
          windFromDeg: 180,
          windFromLabel: "南",
          windMeanMs: 4,
          windMaxMs: 4,
          windGustMs: 6,
          noDeparture: false,
        },
      ],
    );
    const store = { updatedAt: Date.now(), events: mergePatternEvents([], [event]) };
    const base = Date.parse("2026-10-07T02:00:00Z");
    const samples = Array.from({ length: 6 }, (_, index) => ({
      atMs: base + index * 5 * 60_000,
      meanMs: 3 + index * 0.5,
      maxMs: 4 + index * 0.5,
      fromLabel: "南",
      fromDeg: 180,
    }));
    const match = matchPattern(samples, store, base + 25 * 60_000, 6);
    assert.ok(match);
    assert.ok(match.boostFactor > 1);

    const windows: WindowForecast[] = [
      {
        start: new Date(base).toISOString(),
        end: new Date(base + 3 * 3600_000).toISOString(),
        partialFrom: null,
        available: true,
        weather: "晴れ",
        precipMm: 0,
        tempMinC: 20,
        tempMaxC: 21,
        windFromDeg: 180,
        windFromLabel: "南",
        windMeanMs: 5,
        windMaxMs: 5,
        windGustMs: 7,
        noDeparture: false,
      },
      {
        start: new Date(base + 3 * 3600_000).toISOString(),
        end: new Date(base + 6 * 3600_000).toISOString(),
        partialFrom: null,
        available: true,
        weather: "晴れ",
        precipMm: 0,
        tempMinC: 20,
        tempMaxC: 21,
        windFromDeg: 180,
        windFromLabel: "南",
        windMeanMs: 5,
        windMaxMs: 5,
        windGustMs: 7,
        noDeparture: false,
      },
    ];
    const adjusted = applyHarborBoost(windows, match);
    assert.equal(adjusted[0].harborAdjusted, true);
    assert.ok((adjusted[0].windMeanMs ?? 0) > 5);
    assert.equal(adjusted[1].harborAdjusted, true);
  });
});
