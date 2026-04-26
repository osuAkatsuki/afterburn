export const TICK_RATE = 30;
export const ROUND_MS = 5 * 60 * 1000;
export const MAX_PLAYERS = 6;
export const MIN_PLAYERS_TO_START = 2;
export const RESPAWN_MS = 3000;

export const ARENA_RADIUS = 1800;
export const MAX_ALTITUDE = 900;
export const OUT_OF_BOUNDS_GRACE_MS = 10000;
export const DISCONNECT_GRACE_MS = 15000;
export const OCEAN_LEVEL = 0;
export const TERRAIN_COLLISION_MARGIN = 2;

export type TerrainPeak = {
  x: number;
  z: number;
  radius: number;
  height: number;
};

export type TerrainIsland = {
  x: number;
  z: number;
  beachRadius: number;
  beachScaleX: number;
  beachScaleZ: number;
  peaks: TerrainPeak[];
};

export const TERRAIN_ISLANDS: TerrainIsland[] = [
  {
    x: 0,
    z: 0,
    beachRadius: 392,
    beachScaleX: 1.35,
    beachScaleZ: 0.82,
    peaks: [
      { x: -140, z: -56, radius: 170, height: 158 },
      { x: 68, z: 24, radius: 156, height: 132 },
      { x: 185, z: -44, radius: 126, height: 108 },
      { x: -28, z: 124, radius: 132, height: 94 },
      { x: -248, z: 34, radius: 104, height: 76 }
    ]
  },
  {
    x: Math.sin(2.15) * 980,
    z: Math.cos(2.15) * 980,
    beachRadius: 167,
    beachScaleX: 1.35,
    beachScaleZ: 0.82,
    peaks: [
      { x: -44, z: -22, radius: 82, height: 74 },
      { x: 42, z: 18, radius: 72, height: 64 },
      { x: 4, z: 58, radius: 58, height: 48 }
    ]
  },
  {
    x: Math.sin(-1.6) * 1250,
    z: Math.cos(-1.6) * 1250,
    beachRadius: 130,
    beachScaleX: 1.35,
    beachScaleZ: 0.82,
    peaks: [
      { x: -36, z: -14, radius: 62, height: 54 },
      { x: 36, z: 22, radius: 58, height: 48 },
      { x: 0, z: 54, radius: 48, height: 38 }
    ]
  }
];

export const PLAYER_HEALTH = 100;
export const PLAYER_HIT_RADIUS = 22;
export const AIRCRAFT_COLLISION_RADIUS = 16;
export const SPEED_UNIT = 100;
export const MIN_SPEED = SPEED_UNIT * 1.5;
export const MAX_SPEED = SPEED_UNIT * 1.5;
export const AFTERBURNER_SPEED = SPEED_UNIT * 2;
export const CRUISE_THROTTLE = 1;
export const TURN_RATE = 1.45;
export const ROLL_RATE = 2.8;
export const STALL_SPEED = SPEED_UNIT * 1.05;
export const MAX_AIRFRAME_SPEED = SPEED_UNIT * 2.45;
export const GRAVITY_ACCELERATION = 42;
export const LIFT_ACCELERATION = 42;
export const AOA_LIFT_ACCELERATION = 260;
export const MAX_LIFT_ACCELERATION = 150;
export const ENGINE_RESPONSE = 0.95;
export const AIR_DRAG = 0.08;
export const VELOCITY_ALIGNMENT = 4.2;

export const GUN_DAMAGE = 12;
export const GUN_COOLDOWN_SECONDS = 0.085;
export const GUN_HEAT_PER_SHOT = 0.12;
export const GUN_HEAT_DECAY_PER_SECOND = 0.38;
export const GUN_HEAT_MAX = 1;
export const GUN_CONVERGENCE_DISTANCE = 650;
export const BULLET_SPEED = SPEED_UNIT * 3;
export const BULLET_TTL_SECONDS = 2.55;
export const BULLET_HIT_RADIUS = 3;

export const MISSILE_DAMAGE = 70;
export const MISSILE_AMMO_PER_ROUND = 3;
export const MISSILE_COOLDOWN_SECONDS = 4.5;
export const MISSILE_SPEED = SPEED_UNIT * 4;
export const MISSILE_TURN_RATE = 2.4;
export const MISSILE_TTL_SECONDS = 6.5;
export const MISSILE_LOCK_SECONDS = 1.85;
export const MISSILE_LOCK_RANGE = 650;
export const MISSILE_LOCK_DOT = 0.992;
export const MISSILE_LOCK_BREAK_DOT = 0.985;
export const MISSILE_HIT_RADIUS = 34;
export const MISSILE_PROXIMITY_RADIUS = 58;
export const MISSILE_BLAST_RADIUS = 120;
export const MISSILE_MIN_BLAST_DAMAGE = 22;

export const FLARE_COOLDOWN_SECONDS = 3.2;
export const FLARE_AMMO_PER_ROUND = 15;
export const FLARE_TTL_SECONDS = 4.2;
export const FLARE_SPEED = 58;
export const FLARE_DECOY_RANGE = 260;
