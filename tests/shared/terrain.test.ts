import { describe, expect, it } from "vitest";
import { OCEAN_LEVEL } from "../../src/shared/constants.js";
import { isTerrainImpact, terrainHeightAt } from "../../src/shared/terrain.js";
import { sampleTerrainAt, shoreDampingAt, TERRAIN_FIELD, terrainLandAt } from "../../src/shared/terrainField.js";

describe("procedural terrain", () => {
  it("returns deterministic samples for the same world coordinates", () => {
    const first = sampleTerrainAt(-420, 180);
    const second = sampleTerrainAt(-420, 180);

    expect(second).toEqual(first);
  });

  it("classifies ocean, beach, land, mountains, and snow from generated height", () => {
    const ocean = findTerrainSample((sample) => sample.kind === "ocean" && sample.land < TERRAIN_FIELD.oceanThreshold - 0.08);
    const beach = findTerrainSample((sample) => sample.kind === "beach");
    const lowland = findTerrainSample((sample) => sample.kind === "lowland");
    const mountain = findTerrainSample((sample) => sample.kind === "mountain");
    const snow = findTerrainSample((sample) => sample.kind === "snow");

    expect(ocean.kind).toBe("ocean");
    expect(ocean.height).toBe(OCEAN_LEVEL);
    expect(beach.height).toBeGreaterThanOrEqual(OCEAN_LEVEL);
    expect(lowland.height).toBeGreaterThan(beach.height);
    expect(mountain.height).toBeGreaterThan(lowland.height);
    expect(snow.height).toBeGreaterThan(mountain.height);
  });

  it("damps ocean waves near shorelines but not in open water", () => {
    const shoreline = findTerrainSample(
      (sample) => sample.kind === "ocean" && terrainLandAt(sample.x, sample.z) > TERRAIN_FIELD.oceanThreshold - 0.08
    );
    const openWater = findTerrainSample(
      (sample) => sample.kind === "ocean" && terrainLandAt(sample.x, sample.z) < TERRAIN_FIELD.oceanThreshold - 0.14
    );

    expect(shoreDampingAt(shoreline.x, shoreline.z)).toBeLessThan(0.7);
    expect(openWater.kind).toBe("ocean");
    expect(shoreDampingAt(openWater.x, openWater.z)).toBeGreaterThan(0.9);
  });

  it("collides against generated mountain heights", () => {
    const mountain = findTerrainSample((sample) => sample.kind === "mountain" || sample.kind === "snow");

    expect(isTerrainImpact({ x: mountain.x, y: mountain.height - 1, z: mountain.z })).toBe(true);
    expect(isTerrainImpact({ x: mountain.x, y: mountain.height + 20, z: mountain.z })).toBe(false);
  });
});

function findTerrainSample(predicate: (sample: ReturnType<typeof sampleTerrainAt> & { x: number; z: number }) => boolean) {
  for (let z = -2800; z <= 2800; z += 56) {
    for (let x = -2800; x <= 2800; x += 56) {
      const sample = sampleTerrainAt(x, z);
      if (predicate({ ...sample, x, z })) {
        return { ...sample, x, z };
      }
    }
  }

  throw new Error("Expected terrain sample was not found");
}
