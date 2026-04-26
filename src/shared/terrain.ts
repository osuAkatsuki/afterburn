import {
  ARENA_RADIUS,
  MAX_ALTITUDE,
  TERRAIN_COLLISION_MARGIN
} from "./constants.js";
import { isSpawnUnsafeTerrain, sampleTerrainAt } from "./terrainField.js";
import type { TerrainKind, TerrainSample } from "./terrainField.js";
import type { Vec3 } from "./types.js";

export type { TerrainKind, TerrainSample } from "./terrainField.js";

export function terrainHeightAt(x: number, z: number): TerrainSample {
  return sampleTerrainAt(x, z);
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
  const steps = Math.min(48, Math.max(1, Math.ceil(segmentLength / 8)));

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

function isTerrainSampleImpact(position: Vec3): boolean {
  return position.y <= terrainHeightAt(position.x, position.z).height + TERRAIN_COLLISION_MARGIN;
}

export function isUnsafeSpawnTerrain(kind: TerrainKind): boolean {
  return isSpawnUnsafeTerrain(kind);
}
