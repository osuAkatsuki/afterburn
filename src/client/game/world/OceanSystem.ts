import * as THREE from "three";
import { ARENA_RADIUS } from "../../../shared/constants.js";
import { sampleTerrainAt, shoreDampingAt, TERRAIN_FIELD, terrainLandAt } from "../../../shared/terrainField.js";
import { OCEAN_VISUAL_CONFIG } from "./oceanVisualConfig.js";

type ShoreFoam = {
  origin: THREE.Vector3;
  rotation: number;
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

export class OceanSystem {
  private readonly shoreFoams: ShoreFoam[] = [];
  private readonly waterGlints: WaterGlint[] = [];
  private readonly shoreFoamMatrix = new THREE.Matrix4();
  private readonly shoreFoamQuaternion = new THREE.Quaternion();
  private readonly shoreFoamPosition = new THREE.Vector3();
  private readonly shoreFoamScale = new THREE.Vector3();
  private readonly shoreFoamEuler = new THREE.Euler();
  private readonly waterGlintMatrix = new THREE.Matrix4();
  private readonly waterGlintQuaternion = new THREE.Quaternion();
  private readonly waterGlintPosition = new THREE.Vector3();
  private readonly waterGlintScale = new THREE.Vector3();
  private readonly waterGlintEuler = new THREE.Euler();
  private readonly waterGlintWind = new THREE.Vector2(
    Math.cos(OCEAN_VISUAL_CONFIG.waterGlints.windAngle),
    Math.sin(OCEAN_VISUAL_CONFIG.waterGlints.windAngle)
  );
  private ocean?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial>;
  private oceanBasePositions?: Float32Array;
  private shoreFoamMesh?: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private waterGlintMesh?: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private oceanNormalFrame = 0;

  constructor(private readonly scene: THREE.Scene) {}

  initialize(): void {
    this.createOcean();
    this.createShoreFoam();
    this.createWaterGlints();
  }

  update(now: number): void {
    this.updateOcean(now);
    this.updateShoreFoam(now);
    this.updateWaterGlints(now);
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
    if (this.shoreFoamMesh) {
      this.scene.remove(this.shoreFoamMesh);
      this.shoreFoamMesh.geometry.dispose();
      this.shoreFoamMesh.material.dispose();
      this.shoreFoamMesh = undefined;
    }
    if (this.waterGlintMesh) {
      this.scene.remove(this.waterGlintMesh);
      this.waterGlintMesh.geometry.dispose();
      this.waterGlintMesh.material.dispose();
      this.waterGlintMesh = undefined;
    }
    this.shoreFoams.length = 0;
    this.waterGlints.length = 0;
  }

  private createOcean(): void {
    const surfaceSize = ARENA_RADIUS * OCEAN_VISUAL_CONFIG.surface.arenaScale;
    const geometry = new THREE.PlaneGeometry(
      surfaceSize,
      surfaceSize,
      OCEAN_VISUAL_CONFIG.surface.subdivisions,
      OCEAN_VISUAL_CONFIG.surface.subdivisions
    );
    this.oceanBasePositions = (geometry.attributes.position.array as Float32Array).slice();
    this.applyOceanVertexColors(geometry);

    this.ocean = new THREE.Mesh(
      geometry,
      new THREE.MeshPhysicalMaterial({
        color: OCEAN_VISUAL_CONFIG.surface.material.color,
        vertexColors: true,
        roughness: OCEAN_VISUAL_CONFIG.surface.material.roughness,
        metalness: OCEAN_VISUAL_CONFIG.surface.material.metalness,
        clearcoat: OCEAN_VISUAL_CONFIG.surface.material.clearcoat,
        clearcoatRoughness: OCEAN_VISUAL_CONFIG.surface.material.clearcoatRoughness,
        reflectivity: OCEAN_VISUAL_CONFIG.surface.material.reflectivity,
        emissive: OCEAN_VISUAL_CONFIG.surface.material.emissive,
        emissiveIntensity: OCEAN_VISUAL_CONFIG.surface.material.emissiveIntensity
      })
    );
    this.ocean.rotation.x = -Math.PI / 2;
    this.ocean.position.y = OCEAN_VISUAL_CONFIG.surface.positionY;
    this.ocean.receiveShadow = true;
    this.scene.add(this.ocean);
  }

  private applyOceanVertexColors(geometry: THREE.PlaneGeometry): void {
    const positions = geometry.attributes.position.array as Float32Array;
    const colors: number[] = [];
    const deep = new THREE.Color(OCEAN_VISUAL_CONFIG.vertexColor.deep);
    const mid = new THREE.Color(OCEAN_VISUAL_CONFIG.vertexColor.mid);
    const shallow = new THREE.Color(OCEAN_VISUAL_CONFIG.vertexColor.shallow);

    for (let i = 0; i < positions.length; i += 3) {
      const worldX = positions[i];
      const worldZ = -positions[i + 1];
      const broadVariation = OCEAN_VISUAL_CONFIG.vertexColor.broadVariation.reduce(
        (sum, layer) => sum + Math.sin(worldX * layer.xFrequency + worldZ * layer.zFrequency) * layer.amplitude,
        0
      );
      const nearShore = 1 - this.shoreDamping(worldX, worldZ);
      const mix = THREE.MathUtils.clamp(
        OCEAN_VISUAL_CONFIG.vertexColor.baseMix + broadVariation + nearShore * OCEAN_VISUAL_CONFIG.vertexColor.nearShoreMix,
        0,
        1
      );
      const color = deep.clone().lerp(mid, mix).lerp(shallow, nearShore * OCEAN_VISUAL_CONFIG.vertexColor.shallowShoreMix);
      colors.push(color.r, color.g, color.b);
    }

    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  }

  private createShoreFoam(): void {
    const material = new THREE.MeshBasicMaterial({
      color: OCEAN_VISUAL_CONFIG.shoreFoam.color,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(OCEAN_VISUAL_CONFIG.shoreFoam.patchSize, OCEAN_VISUAL_CONFIG.shoreFoam.patchSize),
      material,
      OCEAN_VISUAL_CONFIG.shoreFoam.maxPatchCount
    );
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.renderOrder = 1;
    this.shoreFoamMesh = mesh;
    this.scene.add(mesh);

    const radius = Math.min(TERRAIN_FIELD.renderRadius * 0.9, ARENA_RADIUS * 1.36);
    const spacing = OCEAN_VISUAL_CONFIG.shoreFoam.scanSpacing;
    for (let z = -radius; z <= radius; z += spacing) {
      for (let x = -radius; x <= radius; x += spacing) {
        if (this.shoreFoams.length >= OCEAN_VISUAL_CONFIG.shoreFoam.maxPatchCount) {
          break;
        }

        const sample = sampleTerrainAt(x, z);
        if (sample.kind !== "ocean") {
          continue;
        }

        const landDelta = shorelineGradientLength(x, z);
        if (landDelta < OCEAN_VISUAL_CONFIG.shoreFoam.minWaterLandDelta || this.shoreDamping(x, z) > 0.42) {
          continue;
        }

        const gradient = shorelineGradient(x, z);
        const rotation = Math.atan2(gradient.z, gradient.x) + Math.PI / 2;
        this.shoreFoams.push({
          origin: new THREE.Vector3(x, OCEAN_VISUAL_CONFIG.shoreFoam.positionY, z),
          rotation,
          baseScaleX: OCEAN_VISUAL_CONFIG.shoreFoam.minLength + Math.random() * OCEAN_VISUAL_CONFIG.shoreFoam.lengthSpread,
          baseScaleZ: OCEAN_VISUAL_CONFIG.shoreFoam.minWidth + Math.random() * OCEAN_VISUAL_CONFIG.shoreFoam.widthSpread,
          phase: x * 0.003 + z * 0.005
        });
      }
    }

    mesh.count = this.shoreFoams.length;
    this.updateShoreFoam(0);
  }

  private createWaterGlints(): void {
    const material = new THREE.MeshBasicMaterial({
      color: OCEAN_VISUAL_CONFIG.waterGlints.color,
      transparent: true,
      opacity: OCEAN_VISUAL_CONFIG.waterGlints.materialOpacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexColors: true
    });
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, OCEAN_VISUAL_CONFIG.waterGlints.maxCount);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.renderOrder = 0;
    this.waterGlintMesh = mesh;
    this.scene.add(mesh);

    for (let i = 0; i < OCEAN_VISUAL_CONFIG.waterGlints.maxCount; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius =
        OCEAN_VISUAL_CONFIG.waterGlints.minRadius +
        Math.random() * ARENA_RADIUS * OCEAN_VISUAL_CONFIG.waterGlints.arenaRadiusScale;
      const x = Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;
      if (sampleTerrainAt(x, z).kind !== "ocean") {
        continue;
      }

      if (this.shoreDamping(x, z) < OCEAN_VISUAL_CONFIG.waterGlints.shoreDampingMinimum) {
        continue;
      }

      const width = OCEAN_VISUAL_CONFIG.waterGlints.minWidth + Math.random() * OCEAN_VISUAL_CONFIG.waterGlints.widthSpread;
      const height = OCEAN_VISUAL_CONFIG.waterGlints.minHeight + Math.random() * OCEAN_VISUAL_CONFIG.waterGlints.heightSpread;
      const index = this.waterGlints.length;
      const baseOpacity =
        OCEAN_VISUAL_CONFIG.waterGlints.minOpacity + Math.random() * OCEAN_VISUAL_CONFIG.waterGlints.opacitySpread;
      this.waterGlints.push({
        origin: new THREE.Vector3(x, 0, z),
        rotation: OCEAN_VISUAL_CONFIG.waterGlints.windAngle + (Math.random() - 0.5) * OCEAN_VISUAL_CONFIG.waterGlints.rotationSpread,
        width,
        height,
        phase: Math.random() * Math.PI * 2,
        speed: OCEAN_VISUAL_CONFIG.waterGlints.minSpeed + Math.random() * OCEAN_VISUAL_CONFIG.waterGlints.speedSpread,
        drift: OCEAN_VISUAL_CONFIG.waterGlints.minDrift + Math.random() * OCEAN_VISUAL_CONFIG.waterGlints.driftSpread,
        baseOpacity
      });
      mesh.setColorAt(
        index,
        new THREE.Color(OCEAN_VISUAL_CONFIG.waterGlints.color).multiplyScalar(
          OCEAN_VISUAL_CONFIG.waterGlints.colorBase + baseOpacity * OCEAN_VISUAL_CONFIG.waterGlints.colorOpacityMultiplier
        )
      );
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
    material.roughness =
      OCEAN_VISUAL_CONFIG.surface.material.roughness +
      Math.sin(t * OCEAN_VISUAL_CONFIG.surface.animatedRoughness.frequency) *
        OCEAN_VISUAL_CONFIG.surface.animatedRoughness.amplitude;
    material.clearcoat =
      OCEAN_VISUAL_CONFIG.surface.animatedClearcoat.base +
      Math.sin(t * OCEAN_VISUAL_CONFIG.surface.animatedClearcoat.frequency) *
        OCEAN_VISUAL_CONFIG.surface.animatedClearcoat.amplitude;
    this.ocean.geometry.attributes.position.needsUpdate = true;
    this.oceanNormalFrame = (this.oceanNormalFrame + 1) % OCEAN_VISUAL_CONFIG.surface.normalRecomputeFrames;
    if (this.oceanNormalFrame === 0) {
      this.ocean.geometry.computeVertexNormals();
    }
  }

  private waveHeight(worldX: number, worldZ: number, t: number): number {
    const localY = -worldZ;
    const waveHeight = OCEAN_VISUAL_CONFIG.waves.reduce(
      (sum, wave) =>
        sum + Math.sin(worldX * wave.xFrequency + localY * wave.localYFrequency + t * wave.timeFrequency) * wave.amplitude,
      0
    );
    return waveHeight * this.shoreDamping(worldX, worldZ);
  }

  private updateShoreFoam(now: number): void {
    const mesh = this.shoreFoamMesh;
    if (!mesh) {
      return;
    }

    const t = now * 0.001;
    this.shoreFoams.forEach((foam, index) => {
      const pulse =
        1 + Math.sin(t * OCEAN_VISUAL_CONFIG.shoreFoam.pulseFrequency + foam.phase) * OCEAN_VISUAL_CONFIG.shoreFoam.pulseAmplitude;
      this.shoreFoamPosition.copy(foam.origin);
      this.shoreFoamEuler.set(-Math.PI / 2, 0, foam.rotation);
      this.shoreFoamQuaternion.setFromEuler(this.shoreFoamEuler);
      this.shoreFoamScale.set(foam.baseScaleX * pulse, foam.baseScaleZ * pulse, 1);
      this.shoreFoamMatrix.compose(this.shoreFoamPosition, this.shoreFoamQuaternion, this.shoreFoamScale);
      mesh.setMatrixAt(index, this.shoreFoamMatrix);
    });
    mesh.material.opacity =
      OCEAN_VISUAL_CONFIG.shoreFoam.baseOpacity +
      (Math.sin(t * OCEAN_VISUAL_CONFIG.shoreFoam.opacityFrequency) + 1) * OCEAN_VISUAL_CONFIG.shoreFoam.opacityAmplitude;
    mesh.instanceMatrix.needsUpdate = true;
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
      const shimmer =
        OCEAN_VISUAL_CONFIG.waterGlints.shimmerBase +
        Math.max(0, Math.sin(t * OCEAN_VISUAL_CONFIG.waterGlints.shimmerFrequency + glint.phase)) *
          glint.baseOpacity *
          OCEAN_VISUAL_CONFIG.waterGlints.shimmerOpacityMultiplier;
      this.waterGlintPosition.set(worldX, this.waveHeight(worldX, worldZ, t) + OCEAN_VISUAL_CONFIG.waterGlints.waveOffsetY, worldZ);
      this.waterGlintEuler.set(-Math.PI / 2, 0, glint.rotation);
      this.waterGlintQuaternion.setFromEuler(this.waterGlintEuler);
      this.waterGlintScale.set(glint.width * shimmer, glint.height, 1);
      this.waterGlintMatrix.compose(this.waterGlintPosition, this.waterGlintQuaternion, this.waterGlintScale);
      mesh.setMatrixAt(index, this.waterGlintMatrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }

  private shoreDamping(worldX: number, worldZ: number): number {
    return shoreDampingAt(worldX, worldZ);
  }
}

function shorelineGradient(x: number, z: number): { x: number; z: number } {
  const step = OCEAN_VISUAL_CONFIG.shoreFoam.gradientStep;
  return {
    x: terrainLandAt(x + step, z) - terrainLandAt(x - step, z),
    z: terrainLandAt(x, z + step) - terrainLandAt(x, z - step)
  };
}

function shorelineGradientLength(x: number, z: number): number {
  const gradient = shorelineGradient(x, z);
  return Math.hypot(gradient.x, gradient.z);
}
