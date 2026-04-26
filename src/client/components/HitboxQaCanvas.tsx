import { useEffect, useRef } from "react";
import * as THREE from "three";
import { BULLET_HIT_RADIUS } from "../../shared/constants.js";
import { AIRFRAME_BULLET_BOXES, AIRFRAME_BULLET_CAPSULES, type AircraftComponentName, type LocalBox, type LocalCapsule } from "../../shared/hitShapes.js";
import { quaternionFromRotation } from "../../shared/math.js";
import type { PlayerState, RoomState, Vec3 } from "../../shared/types.js";
import { JetRenderer } from "../game/entities/JetRenderer.js";

type CaptureSize = {
  width: number;
  height: number;
};

const QA_PLAYER_ID = "hitbox-qa";

export function HitboxQaCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureSize = parseCaptureSize(window.location.search);
  const captureStyle = captureSize ? { width: `${captureSize.width}px`, height: `${captureSize.height}px` } : undefined;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor("#83cef6", 1);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
    camera.position.set(35, 18, 46);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.HemisphereLight("#dbeafe", "#334155", 2.1));
    const keyLight = new THREE.DirectionalLight("#ffffff", 2.2);
    keyLight.position.set(18, 28, 22);
    scene.add(keyLight);

    const jetRenderer = new JetRenderer(scene);
    const room = createQaRoom();
    jetRenderer.sync(room);
    jetRenderer.update(1 / 60, room, QA_PLAYER_ID);

    const overlay = createBulletHitboxOverlay();
    scene.add(overlay);

    const resize = () => {
      const width = canvas.clientWidth || captureSize?.width || window.innerWidth;
      const height = canvas.clientHeight || captureSize?.height || window.innerHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const render = () => {
      resize();
      renderer.render(scene, camera);
    };

    render();
    window.addEventListener("resize", render);

    return () => {
      window.removeEventListener("resize", render);
      scene.remove(overlay);
      overlay.traverse(disposeObject);
      jetRenderer.dispose();
      renderer.dispose();
    };
  }, [captureSize?.height, captureSize?.width]);

  return (
    <div className="hitbox-qa-shell" style={captureStyle}>
      <canvas className="viewport" ref={canvasRef} style={captureStyle} />
      <aside className="hitbox-qa-overlay">
        <strong>gun hitbox qa</strong>
        <span>amber capsules: fuselage/nose gun volumes</span>
        <span>colored boxes: named wing/control-surface gun volumes</span>
        <span>projectile radius remains {BULLET_HIT_RADIUS.toFixed(2)}m; shapes are rendered over the jet body</span>
      </aside>
    </div>
  );
}

function createQaRoom(): RoomState {
  const player: PlayerState = {
    id: QA_PLAYER_ID,
    name: "Hitbox QA",
    color: "#fb7185",
    isBot: false,
    ready: true,
    status: "alive",
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    rotation: { pitch: 0, yaw: 0, roll: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    throttle: 1,
    health: 100,
    score: 0,
    deaths: 0,
    latencyMs: 0,
    gunAmmoRemaining: 480,
    gunCooldown: 0,
    missilesRemaining: 3,
    flaresRemaining: 24,
    missileCooldown: 0,
    flareCooldown: 0,
    missileLockProgress: 0,
    missileLockAcquired: false,
    outOfBoundsRemainingMs: 0,
    spawnProtectionRemainingMs: 0,
    respawnAt: 0,
    lastInputSeq: 0,
    input: {
      seq: 0,
      thrust: 0,
      pitch: 0,
      yaw: 0,
      roll: 0,
      fireGun: false,
      fireMissile: false,
      fireFlare: false,
      afterburner: false,
      timestamp: 0
    }
  };

  return {
    id: "QA",
    hostId: QA_PLAYER_ID,
    phase: "playing",
    players: { [QA_PLAYER_ID]: player },
    projectiles: {},
    startedAt: 0,
    endsAt: 0,
    roundMs: 0,
    now: 0
  };
}

function createBulletHitboxOverlay(): THREE.Group {
  const group = new THREE.Group();
  const capsuleMaterial = new THREE.MeshBasicMaterial({
    color: "#f59e0b",
    transparent: true,
    opacity: 0.42,
    wireframe: true,
    depthTest: false
  });

  AIRFRAME_BULLET_CAPSULES.forEach((capsule) => {
    group.add(createCapsuleMesh(capsule, capsuleMaterial));
  });

  AIRFRAME_BULLET_BOXES.forEach((box) => {
    group.add(createBoxOverlay(box));
  });

  group.renderOrder = 10;
  return group;
}

function createCapsuleMesh(capsule: LocalCapsule, material: THREE.Material): THREE.Mesh {
  const start = toVector3(capsule.start);
  const end = toVector3(capsule.end);
  const direction = end.clone().sub(start);
  const length = direction.length();
  const geometry = new THREE.CapsuleGeometry(capsule.radius, Math.max(0.001, length - capsule.radius * 2), 8, 16);
  const mesh = new THREE.Mesh(geometry, material);

  mesh.position.copy(start.clone().add(end).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.renderOrder = 12;
  return mesh;
}

function createBoxOverlay(box: LocalBox): THREE.Group {
  const group = new THREE.Group();
  const color = hitboxColor(box.name);
  const geometry = new THREE.BoxGeometry(box.halfExtents.x * 2, box.halfExtents.y * 2, box.halfExtents.z * 2);
  const fillMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.18,
    depthTest: false
  });
  const lineMaterial = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.95,
    depthTest: false
  });
  const mesh = new THREE.Mesh(geometry, fillMaterial);
  setPosition(mesh, box.center);
  setQuaternion(mesh, quaternionFromRotation(box.rotation));
  mesh.renderOrder = 11;
  group.add(mesh);

  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), lineMaterial);
  outline.position.copy(mesh.position);
  outline.quaternion.copy(mesh.quaternion);
  outline.renderOrder = 12;
  group.add(outline);

  return group;
}

function hitboxColor(name: AircraftComponentName): string {
  if (name.includes("Aileron") || name.includes("Elevator") || name.includes("Rudder")) {
    return "#e879f9";
  }

  if (name.includes("Wing")) {
    return "#22d3ee";
  }

  if (name.includes("Tail") || name.includes("Fin")) {
    return "#a3e635";
  }

  return "#f59e0b";
}

function toVector3(vec: Vec3): THREE.Vector3 {
  return new THREE.Vector3(vec.x, vec.y, vec.z);
}

function setPosition(object: THREE.Object3D, position: Vec3): void {
  object.position.set(position.x, position.y, position.z);
}

function setQuaternion(object: THREE.Object3D, quaternion: { x: number; y: number; z: number; w: number }): void {
  object.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
}

function parseCaptureSize(search: string): CaptureSize | undefined {
  const params = new URLSearchParams(search);
  const width = Number(params.get("captureWidth"));
  const height = Number(params.get("captureHeight"));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }

  return { width, height };
}

function disposeObject(object: THREE.Object3D): void {
  if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => material.dispose());
  }
}
