import {
  ARENA_RADIUS,
  BULLET_SPEED,
  GUN_CONVERGENCE_DISTANCE,
  MAX_ALTITUDE,
  MISSILE_LOCK_RANGE,
  MISSILE_SEEKER_GIMBAL_DOT,
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
import { isPlayerSpawnProtected, neutralInput } from "../shared/simulation.js";
import type { InputFrame, PlayerState, ProjectileState, RoomState, Vec3 } from "../shared/types.js";

const TARGET_LEAD_SECONDS = 0.75;
const SAFE_ALTITUDE = 115;
const HIGH_ALTITUDE = MAX_ALTITUDE * 0.86;
const BOUNDARY_RECOVERY_RADIUS = ARENA_RADIUS * 0.82;
const CENTER_RECOVERY_RADIUS = ARENA_RADIUS * 0.92;
const BOUNDARY_RECOVERY_TANGENT = 900;
const BOT_KEEPOUT_RANGE = 380;
const BOT_MERGE_RANGE = 680;
const BOT_BREAKAWAY_FORWARD = 560;
const BOT_BREAKAWAY_SIDE = 520;
const BOT_BREAKAWAY_CLIMB = 150;
const BOT_OFFSET_PURSUIT_SIDE = 260;
const BOT_GUN_RANGE = GUN_CONVERGENCE_DISTANCE * 0.95;
const BOT_GUN_ALIGNMENT = 0.975;
const BOT_MISSILE_ALIGNMENT = 0.94;
const BOT_DEFENSIVE_RANGE = 920;
const BOT_EVADE_SIDE = 720;
const BOT_EVADE_FORWARD = 180;
const BOT_EVADE_CLIMB = 180;
const BOT_FLARE_REACTION_MIN_MS = 420;
const BOT_FLARE_REACTION_SPREAD_MS = 680;
const BOT_FLARE_DEPLOY_MIN_RANGE = 220;
const BOT_FLARE_DEPLOY_SPREAD_RANGE = 210;

type BotPlan = {
  point: Vec3;
  mode: "pursuit" | "offset" | "breakaway";
};

export function createBotInput(room: RoomState, bot: PlayerState, now: number): InputFrame {
  const input = neutralInput(now);
  input.seq = bot.lastInputSeq + 1;

  if (bot.status !== "alive") {
    return input;
  }

  const target = findBotTarget(room, bot);
  const recoveryPoint = getRecoveryPoint(bot);
  const threatMissile = findIncomingMissile(room, bot);
  const defensivePoint = threatMissile && !recoveryPoint ? getMissileEvasionPoint(bot, threatMissile) : undefined;
  const plan = target && !defensivePoint ? getEngagementPlan(bot, target) : undefined;
  const aimPoint = recoveryPoint ?? defensivePoint ?? plan?.point;
  const steering = aimPoint ? steerToward(bot, aimPoint) : patrol(bot);
  const targetRange = target ? distance(bot.position, target.position) : Number.POSITIVE_INFINITY;
  const targetAhead = target ? steering.ahead : -1;
  const breakingAway = plan?.mode === "breakaway" && !recoveryPoint;
  const defending = Boolean(defensivePoint);

  input.pitch = steering.pitch;
  input.yaw = steering.yaw;
  input.roll = steering.roll;
  input.afterburner = Boolean(recoveryPoint || breakingAway || (!defending && targetRange > 1200));
  input.aimDirection = target ? getSeekerAimDirection(bot, target) : undefined;
  input.fireGun = Boolean(!breakingAway && !defending && target && targetRange < BOT_GUN_RANGE && targetAhead > BOT_GUN_ALIGNMENT);
  input.fireMissile = Boolean(!breakingAway && !defending && target && bot.missileLockAcquired && targetRange < MISSILE_LOCK_RANGE && targetAhead > BOT_MISSILE_ALIGNMENT);
  input.fireFlare = shouldDeployFlare(room, bot, now);

  return input;
}

function findBotTarget(room: RoomState, bot: PlayerState): PlayerState | undefined {
  const forward = botForward(bot);

  return Object.values(room.players)
    .filter((player) => player.id !== bot.id && player.status === "alive" && !isPlayerSpawnProtected(player, room.now))
    .map((player) => {
      const range = distance(bot.position, player.position);
      const direction = normalize(subtract(player.position, bot.position));
      const alignment = dot(forward, direction);
      const damagedBonus = clamp((100 - player.health) / 100, 0, 1) * 0.55;
      const leaderBonus = clamp(player.score, 0, 12) * 0.08;
      const rangeScore = 900 / Math.max(260, range);
      return {
        player,
        score: rangeScore + alignment * 0.55 + damagedBonus + leaderBonus
      };
    })
    .sort((a, b) => b.score - a.score || a.player.id.localeCompare(b.player.id))[0]?.player;
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
    const tangent = horizontalRange > 0.001 ? { x: -bot.position.z / horizontalRange, y: 0, z: bot.position.x / horizontalRange } : { x: 1, y: 0, z: 0 };
    return {
      x: -bot.position.x * centerPull + tangent.x * BOUNDARY_RECOVERY_TANGENT,
      y: Math.max(SAFE_ALTITUDE + 80, Math.min(bot.position.y, MAX_ALTITUDE * 0.62)),
      z: -bot.position.z * centerPull + tangent.z * BOUNDARY_RECOVERY_TANGENT
    };
  }

  return undefined;
}

