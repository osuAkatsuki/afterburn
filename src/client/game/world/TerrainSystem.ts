import * as THREE from "three";
import { TERRAIN_ISLANDS } from "../../../shared/constants.js";
import type { TerrainIsland } from "../../../shared/constants.js";
import { OCEAN_SYSTEM_OWNER, type OceanSystem } from "./OceanSystem.js";

export class TerrainSystem {
  private readonly terrainGroups: THREE.Group[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly oceanSystem: OceanSystem
  ) {}

  initialize(): void {
    TERRAIN_ISLANDS.forEach((island) => this.createIsland(island));
  }

  dispose(): void {
    this.terrainGroups.forEach((group) => {
      this.scene.remove(group);
      disposeObject(group);
    });
    this.terrainGroups.length = 0;
  }

  private createIsland(island: TerrainIsland): void {
    const group = new THREE.Group();
    group.position.set(island.x, 0, island.z);

    const beach = new THREE.Mesh(
      new THREE.CircleGeometry(island.beachRadius, 28),
      new THREE.MeshStandardMaterial({ color: "#c2aa73", roughness: 0.92 })
    );
    beach.rotation.x = -Math.PI / 2;
    beach.position.y = 0.7;
    beach.scale.set(island.beachScaleX, island.beachScaleZ, 1);
    group.add(beach);

    this.oceanSystem.createShoreFoam(island, group);

    const terrainMaterial = new THREE.MeshStandardMaterial({ color: "#3f6f4c", roughness: 0.96 });
    island.peaks.forEach((definition) => {
      const peak = new THREE.Mesh(new THREE.ConeGeometry(definition.radius, definition.height, 7), terrainMaterial);
      peak.position.set(definition.x, definition.height / 2 + 0.8, definition.z);
      peak.castShadow = true;
      peak.receiveShadow = true;
      group.add(peak);
    });

    this.scene.add(group);
    this.terrainGroups.push(group);
  }
}

function disposeObject(object: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  object.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      if (mesh.userData.ownerSystem === OCEAN_SYSTEM_OWNER) {
        return;
      }
      geometries.add(mesh.geometry);
      const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      meshMaterials.forEach((material) => materials.add(material));
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}
