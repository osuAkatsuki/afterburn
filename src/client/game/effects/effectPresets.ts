export const EFFECT_PRESETS = {
  missileImpact: {
    explosionColor: "#f97316",
    smokePuffCount: 18,
    lateralSpread: 24,
    verticalVelocityBase: 10,
    verticalVelocitySpread: 28,
    flameEveryNthPuff: 3,
    flameColor: "#facc15",
    smokeColor: "#6b7280",
    flameOpacity: 0.22,
    smokeOpacity: 0.38,
    lifeBase: 1.25,
    lifeSpread: 0.9,
    sizeBase: 2.8,
    sizeSpread: 2.8,
    growth: 3.2
  },
  bulletImpact: {
    sparkColor: "#fef08a",
    smokeColor: "#d6d3ce",
    lateralVelocitySpread: 8,
    verticalVelocityBase: 5,
    verticalVelocitySpread: 8,
    opacity: 0.22,
    life: 0.65,
    size: 1.1,
    growth: 2.1
  },
  afterburnerPuff: {
    engineOffset: -15,
    intervalMs: 70,
    backwardVelocity: -38,
    randomVelocitySpread: 3,
    color: "#8bd3ff",
    opacity: 0.22,
    life: 0.55,
    size: 1.5,
    growth: 2.6
  },
  damageSmoke: {
    healthThreshold: 35,
    intervalMs: 115,
    originSpread: 5,
    backwardVelocity: -12,
    lateralVelocitySpread: 6,
    verticalVelocityBase: 4,
    verticalVelocitySpread: 4,
    color: "#4b5563",
    opacity: 0.32,
    life: 1.35,
    size: 2.4,
    growth: 2.4
  },
  missileTrail: {
    intervalMs: 55,
    exhaustOffset: -8.6,
    backwardVelocity: -6,
    randomVelocitySpread: 2.8,
    color: "#d6d3ce",
    opacity: 0.36,
    lifeBase: 1.7,
    lifeSpread: 0.55,
    sizeBase: 1.6,
    sizeSpread: 1.2,
    growth: 2.2
  },
  smokeBatches: {
    normalCapacity: 260,
    additiveCapacity: 96,
    maxActivePuffs: 220,
    geometryWidthSegments: 8,
    geometryHeightSegments: 6,
    spawnLateralScale: 0.45
  },
  explosionShard: {
    count: 16,
    scaleBase: 3,
    scaleSpread: 5,
    positionSpread: 10,
    horizontalVelocitySpread: 90,
    verticalVelocityBase: -18,
    verticalVelocitySpread: 90,
    lifeMs: 900
  },
  hitSpark: {
    count: 9,
    scaleX: 1.1,
    scaleY: 1.1,
    scaleZBase: 9,
    scaleZSpread: 10,
    positionSpread: 8,
    horizontalVelocitySpread: 55,
    verticalVelocityBase: -19.25,
    verticalVelocitySpread: 55,
    lifeMs: 360
  }
} as const;
