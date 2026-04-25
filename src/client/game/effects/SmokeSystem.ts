import * as THREE from "three";

type SmokePuff = {
  batch: SmokeBatch;
  slot: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  age: number;
  life: number;
  startScale: number;
  growth: number;
  maxOpacity: number;
};

type SmokeBatch = {
  mesh: THREE.InstancedMesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  tint: THREE.InstancedBufferAttribute;
  opacity: THREE.InstancedBufferAttribute;
  activeCount: number;
  capacity: number;
};

export type SmokePuffOptions = {
  origin: THREE.Vector3;
  velocity: THREE.Vector3;
  color: string;
  opacity: number;
  life: number;
  size: number;
  growth: number;
  additive?: boolean;
};

export class SmokeSystem {
  private readonly smokePuffs: SmokePuff[] = [];
  private readonly smokeMatrix = new THREE.Matrix4();
  private readonly smokePosition = new THREE.Vector3();
  private readonly smokeQuaternion = new THREE.Quaternion();
  private readonly smokeScale = new THREE.Vector3();
  private readonly hiddenSmokeMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  private smokeNormalBatch?: SmokeBatch;
  private smokeAdditiveBatch?: SmokeBatch;

  constructor(private readonly scene: THREE.Scene) {}

  initialize(): void {
    this.smokeNormalBatch = this.createSmokeBatch(260, THREE.NormalBlending);
    this.smokeAdditiveBatch = this.createSmokeBatch(96, THREE.AdditiveBlending);
    this.scene.add(this.smokeNormalBatch.mesh, this.smokeAdditiveBatch.mesh);
  }

  update(dt: number): void {
    for (let i = this.smokePuffs.length - 1; i >= 0; i -= 1) {
      const puff = this.smokePuffs[i];
      puff.age += dt;
      const progress = puff.age / puff.life;

      if (progress >= 1) {
        this.releaseSmokePuff(i);
        continue;
      }

      puff.position.addScaledVector(puff.velocity, dt);
      this.updateSmokeInstance(puff, progress);
    }

    while (this.smokePuffs.length > 220) {
      this.releaseSmokePuff(0);
    }

    this.flushSmokeBatches();
  }

  spawnPuff({ origin, velocity, color, opacity, life, size, growth, additive = false }: SmokePuffOptions): void {
    const batch = additive ? this.smokeAdditiveBatch : this.smokeNormalBatch;
    if (!batch) {
      return;
    }

    if (batch.activeCount >= batch.capacity) {
      const evictIndex = this.smokePuffs.findIndex((puff) => puff.batch === batch);
      if (evictIndex >= 0) {
        this.releaseSmokePuff(evictIndex);
      }
    }
    if (batch.activeCount >= batch.capacity) {
      return;
    }

    const slot = batch.activeCount;
    batch.activeCount += 1;
    batch.mesh.count = batch.activeCount;

    const lateral = new THREE.Vector3((Math.random() - 0.5) * size, (Math.random() - 0.5) * size, (Math.random() - 0.5) * size);
    this.smokePosition.copy(origin).add(lateral.multiplyScalar(0.45));
    const tint = new THREE.Color(color);
    batch.tint.setXYZ(slot, tint.r, tint.g, tint.b);
    batch.tint.needsUpdate = true;

    const puff: SmokePuff = {
      batch,
      slot,
      position: this.smokePosition.clone(),
      velocity,
      age: 0,
      life,
      startScale: size,
      growth,
      maxOpacity: opacity
    };
    this.smokePuffs.push(puff);
    this.updateSmokeInstance(puff, 0);
    this.flushSmokeBatches();
  }

  spawnMissileTrail(origin: THREE.Vector3, missileDirection: THREE.Vector3): void {
    this.spawnPuff({
      origin,
      velocity: missileDirection
        .clone()
        .multiplyScalar(-6)
        .add(new THREE.Vector3((Math.random() - 0.5) * 2.8, (Math.random() - 0.5) * 2.8, (Math.random() - 0.5) * 2.8)),
      color: "#d6d3ce",
      opacity: 0.36,
      life: 1.7 + Math.random() * 0.55,
      size: 1.6 + Math.random() * 1.2,
      growth: 2.2
    });
  }

  getPuffCount(): number {
    return this.smokePuffs.length;
  }

