import * as THREE from "three";
import { BULLET_SPEED, BULLET_TTL_SECONDS } from "../../../shared/constants.js";
import type { PlayerState, RoomState } from "../../../shared/types.js";

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

    const hasMissiles = local.missilesRemaining > 0;
    this.reticle.dataset.visible = "true";
    this.reticle.dataset.lock = hasMissiles && local.missileLockAcquired ? "locked" : hasMissiles && local.missileLockProgress > 0 ? "locking" : "idle";
    this.reticle.style.setProperty("--reticle-x", `${x}px`);
    this.reticle.style.setProperty("--reticle-y", `${y}px`);
    if (hasMissiles) {
      this.updateLockTargetIndicator(room, local);
    } else {
      this.reticle.dataset.targetVisible = "false";
    }
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
    const interceptTime = calculateInterceptTime(localPosition, candidate.targetPosition, targetVelocity, BULLET_SPEED);
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

  private updateLockTargetIndicator(room: RoomState | undefined, local: PlayerState): void {
    if (!this.reticle || !local.missileLockTargetId || local.missileLockProgress <= 0) {
      if (this.reticle) {
        this.reticle.dataset.targetVisible = "false";
      }
      return;
    }

    const target = room?.players[local.missileLockTargetId];
    const targetJet = target ? this.getJet(target.id) : undefined;
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
