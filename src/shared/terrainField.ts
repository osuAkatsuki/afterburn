import { ARENA_RADIUS, OCEAN_LEVEL } from "./constants.js";
import { clamp } from "./math.js";
import { fbm2D, ridgedNoise2D } from "./terrainNoise.js";

export type TerrainKind = "ocean" | "beach" | "lowland" | "highland" | "mountain" | "snow";

export type TerrainSample = {
  height: number;
  kind: TerrainKind;
  land: number;
  slope: number;
};

type LandMass = {
  x: number;
  z: number;
  radiusX: number;
  radiusZ: number;
  rotation: number;
  strength: number;
};

export const TERRAIN_FIELD = {
  seed: 8743,
  renderRadius: ARENA_RADIUS * 1.04,
  renderSegments: 132,
  oceanThreshold: 0.19,
  beachThreshold: 0.27,
  snowLine: 310,
  mountainLine: 250,
  highlandLine: 92,
  landMasses: [
    { x: -230, z: 80, radiusX: 1180, radiusZ: 720, rotation: -0.22, strength: 0.86 },
    { x: 910, z: -870, radiusX: 790, radiusZ: 520, rotation: 0.62, strength: 0.66 },
    { x: -1260, z: -760, radiusX: 720, radiusZ: 430, rotation: -0.75, strength: 0.56 },
    { x: 1550, z: 1050, radiusX: 610, radiusZ: 410, rotation: 0.3, strength: 0.48 },
    { x: -1980, z: 1220, radiusX: 520, radiusZ: 310, rotation: 0.95, strength: 0.42 }
  ] satisfies LandMass[]
} as const;

export function sampleTerrainAt(x: number, z: number): TerrainSample {
  const land = terrainLandAt(x, z);
  if (land < TERRAIN_FIELD.oceanThreshold) {
    return { height: OCEAN_LEVEL, kind: "ocean", land, slope: terrainSlopeAt(x, z) };
  }

  const coast = smoothstep(TERRAIN_FIELD.oceanThreshold, 0.72, land);
  const beach = smoothstep(TERRAIN_FIELD.oceanThreshold, TERRAIN_FIELD.beachThreshold, land);
  const hills = normalized(fbm2D(x * 0.0018, z * 0.0018, TERRAIN_FIELD.seed + 41, 5));
  const valleys = normalized(fbm2D(x * 0.0038, z * 0.0038, TERRAIN_FIELD.seed + 79, 4));
  const ridges = ridgedNoise2D(x * 0.00135, z * 0.00135, TERRAIN_FIELD.seed + 137, 5);
  const mountainMask = smoothstep(0.48, 0.94, land) * smoothstep(0.42, 0.82, ridges);
  const roughness = normalized(fbm2D(x * 0.007, z * 0.007, TERRAIN_FIELD.seed + 211, 3));
  const height =
    OCEAN_LEVEL +
    beach * 2.2 +
    coast * (12 + hills * 78 + valleys * 36 + roughness * 15) +
    mountainMask * (120 + Math.pow(ridges, 2.15) * 420);

  const slope = terrainSlopeAt(x, z);
  return {
    height,
    kind: classifyTerrain(height, land, slope),
    land,
    slope
  };
}

export function terrainLandAt(x: number, z: number): number {
  const broadNoise = fbm2D(x * 0.00052, z * 0.00052, TERRAIN_FIELD.seed, 5);
  const coastNoise = fbm2D(x * 0.0011, z * 0.0011, TERRAIN_FIELD.seed + 17, 4);
  const landMass = TERRAIN_FIELD.landMasses.reduce(
    (value, mass) => Math.max(value, ellipticalLandMass(x, z, mass)),
    0
  );
  const archipelago = normalized(fbm2D(x * 0.00085 + 19.4, z * 0.00085 - 7.2, TERRAIN_FIELD.seed + 503, 4));
  return clamp(landMass + broadNoise * 0.16 + coastNoise * 0.09 + archipelago * 0.16 - 0.14, 0, 1);
}

export function shoreDampingAt(x: number, z: number): number {
  const distanceFromCoast = Math.abs(terrainLandAt(x, z) - TERRAIN_FIELD.oceanThreshold);
  return smoothstep(0.012, 0.14, distanceFromCoast);
}

export function isSpawnUnsafeTerrain(kind: TerrainKind): boolean {
  return kind === "mountain" || kind === "snow";
}

function classifyTerrain(height: number, land: number, slope: number): TerrainKind {
  if (land < TERRAIN_FIELD.oceanThreshold) {
    return "ocean";
  }

  if (land < TERRAIN_FIELD.beachThreshold || height < OCEAN_LEVEL + 5) {
    return "beach";
  }

  if (height >= TERRAIN_FIELD.snowLine) {
    return "snow";
  }

  if (height >= TERRAIN_FIELD.mountainLine || slope > 0.82) {
    return "mountain";
  }

  if (height >= TERRAIN_FIELD.highlandLine || slope > 0.32) {
    return "highland";
  }

  return "lowland";
}

function terrainSlopeAt(x: number, z: number): number {
  const step = 18;
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

  const hills = normalized(fbm2D(x * 0.0018, z * 0.0018, TERRAIN_FIELD.seed + 41, 4));
  const ridges = ridgedNoise2D(x * 0.00135, z * 0.00135, TERRAIN_FIELD.seed + 137, 4);
  const coast = smoothstep(TERRAIN_FIELD.oceanThreshold, 0.72, land);
  const mountainMask = smoothstep(0.48, 0.94, land) * smoothstep(0.42, 0.82, ridges);
  return OCEAN_LEVEL + coast * (12 + hills * 78) + mountainMask * (120 + Math.pow(ridges, 2.15) * 420);
}

function ellipticalLandMass(x: number, z: number, mass: LandMass): number {
  const dx = x - mass.x;
  const dz = z - mass.z;
  const cos = Math.cos(mass.rotation);
  const sin = Math.sin(mass.rotation);
  const localX = dx * cos - dz * sin;
  const localZ = dx * sin + dz * cos;
  const range = Math.hypot(localX / mass.radiusX, localZ / mass.radiusZ);
  return smoothstep(1.12, 0.12, range) * mass.strength;
}

function normalized(value: number): number {
  return value * 0.5 + 0.5;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
