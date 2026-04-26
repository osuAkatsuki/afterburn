import { ARENA_RADIUS, OCEAN_LEVEL } from "./constants.js";
import { clamp } from "./math.js";
import { fbm2D, ridgedNoise2D } from "./terrainNoise.js";

export type TerrainKind = "ocean" | "beach" | "lowland" | "highland" | "mountain" | "snow";

export type TerrainSample = {
  height: number;
  kind: TerrainKind;
  land: number;
  slope: number;
  moisture: number;
  rock: number;
  snow: number;
  detail: number;
  waterDepth: number;
};

type EllipticalMask = {
  x: number;
  z: number;
  radiusX: number;
  radiusZ: number;
  rotation: number;
  strength: number;
};

type MountainRange = EllipticalMask & {
  ridgeSharpness: number;
};

export const TERRAIN_FIELD = {
  seed: 8743,
  renderRadius: ARENA_RADIUS * 1.45,
  oceanThreshold: 0.34,
  beachThreshold: 0.41,
  snowLine: 610,
  mountainLine: 360,
  highlandLine: 145,
  continentalMasses: [
    { x: -180, z: -120, radiusX: 5000, radiusZ: 3400, rotation: -0.12, strength: 0.6 },
    { x: 1540, z: -980, radiusX: 3200, radiusZ: 2100, rotation: 0.44, strength: 0.32 },
    { x: -2060, z: 1320, radiusX: 2600, radiusZ: 1800, rotation: -0.64, strength: 0.28 },
    { x: 2240, z: 1530, radiusX: 1500, radiusZ: 1220, rotation: 0.7, strength: 0.2 }
  ] satisfies EllipticalMask[],
  waterBasins: [
    { x: -3320, z: 80, radiusX: 1500, radiusZ: 3600, rotation: -0.04, strength: 0.78 },
    { x: 3260, z: 960, radiusX: 1100, radiusZ: 1850, rotation: 0.48, strength: 0.54 },
    { x: 540, z: -780, radiusX: 660, radiusZ: 360, rotation: -0.35, strength: 0.48 },
    { x: -980, z: 1200, radiusX: 760, radiusZ: 420, rotation: 0.52, strength: 0.38 },
    { x: 1520, z: 310, radiusX: 520, radiusZ: 300, rotation: 0.18, strength: 0.28 }
  ] satisfies EllipticalMask[],
  mountainRanges: [
    { x: -680, z: -160, radiusX: 460, radiusZ: 2550, rotation: -0.72, strength: 1, ridgeSharpness: 1.8 },
    { x: 720, z: -1100, radiusX: 360, radiusZ: 1750, rotation: 0.54, strength: 0.78, ridgeSharpness: 2.1 },
    { x: 1240, z: 820, radiusX: 430, radiusZ: 1350, rotation: -0.92, strength: 0.58, ridgeSharpness: 1.55 },
    { x: -1760, z: 980, radiusX: 350, radiusZ: 1500, rotation: -0.24, strength: 0.46, ridgeSharpness: 1.7 }
  ] satisfies MountainRange[]
} as const;

type TerrainMasks = {
  coast: number;
  ridge: number;
  range: number;
  hills: number;
  valleys: number;
  roughness: number;
  detail: number;
  moisture: number;
  mountain: number;
};

export function sampleTerrainAt(x: number, z: number): TerrainSample {
  const land = terrainLandAt(x, z);
  const masks = terrainMasksAt(x, z, land);
  const waterDepth = land < TERRAIN_FIELD.oceanThreshold ? (TERRAIN_FIELD.oceanThreshold - land) * 120 : 0;

  if (land < TERRAIN_FIELD.oceanThreshold) {
    return {
      height: OCEAN_LEVEL,
      kind: "ocean",
      land,
      slope: 0,
      moisture: 1,
      rock: 0,
      snow: 0,
      detail: masks.detail,
      waterDepth
    };
  }

  const height = terrainHeightFromMasks(land, masks);
  const slope = terrainSlopeAt(x, z);
  const rock = clamp(slope * 0.95 + masks.mountain * 0.7 + masks.ridge * 0.12, 0, 1);
  const snow = smoothstep(TERRAIN_FIELD.snowLine - 85, TERRAIN_FIELD.snowLine + 120, height) * smoothstep(0.18, 0.72, rock);

  return {
    height,
    kind: classifyTerrain(height, land, slope, snow),
    land,
    slope,
    moisture: masks.moisture,
    rock,
    snow,
    detail: masks.detail,
    waterDepth
  };
}

export function terrainLandAt(x: number, z: number): number {
  const continental = TERRAIN_FIELD.continentalMasses.reduce(
    (value, mass) => Math.max(value, ellipticalMask(x, z, mass)),
    0
  );
  const basins = TERRAIN_FIELD.waterBasins.reduce((value, basin) => Math.max(value, ellipticalMask(x, z, basin)), 0);
  const macro = fbm2D(x * 0.00022, z * 0.00022, TERRAIN_FIELD.seed, 5);
  const coast = fbm2D(x * 0.00072, z * 0.00072, TERRAIN_FIELD.seed + 17, 4);
  const islandsAndPeninsulas = normalized(fbm2D(x * 0.00095 + 19.4, z * 0.00095 - 7.2, TERRAIN_FIELD.seed + 503, 4));

  return clamp(0.24 + continental + macro * 0.18 + coast * 0.1 + islandsAndPeninsulas * 0.12 - basins, 0, 1);
}

