import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  gridCellBounds,
  GRID_STEP_DEG,
  HARBOR_POINT,
  haversineKm,
  OFFSHORE_POINT,
} from "./geo";

describe("geo", () => {
  it("builds the ECMWF 0.25 cell around the offshore point", () => {
    const cell = gridCellBounds(OFFSHORE_POINT, GRID_STEP_DEG);
    assert.equal(cell.south, 35.125);
    assert.equal(cell.north, 35.375);
    assert.equal(cell.west, 139.375);
    assert.equal(cell.east, 139.625);
  });

  it("places harbor a few km from the offshore grid center", () => {
    const km = haversineKm(HARBOR_POINT, OFFSHORE_POINT);
    assert.ok(km > 4 && km < 12);
  });
});
