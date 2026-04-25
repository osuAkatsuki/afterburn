import * as THREE from "three";
import type { PlayerState, RoomState } from "../../../shared/types.js";

type VisualJetTarget = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  visible: boolean;
};

type ControlSurfaces = {
  leftAileron: THREE.Object3D;
  rightAileron: THREE.Object3D;
  elevatorLeft: THREE.Object3D;
  elevatorRight: THREE.Object3D;
  leftRudder: THREE.Object3D;
  rightRudder: THREE.Object3D;
};

export class JetRenderer {
  private readonly jets = new Map<string, THREE.Group>();
  private readonly jetTargets = new Map<string, VisualJetTarget>();

  constructor(private readonly scene: THREE.Scene) {}

  sync(room: RoomState): void {
    const ids = new Set(Object.keys(room.players));
    this.jets.forEach((jet, id) => {
      if (!ids.has(id)) {
        this.scene.remove(jet);
        this.disposeJet(jet);
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

  update(dt: number, room: RoomState | undefined, localPlayerId = ""): void {
    this.jets.forEach((jet, id) => {
      const target = this.jetTargets.get(id);
      if (!target) {
        return;
      }

      jet.visible = target.visible;
      if (!target.visible) {
        return;
      }

      const alpha = id === localPlayerId ? 1 - Math.exp(-dt * 18) : 1 - Math.exp(-dt * 16);
      jet.position.lerp(target.position, alpha);
      jet.quaternion.slerp(target.quaternion, alpha);

      const player = room?.players[id];
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

  getJet(id: string): THREE.Group | undefined {
    return this.jets.get(id);
  }

  getJetCount(): number {
    return this.jets.size;
  }

  dispose(): void {
    this.jets.forEach((jet) => {
      this.scene.remove(jet);
      this.disposeJet(jet);
    });
    this.jets.clear();
    this.jetTargets.clear();
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

    const leftWing = createTriangleMesh(
      [
        new THREE.Vector3(-1.35, -0.15, 1.2),
        new THREE.Vector3(-17.5, -0.25, -3.2),
        new THREE.Vector3(-2.5, -0.2, -8.2)
      ],
      wingMaterial
    );
    const rightWing = createTriangleMesh(
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

    const leftAileron = createHingedTriangleSurface(
      [
        new THREE.Vector3(-9.6, -0.06, -4.8),
        new THREE.Vector3(-16.1, -0.06, -3.45),
        new THREE.Vector3(-11.1, -0.06, -6.45)
      ],
      new THREE.Vector3(-11.4, -0.06, -4.65),
      controlSurfaceMaterial
    );
    const rightAileron = createHingedTriangleSurface(
      [
        new THREE.Vector3(9.6, -0.06, -4.8),
        new THREE.Vector3(16.1, -0.06, -3.45),
        new THREE.Vector3(11.1, -0.06, -6.45)
      ],
      new THREE.Vector3(11.4, -0.06, -4.65),
      controlSurfaceMaterial
    );
    group.add(leftAileron, rightAileron);

    const leftAccent = createTriangleMesh(
      [
        new THREE.Vector3(-11.5, -0.12, -3.8),
        new THREE.Vector3(-17.2, -0.12, -3.2),
        new THREE.Vector3(-12.5, -0.12, -5.4)
      ],
      accentMaterial
    );
    const rightAccent = createTriangleMesh(
      [
        new THREE.Vector3(11.5, -0.12, -3.8),
        new THREE.Vector3(17.2, -0.12, -3.2),
        new THREE.Vector3(12.5, -0.12, -5.4)
      ],
      accentMaterial
    );
    group.add(leftAccent, rightAccent);

    const tailLeft = createTriangleMesh(
      [
        new THREE.Vector3(-1.15, 0.1, -8.3),
        new THREE.Vector3(-7.6, 0, -11.2),
        new THREE.Vector3(-1.65, 0.05, -13.8)
      ],
      panelMaterial
    );
    const tailRight = createTriangleMesh(
      [
        new THREE.Vector3(1.15, 0.1, -8.3),
        new THREE.Vector3(7.6, 0, -11.2),
        new THREE.Vector3(1.65, 0.05, -13.8)
      ],
      panelMaterial
    );
    group.add(tailLeft, tailRight);

    const elevatorLeft = createHingedTriangleSurface(
      [
        new THREE.Vector3(-1.65, 0.12, -11.4),
        new THREE.Vector3(-8.4, 0.08, -13.2),
        new THREE.Vector3(-1.9, 0.1, -15.4)
      ],
      new THREE.Vector3(-3.3, 0.1, -12.05),
      controlSurfaceMaterial
    );
    const elevatorRight = createHingedTriangleSurface(
      [
        new THREE.Vector3(1.65, 0.12, -11.4),
        new THREE.Vector3(8.4, 0.08, -13.2),
        new THREE.Vector3(1.9, 0.1, -15.4)
      ],
      new THREE.Vector3(3.3, 0.1, -12.05),
      controlSurfaceMaterial
    );
    group.add(elevatorLeft, elevatorRight);

    const leftFin = createTriangleMesh(
      [
        new THREE.Vector3(-1.15, 1.1, -8.4),
        new THREE.Vector3(-2.85, 6.6, -11.7),
        new THREE.Vector3(-1.65, 1.05, -14.2)
      ],
      panelMaterial
    );
    const rightFin = createTriangleMesh(
      [
        new THREE.Vector3(1.15, 1.1, -8.4),
        new THREE.Vector3(2.85, 6.6, -11.7),
        new THREE.Vector3(1.65, 1.05, -14.2)
      ],
      panelMaterial
    );
    group.add(leftFin, rightFin);

    const leftRudder = createHingedTriangleSurface(
      [
        new THREE.Vector3(-1.85, 1.35, -10.1),
        new THREE.Vector3(-2.55, 5.25, -11.85),
        new THREE.Vector3(-1.85, 1.25, -13.55)
      ],
      new THREE.Vector3(-1.85, 2.7, -11.85),
      controlSurfaceMaterial
    );
    const rightRudder = createHingedTriangleSurface(
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

  private updateControlSurfaces(jet: THREE.Group, player: PlayerState | undefined, dt: number): void {
    const surfaces = jet.userData.controlSurfaces as ControlSurfaces | undefined;

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

  private playerQuaternion(player: PlayerState): THREE.Quaternion {
    if (player.orientation) {
      return new THREE.Quaternion(player.orientation.x, player.orientation.y, player.orientation.z, player.orientation.w);
    }

    return new THREE.Quaternion().setFromEuler(new THREE.Euler(-player.rotation.pitch, player.rotation.yaw, -player.rotation.roll, "YXZ"));
  }

  private disposeJet(jet: THREE.Group): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    jet.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) {
        const mesh = object as THREE.Mesh;
        geometries.add(mesh.geometry);
        const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        meshMaterials.forEach((material) => materials.add(material));
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
  }
}

function createTriangleMesh(points: THREE.Vector3[], material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  geometry.setIndex([0, 1, 2]);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createHingedTriangleSurface(points: THREE.Vector3[], hinge: THREE.Vector3, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const localPoints = points.map((point) => point.clone().sub(hinge));
  const mesh = createTriangleMesh(localPoints, material);
  group.position.copy(hinge);
  group.add(mesh);
  return group;
}
