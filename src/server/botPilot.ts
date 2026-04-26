import {
  ARENA_RADIUS,
  GUN_CONVERGENCE_DISTANCE,
  MAX_ALTITUDE,
  MISSILE_LOCK_RANGE,
  OCEAN_LEVEL
} from "../shared/constants.js";
import {
  add,
  applyQuaternion,
  clamp,
  distance,
  dot,
  length,
  normalize,
  quaternionFromRotation,
  scale,
  subtract,
  wrapAngle
} from "../shared/math.js";
import { neutralInput } from "../shared/simulation.js";
import type { InputFrame, PlayerState, ProjectileState, RoomState, Vec3 } from "../shared/types.js";

const TARGET_LEAD_SECONDS = 0.75;
const SAFE_ALTITUDE = 115;
const HIGH_ALTITUDE = MAX_ALTITUDE * 0.86;
const BOUNDARY_RECOVERY_RADIUS = ARENA_RADIUS * 0.82;
const CENTER_RECOVERY_RADIUS = ARENA_RADIUS * 0.92;

export function createBotInput(room: RoomState, bot: PlayerState, now: number): InputFrame {
  const input = neutralInput(now);
  input.seq = bot.lastInputSeq + 1;

  if (bot.status !== "alive") {
    return input;
  }

  const target = findBotTarget(room, bot);
  const recoveryPoint = getRecoveryPoint(bot);
  const aimPoint = recoveryPoint ?? getAimPoint(target);
  const steering = aimPoint ? steerToward(bot, aimPoint) : patrol(bot);
  const targetRange = target ? distance(bot.position, target.position) : Number.POSITIVE_INFINITY;
  const targetAhead = target ? steering.ahead : -1;

  input.pitch = steering.pitch;
  input.yaw = steering.yaw;
  input.roll = steering.roll;
  input.afterburner = Boolean(recoveryPoint || targetRange > 520);
  input.fireGun = Boolean(target && targetRange < GUN_CONVERGENCE_DISTANCE * 0.72 && targetAhead > 0.985);
  input.fireMissile = Boolean(target && bot.missileLockAcquired && targetRange < MISSILE_LOCK_RANGE && targetAhead > 0.99);
  input.fireFlare = shouldDeployFlare(room, bot);

  return input;
}

function findBotTarget(room: RoomState, bot: PlayerState): PlayerState | undefined {
  return Object.values(room.players)
    .filter((player) => player.id !== bot.id && player.status === "alive")
    .map((player) => ({ player, range: distance(bot.position, player.position) }))
    .sort((a, b) => a.range - b.range)[0]?.player;
}

function getRecoveryPoint(bot: PlayerState): Vec3 | undefined {
  const horizontalRange = Math.hypot(bot.position.x, bot.position.z);

  if (bot.position.y < SAFE_ALTITUDE) {
    return {
      x: bot.position.x * 0.72,
      y: SAFE_ALTITUDE + 140,
      z: bot.position.z * 0.72
    };
  }

  if (bot.position.y > HIGH_ALTITUDE) {
    return {
      x: bot.position.x * 0.84,
      y: MAX_ALTITUDE * 0.52,
      z: bot.position.z * 0.84
    };
  }

  if (horizontalRange > BOUNDARY_RECOVERY_RADIUS) {
    const centerPull = horizontalRange > CENTER_RECOVERY_RADIUS ? 0 : 0.28;
    return {
      x: -bot.position.x * centerPull,
      y: Math.max(SAFE_ALTITUDE + 80, Math.min(bot.position.y, MAX_ALTITUDE * 0.62)),
      z: -bot.position.z * centerPull
    };
  }

  return undefined;
}

function getAimPoint(target: PlayerState | undefined): Vec3 | undefined {
  if (!target) {
    return undefined;
  }

  return add(target.position, scale(target.velocity, TARGET_LEAD_SECONDS));
}

function patrol(bot: PlayerState): { pitch: number; yaw: number; roll: number; ahead: number } {
  const targetAngle = Math.atan2(-bot.position.x, -bot.position.z) + Math.PI * 0.28;
  const desiredRoll = clamp(wrapAngle(targetAngle - bot.rotation.yaw) * 0.7, -0.72, 0.72);

  return {
    pitch: bot.position.y < OCEAN_LEVEL + SAFE_ALTITUDE + 30 ? 0.55 : 0.18,
    yaw: 0,
    roll: clamp(wrapAngle(desiredRoll - bot.rotation.roll) * 1.85, -1, 1),
    ahead: 1
  };
}

function steerToward(bot: PlayerState, point: Vec3): { pitch: number; yaw: number; roll: number; ahead: number } {
  const orientation = bot.orientation ?? quaternionFromRotation(bot.rotation);
  const forward = normalize(applyQuaternion({ x: 0, y: 0, z: 1 }, orientation));
  const right = normalize(applyQuaternion({ x: 1, y: 0, z: 0 }, orientation));
  const up = normalize(applyQuaternion({ x: 0, y: 1, z: 0 }, orientation));
  const toPoint = normalize(subtract(point, bot.position));
  const lateral = dot(toPoint, right);
  const vertical = dot(toPoint, up);
  const ahead = dot(toPoint, forward);
  const desiredRoll = clamp(lateral * 1.35, -0.95, 0.95);
  const rollError = wrapAngle(desiredRoll - bot.rotation.roll);
  const altitudeBias = bot.position.y < SAFE_ALTITUDE ? 0.38 : bot.position.y > HIGH_ALTITUDE ? -0.32 : 0;

  return {
    pitch: clamp(vertical * 1.55 + Math.abs(lateral) * 0.68 + altitudeBias, -1, 1),
    yaw: clamp(lateral * 0.28, -0.42, 0.42),
    roll: clamp(rollError * 2.15, -1, 1),
    ahead
  };
}

function shouldDeployFlare(room: RoomState, bot: PlayerState): boolean {
  if (bot.flaresRemaining <= 0 || bot.flareCooldown > 0) {
    return false;
  }

  return Object.values(room.projectiles)
    .filter((projectile) => projectile.type === "missile" && projectile.targetId === bot.id)
    .some((projectile) => projectileClosingRange(projectile, bot) < 260);
}

function projectileClosingRange(projectile: ProjectileState, bot: PlayerState): number {
  if (length(projectile.velocity) <= 0.001) {
    return distance(projectile.position, bot.position);
  }

  const toBot = normalize(subtract(bot.position, projectile.position));
  const missileForward = normalize(projectile.velocity);
  const closing = dot(missileForward, toBot);

  return closing > 0.55 ? distance(projectile.position, bot.position) : Number.POSITIVE_INFINITY;
}