  dispose(): void {
    this.smokeNormalBatch?.mesh.geometry.dispose();
    this.smokeNormalBatch?.mesh.material.dispose();
    this.smokeAdditiveBatch?.mesh.geometry.dispose();
    this.smokeAdditiveBatch?.mesh.material.dispose();
  }

  private createSmokeBatch(capacity: number, blending: THREE.Blending): SmokeBatch {
    const geometry = new THREE.SphereGeometry(1, 8, 6);
    const tint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    const opacity = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    tint.setUsage(THREE.DynamicDrawUsage);
    opacity.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("instanceTint", tint);
    geometry.setAttribute("instanceOpacity", opacity);

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending,
      vertexShader: `
        attribute vec3 instanceTint;
        attribute float instanceOpacity;
        varying vec3 vInstanceColor;
        varying float vInstanceOpacity;

        void main() {
          vInstanceColor = instanceTint;
          vInstanceOpacity = instanceOpacity;
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vInstanceColor;
        varying float vInstanceOpacity;

        void main() {
          gl_FragColor = vec4(vInstanceColor, vInstanceOpacity);
        }
      `
    });

    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;

    for (let slot = 0; slot < capacity; slot += 1) {
      mesh.setMatrixAt(slot, this.hiddenSmokeMatrix);
      tint.setXYZ(slot, 0, 0, 0);
      opacity.setX(slot, 0);
    }
    mesh.instanceMatrix.needsUpdate = true;
    tint.needsUpdate = true;
    opacity.needsUpdate = true;

    return { mesh, tint, opacity, activeCount: 0, capacity };
  }

  private updateSmokeInstance(puff: SmokePuff, progress: number): void {
    const scale = puff.startScale * (1 + progress * puff.growth);
    const opacity = Math.max(0, puff.maxOpacity * (1 - progress));
    this.smokeScale.setScalar(scale);
    this.smokeMatrix.compose(puff.position, this.smokeQuaternion, this.smokeScale);
    puff.batch.mesh.setMatrixAt(puff.slot, this.smokeMatrix);
    puff.batch.opacity.setX(puff.slot, opacity);
  }

  private releaseSmokePuff(index: number): void {
    const [puff] = this.smokePuffs.splice(index, 1);
    if (!puff) {
      return;
    }

    puff.batch.mesh.setMatrixAt(puff.slot, this.hiddenSmokeMatrix);
    puff.batch.tint.setXYZ(puff.slot, 0, 0, 0);
    puff.batch.opacity.setX(puff.slot, 0);
    const lastSlot = puff.batch.activeCount - 1;
    if (puff.slot !== lastSlot) {
      const movedPuff = this.smokePuffs.find((candidate) => candidate.batch === puff.batch && candidate.slot === lastSlot);
      if (movedPuff) {
        puff.batch.mesh.getMatrixAt(lastSlot, this.smokeMatrix);
        puff.batch.mesh.setMatrixAt(puff.slot, this.smokeMatrix);
        puff.batch.tint.setXYZ(
          puff.slot,
          puff.batch.tint.getX(lastSlot),
          puff.batch.tint.getY(lastSlot),
          puff.batch.tint.getZ(lastSlot)
        );
        puff.batch.opacity.setX(puff.slot, puff.batch.opacity.getX(lastSlot));
        movedPuff.slot = puff.slot;
      }
    }

    puff.batch.mesh.setMatrixAt(lastSlot, this.hiddenSmokeMatrix);
    puff.batch.tint.setXYZ(lastSlot, 0, 0, 0);
    puff.batch.opacity.setX(lastSlot, 0);
    puff.batch.activeCount = Math.max(0, lastSlot);
    puff.batch.mesh.count = puff.batch.activeCount;
  }

  private flushSmokeBatches(): void {
    if (this.smokeNormalBatch) {
      this.smokeNormalBatch.mesh.instanceMatrix.needsUpdate = true;
      this.smokeNormalBatch.tint.needsUpdate = true;
      this.smokeNormalBatch.opacity.needsUpdate = true;
    }
    if (this.smokeAdditiveBatch) {
      this.smokeAdditiveBatch.mesh.instanceMatrix.needsUpdate = true;
      this.smokeAdditiveBatch.tint.needsUpdate = true;
      this.smokeAdditiveBatch.opacity.needsUpdate = true;
    }
  }
}
