import * as THREE from "three";
import { ARENA_RADIUS, MAX_ALTITUDE, TERRAIN_ISLANDS } from "../../shared/constants.js";
import type { TerrainIsland } from "../../shared/constants.js";
import type { PlayerState, ProjectileState, RoomState } from "../../shared/types.js";

type VisualJetTarget = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  visible: boolean;
};

type SmokePuff = {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  velocity: THREE.Vector3;
  age: number;
  life: number;
  startScale: number;
  growth: number;
  maxOpacity: number;
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
  private readonly explosions: Array<{ group: THREE.Group; born: number; life: number }> = [];
  private readonly cameraLookTarget = new THREE.Vector3(0, 180, 0);
  private readonly chaseCameraFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  private skyDome?: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private ocean?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private oceanBasePositions?: Float32Array;
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
      const shard = new THREE.Mesh(new THREE.TetrahedronGeometry(3 + Math.random() * 5), material.clone());
      shard.position.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
      shard.userData.velocity = new THREE.Vector3((Math.random() - 0.5) * 90, (Math.random() - 0.2) * 90, (Math.random() - 0.5) * 90);
      group.add(shard);
    }

    group.position.set(position.x, position.y, position.z);
    this.scene.add(group);
    this.explosions.push({ group, born: performance.now(), life: 900 });
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
      const spark = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 9 + Math.random() * 10), material.clone());
      spark.position.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
      spark.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      spark.userData.velocity = new THREE.Vector3((Math.random() - 0.5) * 55, (Math.random() - 0.35) * 55, (Math.random() - 0.5) * 55);
      group.add(spark);
    }

    group.position.set(position.x, position.y, position.z);
    this.scene.add(group);
    this.explosions.push({ group, born: performance.now(), life: 360 });
  }

  render(now: number): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.updateOcean(now);
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
    this.renderer.dispose();
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
    const geometry = new THREE.PlaneGeometry(ARENA_RADIUS * 5, ARENA_RADIUS * 5, 92, 92);
    this.oceanBasePositions = (geometry.attributes.position.array as Float32Array).slice();
    this.ocean = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: "#116f86",
        roughness: 0.46,
        metalness: 0.08,
        emissive: "#063342",
        emissiveIntensity: 0.08
      })
    );
    this.ocean.rotation.x = -Math.PI / 2;
    this.ocean.position.y = -4;
    this.ocean.receiveShadow = true;
    this.scene.add(this.ocean);
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

    const verticalFin = this.createTriangleMesh(
      [
        new THREE.Vector3(0, 1.25, -8.4),
        new THREE.Vector3(0, 6.8, -11.5),
        new THREE.Vector3(0, 1.15, -14.1)
      ],
      panelMaterial
    );
    group.add(verticalFin);

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

  private createProjectile(projectile: ProjectileState): THREE.Object3D {
    if (projectile.type === "missile") {
      return this.createMissile();
    }

    if (projectile.type === "flare") {
      return this.createFlare();
    }

    return this.createBulletTracer();
  }

  private createBulletTracer(): THREE.Group {
    const tracer = new THREE.Group();

    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 15, 8),
      new THREE.MeshBasicMaterial({ color: "#fff7ad" })
    );
    core.rotation.x = Math.PI / 2;
    tracer.add(core);

    const glow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.75, 0.75, 20, 8),
      new THREE.MeshBasicMaterial({
        color: "#f97316",
        transparent: true,
        opacity: 0.26,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    glow.rotation.x = Math.PI / 2;
    tracer.add(glow);

    return tracer;
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

    const light = new THREE.PointLight("#f97316", 2.5, 120);
    flare.add(light);
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

    const glow = new THREE.PointLight("#fb923c", 1.8, 65);
    glow.position.z = -7;
    missile.add(glow);

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
    });
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
      positions[i + 2] =
        Math.sin(x * 0.006 + t * 0.95) * 1.6 +
        Math.sin((x + y) * 0.0042 + t * 1.35) * 1.1 +
        Math.sin(y * 0.009 - t * 0.78) * 0.65;
    }

    this.ocean.geometry.attributes.position.needsUpdate = true;
    this.ocean.geometry.computeVertexNormals();
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

      puff.mesh.position.addScaledVector(puff.velocity, dt);
      puff.mesh.scale.setScalar(puff.startScale * (1 + progress * puff.growth));
      puff.mesh.material.opacity = Math.max(0, puff.maxOpacity * (1 - progress));

      if (progress >= 1) {
        this.scene.remove(puff.mesh);
        puff.mesh.geometry.dispose();
        puff.mesh.material.dispose();
        this.smokePuffs.splice(i, 1);
      }
    }

    while (this.smokePuffs.length > 220) {
      const puff = this.smokePuffs.shift();
      if (!puff) {
        continue;
      }
      this.scene.remove(puff.mesh);
      puff.mesh.geometry.dispose();
      puff.mesh.material.dispose();
    }
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
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 6), material);
    const lateral = new THREE.Vector3((Math.random() - 0.5) * size, (Math.random() - 0.5) * size, (Math.random() - 0.5) * size);
    mesh.position.copy(origin).add(lateral.multiplyScalar(0.45));
    mesh.renderOrder = -1;
    this.scene.add(mesh);

    this.smokePuffs.push({
      mesh,
      velocity,
      age: 0,
      life,
      startScale: 1,
      growth,
      maxOpacity: opacity
    });
  }

  private updateExplosions(now: number, dt: number): void {
    for (let i = this.explosions.length - 1; i >= 0; i -= 1) {
      const explosion = this.explosions[i];
      const age = now - explosion.born;
      const progress = age / explosion.life;

      explosion.group.children.forEach((child) => {
        const velocity = child.userData.velocity as THREE.Vector3;
        child.position.addScaledVector(velocity, dt);
        const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
        material.opacity = 1 - progress;
      });

      if (progress >= 1) {
        this.scene.remove(explosion.group);
        this.explosions.splice(i, 1);
      }
    }
  }
}
