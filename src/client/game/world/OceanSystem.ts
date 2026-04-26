import * as THREE from "three";
import { ARENA_RADIUS, TERRAIN_ISLANDS } from "../../../shared/constants.js";
import type { TerrainIsland } from "../../../shared/constants.js";

type ShoreFoam = {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  baseScaleX: number;
  baseScaleZ: number;
  phase: number;
};

type WaterGlint = {
  origin: THREE.Vector3;
  rotation: number;
  width: number;
  height: number;
  phase: number;
  speed: number;
  drift: number;
  baseOpacity: number;
};

export const OCEAN_SYSTEM_OWNER = "OceanSystem";

export class OceanSystem {
  private readonly shoreFoams: ShoreFoam[] = [];
  private readonly waterGlints: WaterGlint[] = [];
  private readonly waterGlintMatrix = new THREE.Matrix4();
  private readonly waterGlintQuaternion = new THREE.Quaternion();
  private readonly waterGlintPosition = new THREE.Vector3();
  private readonly waterGlintScale = new THREE.Vector3();
  private readonly waterGlintEuler = new THREE.Euler();
  private readonly waterGlintWind = new THREE.Vector2(Math.cos(-0.28), Math.sin(-0.28));
  private ocean?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial>;
  private oceanBasePositions?: Float32Array;
  private waterGlintMesh?: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private oceanNormalFrame = 0;

  constructor(private readonly scene: THREE.Scene) {}

  initialize(): void {
    this.createOcean();
    this.createWaterGlints();
  }

  update(now: number): void {
    this.updateOcean(now);
    this.updateShoreFoam(now);
    this.updateWaterGlints(now);
  }

  createShoreFoam(island: TerrainIsland, group: THREE.Group): void {
    const foam = new THREE.Mesh(
      new THREE.RingGeometry(island.beachRadius * 1.005, island.beachRadius * 1.055, 96),
      new THREE.MeshBasicMaterial({
        color: "#d9fbff",
        transparent: true,
        opacity: 0.15,
        depthWrite: false
      })
    );
    foam.rotation.x = -Math.PI / 2;
    foam.position.y = 0.18;
    foam.scale.set(island.beachScaleX, island.beachScaleZ, 1);
    foam.renderOrder = 1;
    foam.userData.ownerSystem = OCEAN_SYSTEM_OWNER;
    group.add(foam);
    this.shoreFoams.push({
      mesh: foam,
      baseScaleX: island.beachScaleX,
      baseScaleZ: island.beachScaleZ,
      phase: island.x * 0.003 + island.z * 0.005
    });
  }

  getWaterGlintCount(): number {
    return this.waterGlints.length;
  }

  dispose(): void {
    if (this.ocean) {
      this.scene.remove(this.ocean);
      this.ocean.geometry.dispose();
      this.ocean.material.dispose();
      this.ocean = undefined;
      this.oceanBasePositions = undefined;
    }
    if (this.waterGlintMesh) {
      this.scene.remove(this.waterGlintMesh);
      this.waterGlintMesh.geometry.dispose();
      this.waterGlintMesh.material.dispose();
      this.waterGlintMesh = undefined;
    }
    this.shoreFoams.forEach((foam) => {
      foam.mesh.parent?.remove(foam.mesh);
      foam.mesh.geometry.dispose();
      foam.mesh.material.dispose();
    });
    this.shoreFoams.length = 0;
    this.waterGlints.length = 0;
  }

  private createOcean(): void {
    const geometry = new THREE.PlaneGeometry(ARENA_RADIUS * 5, ARENA_RADIUS * 5, 80, 80);
    this.oceanBasePositions = (geometry.attributes.position.array as Float32Array).slice();
    this.applyOceanVertexColors(geometry);

    this.ocean = new THREE.Mesh(
      geometry,
      new THREE.MeshPhysicalMaterial({
        color: "#0b6f86",
        vertexColors: true,
        roughness: 0.34,
        metalness: 0.02,
        clearcoat: 0.38,
        clearcoatRoughness: 0.36,
        reflectivity: 0.24,
        emissive: "#063342",
        emissiveIntensity: 0.055
      })
    );
    this.ocean.rotation.x = -Math.PI / 2;
    this.ocean.position.y = -1;
    this.ocean.receiveShadow = true;
    this.scene.add(this.ocean);
  }

  private applyOceanVertexColors(geometry: THREE.PlaneGeometry): void {
    const positions = geometry.attributes.position.array as Float32Array;
    const colors: number[] = [];
    const deep = new THREE.Color("#07586c");
    const mid = new THREE.Color("#0d7f92");
    const shallow = new THREE.Color("#139aac");

    for (let i = 0; i < positions.length; i += 3) {
      const worldX = positions[i];
      const worldZ = -positions[i + 1];
      const broadVariation =
        Math.sin(worldX * 0.0011 + worldZ * 0.0007) * 0.35 +
        Math.sin(worldX * -0.0008 + worldZ * 0.0013) * 0.28 +
        Math.sin((worldX + worldZ) * 0.00042) * 0.18;
      const nearShore = 1 - this.shoreDamping(worldX, worldZ);
      const mix = THREE.MathUtils.clamp(0.48 + broadVariation + nearShore * 0.28, 0, 1);
      const color = deep.clone().lerp(mid, mix).lerp(shallow, nearShore * 0.35);
      colors.push(color.r, color.g, color.b);
    }

    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  }

