import * as THREE from "three";
import type { PlayerState, RoomState } from "../../../shared/types.js";

export const TARGET_LABEL_RANGE_METERS = 4000;
export const TARGET_LABEL_FADE_START_METERS = 2500;

const SCREEN_MARGIN_PX = 24;
const TRAVEL_VECTOR_SECONDS = 0.45;
const TRAVEL_VECTOR_MAX_PX = 46;

export type TargetLockState = "idle" | "locking" | "locked";

export type TargetOverlayModel = {
  playerId: string;
  screenX: number;
  screenY: number;
  opacity: number;
  rangeMeters: number;
  speedMetersPerSecond: number;
  travelVectorX: number;
  travelVectorY: number;
  lockState: TargetLockState;
  lockProgress: number;
};

export type TargetOverlayViewport = {
  width: number;
  height: number;
};

export type TargetPositionProvider = (playerId: string) => THREE.Vector3 | undefined;

export function getTargetOverlayModels(
  room: RoomState | undefined,
  localPlayerId: string,
  camera: THREE.Camera,
  getTargetPosition: TargetPositionProvider,
  viewport: TargetOverlayViewport
): TargetOverlayModel[] {
  const local = room?.players[localPlayerId];
  const localPosition = local ? getTargetPosition(local.id) ?? vectorFromPlayer(local) : undefined;
  if (!room || !local || local.status !== "alive" || !localPosition) {
    return [];
  }

  return Object.values(room.players)
    .filter((player) => player.id !== local.id && player.status === "alive")
    .map((target) => targetOverlayModel(room, local, localPosition, target, camera, getTargetPosition, viewport))
    .filter((model): model is TargetOverlayModel => model !== undefined)
    .sort((first, second) => first.rangeMeters - second.rangeMeters);
}

function targetOverlayModel(
  room: RoomState,
  local: PlayerState,
  localPosition: THREE.Vector3,
  target: PlayerState,
  camera: THREE.Camera,
  getTargetPosition: TargetPositionProvider,
  viewport: TargetOverlayViewport
): TargetOverlayModel | undefined {
  const targetPosition = getTargetPosition(target.id) ?? vectorFromPlayer(target);
  const rangeMeters = targetPosition.distanceTo(localPosition);
  if (rangeMeters > TARGET_LABEL_RANGE_METERS) {
    return undefined;
  }

  const screen = projectToScreen(targetPosition, camera, viewport);
  if (!screen) {
    return undefined;
  }

  const speedMetersPerSecond = vectorFromVelocity(target).length();
  const travelVector = projectedTravelVector(targetPosition, target, camera, viewport);
  const lockProgress = local.missilesRemaining > 0 && local.missileLockTargetId === target.id ? local.missileLockProgress : 0;

  return {
    playerId: target.id,
    screenX: screen.x,
    screenY: screen.y,
    opacity: labelOpacity(rangeMeters),
    rangeMeters,
    speedMetersPerSecond,
    travelVectorX: travelVector.x,
    travelVectorY: travelVector.y,
    lockState: lockState(local, target, room.now),
    lockProgress
  };
}

function lockState(local: PlayerState, target: PlayerState, now: number): TargetLockState {
  if (
    local.missilesRemaining <= 0 ||
    local.missileLockTargetId !== target.id ||
    local.missileLockProgress <= 0 ||
    target.spawnProtectionRemainingMs > 0 ||
    (target.spawnProtectionUntil !== undefined && target.spawnProtectionUntil > now)
  ) {
    return "idle";
  }

  return local.missileLockAcquired ? "locked" : "locking";
}

function projectedTravelVector(
  targetPosition: THREE.Vector3,
  target: PlayerState,
  camera: THREE.Camera,
  viewport: TargetOverlayViewport
): THREE.Vector2 {
  const velocity = vectorFromVelocity(target);
  if (velocity.lengthSq() <= 1) {
    return new THREE.Vector2(0, 0);
  }

  const start = projectToScreen(targetPosition, camera, viewport);
  const end = projectToScreen(
    targetPosition.clone().addScaledVector(velocity, TRAVEL_VECTOR_SECONDS),
    camera,
    viewport,
    false
  );
  if (!start || !end) {
    return new THREE.Vector2(0, 0);
  }

  const vector = new THREE.Vector2(end.x - start.x, end.y - start.y);
  const length = vector.length();
  if (length <= 0.001) {
    return vector;
  }

  return vector.multiplyScalar(Math.min(TRAVEL_VECTOR_MAX_PX, length) / length);
}

function projectToScreen(
  position: THREE.Vector3,
  camera: THREE.Camera,
  viewport: TargetOverlayViewport,
  requireOnScreen = true
): THREE.Vector2 | undefined {
  const projected = position.clone().project(camera);
  if (projected.z < -1 || projected.z > 1) {
    return undefined;
  }

  const x = ((projected.x + 1) / 2) * viewport.width;
  const y = ((-projected.y + 1) / 2) * viewport.height;
  if (
    requireOnScreen &&
    (x < SCREEN_MARGIN_PX ||
      x > viewport.width - SCREEN_MARGIN_PX ||
      y < SCREEN_MARGIN_PX ||
      y > viewport.height - SCREEN_MARGIN_PX)
  ) {
    return undefined;
  }

  return new THREE.Vector2(x, y);
}

function labelOpacity(rangeMeters: number): number {
  if (rangeMeters <= TARGET_LABEL_FADE_START_METERS) {
    return 1;
  }

  const fadeRange = TARGET_LABEL_RANGE_METERS - TARGET_LABEL_FADE_START_METERS;
  const t = Math.max(0, Math.min(1, (rangeMeters - TARGET_LABEL_FADE_START_METERS) / fadeRange));
  return 1 - t * 0.48;
}

export function formatTargetRange(rangeMeters: number): string {
  if (rangeMeters < 1000) {
    return `${Math.round(rangeMeters)} M`;
  }

  const kilometers = rangeMeters / 1000;
  return `${kilometers >= 10 ? Math.round(kilometers).toString() : kilometers.toFixed(1)} KM`;
}

function vectorFromPlayer(player: PlayerState): THREE.Vector3 {
  return new THREE.Vector3(player.position.x, player.position.y, player.position.z);
}

function vectorFromVelocity(player: PlayerState): THREE.Vector3 {
  return new THREE.Vector3(player.velocity.x, player.velocity.y, player.velocity.z);
}