function getAimPoint(bot: PlayerState, target: PlayerState | undefined): Vec3 | undefined {
  if (!target) {
    return undefined;
  }

  const leadSeconds = clamp(distance(bot.position, target.position) / BULLET_SPEED, 0.18, TARGET_LEAD_SECONDS);
  return add(target.position, scale(target.velocity, leadSeconds));
}

function getEngagementPlan(bot: PlayerState, target: PlayerState): BotPlan {
  const range = distance(bot.position, target.position);
  if (range < BOT_KEEPOUT_RANGE || isCollisionCourse(bot, target, range)) {
    return { point: getBreakawayPoint(bot, target), mode: "breakaway" };
  }

  if (range < BOT_MERGE_RANGE) {
    return { point: getOffsetPursuitPoint(bot, target), mode: "offset" };
  }

  return { point: getAimPoint(bot, target) ?? target.position, mode: "pursuit" };
}

function isCollisionCourse(bot: PlayerState, target: PlayerState, range: number): boolean {
  if (range > BOT_MERGE_RANGE) {
    return false;
  }

  const forward = botForward(bot);
  const toTarget = normalize(subtract(target.position, bot.position));
  const targetSpeed = length(target.velocity);
  const targetClosing = targetSpeed > 0.001 ? dot(normalize(target.velocity), scale(toTarget, -1)) : 0;
  return dot(forward, toTarget) > 0.72 && targetClosing > 0.25;
}

function getBreakawayPoint(bot: PlayerState, target: PlayerState): Vec3 {
  const orientation = bot.orientation ?? quaternionFromRotation(bot.rotation);
  const forward = normalize(applyQuaternion({ x: 0, y: 0, z: 1 }, orientation));
  const right = normalize(applyQuaternion({ x: 1, y: 0, z: 0 }, orientation));
  const side = botBreakSide(bot, target);
  return add(add(add(bot.position, scale(forward, BOT_BREAKAWAY_FORWARD)), scale(right, side * BOT_BREAKAWAY_SIDE)), {
    x: 0,
    y: BOT_BREAKAWAY_CLIMB,
    z: 0
  });
}

