import * as THREE from "three";
import { OCEAN_LEVEL } from "../../../shared/constants.js";
import { sampleTerrainAt } from "../../../shared/terrainField.js";
import type { TerrainKind, TerrainSample } from "../../../shared/terrainField.js";

type TerrainClipmapConfig = {
  name: string;
  halfSize: number;
  innerHalfSize: number;
  step: number;
  snapStep: number;
  yOffset: number;
};

const TERRAIN_LEVELS: TerrainClipmapConfig[] = [
  { name: "near", halfSize: 960, innerHalfSize: 0, step: 20, snapStep: 120, yOffset: 0 },
  { name: "mid", halfSize: 3000, innerHalfSize: 860, step: 70, snapStep: 420, yOffset: -0.06 },
  { name: "far", halfSize: 7000, innerHalfSize: 2800, step: 190, snapStep: 1140, yOffset: -0.12 }
];

const TERRAIN_SAMPLE_CACHE_LIMIT = 120_000;

const TERRAIN_COLORS: Record<TerrainKind, string> = {
  ocean: "#103b46",
  beach: "#cbb878",
  lowland: "#466f40",
  highland: "#5e684d",
  mountain: "#6c6d63",
  snow: "#e7f1f2"
};

const COLOR_DEEP_WATER = new THREE.Color("#083442");
const COLOR_SHALLOW_WATER = new THREE.Color("#0a7f91");
const COLOR_SAND = new THREE.Color(TERRAIN_COLORS.beach);
const COLOR_DRY_GRASS = new THREE.Color("#6f7745");
const COLOR_LUSH_GRASS = new THREE.Color("#356f43");
const COLOR_HIGH_GRASS = new THREE.Color(TERRAIN_COLORS.highland);
const COLOR_DARK_VEGETATION = new THREE.Color("#294936");
const COLOR_ROCK = new THREE.Color(TERRAIN_COLORS.mountain);
const COLOR_DARK_ROCK = new THREE.Color("#454942");
const COLOR_SNOW = new THREE.Color(TERRAIN_COLORS.snow);

export class TerrainSystem {
  private readonly material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.02,
    flatShading: false
  });
  private readonly levels: TerrainClipmapLevel[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  initialize(origin = new THREE.Vector3()): void {
    TERRAIN_LEVELS.forEach((config) => {
      const level = new TerrainClipmapLevel(config, this.material);
      level.update(origin, true);
      this.levels.push(level);
      this.scene.add(level.mesh);
    });
  }

  update(cameraPosition: THREE.Vector3): void {
    this.levels.find((level) => level.needsUpdate(cameraPosition))?.update(cameraPosition);
  }

  dispose(): void {
    this.levels.forEach((level) => {
      this.scene.remove(level.mesh);
      level.dispose();
    });
    this.levels.length = 0;
    this.material.dispose();
  }
}

class TerrainClipmapLevel {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly localCoordinates: Array<{ x: number; z: number }>;
  private readonly actualHalfSize: number;
  private originX = Number.NaN;
  private originZ = Number.NaN;

  constructor(
    private readonly config: TerrainClipmapConfig,
    material: THREE.MeshStandardMaterial
  ) {
    const geometry = new THREE.BufferGeometry();
    const segments = Math.ceil((config.halfSize * 2) / config.step);
    this.actualHalfSize = (segments * config.step) / 2;
    this.localCoordinates = createLocalCoordinates(segments, this.actualHalfSize, config.step);
    this.positions = new Float32Array(this.localCoordinates.length * 3);
    this.colors = new Float32Array(this.localCoordinates.length * 3);

    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    geometry.setAttribute("normal", createUpNormals(this.localCoordinates.length));
    geometry.setIndex(createClipmapIndices(segments, this.actualHalfSize, config));

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = `terrain-${config.name}`;
    this.mesh.receiveShadow = false;
    this.mesh.castShadow = false;
    this.mesh.frustumCulled = false;
  }

  needsUpdate(center: THREE.Vector3): boolean {
    const { x, z } = this.snappedOrigin(center);
    return x !== this.originX || z !== this.originZ;
  }

  update(center: THREE.Vector3, force = false): void {
    const { x: nextOriginX, z: nextOriginZ } = this.snappedOrigin(center);
    if (!force && nextOriginX === this.originX && nextOriginZ === this.originZ) {
      return;
    }

    this.originX = nextOriginX;
    this.originZ = nextOriginZ;

    this.localCoordinates.forEach((local, index) => {
      const worldX = this.originX + local.x;
      const worldZ = this.originZ + local.z;
      const sample = cachedSampleTerrainAt(worldX, worldZ);
      const positionOffset = index * 3;
      this.positions[positionOffset] = worldX;
      this.positions[positionOffset + 1] = terrainRenderHeight(sample, this.config.yOffset);
      this.positions[positionOffset + 2] = worldZ;

      const color = terrainColor(sample);
      this.colors[positionOffset] = color.r;
      this.colors[positionOffset + 1] = color.g;
      this.colors[positionOffset + 2] = color.b;
    });

    const geometry = this.mesh.geometry;
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.attributes.normal.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }

