import * as THREE from "three";
import { ARENA_RADIUS, BULLET_SPEED, BULLET_TTL_SECONDS, MAX_ALTITUDE, TERRAIN_ISLANDS } from "../../shared/constants.js";
import type { TerrainIsland } from "../../shared/constants.js";
import type { PlayerState, ProjectileState, RoomState } from "../../shared/types.js";

type VisualJetTarget = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  visible: boolean;
};

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

type ExplosionEffect = {
  group: THREE.Group;
  material: THREE.MeshBasicMaterial;
  born: number;
  life: number;
};

export type SceneDebugStats = {
  objects: number;
  jets: number;
  projectiles: number;
  smokePuffs: number;
  explosions: number;
  waterGlints: number;
  drawCalls: number;
  triangles: number;
  lines: number;
  points: number;
  geometries: number;
  textures: number;
  pixelRatio: number;
  width: number;
  height: number;
};

export class DogfightScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 6000);
  private readonly reticle: HTMLElement | null;
  private readonly clock = new THREE.Clock();
  private readonly jets = new Map<string, THREE.Group>();
  private readonly jetTargets = new Map<string, VisualJetTarget>();
  private readonly projectiles = new Map<string, THREE.Object3D>();
  private readonly smokePuffs: SmokePuff[] = [];
  private readonly explosions: ExplosionEffect[] = [];
  private readonly shoreFoams: ShoreFoam[] = [];
  private readonly waterGlints: WaterGlint[] = [];
  private readonly cameraLookTarget = new THREE.Vector3(0, 180, 0);
  private readonly chaseCameraFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  private readonly debugSize = new THREE.Vector2();
  private readonly explosionShardGeometry = new THREE.TetrahedronGeometry(1, 0);
  private readonly hitSparkGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly bulletTracerGeometry = DogfightScene.createRotatedCylinderGeometry(0.34, 0.18, 18, 8);
  private readonly bulletTracerMaterial = new THREE.MeshBasicMaterial({
    color: "#fff1a8",
    transparent: true,
    opacity: 0.86,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  private readonly smokeMatrix = new THREE.Matrix4();
  private readonly smokePosition = new THREE.Vector3();
  private readonly smokeQuaternion = new THREE.Quaternion();
  private readonly smokeScale = new THREE.Vector3();
  private readonly hiddenSmokeMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly waterGlintEuler = new THREE.Euler();
  private readonly waterGlintWind = new THREE.Vector2(Math.cos(-0.28), Math.sin(-0.28));
  private skyDome?: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private ocean?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial>;
  private oceanBasePositions?: Float32Array;
  private waterGlintMesh?: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private smokeNormalBatch?: SmokeBatch;
  private smokeAdditiveBatch?: SmokeBatch;
  private readonly waterGlintMatrix = new THREE.Matrix4();
  private readonly waterGlintQuaternion = new THREE.Quaternion();
  private readonly waterGlintPosition = new THREE.Vector3();
  private readonly waterGlintScale = new THREE.Vector3();
  private oceanNormalFrame = 0;
  private state: RoomState | undefined;
  private localPlayerId = "";

  private readonly resize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  constructor(canvas: HTMLCanvasElement, reticle: HTMLElement | null) {
    this.reticle = reticle;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.background = new THREE.Color("#8bd3ff");
    this.scene.fog = new THREE.Fog("#8bd3ff", 900, 3800);
    this.camera.position.set(0, 260, -520);

    this.buildWorld();
    window.addEventListener("resize", this.resize);
  }

  updateState(room: RoomState, localPlayerId: string): void {
    this.state = room;
    this.localPlayerId = localPlayerId;
    this.syncJets(room);
    this.syncProjectiles(room.projectiles);
  }

  spawnExplosion(position: { x: number; y: number; z: number }, color: string): void {
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });

    for (let i = 0; i < 16; i += 1) {
      const shard = new THREE.Mesh(this.explosionShardGeometry, material);
      shard.scale.setScalar(3 + Math.random() * 5);
      shard.position.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
      shard.userData.velocity = new THREE.Vector3((Math.random() - 0.5) * 90, (Math.random() - 0.2) * 90, (Math.random() - 0.5) * 90);
      group.add(shard);
    }

    group.position.set(position.x, position.y, position.z);
    this.scene.add(group);
    this.explosions.push({ group, material, born: performance.now(), life: 900 });
  }

  spawnHitSpark(position: { x: number; y: number; z: number }, color: string): void {
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    for (let i = 0; i < 9; i += 1) {
      const spark = new THREE.Mesh(this.hitSparkGeometry, material);
      spark.scale.set(1.1, 1.1, 9 + Math.random() * 10);
      spark.position.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
      spark.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      spark.userData.velocity = new THREE.Vector3((Math.random() - 0.5) * 55, (Math.random() - 0.35) * 55, (Math.random() - 0.5) * 55);
      group.add(spark);
    }

    group.position.set(position.x, position.y, position.z);
    this.scene.add(group);
    this.explosions.push({ group, material, born: performance.now(), life: 360 });
  }

  spawnProjectileImpact(position: { x: number; y: number; z: number }, projectileType: "bullet" | "missile"): void {
    const origin = new THREE.Vector3(position.x, position.y, position.z);

    if (projectileType === "missile") {
      this.spawnExplosion(position, "#f97316");
      for (let i = 0; i < 18; i += 1) {
        const direction = new THREE.Vector3((Math.random() - 0.5) * 24, 10 + Math.random() * 28, (Math.random() - 0.5) * 24);
        this.spawnPuff({
          origin,
          velocity: direction,
          color: i % 3 === 0 ? "#facc15" : "#6b7280",
          opacity: i % 3 === 0 ? 0.22 : 0.38,
          life: 1.25 + Math.random() * 0.9,
          size: 2.8 + Math.random() * 2.8,
          growth: 3.2,
          additive: i % 3 === 0
        });
      }
      return;
    }

    this.spawnHitSpark(position, "#fef08a");
    this.spawnPuff({
      origin,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 8, 5 + Math.random() * 8, (Math.random() - 0.5) * 8),
      color: "#d6d3ce",
      opacity: 0.22,
      life: 0.65,
      size: 1.1,
      growth: 2.1
    });
  }

  render(now: number): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.updateOcean(now);
    this.updateShoreFoam(now);
    this.updateWaterGlints(now);
    this.updateJets(dt);
    this.updateJetEffects(now);
    this.updateCamera(dt);
    this.updateSkyDome();
    this.updateReticle();
    this.updateMissileSmoke(now, dt);
    this.updateExplosions(now, dt);
    this.renderer.render(this.scene, this.camera);
  }

  destroy(): void {
    window.removeEventListener("resize", this.resize);
    this.explosionShardGeometry.dispose();
    this.hitSparkGeometry.dispose();
    this.bulletTracerGeometry.dispose();
    this.bulletTracerMaterial.dispose();
    this.smokeNormalBatch?.mesh.geometry.dispose();
    this.smokeNormalBatch?.mesh.material.dispose();
    this.smokeAdditiveBatch?.mesh.geometry.dispose();
    this.smokeAdditiveBatch?.mesh.material.dispose();
    this.renderer.dispose();
  }

  getDebugStats(): SceneDebugStats {
    let objects = 0;
    this.scene.traverse(() => {
      objects += 1;
    });

    const size = this.renderer.getSize(this.debugSize);
    const renderInfo = this.renderer.info.render;
    const memoryInfo = this.renderer.info.memory;
    return {
      objects,
      jets: this.jets.size,
      projectiles: this.projectiles.size,
      smokePuffs: this.smokePuffs.length,
      explosions: this.explosions.length,
      waterGlints: this.waterGlints.length,
      drawCalls: renderInfo.calls,
      triangles: renderInfo.triangles,
      lines: renderInfo.lines,
      points: renderInfo.points,
      geometries: memoryInfo.geometries,
      textures: memoryInfo.textures,
      pixelRatio: this.renderer.getPixelRatio(),
      width: size.width,
      height: size.height
    };
  }

  private buildWorld(): void {
    this.skyDome = this.createSkyDome();
    this.scene.add(this.skyDome);

    const hemi = new THREE.HemisphereLight("#dff6ff", "#1f5666", 1.75);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight("#fff3c4", 3.2);
    sun.position.set(-620, 980, -360);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    this.scene.add(sun);

    this.createOcean();
    this.createWaterGlints();
    this.createSmokeBatches();
    TERRAIN_ISLANDS.forEach((island) => this.createIsland(island));

    for (let i = 0; i < 28; i += 1) {
      const cloud = this.createCloud();
      const angle = Math.random() * Math.PI * 2;
      const radius = 400 + Math.random() * 1300;
      cloud.position.set(Math.sin(angle) * radius, 260 + Math.random() * 420, Math.cos(angle) * radius);
      this.scene.add(cloud);
    }
  }

  private createSkyDome(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(5200, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          topColor: { value: new THREE.Color("#5eb8f2") },
          horizonColor: { value: new THREE.Color("#bfeaff") }
        },
        vertexShader: `
          varying vec3 vWorldPosition;
          void main() {
            vWorldPosition = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 topColor;
          uniform vec3 horizonColor;
          varying vec3 vWorldPosition;
          void main() {
            float h = normalize(vWorldPosition).y;
            float mixAmount = smoothstep(-0.12, 0.82, h);
            gl_FragColor = vec4(mix(horizonColor, topColor, mixAmount), 1.0);
          }
        `
      })
    );
    dome.frustumCulled = false;
    return dome;
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
      const nearShore = 1 - this.oceanShoreDamping(worldX, worldZ);
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
      if (this.oceanShoreDamping(x, z) < 0.82) {
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

  private createSmokeBatches(): void {
    this.smokeNormalBatch = this.createSmokeBatch(260, THREE.NormalBlending);
    this.smokeAdditiveBatch = this.createSmokeBatch(96, THREE.AdditiveBlending);
    this.scene.add(this.smokeNormalBatch.mesh, this.smokeAdditiveBatch.mesh);
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
    group.add(foam);
    this.shoreFoams.push({
      mesh: foam,
      baseScaleX: island.beachScaleX,
      baseScaleZ: island.beachScaleZ,
      phase: island.x * 0.003 + island.z * 0.005
    });

    const terrainMaterial = new THREE.MeshStandardMaterial({ color: "#3f6f4c", roughness: 0.96 });
    island.peaks.forEach((definition) => {
      const peak = new THREE.Mesh(new THREE.ConeGeometry(definition.radius, definition.height, 7), terrainMaterial);
      peak.position.set(definition.x, definition.height / 2 + 0.8, definition.z);
      peak.castShadow = true;
      peak.receiveShadow = true;
      group.add(peak);
    });

    this.scene.add(group);
  }

  private createCloud(): THREE.Group {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: "#f8fbff", roughness: 1, transparent: true, opacity: 0.72 });
    const shadowMaterial = new THREE.MeshStandardMaterial({ color: "#d7e5ef", roughness: 1, transparent: true, opacity: 0.34 });
    const count = 5 + Math.floor(Math.random() * 5);

    for (let i = 0; i < count; i += 1) {
      const puff = new THREE.Mesh(new THREE.DodecahedronGeometry(24 + Math.random() * 26, 0), i % 3 === 0 ? shadowMaterial : material);
      puff.position.set((i - count / 2) * 24, Math.random() * 14, (Math.random() - 0.5) * 32);
      puff.scale.set(2.1, 0.46, 0.92);
      group.add(puff);
    }

    return group;
  }

  private syncJets(room: RoomState): void {
    const ids = new Set(Object.keys(room.players));
    this.jets.forEach((jet, id) => {
      if (!ids.has(id)) {
        this.scene.remove(jet);
        this.jets.delete(id);
        this.jetTargets.delete(id);
      }
    });

    Object.values(room.players).forEach((player) => {
      let jet = this.jets.get(player.id);
      if (!jet) {
        jet = this.createJet(player);
        this.scene.add(jet);
        this.jets.set(player.id, jet);
      }

      const targetPosition = new THREE.Vector3(player.position.x, player.position.y, player.position.z);
      const targetQuaternion = this.playerQuaternion(player);
      this.jetTargets.set(player.id, {
        position: targetPosition,
        quaternion: targetQuaternion,
        visible: player.status === "alive"
      });

      if (jet.userData.initialized !== true) {
        jet.position.copy(targetPosition);
        jet.quaternion.copy(targetQuaternion);
        jet.userData.initialized = true;
      }
    });
  }

  private syncProjectiles(projectiles: Record<string, ProjectileState>): void {
    const ids = new Set(Object.keys(projectiles));
    this.projectiles.forEach((mesh, id) => {
      if (!ids.has(id)) {
        this.scene.remove(mesh);
        this.projectiles.delete(id);
      }
    });

    Object.values(projectiles).forEach((projectile) => {
      let mesh = this.projectiles.get(projectile.id);
      if (!mesh) {
        mesh = this.createProjectile(projectile);
        this.scene.add(mesh);
        this.projectiles.set(projectile.id, mesh);
      }

      mesh.position.set(projectile.position.x, projectile.position.y, projectile.position.z);
      const velocity = new THREE.Vector3(projectile.velocity.x, projectile.velocity.y, projectile.velocity.z).normalize();
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), velocity);
    });
  }

  private createJet(player: PlayerState): THREE.Group {
    const group = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: "#9ca8b3", roughness: 0.36, metalness: 0.42 });
    const panelMaterial = new THREE.MeshStandardMaterial({ color: "#475569", roughness: 0.44, metalness: 0.32, side: THREE.DoubleSide });
    const accentMaterial = new THREE.MeshStandardMaterial({ color: player.color, roughness: 0.38, metalness: 0.18, side: THREE.DoubleSide });
    const wingMaterial = new THREE.MeshStandardMaterial({ color: "#7d8995", roughness: 0.42, metalness: 0.34, side: THREE.DoubleSide });
    const controlSurfaceMaterial = new THREE.MeshStandardMaterial({ color: "#64748b", roughness: 0.48, metalness: 0.28, side: THREE.DoubleSide });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 2.05, 18, 18), bodyMaterial);
    body.rotation.x = Math.PI / 2;
    body.castShadow = true;
    group.add(body);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(1.38, 5.7, 18), bodyMaterial);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 11.8;
    nose.castShadow = true;
    group.add(nose);

    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(1.8, 18, 8),
      new THREE.MeshStandardMaterial({ color: "#0f172a", roughness: 0.12, metalness: 0.08, emissive: "#1e3a5f", emissiveIntensity: 0.18 })
    );
    canopy.scale.set(0.85, 0.38, 1.55);
    canopy.position.y = 1.45;
    canopy.position.z = 3.6;
    group.add(canopy);

    const leftWing = this.createTriangleMesh(
      [
        new THREE.Vector3(-1.35, -0.15, 1.2),
        new THREE.Vector3(-17.5, -0.25, -3.2),
        new THREE.Vector3(-2.5, -0.2, -8.2)
      ],
      wingMaterial
    );
    const rightWing = this.createTriangleMesh(
      [
        new THREE.Vector3(1.35, -0.15, 1.2),
        new THREE.Vector3(17.5, -0.25, -3.2),
        new THREE.Vector3(2.5, -0.2, -8.2)
      ],
      wingMaterial
    );
    group.add(leftWing, rightWing);

    const leftWingRoot = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.38, 5.8), panelMaterial);
    leftWingRoot.position.set(-4.9, -0.33, -2.4);
    leftWingRoot.rotation.y = -0.16;
    leftWingRoot.castShadow = true;
    leftWingRoot.receiveShadow = true;
    const rightWingRoot = leftWingRoot.clone();
    rightWingRoot.position.x = 4.9;
    rightWingRoot.rotation.y = 0.16;
    group.add(leftWingRoot, rightWingRoot);

    const leftAileron = this.createHingedTriangleSurface(
      [
        new THREE.Vector3(-9.6, -0.06, -4.8),
        new THREE.Vector3(-16.1, -0.06, -3.45),
        new THREE.Vector3(-11.1, -0.06, -6.45)
      ],
      new THREE.Vector3(-11.4, -0.06, -4.65),
      controlSurfaceMaterial
    );
    const rightAileron = this.createHingedTriangleSurface(
      [
        new THREE.Vector3(9.6, -0.06, -4.8),
        new THREE.Vector3(16.1, -0.06, -3.45),
        new THREE.Vector3(11.1, -0.06, -6.45)
      ],
      new THREE.Vector3(11.4, -0.06, -4.65),
      controlSurfaceMaterial
    );
    group.add(leftAileron, rightAileron);

    const leftAccent = this.createTriangleMesh(
      [
        new THREE.Vector3(-11.5, -0.12, -3.8),
        new THREE.Vector3(-17.2, -0.12, -3.2),
        new THREE.Vector3(-12.5, -0.12, -5.4)
      ],
      accentMaterial
    );
    const rightAccent = this.createTriangleMesh(
      [
        new THREE.Vector3(11.5, -0.12, -3.8),
        new THREE.Vector3(17.2, -0.12, -3.2),
        new THREE.Vector3(12.5, -0.12, -5.4)
      ],
      accentMaterial
    );
    group.add(leftAccent, rightAccent);

    const tailLeft = this.createTriangleMesh(
      [
        new THREE.Vector3(-1.15, 0.1, -8.3),
        new THREE.Vector3(-7.6, 0, -11.2),
        new THREE.Vector3(-1.65, 0.05, -13.8)
      ],
      panelMaterial
    );
    const tailRight = this.createTriangleMesh(
      [
        new THREE.Vector3(1.15, 0.1, -8.3),
        new THREE.Vector3(7.6, 0, -11.2),
        new THREE.Vector3(1.65, 0.05, -13.8)
      ],
      panelMaterial
    );
    group.add(tailLeft, tailRight);

    const elevatorLeft = this.createHingedTriangleSurface(
      [
        new THREE.Vector3(-1.65, 0.12, -11.4),
        new THREE.Vector3(-8.4, 0.08, -13.2),
        new THREE.Vector3(-1.9, 0.1, -15.4)
      ],
      new THREE.Vector3(-3.3, 0.1, -12.05),
      controlSurfaceMaterial
    );
    const elevatorRight = this.createHingedTriangleSurface(
      [
        new THREE.Vector3(1.65, 0.12, -11.4),
        new THREE.Vector3(8.4, 0.08, -13.2),
        new THREE.Vector3(1.9, 0.1, -15.4)
      ],
      new THREE.Vector3(3.3, 0.1, -12.05),
      controlSurfaceMaterial
    );
    group.add(elevatorLeft, elevatorRight);

    const leftFin = this.createTriangleMesh(
      [
        new THREE.Vector3(-1.15, 1.1, -8.4),
        new THREE.Vector3(-2.85, 6.6, -11.7),
        new THREE.Vector3(-1.65, 1.05, -14.2)
      ],
      panelMaterial
    );
    const rightFin = this.createTriangleMesh(
      [
        new THREE.Vector3(1.15, 1.1, -8.4),
        new THREE.Vector3(2.85, 6.6, -11.7),
        new THREE.Vector3(1.65, 1.05, -14.2)
      ],
      panelMaterial
    );
    group.add(leftFin, rightFin);

    const leftRudder = this.createHingedTriangleSurface(
      [
        new THREE.Vector3(-1.85, 1.35, -10.1),
        new THREE.Vector3(-2.55, 5.25, -11.85),
        new THREE.Vector3(-1.85, 1.25, -13.55)
      ],
      new THREE.Vector3(-1.85, 2.7, -11.85),
      controlSurfaceMaterial
    );
    const rightRudder = this.createHingedTriangleSurface(
      [
        new THREE.Vector3(1.85, 1.35, -10.1),
        new THREE.Vector3(2.55, 5.25, -11.85),
        new THREE.Vector3(1.85, 1.25, -13.55)
      ],
      new THREE.Vector3(1.85, 2.7, -11.85),
      controlSurfaceMaterial
    );
    group.add(leftRudder, rightRudder);

    const leftNozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.82, 1.6, 14), panelMaterial);
    leftNozzle.rotation.x = Math.PI / 2;
    leftNozzle.position.set(-0.9, 0, -10.4);
    const rightNozzle = leftNozzle.clone();
    rightNozzle.position.x = 0.9;
    group.add(leftNozzle, rightNozzle);

    const flameMaterial = new THREE.MeshBasicMaterial({ color: "#74c0ff", transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(1.55, 9, 18), flameMaterial);
    flame.rotation.x = -Math.PI / 2;
    flame.position.z = -14.2;
    group.add(flame);

    const heatGlowMaterial = new THREE.MeshBasicMaterial({ color: "#f97316", transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false });
    const heatGlow = new THREE.Mesh(new THREE.SphereGeometry(2.7, 14, 8), heatGlowMaterial);
    heatGlow.scale.set(1, 0.55, 1.6);
    heatGlow.position.z = -12.5;
    group.add(heatGlow);

    group.userData.flame = flame;
    group.userData.flameMaterial = flameMaterial;
    group.userData.heatGlow = heatGlow;
    group.userData.heatGlowMaterial = heatGlowMaterial;
    group.userData.controlSurfaces = {
      leftAileron,
      rightAileron,
      elevatorLeft,
      elevatorRight,
      leftRudder,
      rightRudder
    };
    group.userData.nextAfterburnerPuffAt = 0;
    group.userData.nextDamageSmokeAt = 0;

    return group;
  }

  private createTriangleMesh(points: THREE.Vector3[], material: THREE.Material): THREE.Mesh {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    geometry.setIndex([0, 1, 2]);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private createHingedTriangleSurface(points: THREE.Vector3[], hinge: THREE.Vector3, material: THREE.Material): THREE.Group {
    const group = new THREE.Group();
    const localPoints = points.map((point) => point.clone().sub(hinge));
    const mesh = this.createTriangleMesh(localPoints, material);
    group.position.copy(hinge);
    group.add(mesh);
    return group;
  }

  private createProjectile(projectile: ProjectileState): THREE.Object3D {
    if (projectile.type === "missile") {
      return this.createMissile();
    }

    if (projectile.type === "flare") {
      return this.createFlare();
    }

    return this.createBulletTracer();
  }

  private createBulletTracer(): THREE.Mesh {
    return new THREE.Mesh(this.bulletTracerGeometry, this.bulletTracerMaterial);
  }

  private createFlare(): THREE.Group {
    const flare = new THREE.Group();
    flare.userData.projectileType = "flare";

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(4.2, 14, 10),
      new THREE.MeshBasicMaterial({ color: "#fffbeb", transparent: true, opacity: 0.95 })
    );
    flare.add(core);

    const corona = new THREE.Mesh(
      new THREE.SphereGeometry(9, 14, 10),
      new THREE.MeshBasicMaterial({ color: "#fb923c", transparent: true, opacity: 0.35, depthWrite: false })
    );
    flare.add(corona);
    return flare;
  }

  private createMissile(): THREE.Group {
    const missile = new THREE.Group();
    missile.userData.projectileType = "missile";
    missile.userData.nextSmokeAt = 0;

    const bodyMaterial = new THREE.MeshStandardMaterial({ color: "#d8dde4", roughness: 0.38, metalness: 0.35 });
    const darkMaterial = new THREE.MeshStandardMaterial({ color: "#202938", roughness: 0.5, metalness: 0.2 });
    const warningMaterial = new THREE.MeshStandardMaterial({ color: "#b91c1c", roughness: 0.42, metalness: 0.12 });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 11, 18), bodyMaterial);
    body.rotation.x = Math.PI / 2;
    body.castShadow = true;
    missile.add(body);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(1.08, 3.2, 18), warningMaterial);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 7.1;
    nose.castShadow = true;
    missile.add(nose);

    const tail = new THREE.Mesh(new THREE.CylinderGeometry(1.14, 1.14, 1.3, 18), darkMaterial);
    tail.rotation.x = Math.PI / 2;
    tail.position.z = -5.9;
    tail.castShadow = true;
    missile.add(tail);

    const finMaterial = new THREE.MeshStandardMaterial({ color: "#111827", roughness: 0.55, metalness: 0.18 });
    const finGeometries = [
      { geometry: new THREE.BoxGeometry(0.16, 2.4, 2.9), position: new THREE.Vector3(0, 1.45, -4.6) },
      { geometry: new THREE.BoxGeometry(0.16, 2.4, 2.9), position: new THREE.Vector3(0, -1.45, -4.6) },
      { geometry: new THREE.BoxGeometry(2.4, 0.16, 2.9), position: new THREE.Vector3(1.45, 0, -4.6) },
      { geometry: new THREE.BoxGeometry(2.4, 0.16, 2.9), position: new THREE.Vector3(-1.45, 0, -4.6) }
    ];

    finGeometries.forEach(({ geometry, position }) => {
      const fin = new THREE.Mesh(geometry, finMaterial);
      fin.position.copy(position);
      fin.castShadow = true;
      missile.add(fin);
    });

    const exhaust = new THREE.Mesh(
      new THREE.ConeGeometry(0.85, 4.6, 14),
      new THREE.MeshBasicMaterial({ color: "#f97316", transparent: true, opacity: 0.7, depthWrite: false })
    );
    exhaust.rotation.x = -Math.PI / 2;
    exhaust.position.z = -8.2;
    missile.add(exhaust);
    return missile;
  }

  private updateJets(dt: number): void {
    const alpha = 1 - Math.exp(-dt * 16);

    this.jets.forEach((jet, id) => {
      const target = this.jetTargets.get(id);
      if (!target) {
        return;
      }

      jet.visible = target.visible;
      if (!target.visible) {
        return;
      }

      jet.position.lerp(target.position, alpha);
      jet.quaternion.slerp(target.quaternion, alpha);

      const player = this.state?.players[id];
      const afterburner = player?.input.afterburner === true;
      const flame = jet.userData.flame as THREE.Mesh | undefined;
      const flameMaterial = jet.userData.flameMaterial as THREE.MeshBasicMaterial | undefined;
      const heatGlow = jet.userData.heatGlow as THREE.Mesh | undefined;
      const heatGlowMaterial = jet.userData.heatGlowMaterial as THREE.MeshBasicMaterial | undefined;
      if (flame && flameMaterial && heatGlow && heatGlowMaterial) {
        const pulse = 0.9 + Math.sin(performance.now() * 0.02) * 0.08;
        flame.scale.set(afterburner ? 1.35 * pulse : 0.58, afterburner ? 1.35 * pulse : 0.58, afterburner ? 1.75 * pulse : 0.82);
        flameMaterial.opacity = afterburner ? 0.84 : 0.28;
        heatGlow.scale.set(afterburner ? 1.3 : 0.78, afterburner ? 0.72 : 0.44, afterburner ? 2.1 : 1.15);
        heatGlowMaterial.opacity = afterburner ? 0.36 : 0.13;
      }

      this.updateControlSurfaces(jet, player, dt);
    });
  }

  private updateControlSurfaces(jet: THREE.Group, player: PlayerState | undefined, dt: number): void {
    const surfaces = jet.userData.controlSurfaces as
      | {
          leftAileron: THREE.Object3D;
          rightAileron: THREE.Object3D;
          elevatorLeft: THREE.Object3D;
          elevatorRight: THREE.Object3D;
          leftRudder: THREE.Object3D;
          rightRudder: THREE.Object3D;
        }
      | undefined;

    if (!surfaces || !player) {
      return;
    }

    const alpha = 1 - Math.exp(-dt * 18);
    const maxAileron = 0.48;
    const maxElevator = 0.42;
    const maxRudder = 0.34;
    const roll = player.input.roll;
    const pitch = player.input.pitch;
    const yaw = player.input.yaw;

    surfaces.leftAileron.rotation.x = THREE.MathUtils.lerp(surfaces.leftAileron.rotation.x, roll * maxAileron, alpha);
    surfaces.rightAileron.rotation.x = THREE.MathUtils.lerp(surfaces.rightAileron.rotation.x, -roll * maxAileron, alpha);
    surfaces.elevatorLeft.rotation.x = THREE.MathUtils.lerp(surfaces.elevatorLeft.rotation.x, -pitch * maxElevator, alpha);
    surfaces.elevatorRight.rotation.x = THREE.MathUtils.lerp(surfaces.elevatorRight.rotation.x, -pitch * maxElevator, alpha);
    surfaces.leftRudder.rotation.y = THREE.MathUtils.lerp(surfaces.leftRudder.rotation.y, yaw * maxRudder, alpha);
    surfaces.rightRudder.rotation.y = THREE.MathUtils.lerp(surfaces.rightRudder.rotation.y, yaw * maxRudder, alpha);
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
      positions[i + 2] = this.oceanWaveHeight(x, -y, t);
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

  private oceanWaveHeight(worldX: number, worldZ: number, t: number): number {
    const localY = -worldZ;
    const waveHeight =
      Math.sin(worldX * 0.0048 + t * 0.72) * 1.9 +
      Math.sin((worldX + localY) * 0.0036 + t * 1.05) * 1.25 +
      Math.sin(localY * 0.0078 - t * 0.86) * 0.82 +
      Math.sin((worldX * 0.018 - localY * 0.011) + t * 2.15) * 0.28 +
      Math.sin((worldX * 0.031 + localY * 0.027) - t * 2.85) * 0.1;
    return waveHeight * this.oceanShoreDamping(worldX, worldZ);
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
      this.waterGlintPosition.set(worldX, this.oceanWaveHeight(worldX, worldZ, t) + 0.44, worldZ);
      this.waterGlintEuler.set(-Math.PI / 2, 0, glint.rotation);
      this.waterGlintQuaternion.setFromEuler(this.waterGlintEuler);
      this.waterGlintScale.set(glint.width * shimmer, glint.height, 1);
      this.waterGlintMatrix.compose(this.waterGlintPosition, this.waterGlintQuaternion, this.waterGlintScale);
      mesh.setMatrixAt(index, this.waterGlintMatrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }

  private oceanShoreDamping(worldX: number, worldZ: number): number {
    let damping = 1;
    for (let i = 0; i < TERRAIN_ISLANDS.length; i += 1) {
      const island = TERRAIN_ISLANDS[i];
      const localX = worldX - island.x;
      const localZ = worldZ - island.z;
      const normalizedX = localX / (island.beachRadius * island.beachScaleX);
      const normalizedZ = localZ / (island.beachRadius * island.beachScaleZ);
      const shorelineDistance = Math.hypot(normalizedX, normalizedZ);
      if (shorelineDistance < 1.34) {
        damping = Math.min(damping, DogfightScene.smoothstep(0.98, 1.34, shorelineDistance));
      }
    }
    return damping;
  }

  private static smoothstep(edge0: number, edge1: number, value: number): number {
    const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  private updateJetEffects(now: number): void {
    this.jets.forEach((jet, id) => {
      const player = this.state?.players[id];
      if (!player || player.status !== "alive" || !jet.visible) {
        return;
      }

      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(jet.quaternion).normalize();
      const origin = jet.position.clone().addScaledVector(forward, -15);

      if (player.input.afterburner && now >= (jet.userData.nextAfterburnerPuffAt as number)) {
        jet.userData.nextAfterburnerPuffAt = now + 70;
        this.spawnPuff({
          origin,
          velocity: forward.clone().multiplyScalar(-38).add(new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3)),
          color: "#8bd3ff",
          opacity: 0.22,
          life: 0.55,
          size: 1.5,
          growth: 2.6,
          additive: true
        });
      }

      if (player.health > 0 && player.health <= 35 && now >= (jet.userData.nextDamageSmokeAt as number)) {
        jet.userData.nextDamageSmokeAt = now + 115;
        this.spawnPuff({
          origin: origin.clone().add(new THREE.Vector3((Math.random() - 0.5) * 5, 0, (Math.random() - 0.5) * 5)),
          velocity: forward.clone().multiplyScalar(-12).add(new THREE.Vector3((Math.random() - 0.5) * 6, 4 + Math.random() * 4, (Math.random() - 0.5) * 6)),
          color: "#4b5563",
          opacity: 0.32,
          life: 1.35,
          size: 2.4,
          growth: 2.4
        });
      }
    });
  }

  private playerQuaternion(player: PlayerState): THREE.Quaternion {
    if (player.orientation) {
      return new THREE.Quaternion(player.orientation.x, player.orientation.y, player.orientation.z, player.orientation.w);
    }

    return new THREE.Quaternion().setFromEuler(new THREE.Euler(-player.rotation.pitch, player.rotation.yaw, -player.rotation.roll, "YXZ"));
  }

  private updateCamera(dt: number): void {
    const local = this.state?.players[this.localPlayerId];
    const localJet = this.jets.get(this.localPlayerId);
    const cameraAlpha = 1 - Math.exp(-dt * 7);
    const rotationAlpha = 1 - Math.exp(-dt * 10);
    const lookAlpha = 1 - Math.exp(-dt * 9);

    if (!local || local.status !== "alive" || !localJet?.visible) {
      this.camera.position.lerp(new THREE.Vector3(0, 520, -860), cameraAlpha * 0.35);
      this.cameraLookTarget.lerp(new THREE.Vector3(0, 180, 0), lookAlpha * 0.35);
      this.camera.lookAt(this.cameraLookTarget);
      return;
    }

    const desiredOffset = new THREE.Vector3(0, 20, -86).applyQuaternion(localJet.quaternion);
    const desired = localJet.position.clone().add(desiredOffset);
    const desiredRotation = localJet.quaternion.clone().multiply(this.chaseCameraFlip);

    this.camera.position.lerp(desired, cameraAlpha);
    this.camera.quaternion.slerp(desiredRotation, rotationAlpha);
    this.camera.far = Math.max(6000, MAX_ALTITUDE * 6);
  }

  private updateSkyDome(): void {
    this.skyDome?.position.copy(this.camera.position);
  }

  private updateReticle(): void {
    if (!this.reticle) {
      return;
    }

    const local = this.state?.players[this.localPlayerId];
    const localJet = this.jets.get(this.localPlayerId);
    if (!local || local.status !== "alive" || !localJet?.visible) {
      this.reticle.dataset.visible = "false";
      this.reticle.dataset.lock = "idle";
      this.reticle.dataset.targetVisible = "false";
      this.reticle.dataset.leadVisible = "false";
      return;
    }

    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(localJet.quaternion).normalize();
    const aimPoint = localJet.position
      .clone()
      .add(forward.multiplyScalar(900))
      .project(this.camera);

    if (aimPoint.z < -1 || aimPoint.z > 1) {
      this.reticle.dataset.visible = "false";
      this.reticle.dataset.targetVisible = "false";
      this.reticle.dataset.leadVisible = "false";
      return;
    }

    const margin = 36;
    const x = Math.max(margin, Math.min(window.innerWidth - margin, ((aimPoint.x + 1) / 2) * window.innerWidth));
    const y = Math.max(margin, Math.min(window.innerHeight - margin, ((-aimPoint.y + 1) / 2) * window.innerHeight));

    this.reticle.dataset.visible = "true";
    this.reticle.dataset.lock = local.missileLockAcquired ? "locked" : local.missileLockProgress > 0 ? "locking" : "idle";
    this.reticle.style.setProperty("--reticle-x", `${x}px`);
    this.reticle.style.setProperty("--reticle-y", `${y}px`);
    this.updateLockTargetIndicator(local);
    this.updateGunLeadIndicator(local, localJet, forward);
  }

  private updateGunLeadIndicator(local: PlayerState, localJet: THREE.Group, forward: THREE.Vector3): void {
    if (!this.reticle || !this.state) {
      return;
    }

    const maxRange = BULLET_SPEED * BULLET_TTL_SECONDS;
    const localPosition = localJet.position;
    const candidates = Object.values(this.state.players)
      .filter((player) => player.id !== local.id && player.status === "alive")
      .map((player) => {
        const targetPosition = new THREE.Vector3(player.position.x, player.position.y, player.position.z);
        const offset = targetPosition.clone().sub(localPosition);
        const range = offset.length();
        const alignment = offset.normalize().dot(forward);
        return { player, targetPosition, range, alignment };
      })
      .filter(({ range, alignment }) => range <= maxRange && alignment > 0.35)
      .sort((a, b) => b.alignment - a.alignment || a.range - b.range);

    const candidate = candidates[0];
    if (!candidate) {
      this.reticle.dataset.leadVisible = "false";
      return;
    }

    const targetVelocity = new THREE.Vector3(candidate.player.velocity.x, candidate.player.velocity.y, candidate.player.velocity.z);
    const interceptTime = this.interceptTime(localPosition, candidate.targetPosition, targetVelocity, BULLET_SPEED);
    if (!interceptTime || interceptTime > BULLET_TTL_SECONDS) {
      this.reticle.dataset.leadVisible = "false";
      return;
    }

    const leadPoint = candidate.targetPosition.clone().addScaledVector(targetVelocity, interceptTime).project(this.camera);
    if (leadPoint.z < -1 || leadPoint.z > 1) {
      this.reticle.dataset.leadVisible = "false";
      return;
    }

    const margin = 28;
    const x = Math.max(margin, Math.min(window.innerWidth - margin, ((leadPoint.x + 1) / 2) * window.innerWidth));
    const y = Math.max(margin, Math.min(window.innerHeight - margin, ((-leadPoint.y + 1) / 2) * window.innerHeight));

    this.reticle.dataset.leadVisible = "true";
    this.reticle.style.setProperty("--lead-x", `${x}px`);
    this.reticle.style.setProperty("--lead-y", `${y}px`);
  }

  private interceptTime(origin: THREE.Vector3, target: THREE.Vector3, targetVelocity: THREE.Vector3, projectileSpeed: number): number | undefined {
    const offset = target.clone().sub(origin);
    const a = targetVelocity.lengthSq() - projectileSpeed * projectileSpeed;
    const b = 2 * offset.dot(targetVelocity);
    const c = offset.lengthSq();

    if (Math.abs(a) < 0.00001) {
      const t = -c / b;
      return t > 0 ? t : undefined;
    }

    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) {
      return undefined;
    }

    const root = Math.sqrt(discriminant);
    const t1 = (-b - root) / (2 * a);
    const t2 = (-b + root) / (2 * a);
    const times = [t1, t2].filter((time) => time > 0).sort((first, second) => first - second);
    return times[0];
  }

  private updateLockTargetIndicator(local: PlayerState): void {
    if (!this.reticle || !local.missileLockTargetId || local.missileLockProgress <= 0) {
      if (this.reticle) {
        this.reticle.dataset.targetVisible = "false";
      }
      return;
    }

    const target = this.state?.players[local.missileLockTargetId];
    const targetJet = target ? this.jets.get(target.id) : undefined;
    if (!target || target.status !== "alive" || !targetJet?.visible) {
      this.reticle.dataset.targetVisible = "false";
      return;
    }

    const targetPoint = targetJet.position.clone().project(this.camera);
    if (targetPoint.z < -1 || targetPoint.z > 1) {
      this.reticle.dataset.targetVisible = "false";
      return;
    }

    const margin = 32;
    const x = Math.max(margin, Math.min(window.innerWidth - margin, ((targetPoint.x + 1) / 2) * window.innerWidth));
    const y = Math.max(margin, Math.min(window.innerHeight - margin, ((-targetPoint.y + 1) / 2) * window.innerHeight));

    this.reticle.dataset.targetVisible = "true";
    this.reticle.style.setProperty("--target-x", `${x}px`);
    this.reticle.style.setProperty("--target-y", `${y}px`);
  }

  private updateMissileSmoke(now: number, dt: number): void {
    this.projectiles.forEach((projectile) => {
      if (projectile.userData.projectileType !== "missile") {
        return;
      }

      if (now < (projectile.userData.nextSmokeAt as number)) {
        return;
      }

      projectile.userData.nextSmokeAt = now + 55;
      const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(projectile.quaternion).normalize();
      const origin = projectile.position.clone().addScaledVector(direction, -8.6);
      this.spawnSmokePuff(origin, direction);
    });

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

  private spawnSmokePuff(origin: THREE.Vector3, missileDirection: THREE.Vector3): void {
    this.spawnPuff({
      origin,
      velocity: missileDirection.clone().multiplyScalar(-6).add(new THREE.Vector3((Math.random() - 0.5) * 2.8, (Math.random() - 0.5) * 2.8, (Math.random() - 0.5) * 2.8)),
      color: "#d6d3ce",
      opacity: 0.36,
      life: 1.7 + Math.random() * 0.55,
      size: 1.6 + Math.random() * 1.2,
      growth: 2.2
    });
  }

  private spawnPuff({
    origin,
    velocity,
    color,
    opacity,
    life,
    size,
    growth,
    additive = false
  }: {
    origin: THREE.Vector3;
    velocity: THREE.Vector3;
    color: string;
    opacity: number;
    life: number;
    size: number;
    growth: number;
    additive?: boolean;
  }): void {
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

  private updateExplosions(now: number, dt: number): void {
    for (let i = this.explosions.length - 1; i >= 0; i -= 1) {
      const explosion = this.explosions[i];
      const age = now - explosion.born;
      const progress = age / explosion.life;

      explosion.group.children.forEach((child) => {
        const velocity = child.userData.velocity as THREE.Vector3;
        child.position.addScaledVector(velocity, dt);
      });
      explosion.material.opacity = 1 - progress;

      if (progress >= 1) {
        this.scene.remove(explosion.group);
        explosion.material.dispose();
        this.explosions.splice(i, 1);
      }
    }
  }

  private static createRotatedCylinderGeometry(radiusTop: number, radiusBottom: number, height: number, radialSegments: number): THREE.CylinderGeometry {
    const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments);
    geometry.rotateX(Math.PI / 2);
    return geometry;
  }
}
