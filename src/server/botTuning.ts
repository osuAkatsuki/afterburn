import {
  ARENA_RADIUS,
  GUN_CONVERGENCE_DISTANCE,
  MAX_ALTITUDE
} from "../shared/constants.js";
import type { BotSkill } from "../shared/types.js";

export type BotSkillProfile = {
  defensiveRange: number;
  evasionNoise: number;
  flareDetectionChance: number;
  flareReactionMinMs: number;
  flareReactionSpreadMs: number;
  flareDeployMinRange: number;
  flareDeploySpreadRange: number;
};

export const BOT_TUNING = {
  targetLead: {
    maxSeconds: 0.75,
    minSeconds: 0.18
  },
  altitude: {
    safe: 115,
    high: MAX_ALTITUDE * 0.86,
    lowRecoveryClimb: 140,
    boundaryRecoveryClearance: 80,
    boundaryRecoveryAltitudeScale: 0.62,
    highRecoveryAltitudeScale: 0.52,
    lowPatrolClearance: 30
  },
  boundaryRecovery: {
    startRadius: ARENA_RADIUS * 0.82,
    centerPullRadius: ARENA_RADIUS * 0.92,
    tangentDistance: 900,
    lowAltitudeCenterPull: 0.72,
    highAltitudeCenterPull: 0.84,
    softCenterPull: 0.28
  },
  engagement: {
    keepoutRange: 380,
    mergeRange: 680,
    breakawayForward: 560,
    breakawaySide: 520,
    breakawayClimb: 150,
    offsetPursuitSide: 260,
    offsetPursuitClimb: 60,
    gunRange: GUN_CONVERGENCE_DISTANCE * 0.95,
    gunAlignment: 0.975,
    missileAlignment: 0.94,
    longRangeAfterburnerRange: 1200,
    collisionCourseAlignment: 0.72,
    collisionCourseTargetClosing: 0.25
  },
  evasion: {
    sideDistance: 720,
    forwardDistance: 180,
    climb: 180,
    lowAltitudeExtraClimb: 160,
    highAltitudeClimbScale: 0.35,
    missileClosingDot: 0.55
  },
  targetingScore: {
    damagedBonusScale: 0.55,
    leaderBonusPerScore: 0.08,
    rangeScoreNumerator: 900,
    minRangeForScore: 260,
    alignmentScale: 0.55,
    maxLeaderScoreBonusKills: 12
  },
  steering: {
    patrolOrbitAngle: Math.PI * 0.28,
    patrolRollScale: 0.7,
    patrolMaxRoll: 0.72,
    patrolRollCorrection: 1.85,
    patrolLowPitch: 0.55,
    patrolCruisePitch: 0.18,
    desiredRollScale: 1.35,
    maxDesiredRoll: 0.95,
    pitchVerticalScale: 1.55,
    pitchLateralLiftScale: 0.68,
    lowAltitudePitchBias: 0.38,
    highAltitudePitchBias: -0.32,
    yawScale: 0.28,
    maxYaw: 0.42,
    rollCorrectionScale: 2.15
  }
} as const;

export const BOT_SKILL_PROFILES: Record<BotSkill, BotSkillProfile> = {
  regular: {
    defensiveRange: 780,
    evasionNoise: 0.32,
    flareDetectionChance: 0.68,
    flareReactionMinMs: 650,
    flareReactionSpreadMs: 950,
    flareDeployMinRange: 80,
    flareDeploySpreadRange: 300
  },
  ace: {
    defensiveRange: 920,
    evasionNoise: 0.08,
    flareDetectionChance: 0.99,
    flareReactionMinMs: 420,
    flareReactionSpreadMs: 680,
    flareDeployMinRange: 220,
    flareDeploySpreadRange: 210
  }
};