  private snappedOrigin(center: THREE.Vector3): { x: number; z: number } {
    return {
      x: Math.round(center.x / this.config.snapStep) * this.config.snapStep,
      z: Math.round(center.z / this.config.snapStep) * this.config.snapStep
    };
  }
}

function createLocalCoordinates(segments: number, halfSize: number, step: number): Array<{ x: number; z: number }> {
  const coordinates: Array<{ x: number; z: number }> = [];
  for (let zIndex = 0; zIndex <= segments; zIndex += 1) {
    const z = -halfSize + zIndex * step;
    for (let xIndex = 0; xIndex <= segments; xIndex += 1) {
      const x = -halfSize + xIndex * step;
      coordinates.push({ x, z });
    }
  }
  return coordinates;
}

function createUpNormals(vertexCount: number): THREE.BufferAttribute {
  const normals = new Float32Array(vertexCount * 3);
  for (let i = 0; i < normals.length; i += 3) {
    normals[i + 1] = 1;
  }
  return new THREE.BufferAttribute(normals, 3);
}

function createClipmapIndices(segments: number, halfSize: number, config: TerrainClipmapConfig): number[] {
  const indices: number[] = [];
  const row = segments + 1;

  for (let zIndex = 0; zIndex < segments; zIndex += 1) {
    for (let xIndex = 0; xIndex < segments; xIndex += 1) {
      const centerX = -halfSize + (xIndex + 0.5) * config.step;
      const centerZ = -halfSize + (zIndex + 0.5) * config.step;
      if (config.innerHalfSize > 0 && Math.max(Math.abs(centerX), Math.abs(centerZ)) < config.innerHalfSize) {
        continue;
      }

      const a = zIndex * row + xIndex;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  return indices;
}

function terrainRenderHeight(sample: TerrainSample, yOffset: number): number {
  if (sample.kind === "ocean") {
    return OCEAN_LEVEL - 5 - sample.waterDepth * 0.14 + yOffset;
  }
  return sample.height + yOffset;
}

function terrainColor(sample: TerrainSample): THREE.Color {
  const color =
    sample.kind === "ocean"
      ? COLOR_DEEP_WATER.clone().lerp(COLOR_SHALLOW_WATER, THREE.MathUtils.clamp(sample.land / 0.34, 0, 1))
      : landColor(sample);
  const broadShade = THREE.MathUtils.clamp(0.94 + sample.detail * 0.12 + sample.slope * 0.12, 0.72, 1.22);
  return color.multiplyScalar(broadShade);
}

function landColor(sample: TerrainSample): THREE.Color {
  if (sample.kind === "beach") {
    return COLOR_SAND.clone().lerp(COLOR_LUSH_GRASS, THREE.MathUtils.clamp((sample.land - 0.34) / 0.12, 0, 0.28));
  }

  const grass = COLOR_DRY_GRASS.clone().lerp(COLOR_LUSH_GRASS, sample.moisture).lerp(COLOR_HIGH_GRASS, sample.height / 520);
  const rock = COLOR_ROCK.clone().lerp(COLOR_DARK_ROCK, THREE.MathUtils.clamp(sample.slope * 0.6, 0, 1));
  const vegetation = THREE.MathUtils.clamp(sample.moisture * 0.28 + Math.max(0, -sample.detail) * 0.16 - sample.rock * 0.18, 0, 0.34);
  const terrain = grass.lerp(COLOR_DARK_VEGETATION, vegetation).lerp(rock, THREE.MathUtils.clamp(sample.rock, 0, 0.92));
  return terrain.lerp(COLOR_SNOW, THREE.MathUtils.clamp(sample.snow, 0, 1));
}

const terrainSampleCache = new Map<string, TerrainSample>();

function cachedSampleTerrainAt(x: number, z: number): TerrainSample {
  const key = `${Math.round(x)}:${Math.round(z)}`;
  const cached = terrainSampleCache.get(key);
  if (cached) {
    return cached;
  }

  if (terrainSampleCache.size > TERRAIN_SAMPLE_CACHE_LIMIT) {
    terrainSampleCache.clear();
  }

  const sample = sampleTerrainAt(x, z);
  terrainSampleCache.set(key, sample);
  return sample;
}
