import {
  BULLET_SPEED,
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
import { BOT_SKILL_PROFILES, BOT_TUNING, type BotSkillProfile } from "./botTuning.js";

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
  const profile = botProfile(bot);
  const threatMissile = findIncomingMissile(room, bot, profile);
  const defensivePoint = threatMissile && !recoveryPoint ? getMissileEvasionPoint(bot, threatMissile, profile) : undefined;
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
  input.afterburner = Boolean(recoveryPoint || breakingAway || (!defending && targetRange > BOT_TUNING.engagement.longRangeAfterburnerRange));
  input.aimDirection = target ? getSeekerAimDirection(bot, target) : undefined;
  input.fireGun = Boolean(!breakingAway && !defending && target && targetRange < BOT_TUNING.engagement.gunRange && targetAhead > BOT_TUNING.engagement.gunAlignment);
  input.fireMissile = Boolean(
    !breakingAway &&
      !defending &&
      target &&
      bot.missileLockAcquired &&
      targetRange < MISSILE_LOCK_RANGE &&
      targetAhead > BOT_TUNING.engagement.missileAlignment
  );
  input.fireFlare = shouldDeployFlare(room, bot, now, profile);

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
      const damagedBonus = clamp((100 - player.health) / 100, 0, 1) * BOT_TUNING.targetingScore.damagedBonusScale;
      const leaderBonus =
        clamp(player.score, 0, BOT_TUNING.targetingScore.maxLeaderScoreBonusKills) * BOT_TUNING.targetingScore.leaderBonusPerScore;
      const rangeScore = BOT_TUNING.targetingScore.rangeScoreNumerator / Math.max(BOT_TUNING.targetingScore.minRangeForScore, range);
      return {
        player,
        score: rangeScore + alignment * BOT_TUNING.targetingScore.alignmentScale + damagedBonus + leaderBonus
      };
    })
    .sort((a, b) => b.score - a.score || a.player.id.localeCompare(b.player.id))[0]?.player;
}

function getRecoveryPoint(bot: PlayerState): Vec3 | undefined {
  const horizontalRange = Math.hypot(bot.position.x, bot.position.z);

  if (bot.position.y < BOT_TUNING.altitude.safe) {
    return {
      x: bot.position.x * BOT_TUNING.boundaryRecovery.lowAltitudeCenterPull,
      y: BOT_TUNING.altitude.safe + BOT_TUNING.altitude.lowRecoveryClimb,
      z: bot.position.z * BOT_TUNING.boundaryRecovery.lowAltitudeCenterPull
    };
  }

  if (bot.position.y > BOT_TUNING.altitude.high) {
    return {
      x: bot.position.x * BOT_TUNING.boundaryRecovery.highAltitudeCenterPull,
      y: MAX_ALTITUDE * BOT_TUNING.altitude.highRecoveryAltitudeScale,
      z: bot.position.z * BOT_TUNING.boundaryRecovery.highAltitudeCenterPull
    };
  }

  if (horizontalRange > BOT_TUNING.boundaryRecovery.startRadius) {
    const centerPull = horizontalRange > BOT_TUNING.boundaryRecovery.centerPullRadius ? 0 : BOT_TUNING.boundaryRecovery.softCenterPull;
    const tangent = horizontalRange > 0.001 ? { x: -bot.position.z / horizontalRange, y: 0, z: bot.position.x / horizontalRange } : { x: 1, y: 0, z: 0 };
    return {
      x: -bot.position.x * centerPull + tangent.x * BOT_TUNING.boundaryRecovery.tangentDistance,
      y: Math.max(
        BOT_TUNING.altitude.safe + BOT_TUNING.altitude.boundaryRecoveryClearance,
        Math.min(bot.position.y, MAX_ALTITUDE * BOT_TUNING.altitude.boundaryRecoveryAltitudeScale)
      ),
      z: -bot.position.z * centerPull + tangent.z * BOT_TUNING.boundaryRecovery.tangentDistance
    };
  }

  return undefined;
}

function getAimPoint(bot: PlayerState, target: PlayerState | undefined): Vec3 | undefined {
  if (!target) {
    return undefined;
  }

  const leadSeconds = clamp(distance(bot.position, target.position) / BULLET_SPEED, BOT_TUNING.targetLead.minSeconds, BOT_TUNING.targetLead.maxSeconds);
  return add(target.position, scale(target.velocity, leadSeconds));
}

