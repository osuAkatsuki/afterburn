import * as THREE from "three";
import type { PlayerState, RoomState } from "../../../shared/types.js";
import {
  JET_VISUAL_MODEL,
  type JetControlSurfaceName,
  type JetMaterialKey,
  type Vec3Tuple
} from "./jetVisualModel.js";

type VisualJetTarget = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  visible: boolean;
};

type ControlSurfaces = Record<JetControlSurfaceName, THREE.Object3D>;

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

      if (id === localPlayerId) {
        jet.position.copy(target.position);
        jet.quaternion.copy(target.quaternion);
      } else {
        const alpha = 1 - Math.exp(-dt * 16);
        jet.position.lerp(target.position, alpha);
        jet.quaternion.slerp(target.quaternion, alpha);
      }

      const player = room?.players[id];
      const afterburner = player?.input.afterburner === true;
      const flame = jet.userData.flame as THREE.Mesh | undefined;
      const flameMaterial = jet.userData.flameMaterial as THREE.MeshBasicMaterial | undefined;
      const heatGlow = jet.userData.heatGlow as THREE.Mesh | undefined;
      const heatGlowMaterial = jet.userData.heatGlowMaterial as THREE.MeshBasicMaterial | undefined;
      if (flame && flameMaterial && heatGlow && heatGlowMaterial) {
        const visual = JET_VISUAL_MODEL.afterburnerVisual;
        const pulse = visual.pulseBase + Math.sin(performance.now() * visual.pulseFrequency) * visual.pulseAmplitude;
        setScale(flame, afterburner ? scaleTuple(visual.flameScaleAfterburner, pulse) : visual.flameScaleCruise);
        flameMaterial.opacity = afterburner ? visual.flameOpacityAfterburner : visual.flameOpacityCruise;
        setScale(heatGlow, afterburner ? visual.heatGlowScaleAfterburner : visual.heatGlowScaleCruise);
        heatGlowMaterial.opacity = afterburner ? visual.heatGlowOpacityAfterburner : visual.heatGlowOpacityCruise;
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
    const materials: Record<JetMaterialKey, THREE.Material> = {
      body: new THREE.MeshStandardMaterial({ color: "#9ca8b3", roughness: 0.36, metalness: 0.42 }),
      panel: new THREE.MeshStandardMaterial({ color: "#475569", roughness: 0.44, metalness: 0.32, side: THREE.DoubleSide }),
      accent: new THREE.MeshStandardMaterial({ color: player.color, roughness: 0.38, metalness: 0.18, side: THREE.DoubleSide }),
      wing: new THREE.MeshStandardMaterial({ color: "#7d8995", roughness: 0.42, metalness: 0.34, side: THREE.DoubleSide }),
      controlSurface: new THREE.MeshStandardMaterial({ color: "#64748b", roughness: 0.48, metalness: 0.28, side: THREE.DoubleSide })
    };

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(
        JET_VISUAL_MODEL.body.radiusTop,
        JET_VISUAL_MODEL.body.radiusBottom,
        JET_VISUAL_MODEL.body.length,
        JET_VISUAL_MODEL.body.radialSegments
      ),
      materials.body
    );
    body.rotation.x = Math.PI / 2;
    body.castShadow = true;
    group.add(body);

    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(
        JET_VISUAL_MODEL.nose.radius,
        JET_VISUAL_MODEL.nose.length,
        JET_VISUAL_MODEL.nose.radialSegments
      ),
      materials.body
    );
    nose.rotation.x = Math.PI / 2;
    setPosition(nose, JET_VISUAL_MODEL.nose.position);
    nose.castShadow = true;
    group.add(nose);

    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(
        JET_VISUAL_MODEL.canopy.radius,
        JET_VISUAL_MODEL.canopy.widthSegments,
        JET_VISUAL_MODEL.canopy.heightSegments
      ),
      new THREE.MeshStandardMaterial({ color: "#0f172a", roughness: 0.12, metalness: 0.08, emissive: "#1e3a5f", emissiveIntensity: 0.18 })
    );
    setScale(canopy, JET_VISUAL_MODEL.canopy.scale);
    setPosition(canopy, JET_VISUAL_MODEL.canopy.position);
    group.add(canopy);

    JET_VISUAL_MODEL.wingRoots.forEach((part) => {
      const root = new THREE.Mesh(new THREE.BoxGeometry(...part.size), materials.panel);
      setPosition(root, part.position);
      root.rotation.y = part.rotationY;
      root.castShadow = true;
      root.receiveShadow = true;
      group.add(root);
    });

    JET_VISUAL_MODEL.fixedTriangles.forEach((part) => {
      group.add(createTriangleMesh(toVector3List(part.points), materials[part.material]));
    });

    const controlSurfaces = {} as ControlSurfaces;
    JET_VISUAL_MODEL.controlSurfaces.forEach((part) => {
      const surface = createHingedTriangleSurface(toVector3List(part.points), toVector3(part.hinge), materials[part.material]);
      controlSurfaces[part.surface] = surface;
      group.add(surface);
    });

    JET_VISUAL_MODEL.nozzles.forEach((part) => {
      const nozzle = new THREE.Mesh(
        new THREE.CylinderGeometry(part.radiusTop, part.radiusBottom, part.length, part.radialSegments),
        materials.panel
      );
      nozzle.rotation.x = Math.PI / 2;
      setPosition(nozzle, part.position);
      group.add(nozzle);
    });

    const flameMaterial = new THREE.MeshBasicMaterial({ color: "#74c0ff", transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(
        JET_VISUAL_MODEL.afterburnerFlame.radius,
        JET_VISUAL_MODEL.afterburnerFlame.length,
        JET_VISUAL_MODEL.afterburnerFlame.radialSegments
      ),
      flameMaterial
    );
    flame.rotation.x = -Math.PI / 2;
    setPosition(flame, JET_VISUAL_MODEL.afterburnerFlame.position);
    group.add(flame);

    const heatGlowMaterial = new THREE.MeshBasicMaterial({ color: "#f97316", transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false });
    const heatGlow = new THREE.Mesh(
      new THREE.SphereGeometry(
        JET_VISUAL_MODEL.heatGlow.radius,
        JET_VISUAL_MODEL.heatGlow.widthSegments,
        JET_VISUAL_MODEL.heatGlow.heightSegments
      ),
      heatGlowMaterial
    );
    setScale(heatGlow, JET_VISUAL_MODEL.heatGlow.scale);
    setPosition(heatGlow, JET_VISUAL_MODEL.heatGlow.position);
    group.add(heatGlow);

    group.userData.flame = flame;
    group.userData.flameMaterial = flameMaterial;
    group.userData.heatGlow = heatGlow;
    group.userData.heatGlowMaterial = heatGlowMaterial;
    group.userData.controlSurfaces = controlSurfaces;
    group.userData.nextAfterburnerPuffAt = 0;
    group.userData.nextDamageSmokeAt = 0;

    return group;
  }

  private updateControlSurfaces(jet: THREE.Group, player: PlayerState | undefined, dt: number): void {
    const surfaces = jet.userData.controlSurfaces as ControlSurfaces | undefined;

    if (!surfaces || !player) {
      return;
    }

    const motion = JET_VISUAL_MODEL.controlSurfaceMotion;
    const alpha = 1 - Math.exp(-dt * motion.smoothing);
    const roll = player.input.roll;
    const pitch = player.input.pitch;
    const yaw = player.input.yaw;

    surfaces.leftAileron.rotation.x = THREE.MathUtils.lerp(surfaces.leftAileron.rotation.x, roll * motion.maxAileronRadians, alpha);
    surfaces.rightAileron.rotation.x = THREE.MathUtils.lerp(surfaces.rightAileron.rotation.x, -roll * motion.maxAileronRadians, alpha);
    surfaces.elevatorLeft.rotation.x = THREE.MathUtils.lerp(surfaces.elevatorLeft.rotation.x, -pitch * motion.maxElevatorRadians, alpha);
    surfaces.elevatorRight.rotation.x = THREE.MathUtils.lerp(surfaces.elevatorRight.rotation.x, -pitch * motion.maxElevatorRadians, alpha);
    surfaces.leftRudder.rotation.y = THREE.MathUtils.lerp(surfaces.leftRudder.rotation.y, yaw * motion.maxRudderRadians, alpha);
    surfaces.rightRudder.rotation.y = THREE.MathUtils.lerp(surfaces.rightRudder.rotation.y, yaw * motion.maxRudderRadians, alpha);
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

function toVector3(tuple: Vec3Tuple): THREE.Vector3 {
  return new THREE.Vector3(tuple[0], tuple[1], tuple[2]);
}

function toVector3List(points: readonly Vec3Tuple[]): THREE.Vector3[] {
  return points.map(toVector3);
}

function setPosition(object: THREE.Object3D, position: Vec3Tuple): void {
  object.position.set(position[0], position[1], position[2]);
}

function setScale(object: THREE.Object3D, scale: Vec3Tuple): void {
  object.scale.set(scale[0], scale[1], scale[2]);
}

function scaleTuple(tuple: Vec3Tuple, scalar: number): Vec3Tuple {
  return [tuple[0] * scalar, tuple[1] * scalar, tuple[2] * scalar];
}
