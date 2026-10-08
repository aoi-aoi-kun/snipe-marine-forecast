import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DIRECTIONS_16,
  degreesFromLabel,
  snapTo16,
  windFromLabel,
  windSector16,
} from "./wind";

describe("16-point wind directions", () => {
  it("round-trips all 16 labels", () => {
    for (let index = 0; index < 16; index++) {
      const deg = index * 22.5;
      const label = windFromLabel(deg);
      assert.equal(label, DIRECTIONS_16[index]);
      assert.equal(degreesFromLabel(label), deg);
      assert.equal(windSector16(deg), index);
    }
  });

  it("maps intermediate angles to the nearest 16-point", () => {
    assert.equal(windFromLabel(11), "北");
    assert.equal(windFromLabel(12), "北北東");
    assert.equal(snapTo16(30), 22.5);
    assert.equal(snapTo16(33.7), 22.5);
    assert.equal(snapTo16(33.8), 45);
  });

  it("treats calm / unknown labels as null", () => {
    assert.equal(degreesFromLabel("無風"), null);
    assert.equal(degreesFromLabel("静穏"), null);
    assert.equal(degreesFromLabel("—"), null);
    assert.equal(degreesFromLabel("謎"), null);
  });

  it("accepts spaced labels from HTML tables", () => {
    assert.equal(degreesFromLabel("北北東"), 22.5);
    assert.equal(degreesFromLabel(" 南南西 "), 202.5);
    assert.equal(degreesFromLabel("NNE"), 22.5);
  });
});