function getEngagementPlan(bot: PlayerState, target: PlayerState): BotPlan {
  const range = distance(bot.position, target.position);
  if (range < BOT_TUNING.engagement.keepoutRange || isCollisionCourse(bot, target, range)) {
    return { point: getBreakawayPoint(bot, target), mode: "breakaway" };
  }

  if (range < BOT_TUNING.engagement.mergeRange) {
    return { point: getOffsetPursuitPoint(bot, target), mode: "offset" };
  }

  return { point: getAimPoint(bot, target) ?? target.position, mode: "pursuit" };
}

function isCollisionCourse(bot: PlayerState, target: PlayerState, range: number): boolean {
  if (range > BOT_TUNING.engagement.mergeRange) {
    return false;
  }

  const forward = botForward(bot);
  const toTarget = normalize(subtract(target.position, bot.position));
  const targetSpeed = length(target.velocity);
  const targetClosing = targetSpeed > 0.001 ? dot(normalize(target.velocity), scale(toTarget, -1)) : 0;
  return dot(forward, toTarget) > BOT_TUNING.engagement.collisionCourseAlignment && targetClosing > BOT_TUNING.engagement.collisionCourseTargetClosing;
}

function getBreakawayPoint(bot: PlayerState, target: PlayerState): Vec3 {
  const orientation = bot.orientation ?? quaternionFromRotation(bot.rotation);
  const forward = normalize(applyQuaternion({ x: 0, y: 0, z: 1 }, orientation));
  const right = normalize(applyQuaternion({ x: 1, y: 0, z: 0 }, orientation));
  const side = botBreakSide(bot, target);
  return add(add(add(bot.position, scale(forward, BOT_TUNING.engagement.breakawayForward)), scale(right, side * BOT_TUNING.engagement.breakawaySide)), {
    x: 0,
    y: BOT_TUNING.engagement.breakawayClimb,
    z: 0
  });
}

function getOffsetPursuitPoint(bot: PlayerState, target: PlayerState): Vec3 {
  const orientation = bot.orientation ?? quaternionFromRotation(bot.rotation);
  const right = normalize(applyQuaternion({ x: 1, y: 0, z: 0 }, orientation));
  const side = botBreakSide(bot, target);
  return add(add(getAimPoint(bot, target) ?? target.position, scale(right, side * BOT_TUNING.engagement.offsetPursuitSide)), {
    x: 0,
    y: BOT_TUNING.engagement.offsetPursuitClimb,
    z: 0
  });
}

function botForward(bot: PlayerState): Vec3 {
  return normalize(applyQuaternion({ x: 0, y: 0, z: 1 }, bot.orientation ?? quaternionFromRotation(bot.rotation)));
}

function patrol(bot: PlayerState): { pitch: number; yaw: number; roll: number; ahead: number } {
  const targetAngle = Math.atan2(-bot.position.x, -bot.position.z) + BOT_TUNING.steering.patrolOrbitAngle;
  const desiredRoll = clamp(
    wrapAngle(targetAngle - bot.rotation.yaw) * BOT_TUNING.steering.patrolRollScale,
    -BOT_TUNING.steering.patrolMaxRoll,
    BOT_TUNING.steering.patrolMaxRoll
  );

  return {
    pitch:
      bot.position.y < OCEAN_LEVEL + BOT_TUNING.altitude.safe + BOT_TUNING.altitude.lowPatrolClearance
        ? BOT_TUNING.steering.patrolLowPitch
        : BOT_TUNING.steering.patrolCruisePitch,
    yaw: 0,
    roll: clamp(wrapAngle(desiredRoll - bot.rotation.roll) * BOT_TUNING.steering.patrolRollCorrection, -1, 1),
    ahead: 1
  };
}

function getSeekerAimDirection(bot: PlayerState, target: PlayerState): Vec3 | undefined {
  const direction = normalize(subtract(target.position, bot.position));
  return dot(botForward(bot), direction) >= MISSILE_SEEKER_GIMBAL_DOT ? direction : undefined;
}

function findIncomingMissile(room: RoomState, bot: PlayerState, profile: BotSkillProfile): ProjectileState | undefined {
  return Object.values(room.projectiles)
    .filter((projectile) => projectile.type === "missile" && projectile.targetType === "player" && projectile.targetId === bot.id)
    .map((projectile) => ({ projectile, range: projectileClosingRange(projectile, bot) }))
    .filter(({ range }) => range < profile.defensiveRange)
    .sort((a, b) => a.range - b.range)[0]?.projectile;
}