  private createWaterGlints(): void {
    const windAngle = -0.28;
    const material = new THREE.MeshBasicMaterial({
      color: "#e6fbff",
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexColors: true
    });
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, 85);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.renderOrder = 0;
    this.waterGlintMesh = mesh;
    this.scene.add(mesh);

    for (let i = 0; i < 85; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 280 + Math.random() * ARENA_RADIUS * 2.15;
      const x = Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;
      if (this.shoreDamping(x, z) < 0.82) {
        continue;
      }

      const width = 10 + Math.random() * 34;
      const height = 0.9 + Math.random() * 2.6;
      const index = this.waterGlints.length;
      const baseOpacity = 0.025 + Math.random() * 0.055;
      this.waterGlints.push({
        origin: new THREE.Vector3(x, 0, z),
        rotation: windAngle + (Math.random() - 0.5) * 0.28,
        width,
        height,
        phase: Math.random() * Math.PI * 2,
        speed: 0.34 + Math.random() * 0.28,
        drift: 8 + Math.random() * 24,
        baseOpacity
      });
      mesh.setColorAt(index, new THREE.Color("#e6fbff").multiplyScalar(0.48 + baseOpacity * 6));
    }

    mesh.count = this.waterGlints.length;
    this.updateWaterGlints(0);
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  }

  private updateOcean(now: number): void {
    if (!this.ocean || !this.oceanBasePositions) {
      return;
    }

    const positions = this.ocean.geometry.attributes.position.array as Float32Array;
    const t = now * 0.001;
    for (let i = 0; i < positions.length; i += 3) {
      const x = this.oceanBasePositions[i];
      const y = this.oceanBasePositions[i + 1];
      positions[i + 2] = this.waveHeight(x, -y, t);
    }

    const material = this.ocean.material;
    material.roughness = 0.34 + Math.sin(t * 0.21) * 0.015;
    material.clearcoat = 0.36 + Math.sin(t * 0.18) * 0.025;
    this.ocean.geometry.attributes.position.needsUpdate = true;
    this.oceanNormalFrame = (this.oceanNormalFrame + 1) % 2;
    if (this.oceanNormalFrame === 0) {
      this.ocean.geometry.computeVertexNormals();
    }
  }

  private waveHeight(worldX: number, worldZ: number, t: number): number {
    const localY = -worldZ;
    const waveHeight =
      Math.sin(worldX * 0.0048 + t * 0.72) * 1.9 +
      Math.sin((worldX + localY) * 0.0036 + t * 1.05) * 1.25 +
      Math.sin(localY * 0.0078 - t * 0.86) * 0.82 +
      Math.sin((worldX * 0.018 - localY * 0.011) + t * 2.15) * 0.28 +
      Math.sin((worldX * 0.031 + localY * 0.027) - t * 2.85) * 0.1;
    return waveHeight * this.shoreDamping(worldX, worldZ);
  }

  private updateShoreFoam(now: number): void {
    const t = now * 0.001;
    this.shoreFoams.forEach((foam) => {
      const pulse = 1 + Math.sin(t * 1.35 + foam.phase) * 0.012;
      foam.mesh.scale.set(foam.baseScaleX * pulse, foam.baseScaleZ * pulse, 1);
      foam.mesh.material.opacity = 0.1 + (Math.sin(t * 1.8 + foam.phase) + 1) * 0.035;
    });
  }

  private updateWaterGlints(now: number): void {
    const mesh = this.waterGlintMesh;
    if (!mesh) {
      return;
    }

    const t = now * 0.001;
    this.waterGlints.forEach((glint, index) => {
      const drift = Math.sin(t * glint.speed + glint.phase) * glint.drift;
      const worldX = glint.origin.x + this.waterGlintWind.x * drift;
      const worldZ = glint.origin.z + this.waterGlintWind.y * drift;
      const shimmer = 0.78 + Math.max(0, Math.sin(t * 1.6 + glint.phase)) * glint.baseOpacity * 7;
      this.waterGlintPosition.set(worldX, this.waveHeight(worldX, worldZ, t) + 0.44, worldZ);
      this.waterGlintEuler.set(-Math.PI / 2, 0, glint.rotation);
      this.waterGlintQuaternion.setFromEuler(this.waterGlintEuler);
      this.waterGlintScale.set(glint.width * shimmer, glint.height, 1);
      this.waterGlintMatrix.compose(this.waterGlintPosition, this.waterGlintQuaternion, this.waterGlintScale);
      mesh.setMatrixAt(index, this.waterGlintMatrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }

  private shoreDamping(worldX: number, worldZ: number): number {
    let damping = 1;
    for (let i = 0; i < TERRAIN_ISLANDS.length; i += 1) {
      const island = TERRAIN_ISLANDS[i];
      const localX = worldX - island.x;
      const localZ = worldZ - island.z;
      const shoreX = island.beachRadius * island.beachScaleX;
      const shoreZ = island.beachRadius * island.beachScaleZ;
      if (Math.abs(localX) > shoreX * 1.34 || Math.abs(localZ) > shoreZ * 1.34) {
        continue;
      }

      const normalizedX = localX / shoreX;
      const normalizedZ = localZ / shoreZ;
      const shorelineDistance = Math.hypot(normalizedX, normalizedZ);
      if (shorelineDistance < 1.34) {
        damping = Math.min(damping, smoothstep(0.98, 1.34, shorelineDistance));
      }
    }
    return damping;
  }
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
