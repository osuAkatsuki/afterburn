import * as THREE from "three";
import { OCEAN_LEVEL } from "../../../shared/constants.js";
import { sampleTerrainAt, TERRAIN_FIELD } from "../../../shared/terrainField.js";
import type { TerrainKind, TerrainSample } from "../../../shared/terrainField.js";

const TERRAIN_COLORS: Record<TerrainKind, string> = {
  ocean: "#0c6b7f",
  beach: "#c2aa73",
  lowland: "#42734f",
  highland: "#5e754d",
  mountain: "#73746b",
  snow: "#e8f0f2"
};

export class TerrainSystem {
  private terrain?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

  constructor(private readonly scene: THREE.Scene) {}

  initialize(): void {
    const geometry = createTerrainGeometry();
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.02,
      flatShading: false
    });

    this.terrain = new THREE.Mesh(geometry, material);
    this.terrain.receiveShadow = true;
    this.terrain.castShadow = true;
    this.scene.add(this.terrain);
  }

  dispose(): void {
    if (!this.terrain) {
      return;
    }

    this.scene.remove(this.terrain);
    this.terrain.geometry.dispose();
    this.terrain.material.dispose();
    this.terrain = undefined;
  }
}

function createTerrainGeometry(): THREE.BufferGeometry {
  const segments = TERRAIN_FIELD.renderSegments;
  const radius = TERRAIN_FIELD.renderRadius;
  const step = (radius * 2) / segments;
  const samples: TerrainSample[] = [];
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (let zIndex = 0; zIndex <= segments; zIndex += 1) {
    const z = -radius + zIndex * step;
    for (let xIndex = 0; xIndex <= segments; xIndex += 1) {
      const x = -radius + xIndex * step;
      const sample = sampleTerrainAt(x, z);
      const height = sample.kind === "ocean" ? OCEAN_LEVEL - 0.08 : sample.height;
      samples.push(sample);
      positions.push(x, height, z);
      pushTerrainColor(colors, sample);
    }
  }

  const row = segments + 1;
  for (let zIndex = 0; zIndex < segments; zIndex += 1) {
    for (let xIndex = 0; xIndex < segments; xIndex += 1) {
      const a = zIndex * row + xIndex;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      if (isOceanCell(samples[a], samples[b], samples[c], samples[d])) {
        continue;
      }

      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function isOceanCell(a: TerrainSample, b: TerrainSample, c: TerrainSample, d: TerrainSample): boolean {
  return [a, b, c, d].every((sample) => sample.kind === "ocean");
}

function pushTerrainColor(colors: number[], sample: TerrainSample): void {
  const base = new THREE.Color(TERRAIN_COLORS[sample.kind]);
  const shade = THREE.MathUtils.clamp(0.82 + sample.slope * 0.28 + sample.land * 0.08, 0.72, 1.16);
  base.multiplyScalar(shade);
  colors.push(base.r, base.g, base.b);
}
