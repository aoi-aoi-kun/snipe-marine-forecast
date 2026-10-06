import assert from "node:assert/strict";
import test from "node:test";
import { parseWarnings } from "./jma";

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
