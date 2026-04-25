import * as THREE from "three";
import { ARENA_RADIUS, MAX_ALTITUDE } from "../../shared/constants.js";
import { forwardVector, lerpAngle } from "../../shared/math.js";
import type { PlayerState, ProjectileState, RoomState } from "../../shared/types.js";

type VisualJetTarget = {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  visible: boolean;
};

export class DogfightScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 6000);
  private readonly clock = new THREE.Clock();
  private readonly jets = new Map<string, THREE.Group>();
  private readonly jetTargets = new Map<string, VisualJetTarget>();
  private readonly projectiles = new Map<string, THREE.Object3D>();
  private readonly explosions: Array<{ group: THREE.Group; born: number; life: number }> = [];
  private readonly cameraLookTarget = new THREE.Vector3(0, 180, 0);
  private state: RoomState | undefined;
  private localPlayerId = "";

  private readonly resize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
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

  render(now: number): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.updateJets(dt);
    this.updateCamera(dt);
    this.updateExplosions(now, dt);
    this.renderer.render(this.scene, this.camera);
  }

  destroy(): void {
    window.removeEventListener("resize", this.resize);
    this.renderer.dispose();
  }

  private buildWorld(): void {
    const hemi = new THREE.HemisphereLight("#dff6ff", "#23646d", 2.2);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight("#fff3c4", 2.8);
    sun.position.set(-500, 900, -300);
    sun.castShadow = true;
    this.scene.add(sun);

    const ocean = new THREE.Mesh(
      new THREE.CircleGeometry(ARENA_RADIUS * 1.25, 96),
      new THREE.MeshStandardMaterial({ color: "#147b9b", roughness: 0.72, metalness: 0.05 })
    );
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.y = -2;
    this.scene.add(ocean);

    const island = new THREE.Mesh(
      new THREE.ConeGeometry(380, 90, 7),
      new THREE.MeshStandardMaterial({ color: "#497f54", roughness: 0.95 })
    );
    island.position.set(0, 34, 0);
    island.scale.set(1.6, 0.45, 1.2);
    this.scene.add(island);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(ARENA_RADIUS, 2, 6, 128),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.28 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 24;
    this.scene.add(ring);

    for (let i = 0; i < 28; i += 1) {
      const cloud = this.createCloud();
      const angle = Math.random() * Math.PI * 2;
      const radius = 400 + Math.random() * 1300;
      cloud.position.set(Math.sin(angle) * radius, 260 + Math.random() * 420, Math.cos(angle) * radius);
      this.scene.add(cloud);
    }
  }

  private createCloud(): THREE.Group {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: "#f8fbff", roughness: 1, transparent: true, opacity: 0.82 });
    const count = 3 + Math.floor(Math.random() * 4);

    for (let i = 0; i < count; i += 1) {
      const puff = new THREE.Mesh(new THREE.DodecahedronGeometry(20 + Math.random() * 22, 0), material);
      puff.position.set(i * 22, Math.random() * 12, (Math.random() - 0.5) * 24);
      puff.scale.set(1.8, 0.55, 0.9);
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
      const targetRotation = new THREE.Euler(-player.rotation.pitch, player.rotation.yaw, -player.rotation.roll, "YXZ");
      this.jetTargets.set(player.id, {
        position: targetPosition,
        rotation: targetRotation,
        visible: player.status === "alive"
      });

      if (jet.userData.initialized !== true) {
        jet.position.copy(targetPosition);
        jet.rotation.copy(targetRotation);
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
      mesh.lookAt(mesh.position.clone().add(velocity));
    });
  }

  private createJet(player: PlayerState): THREE.Group {
    const group = new THREE.Group();
    const jetMaterial = new THREE.MeshStandardMaterial({ color: player.color, roughness: 0.45, metalness: 0.18 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 18), jetMaterial);
    body.castShadow = true;
    group.add(body);

    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(2.25, 6, 5),
      new THREE.MeshStandardMaterial({ color: "#eef7ff", roughness: 0.35, metalness: 0.22 })
    );
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 11;
    group.add(nose);

    const wing = new THREE.Mesh(new THREE.BoxGeometry(20, 0.45, 5.5), jetMaterial.clone());
    wing.position.z = -1;
    group.add(wing);

    const tail = new THREE.Mesh(new THREE.BoxGeometry(8, 0.5, 3), new THREE.MeshStandardMaterial({ color: "#182033", roughness: 0.5 }));
    tail.position.z = -9;
    tail.position.y = 2.5;
    group.add(tail);

    const canopy = new THREE.Mesh(new THREE.BoxGeometry(3, 1.3, 5), new THREE.MeshStandardMaterial({ color: "#0f172a", roughness: 0.18, metalness: 0.05 }));
    canopy.position.y = 2.1;
    canopy.position.z = 2.2;
    group.add(canopy);

    const flame = new THREE.Mesh(new THREE.ConeGeometry(1.8, 10, 7), new THREE.MeshBasicMaterial({ color: "#60a5fa", transparent: true, opacity: 0.45 }));
    flame.rotation.x = -Math.PI / 2;
    flame.position.z = -13;
    group.add(flame);

    return group;
  }

  private createProjectile(projectile: ProjectileState): THREE.Object3D {
    if (projectile.type === "missile") {
      const missile = new THREE.Mesh(
        new THREE.ConeGeometry(2.2, 10, 8),
        new THREE.MeshStandardMaterial({ color: "#f97316", emissive: "#7c2d12", emissiveIntensity: 0.4 })
      );
      missile.rotation.x = Math.PI / 2;
      return missile;
    }

    return new THREE.Mesh(new THREE.SphereGeometry(2.3, 8, 8), new THREE.MeshBasicMaterial({ color: "#fff7ad" }));
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
      jet.rotation.order = "YXZ";
      jet.rotation.set(
        lerpAngle(jet.rotation.x, target.rotation.x, alpha),
        lerpAngle(jet.rotation.y, target.rotation.y, alpha),
        lerpAngle(jet.rotation.z, target.rotation.z, alpha)
      );
    });
  }

  private updateCamera(dt: number): void {
    const local = this.state?.players[this.localPlayerId];
    const localJet = this.jets.get(this.localPlayerId);
    const cameraAlpha = 1 - Math.exp(-dt * 7);
    const lookAlpha = 1 - Math.exp(-dt * 9);

    if (!local || local.status !== "alive" || !localJet?.visible) {
      this.camera.position.lerp(new THREE.Vector3(0, 520, -860), cameraAlpha * 0.35);
      this.cameraLookTarget.lerp(new THREE.Vector3(0, 180, 0), lookAlpha * 0.35);
      this.camera.lookAt(this.cameraLookTarget);
      return;
    }

    const forward = forwardVector({
      pitch: -localJet.rotation.x,
      yaw: localJet.rotation.y,
      roll: -localJet.rotation.z
    });
    const desired = new THREE.Vector3(
      localJet.position.x - forward.x * 72,
      localJet.position.y + 24 - forward.y * 24,
      localJet.position.z - forward.z * 72
    );
    const desiredLook = new THREE.Vector3(
      localJet.position.x + forward.x * 150,
      localJet.position.y + 12 + forward.y * 80,
      localJet.position.z + forward.z * 150
    );

    this.camera.position.lerp(desired, cameraAlpha);
    this.cameraLookTarget.lerp(desiredLook, lookAlpha);
    this.camera.lookAt(this.cameraLookTarget);
    this.camera.far = Math.max(6000, MAX_ALTITUDE * 6);
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