function getMissileEvasionPoint(bot: PlayerState, missile: ProjectileState, profile: BotSkillProfile): Vec3 {
  const orientation = bot.orientation ?? quaternionFromRotation(bot.rotation);
  const forward = normalize(applyQuaternion({ x: 0, y: 0, z: 1 }, orientation));
  const right = normalize(applyQuaternion({ x: 1, y: 0, z: 0 }, orientation));
  const missileForward = length(missile.velocity) > 0.001 ? normalize(missile.velocity) : normalize(subtract(bot.position, missile.position));
  const horizontalMissileRight = normalize({ x: -missileForward.z, y: 0, z: missileForward.x });
  const fallbackRight = length(horizontalMissileRight) > 0.001 ? horizontalMissileRight : right;
  const side = deterministicUnit(bot.id, missile.id, "evade") >= 0.5 ? 1 : -1;
  const lateralBase = dot(fallbackRight, right) >= 0 ? fallbackRight : scale(fallbackRight, -1);
  const noise = (deterministicUnit(bot.id, missile.id, "evade-noise") * 2 - 1) * profile.evasionNoise;
  const lateral = normalize(add(lateralBase, scale(forward, noise)));

  return add(add(add(bot.position, scale(lateral, side * BOT_TUNING.evasion.sideDistance)), scale(forward, BOT_TUNING.evasion.forwardDistance)), {
    x: 0,
    y:
      bot.position.y < BOT_TUNING.altitude.safe + BOT_TUNING.evasion.lowAltitudeExtraClimb
        ? BOT_TUNING.evasion.climb
        : BOT_TUNING.evasion.climb * BOT_TUNING.evasion.highAltitudeClimbScale,
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
  const desiredRoll = clamp(lateral * BOT_TUNING.steering.desiredRollScale, -BOT_TUNING.steering.maxDesiredRoll, BOT_TUNING.steering.maxDesiredRoll);
  const rollError = wrapAngle(desiredRoll - bot.rotation.roll);
  const altitudeBias =
    bot.position.y < BOT_TUNING.altitude.safe
      ? BOT_TUNING.steering.lowAltitudePitchBias
      : bot.position.y > BOT_TUNING.altitude.high
        ? BOT_TUNING.steering.highAltitudePitchBias
        : 0;

  return {
    pitch: clamp(vertical * BOT_TUNING.steering.pitchVerticalScale + Math.abs(lateral) * BOT_TUNING.steering.pitchLateralLiftScale + altitudeBias, -1, 1),
    yaw: clamp(lateral * BOT_TUNING.steering.yawScale, -BOT_TUNING.steering.maxYaw, BOT_TUNING.steering.maxYaw),
    roll: clamp(rollError * BOT_TUNING.steering.rollCorrectionScale, -1, 1),
    ahead
  };
}

function shouldDeployFlare(room: RoomState, bot: PlayerState, now: number, profile: BotSkillProfile): boolean {
  if (bot.flaresRemaining <= 0 || bot.flareCooldown > 0) {
    return false;
  }

  return Object.values(room.projectiles)
    .filter((projectile) => projectile.type === "missile" && projectile.targetId === bot.id)
    .some((projectile) => {
      if (deterministicUnit(bot.id, projectile.id, "detect") > profile.flareDetectionChance) {
        return false;
      }

      const age = now - projectile.createdAt;
      const reactionDelay = profile.flareReactionMinMs + deterministicUnit(bot.id, projectile.id, "react") * profile.flareReactionSpreadMs;
      if (age < reactionDelay) {
        return false;
      }

      const deployRange = profile.flareDeployMinRange + deterministicUnit(bot.id, projectile.id, "range") * profile.flareDeploySpreadRange;
      return projectileClosingRange(projectile, bot) < deployRange;
    });
}

function botProfile(bot: PlayerState): BotSkillProfile {
  return BOT_SKILL_PROFILES[bot.botSkill ?? "regular"];
}

function projectileClosingRange(projectile: ProjectileState, bot: PlayerState): number {
  if (length(projectile.velocity) <= 0.001) {
    return distance(projectile.position, bot.position);
  }

  const toBot = normalize(subtract(bot.position, projectile.position));
  const missileForward = normalize(projectile.velocity);
  const closing = dot(missileForward, toBot);

  return closing > BOT_TUNING.evasion.missileClosingDot ? distance(projectile.position, bot.position) : Number.POSITIVE_INFINITY;
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