function getOffsetPursuitPoint(bot: PlayerState, target: PlayerState): Vec3 {
  const orientation = bot.orientation ?? quaternionFromRotation(bot.rotation);
  const right = normalize(applyQuaternion({ x: 1, y: 0, z: 0 }, orientation));
  const side = botBreakSide(bot, target);
  return add(add(getAimPoint(bot, target) ?? target.position, scale(right, side * BOT_OFFSET_PURSUIT_SIDE)), {
    x: 0,
    y: 60,
    z: 0
  });
}

function botForward(bot: PlayerState): Vec3 {
  return normalize(applyQuaternion({ x: 0, y: 0, z: 1 }, bot.orientation ?? quaternionFromRotation(bot.rotation)));
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

function getSeekerAimDirection(bot: PlayerState, target: PlayerState): Vec3 | undefined {
  const direction = normalize(subtract(target.position, bot.position));
  return dot(botForward(bot), direction) >= MISSILE_SEEKER_GIMBAL_DOT ? direction : undefined;
}

function findIncomingMissile(room: RoomState, bot: PlayerState): ProjectileState | undefined {
  return Object.values(room.projectiles)
    .filter((projectile) => projectile.type === "missile" && projectile.targetType === "player" && projectile.targetId === bot.id)
    .map((projectile) => ({ projectile, range: projectileClosingRange(projectile, bot) }))
    .filter(({ range }) => range < BOT_DEFENSIVE_RANGE)
    .sort((a, b) => a.range - b.range)[0]?.projectile;
}

function getMissileEvasionPoint(bot: PlayerState, missile: ProjectileState): Vec3 {
  const orientation = bot.orientation ?? quaternionFromRotation(bot.rotation);
  const forward = normalize(applyQuaternion({ x: 0, y: 0, z: 1 }, orientation));
  const right = normalize(applyQuaternion({ x: 1, y: 0, z: 0 }, orientation));
  const missileForward = length(missile.velocity) > 0.001 ? normalize(missile.velocity) : normalize(subtract(bot.position, missile.position));
  const horizontalMissileRight = normalize({ x: -missileForward.z, y: 0, z: missileForward.x });
  const fallbackRight = length(horizontalMissileRight) > 0.001 ? horizontalMissileRight : right;
  const side = deterministicUnit(bot.id, missile.id, "evade") >= 0.5 ? 1 : -1;
  const lateral = dot(fallbackRight, right) >= 0 ? fallbackRight : scale(fallbackRight, -1);

  return add(add(add(bot.position, scale(lateral, side * BOT_EVADE_SIDE)), scale(forward, BOT_EVADE_FORWARD)), {
    x: 0,
    y: bot.position.y < SAFE_ALTITUDE + 160 ? BOT_EVADE_CLIMB : BOT_EVADE_CLIMB * 0.35,
    z: 0
  });
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

function shouldDeployFlare(room: RoomState, bot: PlayerState, now: number): boolean {
  if (bot.flaresRemaining <= 0 || bot.flareCooldown > 0) {
    return false;
  }

  return Object.values(room.projectiles)
    .filter((projectile) => projectile.type === "missile" && projectile.targetId === bot.id)
    .some((projectile) => {
      const age = now - projectile.createdAt;
      const reactionDelay = BOT_FLARE_REACTION_MIN_MS + deterministicUnit(bot.id, projectile.id, "react") * BOT_FLARE_REACTION_SPREAD_MS;
      if (age < reactionDelay) {
        return false;
      }

      const deployRange = BOT_FLARE_DEPLOY_MIN_RANGE + deterministicUnit(bot.id, projectile.id, "range") * BOT_FLARE_DEPLOY_SPREAD_RANGE;
      return projectileClosingRange(projectile, bot) < deployRange;
    });
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

function botBreakSide(bot: PlayerState, target: PlayerState): number {
  return deterministicUnit(bot.id, target.id, "merge") >= 0.5 ? 1 : -1;
}

function deterministicUnit(...parts: string[]): number {
  let hash = 2166136261;
  const input = parts.join(":");
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 0xffffffff;
}
