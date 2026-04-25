import {
  ARENA_RADIUS,
  MAX_ALTITUDE,
  OCEAN_LEVEL,
  TERRAIN_COLLISION_MARGIN,
  TERRAIN_ISLANDS
} from "./constants.js";
import type { TerrainIsland, TerrainPeak } from "./constants.js";
import type { Vec3 } from "./types.js";

export type TerrainKind = "ocean" | "island" | "mountain";

export type TerrainSample = {
  height: number;
  kind: TerrainKind;
};

export function terrainHeightAt(x: number, z: number): TerrainSample {
  let sample: TerrainSample = { height: OCEAN_LEVEL, kind: "ocean" };

  TERRAIN_ISLANDS.forEach((island) => {
    if (isInsideIslandBeach(island, x, z) && sample.height < OCEAN_LEVEL + 0.8) {
      sample = { height: OCEAN_LEVEL + 0.8, kind: "island" };
    }

    island.peaks.forEach((peak) => {
      const peakHeight = mountainHeightAt(island, peak, x, z);
      if (peakHeight > sample.height) {
        sample = { height: peakHeight, kind: "mountain" };
      }
    });
  });

  return sample;
}

export function isTerrainImpact(position: Vec3, previousPosition?: Vec3): boolean {
  if (!previousPosition) {
    return isTerrainSampleImpact(position);
  }

  const segmentLength = Math.hypot(
    position.x - previousPosition.x,
    position.y - previousPosition.y,
    position.z - previousPosition.z
  );
  const steps = Math.min(8, Math.max(1, Math.ceil(segmentLength / 3)));

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const sample = {
      x: previousPosition.x + (position.x - previousPosition.x) * t,
      y: previousPosition.y + (position.y - previousPosition.y) * t,
      z: previousPosition.z + (position.z - previousPosition.z) * t
    };

    if (isTerrainSampleImpact(sample)) {
      return true;
    }
  }

  return false;
}

export function isOutsidePlayArea(position: Vec3): boolean {
  return Math.hypot(position.x, position.z) > ARENA_RADIUS || position.y > MAX_ALTITUDE;
}

function isInsideIslandBeach(island: TerrainIsland, x: number, z: number): boolean {
  const localX = x - island.x;
  const localZ = z - island.z;
  const normalizedX = localX / (island.beachRadius * island.beachScaleX);
  const normalizedZ = localZ / (island.beachRadius * island.beachScaleZ);
  return normalizedX * normalizedX + normalizedZ * normalizedZ <= 1;
}

function isTerrainSampleImpact(position: Vec3): boolean {
  return position.y <= terrainHeightAt(position.x, position.z).height + TERRAIN_COLLISION_MARGIN;
}

function mountainHeightAt(island: TerrainIsland, peak: TerrainPeak, x: number, z: number): number {
  const centerX = island.x + peak.x;
  const centerZ = island.z + peak.z;
  const range = Math.hypot(x - centerX, z - centerZ);
  if (range >= peak.radius) {
    return OCEAN_LEVEL;
  }

  return OCEAN_LEVEL + peak.height * (1 - range / peak.radius);
}
