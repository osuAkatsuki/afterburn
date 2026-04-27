import * as THREE from "three";
import { BULLET_SPEED, BULLET_TTL_SECONDS, GUN_CONVERGENCE_DISTANCE } from "../../../shared/constants.js";
import type { PlayerState, RoomState } from "../../../shared/types.js";

const GUN_MUZZLE_FORWARD_OFFSET = 22;
const GUN_MUZZLE_SIDE_OFFSET = 8.5;
const GUN_MUZZLE_VERTICAL_OFFSET = -0.8;

export class ReticleProjector {
  constructor(
    private readonly reticle: HTMLElement | null,
    private readonly camera: THREE.Camera,
    private readonly getJet: (playerId: string) => THREE.Group | undefined
  ) {}

  update(room: RoomState | undefined, localPlayerId: string): void {
    if (!this.reticle) {
      return;
    }

    const local = room?.players[localPlayerId];
    const localJet = local ? this.getJet(local.id) : undefined;
    if (!local || local.status !== "alive" || !localJet?.visible) {
      this.reticle.dataset.visible = "false";
      this.reticle.dataset.lock = "idle";
      this.reticle.dataset.leadVisible = "false";
      return;
    }

    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(localJet.quaternion).normalize();
    const aimPoint = localJet.position
      .clone()
      .add(forward.clone().multiplyScalar(GUN_CONVERGENCE_DISTANCE))
      .project(this.camera);

    if (aimPoint.z < -1 || aimPoint.z > 1) {
      this.reticle.dataset.visible = "false";
      this.reticle.dataset.leadVisible = "false";
      return;
    }

    const margin = 36;
    const x = Math.max(margin, Math.min(window.innerWidth - margin, ((aimPoint.x + 1) / 2) * window.innerWidth));
    const y = Math.max(margin, Math.min(window.innerHeight - margin, ((-aimPoint.y + 1) / 2) * window.innerHeight));

    this.reticle.dataset.visible = "true";
    this.reticle.dataset.lock = "idle";
    this.reticle.style.setProperty("--reticle-x", `${x}px`);
    this.reticle.style.setProperty("--reticle-y", `${y}px`);
    this.updateGunLeadIndicator(room, local, localJet, forward);
  }

  private updateGunLeadIndicator(room: RoomState | undefined, local: PlayerState, localJet: THREE.Group, forward: THREE.Vector3): void {
    if (!this.reticle || !room) {
      return;
    }

    const maxRange = BULLET_SPEED * BULLET_TTL_SECONDS;
    const localPosition = localJet.position;
    const candidates = Object.values(room.players)
      .filter((player) => player.id !== local.id && player.status === "alive")
      .map((player) => {
        const targetJet = this.getJet(player.id);
        const targetPosition = targetJet?.visible
          ? targetJet.position.clone()
          : new THREE.Vector3(player.position.x, player.position.y, player.position.z);
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
    const virtualMuzzle = gunMuzzle(localJet, 0);
    const interceptTime = calculateInterceptTime(virtualMuzzle, candidate.targetPosition, targetVelocity, BULLET_SPEED);
    if (!interceptTime || interceptTime > BULLET_TTL_SECONDS) {
      this.reticle.dataset.leadVisible = "false";
      return;
    }

    const interceptPoint = candidate.targetPosition.clone().addScaledVector(targetVelocity, interceptTime);
    const sightPoint = averageVectors([
      convergenceSightPoint(localPosition, gunMuzzle(localJet, -1), interceptPoint),
      convergenceSightPoint(localPosition, gunMuzzle(localJet, 1), interceptPoint)
    ]).project(this.camera);
    if (sightPoint.z < -1 || sightPoint.z > 1) {
      this.reticle.dataset.leadVisible = "false";
      return;
    }

    const margin = 28;
    const x = Math.max(margin, Math.min(window.innerWidth - margin, ((sightPoint.x + 1) / 2) * window.innerWidth));
    const y = Math.max(margin, Math.min(window.innerHeight - margin, ((-sightPoint.y + 1) / 2) * window.innerHeight));

    this.reticle.dataset.leadVisible = "true";
    this.reticle.style.setProperty("--lead-x", `${x}px`);
    this.reticle.style.setProperty("--lead-y", `${y}px`);
  }

}

export function calculateInterceptTime(origin: THREE.Vector3, target: THREE.Vector3, targetVelocity: THREE.Vector3, projectileSpeed: number): number | undefined {
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

export function convergenceSightPoint(origin: THREE.Vector3, muzzle: THREE.Vector3, interceptPoint: THREE.Vector3): THREE.Vector3 {
  const bulletDirection = interceptPoint.clone().sub(muzzle);
  if (bulletDirection.lengthSq() <= 0.00001) {
    return interceptPoint.clone();
  }

  bulletDirection.normalize();
  const muzzleOffset = muzzle.clone().sub(origin);
  const b = 2 * muzzleOffset.dot(bulletDirection);
  const c = muzzleOffset.lengthSq() - GUN_CONVERGENCE_DISTANCE * GUN_CONVERGENCE_DISTANCE;
  const discriminant = b * b - 4 * c;
  if (discriminant < 0) {
    return origin.clone().add(interceptPoint.clone().sub(origin).normalize().multiplyScalar(GUN_CONVERGENCE_DISTANCE));
  }

  const root = Math.sqrt(discriminant);
  const distances = [(-b - root) / 2, (-b + root) / 2].filter((distance) => distance > 0).sort((first, second) => first - second);
  const distance = distances[0];
  if (distance === undefined) {
    return origin.clone().add(interceptPoint.clone().sub(origin).normalize().multiplyScalar(GUN_CONVERGENCE_DISTANCE));
  }

  return muzzle.clone().addScaledVector(bulletDirection, distance);
}

function gunMuzzle(localJet: THREE.Group, barrelSide: -1 | 0 | 1): THREE.Vector3 {
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(localJet.quaternion).normalize();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(localJet.quaternion).normalize();
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(localJet.quaternion).normalize();

  return localJet.position
    .clone()
    .addScaledVector(forward, GUN_MUZZLE_FORWARD_OFFSET)
    .addScaledVector(right, barrelSide * GUN_MUZZLE_SIDE_OFFSET)
    .addScaledVector(up, GUN_MUZZLE_VERTICAL_OFFSET);
}

function averageVectors(vectors: THREE.Vector3[]): THREE.Vector3 {
  const average = vectors.reduce((sum, vector) => sum.add(vector), new THREE.Vector3());
  return average.multiplyScalar(1 / Math.max(1, vectors.length));
}