export function shoreDampingAt(x: number, z: number): number {
  const distanceFromCoast = Math.abs(terrainLandAt(x, z) - TERRAIN_FIELD.oceanThreshold);
  return smoothstep(0.01, 0.13, distanceFromCoast);
}

export function isSpawnUnsafeTerrain(kind: TerrainKind): boolean {
  return kind === "mountain" || kind === "snow";
}

function classifyTerrain(height: number, land: number, slope: number, snow: number): TerrainKind {
  if (land < TERRAIN_FIELD.oceanThreshold) {
    return "ocean";
  }

  if (land < TERRAIN_FIELD.beachThreshold || height < OCEAN_LEVEL + 8) {
    return "beach";
  }

  if (snow > 0.42) {
    return "snow";
  }

  if (height >= TERRAIN_FIELD.mountainLine || slope > 0.72) {
    return "mountain";
  }

  if (height >= TERRAIN_FIELD.highlandLine || slope > 0.28) {
    return "highland";
  }

  return "lowland";
}

function terrainMasksAt(x: number, z: number, land: number): TerrainMasks {
  const coast = smoothstep(TERRAIN_FIELD.oceanThreshold, 0.78, land);
  const ridge = ridgedNoise2D(x * 0.00105, z * 0.00105, TERRAIN_FIELD.seed + 137, 6);
  const range = mountainRangeMaskAt(x, z);
  const hills = normalized(fbm2D(x * 0.00145, z * 0.00145, TERRAIN_FIELD.seed + 41, 5));
  const valleys = normalized(fbm2D(x * 0.0026 + 3.7, z * 0.0026 - 9.1, TERRAIN_FIELD.seed + 79, 4));
  const roughness = normalized(fbm2D(x * 0.0062, z * 0.0062, TERRAIN_FIELD.seed + 211, 3));
  const detail = fbm2D(x * 0.016, z * 0.016, TERRAIN_FIELD.seed + 307, 3);
  const moisture = clamp(
    0.46 +
      fbm2D(x * 0.00082 - 4.2, z * 0.00082 + 11.8, TERRAIN_FIELD.seed + 619, 4) * 0.34 +
      (1 - shoreDampingAt(x, z)) * 0.28 -
      range * 0.22,
    0,
    1
  );
  const mountain = clamp(range * Math.pow(smoothstep(0.28, 0.86, ridge), 0.75) + smoothstep(0.76, 0.98, land) * 0.18, 0, 1);

  return { coast, ridge, range, hills, valleys, roughness, detail, moisture, mountain };
}

function terrainHeightFromMasks(land: number, masks: TerrainMasks): number {
  const beachShelf = smoothstep(TERRAIN_FIELD.oceanThreshold, TERRAIN_FIELD.beachThreshold, land) * 5.4;
  const lowRelief = masks.coast * (20 + masks.hills * 145 + masks.valleys * 42 + masks.roughness * 34 + Math.max(0, masks.detail) * 18);
  const mountainRelief =
    masks.mountain * (165 + Math.pow(masks.ridge, 2.2) * 720 + masks.roughness * 145 + Math.max(0, masks.detail) * 54);
  const valleyCut = masks.coast * Math.pow(masks.valleys, 2.1) * (32 + masks.mountain * 150);

  return Math.max(OCEAN_LEVEL + 0.8, OCEAN_LEVEL + beachShelf + lowRelief + mountainRelief - valleyCut);
}

function terrainSlopeAt(x: number, z: number): number {
  const step = 14;
  const land = terrainLandAt(x, z);
  if (land < TERRAIN_FIELD.oceanThreshold) {
    return 0;
  }

  const hX = roughHeightAt(x + step, z) - roughHeightAt(x - step, z);
  const hZ = roughHeightAt(x, z + step) - roughHeightAt(x, z - step);
  return Math.hypot(hX, hZ) / (step * 2);
}

function roughHeightAt(x: number, z: number): number {
  const land = terrainLandAt(x, z);
  if (land < TERRAIN_FIELD.oceanThreshold) {
    return OCEAN_LEVEL;
  }

  return terrainHeightFromMasks(land, terrainMasksAt(x, z, land));
}

function mountainRangeMaskAt(x: number, z: number): number {
  return TERRAIN_FIELD.mountainRanges.reduce((value, range) => {
    const mask = ellipticalMask(x, z, range);
    return Math.max(value, Math.pow(mask, range.ridgeSharpness) * range.strength);
  }, 0);
}

function ellipticalMask(x: number, z: number, mask: EllipticalMask): number {
  const dx = x - mask.x;
  const dz = z - mask.z;
  const cos = Math.cos(mask.rotation);
  const sin = Math.sin(mask.rotation);
  const localX = dx * cos - dz * sin;
  const localZ = dx * sin + dz * cos;
  const range = Math.hypot(localX / mask.radiusX, localZ / mask.radiusZ);
  return smoothstep(1.12, 0.04, range) * mask.strength;
}

function normalized(value: number): number {
  return value * 0.5 + 0.5;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
