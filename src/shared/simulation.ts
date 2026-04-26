import {
  AFTERBURNER_SPEED,
  AIRCRAFT_COLLISION_PADDING,
  AOA_LIFT_ACCELERATION,
  BULLET_HIT_RADIUS,
  BULLET_SPEED,
  BULLET_TTL_SECONDS,
  CRUISE_THROTTLE,
  FLARE_COOLDOWN_SECONDS,
  FLARE_AMMO_PER_ROUND,
  FLARE_DECOY_RANGE,
  FLARE_HEAT_DECAY_SECONDS,
  FLARE_MIN_HEAT_SIGNATURE,
  FLARE_PEAK_HEAT_SIGNATURE,
  FLARE_SPEED,
  FLARE_TTL_SECONDS,
  GRAVITY_ACCELERATION,
  GUN_AMMO_PER_ROUND,
  GUN_CONVERGENCE_DISTANCE,
  GUN_COOLDOWN_SECONDS,
  GUN_DAMAGE,
  LIFT_ACCELERATION,
  MAX_AIRFRAME_SPEED,
  MAX_LIFT_ACCELERATION,
  MAX_SPEED,
  MIN_SPEED,
  MISSILE_COOLDOWN_SECONDS,
  MISSILE_AMMO_PER_ROUND,
  MISSILE_ARMING_DISTANCE,
  MISSILE_DAMAGE,
  MISSILE_HIT_RADIUS,
  MISSILE_BLAST_RADIUS,
  MISSILE_LOCK_BREAK_DOT,
  MISSILE_LOCK_DOT,
  MISSILE_LOCK_RANGE,
  MISSILE_LOCK_SECONDS,
  MISSILE_MIN_BLAST_DAMAGE,
  MISSILE_NAVIGATION_CONSTANT,
  MISSILE_PROXIMITY_RADIUS,
  MISSILE_SEEKER_GATE_DOT,
  MISSILE_SPEED,
  MISSILE_TTL_SECONDS,
  MISSILE_TURN_RATE,
  PLAYER_HEALTH,
  RESPAWN_MS,
  ROLL_RATE,
  ROUND_MS,
  SPAWN_ALTITUDE_MAX,
  SPAWN_ALTITUDE_MIN,
  SPAWN_PROTECTION_MS,
  SPAWN_RING_MAX,
  SPAWN_RING_MIN,
  SPAWN_TERRAIN_CLEARANCE,
  TURN_RATE,
  OUT_OF_BOUNDS_GRACE_MS,
  STALL_SPEED,
  AIR_DRAG,
  ENGINE_RESPONSE,
  JET_AFTERBURNER_HEAT_MULTIPLIER,
  JET_ENGINE_HEAT_SIGNATURE,
  VELOCITY_ALIGNMENT
} from "./constants.js";
import {
  aircraftIntersectsAircraft,
  aircraftTerrainProbePoints,
  closestProjectileToAircraftAirframe,
  closestProjectileToAircraftBulletDamage,
  distanceToAircraftAirframe
} from "./hitShapes.js";
import {
  add,
  applyQuaternion,
  clamp,
  cloneVec3,
  cross,
  distance,
  dot,
  forwardVector,
  length,
  normalize,
  multiplyQuaternions,
  quaternionFromAxisAngle,
  quaternionFromRotation,
  rotationFromQuaternion,
  sanitizeAxis,
  sanitizeBoolean,
  scale,
  subtract
} from "./math.js";
import { isOutsidePlayArea, isTerrainImpact, terrainHeightAt } from "./terrain.js";
import type { CombatEvent, InputFrame, PlayerState, ProjectileState, RoomState, Vec3 } from "./types.js";

const palette = ["#ef4444", "#38bdf8", "#facc15", "#a78bfa", "#34d399", "#fb7185"];
const SPAWN_SLOT_COUNT = 6;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
type ProjectileImpactReason = "terrain" | "player" | "flare";
type MissileGuidanceTarget = {
  position: Vec3;
  velocity: Vec3;
};
type MissilePlayerCandidate = {
  player: PlayerState;
  clearance: number;
  segmentT: number;
  position: Vec3;
};

export const neutralInput = (timestamp = 0): InputFrame => ({
  seq: 0,
  thrust: 0,
  pitch: 0,
  yaw: 0,
  roll: 0,
  fireGun: false,
  fireMissile: false,
  fireFlare: false,
  afterburner: false,
  timestamp
});

export function sanitizeInput(input: Partial<InputFrame> | undefined, fallbackSeq = 0): InputFrame {
  return {
    seq: typeof input?.seq === "number" && Number.isFinite(input.seq) ? Math.max(fallbackSeq, Math.floor(input.seq)) : fallbackSeq,
    thrust: sanitizeAxis(input?.thrust),
    pitch: sanitizeAxis(input?.pitch),
    yaw: sanitizeAxis(input?.yaw),
    roll: sanitizeAxis(input?.roll),
    fireGun: sanitizeBoolean(input?.fireGun),
    fireMissile: sanitizeBoolean(input?.fireMissile),
    fireFlare: sanitizeBoolean(input?.fireFlare),
    afterburner: sanitizeBoolean(input?.afterburner),
    aimDirection: sanitizeDirection(input?.aimDirection),
    timestamp: typeof input?.timestamp === "number" && Number.isFinite(input.timestamp) ? input.timestamp : 0
  };
}

function sanitizeDirection(value: unknown): Vec3 | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Partial<Vec3>;
  if (
    typeof candidate.x !== "number" ||
    typeof candidate.y !== "number" ||
    typeof candidate.z !== "number" ||
    !Number.isFinite(candidate.x) ||
    !Number.isFinite(candidate.y) ||
    !Number.isFinite(candidate.z)
  ) {
    return undefined;
  }

  const normalized = normalize(candidate as Vec3);
  return length(normalized) > 0 ? normalized : undefined;
}

export function createRoomState(id: string, hostId: string, now = Date.now()): RoomState {
  return {
    id,
    hostId,
    phase: "lobby",
    players: {},
    projectiles: {},
    startedAt: 0,
    endsAt: 0,
    roundMs: ROUND_MS,
    now
  };
}

export function createPlayer(id: string, name: string, index = 0, now = Date.now()): PlayerState {
  const spawn = spawnForIndex(index);

  return {
    id,
    name: cleanName(name),
    color: palette[index % palette.length],
    isBot: false,
    ready: false,
    status: "lobby",
    position: spawn.position,
    velocity: { x: 0, y: 0, z: MIN_SPEED },
    rotation: spawn.rotation,
    orientation: quaternionFromRotation(spawn.rotation),
    throttle: CRUISE_THROTTLE,
    health: PLAYER_HEALTH,
    score: 0,
    deaths: 0,
    latencyMs: 0,
    gunAmmoRemaining: GUN_AMMO_PER_ROUND,
    gunCooldown: 0,
    missilesRemaining: MISSILE_AMMO_PER_ROUND,
    flaresRemaining: FLARE_AMMO_PER_ROUND,
    missileCooldown: 0,
    flareCooldown: 0,
    missileLockProgress: 0,
    missileLockAcquired: false,
    outOfBoundsRemainingMs: 0,
    spawnProtectionRemainingMs: 0,
    respawnAt: 0,
    lastInputSeq: 0,
    input: neutralInput(now)
  };
}

export function cleanName(name: string): string {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 18);
  return clean.length > 0 ? clean : "Pilot";
}

export function addPlayerToRoom(room: RoomState, player: PlayerState): void {
  room.players[player.id] = player;
  player.color = palette[(Object.keys(room.players).length - 1) % palette.length];
}

export function startRound(room: RoomState, now = Date.now()): void {
  room.phase = "playing";
  room.startedAt = now;
  room.endsAt = now + room.roundMs;
  room.winnerId = undefined;
  room.projectiles = {};
  room.now = now;

  Object.values(room.players).forEach((player, index) => {
    player.ready = false;
    resetPlayerForRound(player, index, now);
  });
}

export function resetPlayerForRound(player: PlayerState, index: number, now: number): void {
  const spawn = spawnForIndex(index);
  player.status = "alive";
  player.position = cloneVec3(spawn.position);
  player.velocity = scale(forwardVector(spawn.rotation), MIN_SPEED);
  player.rotation = { ...spawn.rotation };
  player.orientation = quaternionFromRotation(spawn.rotation);
  player.throttle = CRUISE_THROTTLE;
  player.health = PLAYER_HEALTH;
  player.score = 0;
  player.deaths = 0;
  player.gunAmmoRemaining = GUN_AMMO_PER_ROUND;
  player.gunCooldown = 0;
  player.missilesRemaining = MISSILE_AMMO_PER_ROUND;
  player.flaresRemaining = FLARE_AMMO_PER_ROUND;
  player.missileCooldown = 0;
  player.flareCooldown = 0;
  clearMissileLock(player);
  clearOutOfBoundsWarning(player);
  activateSpawnProtection(player, now);
  player.respawnAt = 0;
  player.input = neutralInput(now);
  player.lastInputSeq = 0;
}

export function setPlayerInput(player: PlayerState, input: Partial<InputFrame>): void {
  const sanitized = sanitizeInput(input, player.lastInputSeq);
  if (sanitized.seq < player.lastInputSeq) {
    return;
  }

  player.input = sanitized;
  player.lastInputSeq = sanitized.seq;
}

export function stepRoom(room: RoomState, dtSeconds: number, now = room.now + dtSeconds * 1000): CombatEvent[] {
  const dt = clamp(dtSeconds, 0, 0.1);
  const events: CombatEvent[] = [];
  room.now = now;

  if (room.phase !== "playing") {
    return events;
  }

  Object.values(room.players).forEach((player, index) => {
    if (player.status === "dead" && player.respawnAt > 0 && now >= player.respawnAt) {
      respawnPlayer(room, player, index, now);
      events.push({ type: "respawn", roomId: room.id, playerId: player.id });
    }

    if (player.status === "alive") {
      stepPlayer(room, player, dt, now, events);
    }
  });

  resolvePlayerCollisions(room, now, events);
  stepProjectiles(room, dt, now, events);

  if (now >= room.endsAt) {
    room.phase = "ended";
    room.winnerId = getWinnerId(room);
    Object.values(room.players).forEach((player) => {
      player.ready = player.isBot;
    });
  }

  return events;
}

export function getWinnerId(room: RoomState): string | undefined {
  return Object.values(room.players)
    .slice()
    .sort((a, b) => b.score - a.score || a.deaths - b.deaths || a.name.localeCompare(b.name))[0]?.id;
}

export function spawnForIndex(index: number): { position: Vec3; rotation: { pitch: number; yaw: number; roll: number } } {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const spawn = spawnCandidate(index, attempt);
    if (isSpawnTerrainSafe(spawn.position)) {
      return spawn;
    }
  }

  return spawnCandidate(index, 0);
}

function selectSpawnForPlayer(room: RoomState, playerId: string, index: number): { position: Vec3; rotation: { pitch: number; yaw: number; roll: number } } {
  const enemies = Object.values(room.players).filter((player) => player.id !== playerId && player.status === "alive");
  if (enemies.length === 0) {
    return spawnForIndex(index);
  }

  let best = spawnForIndex(index);
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let attempt = 0; attempt < 36; attempt += 1) {
    const spawn = spawnCandidate(index, attempt);
    const terrain = terrainHeightAt(spawn.position.x, spawn.position.z);
    const terrainPenalty = isSpawnTerrainSafe(spawn.position) ? 0 : -5000;
    const enemyClearance = enemies.reduce(
      (closest, enemy) => Math.min(closest, distance(spawn.position, enemy.position)),
      Number.POSITIVE_INFINITY
    );
    const centerBias = -Math.abs(Math.hypot(spawn.position.x, spawn.position.z) - (SPAWN_RING_MIN + SPAWN_RING_MAX) / 2) * 0.08;
    const mountainPenalty = terrain.kind === "mountain" ? -5000 : 0;
    const score = enemyClearance + terrainPenalty + mountainPenalty + centerBias;

    if (score > bestScore) {
      best = spawn;
      bestScore = score;
    }
  }

  return best;
}

function spawnCandidate(index: number, attempt: number): { position: Vec3; rotation: { pitch: number; yaw: number; roll: number } } {
  const angle = ((Math.PI * 2 * (index % SPAWN_SLOT_COUNT)) / SPAWN_SLOT_COUNT + attempt * GOLDEN_ANGLE) % (Math.PI * 2);
  const ringRange = SPAWN_RING_MAX - SPAWN_RING_MIN;
  const altitudeRange = SPAWN_ALTITUDE_MAX - SPAWN_ALTITUDE_MIN;
  const radius = SPAWN_RING_MIN + ((((index + attempt * 7) * 37) % 101) / 100) * ringRange;
  const altitude = SPAWN_ALTITUDE_MIN + ((((index + attempt * 5) * 29) % 101) / 100) * altitudeRange;
  const inwardHeading = Math.atan2(-Math.sin(angle), -Math.cos(angle));
  const headingOffset = (index + attempt) % 2 === 0 ? 0.24 : -0.24;

  return {
    position: {
      x: Math.sin(angle) * radius,
      y: altitude,
      z: Math.cos(angle) * radius
    },
    rotation: {
      pitch: 0,
      yaw: inwardHeading + headingOffset,
      roll: 0
    }
  };
}

function isSpawnTerrainSafe(position: Vec3): boolean {
  const terrain = terrainHeightAt(position.x, position.z);
  return terrain.kind !== "mountain" && position.y >= terrain.height + SPAWN_TERRAIN_CLEARANCE;
}

function stepPlayer(room: RoomState, player: PlayerState, dt: number, now: number, events: CombatEvent[]): void {
  updateSpawnProtection(player, now);
  player.gunCooldown = Math.max(0, player.gunCooldown - dt);
  player.missileCooldown = Math.max(0, player.missileCooldown - dt);
  player.flareCooldown = Math.max(0, player.flareCooldown - dt);

  const previousPosition = cloneVec3(player.position);
  applyPlayerFlightStep(player, player.input, dt);
  if (resolveArenaHazards(room, player, now, events, previousPosition)) {
    return;
  }

  if (player.missilesRemaining > 0) {
    updateMissileLock(room, player, dt, now);
  } else {
    clearMissileLock(player);
  }

  const weaponsEnabled = !isPlayerSpawnProtected(player, now);

  if (weaponsEnabled && player.input.fireGun && player.gunCooldown <= 0 && player.gunAmmoRemaining > 0) {
    fireGun(room, player, now, events);
  }

  if (weaponsEnabled && player.input.fireMissile && player.missileCooldown <= 0 && player.missilesRemaining > 0) {
    fireMissile(room, player, now, events);
  }

  if (player.input.fireFlare && player.flareCooldown <= 0 && player.flaresRemaining > 0) {
    fireFlare(room, player, now, events);
  }
}

export function applyPlayerFlightStep(player: PlayerState, input: InputFrame, dt: number): void {
  player.input = input;

  const localPitchDelta = player.input.pitch * TURN_RATE * dt;
  let orientation = player.orientation ?? quaternionFromRotation(player.rotation);
  const localYawDelta = player.input.yaw * 0.45 * TURN_RATE * dt;
  const localRollDelta = player.input.roll * ROLL_RATE * dt;

  if (localYawDelta !== 0) {
    const up = applyQuaternion({ x: 0, y: 1, z: 0 }, orientation);
    orientation = multiplyQuaternions(quaternionFromAxisAngle(up, localYawDelta), orientation);
  }

  if (localPitchDelta !== 0) {
    const right = applyQuaternion({ x: 1, y: 0, z: 0 }, orientation);
    orientation = multiplyQuaternions(quaternionFromAxisAngle(right, -localPitchDelta), orientation);
  }

  if (localRollDelta !== 0) {
    const forwardAxis = applyQuaternion({ x: 0, y: 0, z: 1 }, orientation);
    orientation = multiplyQuaternions(quaternionFromAxisAngle(forwardAxis, -localRollDelta), orientation);
  }

  player.orientation = orientation;
  player.rotation = rotationFromQuaternion(orientation);

  const forward = playerForward(player);
  player.velocity = stepFlightVelocity(player, forward, dt);
  player.position = add(player.position, scale(player.velocity, dt));
}

function stepFlightVelocity(player: PlayerState, forward: Vec3, dt: number): Vec3 {
  const orientation = player.orientation ?? quaternionFromRotation(player.rotation);
  const currentVelocity = length(player.velocity) > 10 ? player.velocity : scale(forward, MAX_SPEED);
  const currentSpeed = clamp(length(currentVelocity), STALL_SPEED, MAX_AIRFRAME_SPEED);
  const targetSpeed = player.input.afterburner ? AFTERBURNER_SPEED : MAX_SPEED;
  const forwardSpeed = dot(currentVelocity, forward);
  const up = normalize(applyQuaternion({ x: 0, y: 1, z: 0 }, orientation));
  const liftFactor = clamp(currentSpeed / MAX_SPEED, 0, 1.35);
  const velocityDirection = normalize(currentVelocity);
  const localVerticalFlow = clamp(dot(velocityDirection, up), -0.58, 0.58);
  const liftMagnitude = clamp(
    (LIFT_ACCELERATION - localVerticalFlow * AOA_LIFT_ACCELERATION) * liftFactor * liftFactor,
    -MAX_LIFT_ACCELERATION,
    MAX_LIFT_ACCELERATION
  );
  const dragLoad = AIR_DRAG * Math.max(0.35, currentSpeed / MAX_SPEED) * currentSpeed;
  const engine = scale(forward, (targetSpeed - forwardSpeed) * ENGINE_RESPONSE + dragLoad);
  const lift = scale(up, liftMagnitude);
  const gravity = { x: 0, y: -GRAVITY_ACCELERATION, z: 0 };
  const drag = scale(currentVelocity, -AIR_DRAG * Math.max(0.35, currentSpeed / MAX_SPEED));
  const alignment = scale(subtract(scale(forward, currentSpeed), currentVelocity), VELOCITY_ALIGNMENT);
  const nextVelocity = add(currentVelocity, scale(add(add(add(engine, lift), gravity), add(drag, alignment)), dt));
  const nextSpeed = clamp(length(nextVelocity), STALL_SPEED * 0.92, MAX_AIRFRAME_SPEED);
  player.throttle = targetSpeed / AFTERBURNER_SPEED;
  return scale(normalize(nextVelocity), nextSpeed);
}

function resolveArenaHazards(
  room: RoomState,
  player: PlayerState,
  now: number,
  events: CombatEvent[],
  previousPosition?: Vec3
): boolean {
  if (isAircraftTerrainImpact(player, previousPosition)) {
    crashPlayer(room, player, "terrain", now, events);
    return true;
  }

  if (!isOutsidePlayArea(player.position)) {
    clearOutOfBoundsWarning(player);
    return false;
  }

  player.outOfBoundsUntil ??= now + OUT_OF_BOUNDS_GRACE_MS;
  player.outOfBoundsRemainingMs = Math.max(0, player.outOfBoundsUntil - now);

  if (player.outOfBoundsRemainingMs <= 0) {
    crashPlayer(room, player, "out-of-bounds", now, events);
    return true;
  }

  return false;
}

function crashPlayer(
  room: RoomState,
  player: PlayerState,
  reason: "terrain" | "out-of-bounds" | "collision",
  now: number,
  events: CombatEvent[]
): void {
  if (player.status !== "alive") {
    return;
  }

  player.status = "dead";
  player.health = 0;
  player.deaths += 1;
  player.respawnAt = now + RESPAWN_MS;
  player.velocity = { x: 0, y: 0, z: 0 };
  clearMissileLock(player);
  clearOutOfBoundsWarning(player);
  clearSpawnProtection(player);
  events.push({ type: "crash", roomId: room.id, playerId: player.id, reason });
}

function resolvePlayerCollisions(room: RoomState, now: number, events: CombatEvent[]): void {
  const alivePlayers = Object.values(room.players).filter((player) => player.status === "alive");

  for (let i = 0; i < alivePlayers.length; i += 1) {
    const player = alivePlayers[i];
    if (player.status !== "alive") {
      continue;
    }

    for (let j = i + 1; j < alivePlayers.length; j += 1) {
      const other = alivePlayers[j];
      if (other.status !== "alive") {
        continue;
      }

      if (isPlayerSpawnProtected(player, now) || isPlayerSpawnProtected(other, now)) {
        continue;
      }

      if (aircraftIntersectsAircraft(player, other, AIRCRAFT_COLLISION_PADDING)) {
        crashPlayer(room, player, "collision", now, events);
        crashPlayer(room, other, "collision", now, events);
      }
    }
  }
}

function isAircraftTerrainImpact(player: PlayerState, previousPosition?: Vec3): boolean {
  if (isTerrainImpact(player.position, previousPosition)) {
    return true;
  }

  const centerDelta = previousPosition ? subtract(previousPosition, player.position) : undefined;
  return aircraftTerrainProbePoints(player).some((point) => {
    const previousPoint = centerDelta ? add(point, centerDelta) : undefined;
    return isTerrainImpact(point, previousPoint);
  });
}

function clearOutOfBoundsWarning(player: PlayerState): void {
  player.outOfBoundsUntil = undefined;
  player.outOfBoundsRemainingMs = 0;
}

function activateSpawnProtection(player: PlayerState, now: number): void {
  player.spawnProtectionUntil = now + SPAWN_PROTECTION_MS;
  player.spawnProtectionRemainingMs = SPAWN_PROTECTION_MS;
}

function updateSpawnProtection(player: PlayerState, now: number): void {
  if (!player.spawnProtectionUntil || now >= player.spawnProtectionUntil) {
    clearSpawnProtection(player);
    return;
  }

  player.spawnProtectionRemainingMs = Math.max(0, player.spawnProtectionUntil - now);
}

function clearSpawnProtection(player: PlayerState): void {
  player.spawnProtectionUntil = undefined;
  player.spawnProtectionRemainingMs = 0;
}

export function isPlayerSpawnProtected(player: PlayerState, now: number): boolean {
  return player.status === "alive" && Boolean(player.spawnProtectionUntil && now < player.spawnProtectionUntil);
}

function playerForward(player: PlayerState): Vec3 {
  return normalize(applyQuaternion({ x: 0, y: 0, z: 1 }, player.orientation ?? quaternionFromRotation(player.rotation)));
}

function fireGun(room: RoomState, player: PlayerState, now: number, events: CombatEvent[]): void {
  const forward = playerForward(player);
  const orientation = player.orientation ?? quaternionFromRotation(player.rotation);
  const right = normalize(applyQuaternion({ x: 1, y: 0, z: 0 }, orientation));
  const up = normalize(applyQuaternion({ x: 0, y: 1, z: 0 }, orientation));
  const barrelSide = Math.floor(now / (GUN_COOLDOWN_SECONDS * 1000)) % 2 === 0 ? -1 : 1;
  const muzzle = add(add(add(player.position, scale(forward, 22)), scale(right, barrelSide * 8.5)), scale(up, -0.8));
  const convergencePoint = add(player.position, scale(forward, GUN_CONVERGENCE_DISTANCE));
  const shotDirection = normalize(subtract(convergencePoint, muzzle));
  const id = `${player.id}-b-${now}-${Math.random().toString(36).slice(2, 7)}`;
  room.projectiles[id] = {
    id,
    type: "bullet",
    ownerId: player.id,
    position: muzzle,
    velocity: scale(shotDirection, BULLET_SPEED),
    ttl: BULLET_TTL_SECONDS,
    damage: GUN_DAMAGE,
    createdAt: now
  };
  player.gunCooldown = GUN_COOLDOWN_SECONDS;
  player.gunAmmoRemaining = Math.max(0, player.gunAmmoRemaining - 1);
  events.push({ type: "launch", roomId: room.id, playerId: player.id, weapon: "bullet" });
}

function fireMissile(room: RoomState, player: PlayerState, now: number, events: CombatEvent[]): void {
  const target =
    player.missileLockAcquired && player.missileLockTargetId
      ? room.players[player.missileLockTargetId]
      : undefined;
  const lockedTarget = target?.status === "alive" ? target : undefined;

  if (player.missileLockTargetId && !lockedTarget) {
    clearMissileLock(player);
  }

  const forward = playerForward(player);
  const id = `${player.id}-m-${now}-${Math.random().toString(36).slice(2, 7)}`;
  room.projectiles[id] = {
    id,
    type: "missile",
    ownerId: player.id,
    targetId: lockedTarget?.id,
    targetType: lockedTarget ? "player" : undefined,
    position: add(player.position, scale(forward, 35)),
    velocity: scale(forward, MISSILE_SPEED),
    ttl: MISSILE_TTL_SECONDS,
    damage: MISSILE_DAMAGE,
    createdAt: now
  };
  player.missilesRemaining = Math.max(0, player.missilesRemaining - 1);
  player.missileCooldown = MISSILE_COOLDOWN_SECONDS;
  clearMissileLock(player);
  events.push({ type: "launch", roomId: room.id, playerId: player.id, weapon: "missile" });
}

function fireFlare(room: RoomState, player: PlayerState, now: number, events: CombatEvent[]): void {
  const forward = playerForward(player);
  const orientation = player.orientation ?? quaternionFromRotation(player.rotation);
  const right = normalize(applyQuaternion({ x: 1, y: 0, z: 0 }, orientation));
  const up = normalize(applyQuaternion({ x: 0, y: 1, z: 0 }, orientation));
  const side = player.flaresRemaining % 2 === 0 ? -1 : 1;
  const dispenser = add(add(add(player.position, scale(forward, -26)), scale(right, side * 8)), scale(up, -5.5));
  const ejectionVelocity = add(add(scale(forward, -FLARE_SPEED), scale(right, side * 18)), scale(up, -24));
  const id = `${player.id}-f-${now}-${Math.random().toString(36).slice(2, 7)}`;
  room.projectiles[id] = {
    id,
    type: "flare",
    ownerId: player.id,
    position: dispenser,
    velocity: add(scale(player.velocity, 0.45), ejectionVelocity),
    ttl: FLARE_TTL_SECONDS,
    damage: 0,
    createdAt: now
  };
  player.flaresRemaining = Math.max(0, player.flaresRemaining - 1);
  player.flareCooldown = FLARE_COOLDOWN_SECONDS;
  events.push({ type: "launch", roomId: room.id, playerId: player.id, weapon: "flare" });
}

function updateMissileLock(room: RoomState, player: PlayerState, dt: number, now: number): void {
  const currentTarget =
    player.missileLockTargetId && isLockValid(room, player, player.missileLockTargetId, MISSILE_LOCK_BREAK_DOT, now)
      ? room.players[player.missileLockTargetId]
      : undefined;
  const target = currentTarget ?? findMissileLockCandidate(room, player, MISSILE_LOCK_DOT, now);

  if (!target) {
    clearMissileLock(player);
    return;
  }

  if (target.id !== player.missileLockTargetId) {
    player.missileLockTargetId = target.id;
    player.missileLockProgress = 0;
    player.missileLockAcquired = false;
  }

  player.missileLockProgress = clamp(player.missileLockProgress + dt / MISSILE_LOCK_SECONDS, 0, 1);
  player.missileLockAcquired = player.missileLockProgress >= 1;
}

function clearMissileLock(player: PlayerState): void {
  player.missileLockTargetId = undefined;
  player.missileLockProgress = 0;
  player.missileLockAcquired = false;
}

function isLockValid(room: RoomState, player: PlayerState, targetId: string, requiredDot: number, now: number): boolean {
  const target = room.players[targetId];
  if (!target || target.id === player.id || target.status !== "alive" || isPlayerSpawnProtected(target, now)) {
    return false;
  }

  const offset = subtract(target.position, player.position);
  const range = distance(target.position, player.position);
  if (range > MISSILE_LOCK_RANGE) {
    return false;
  }

  return dot(playerForward(player), normalize(offset)) >= requiredDot;
}

function findMissileLockCandidate(room: RoomState, player: PlayerState, requiredDot: number, now: number): PlayerState | undefined {
  const forward = playerForward(player);

  return Object.values(room.players)
    .filter((candidate) => candidate.id !== player.id && candidate.status === "alive" && !isPlayerSpawnProtected(candidate, now))
    .map((candidate) => {
      const offset = subtract(candidate.position, player.position);
      const range = distance(candidate.position, player.position);
      const lock = dot(forward, normalize(offset));
      return { candidate, range, lock };
    })
    .filter(({ range, lock }) => range <= MISSILE_LOCK_RANGE && lock >= requiredDot)
    .sort((a, b) => b.lock - a.lock || a.range - b.range)[0]?.candidate;
}

function stepProjectiles(room: RoomState, dt: number, now: number, events: CombatEvent[]): void {
  Object.values(room.projectiles).forEach((projectile) => {
    projectile.ttl -= dt;

    if (projectile.ttl <= 0) {
      delete room.projectiles[projectile.id];
      return;
    }

    if (projectile.type === "missile" && projectile.targetId) {
      const flare = findMissileFlareTarget(room, projectile, now);
      if (flare) {
        projectile.targetId = flare.id;
        projectile.targetType = "flare";
      }

      const target = getMissileGuidanceTarget(room, projectile, now);
      if (target) {
        projectile.velocity = proportionalNavigationVelocity(projectile, target, dt);
      }
    }

    const previousPosition = cloneVec3(projectile.position);
    projectile.position = add(projectile.position, scale(projectile.velocity, dt));

    if (projectile.type === "flare") {
      return;
    }

    const terrainImpact = isTerrainImpact(projectile.position, previousPosition);
    if (terrainImpact) {
      if (projectile.type === "missile") {
        detonateMissile(room, projectile, "terrain", now, events);
      } else {
        detonateBullet(room, projectile, "terrain", now, events);
      }
      delete room.projectiles[projectile.id];
      return;
    }

    if (projectile.type === "missile") {
      const flareHit = findMissileFlareHit(room, projectile);
      if (flareHit) {
        detonateMissile(room, projectile, "flare", now, events);
        delete room.projectiles[flareHit.id];
        delete room.projectiles[projectile.id];
        return;
      }

      if (isMissileArmed(projectile, now)) {
        const directHit = findMissileDirectHit(room, projectile, previousPosition, now);
        if (directHit) {
          projectile.position = cloneVec3(directHit.position);
          detonateMissile(room, projectile, "player", now, events, directHit.player.id);
          delete room.projectiles[projectile.id];
          return;
        }

        const proximityHit = findMissileProximityFuseTarget(room, projectile, previousPosition, now);
        if (proximityHit) {
          projectile.position = cloneVec3(proximityHit.position);
          detonateMissile(room, projectile, "player", now, events);
          delete room.projectiles[projectile.id];
        }
      }
      return;
    }

    const hit = findBulletHit(room, projectile, previousPosition, now);
    if (hit) {
      detonateBullet(room, projectile, "player", now, events, hit);
      delete room.projectiles[projectile.id];
    }
  });
}

function emitProjectileImpact(
  room: RoomState,
  projectile: ProjectileState,
  reason: ProjectileImpactReason,
  events: CombatEvent[]
): void {
  if (projectile.type !== "bullet" && projectile.type !== "missile") {
    return;
  }

  events.push({
    type: "impact",
    roomId: room.id,
    ownerId: projectile.ownerId,
    projectileType: projectile.type,
    position: cloneVec3(projectile.position),
    reason
  });
}

function detonateBullet(
  room: RoomState,
  projectile: ProjectileState,
  reason: ProjectileImpactReason,
  now: number,
  events: CombatEvent[],
  hit?: PlayerState
): void {
  if (hit) {
    applyDamage(room, projectile.ownerId, hit.id, projectile.damage, "bullet", now, events);
  }

  emitProjectileImpact(room, projectile, reason, events);
}

function detonateMissile(
  room: RoomState,
  projectile: ProjectileState,
  reason: ProjectileImpactReason,
  now: number,
  events: CombatEvent[],
  directPlayerId?: string
): void {
  emitProjectileImpact(room, projectile, reason, events);

  if (!isMissileArmed(projectile, now)) {
    return;
  }

  Object.values(room.players).forEach((player) => {
    if (player.status !== "alive" || player.id === projectile.ownerId || isPlayerSpawnProtected(player, now)) {
      return;
    }

    const range = distanceToAircraftAirframe(projectile.position, player);
    if (range > MISSILE_BLAST_RADIUS) {
      return;
    }

    const damage =
      player.id === directPlayerId
        ? Math.max(PLAYER_HEALTH, MISSILE_DAMAGE)
        : Math.round(
            MISSILE_MIN_BLAST_DAMAGE +
              (MISSILE_DAMAGE - MISSILE_MIN_BLAST_DAMAGE) * (1 - clamp(range / MISSILE_BLAST_RADIUS, 0, 1))
          );

    applyDamage(room, projectile.ownerId, player.id, damage, "missile", now, events);
  });
}

function isMissileArmed(projectile: ProjectileState, now: number): boolean {
  return (Math.max(0, now - projectile.createdAt) / 1000) * MISSILE_SPEED >= MISSILE_ARMING_DISTANCE;
}

function findMissileFlareTarget(room: RoomState, missile: ProjectileState, now: number): ProjectileState | undefined {
  const currentTargetScore = currentMissileTargetHeatScore(room, missile, now);
  const missileDirection = length(missile.velocity) > 0 ? normalize(missile.velocity) : undefined;

  return Object.values(room.projectiles)
    .filter((projectile) => projectile.type === "flare" && projectile.ownerId !== missile.ownerId)
    .map((flare) => ({
      flare,
      range: distance(flare.position, missile.position),
      alignment: missileDirection ? dot(missileDirection, normalize(subtract(flare.position, missile.position))) : 1,
      score: heatScore(flareHeatSignature(flare, now), distance(flare.position, missile.position))
    }))
    .filter(({ range, alignment }) => range <= FLARE_DECOY_RANGE && alignment >= MISSILE_SEEKER_GATE_DOT)
    .filter(({ score }) => score > currentTargetScore)
    .sort((a, b) => b.score - a.score || a.range - b.range)[0]?.flare;
}

function currentMissileTargetHeatScore(room: RoomState, missile: ProjectileState, now: number): number {
  if (!missile.targetId) {
    return 0;
  }

  if (missile.targetType === "flare") {
    const flare = room.projectiles[missile.targetId];
    return flare?.type === "flare" ? heatScore(flareHeatSignature(flare, now), distance(flare.position, missile.position)) : 0;
  }

  const target = room.players[missile.targetId];
  if (!target || target.status !== "alive" || isPlayerSpawnProtected(target, now)) {
    return 0;
  }

  const enginePosition = add(target.position, scale(playerForward(target), -18));
  return heatScore(engineHeatSignature(target), distance(enginePosition, missile.position));
}

function heatScore(signature: number, range: number): number {
  const safeRange = Math.max(1, range);
  return signature / (safeRange * safeRange);
}

function flareHeatSignature(flare: ProjectileState, now: number): number {
  const ageSeconds = Math.max(0, now - flare.createdAt) / 1000;
  return Math.max(FLARE_MIN_HEAT_SIGNATURE, FLARE_PEAK_HEAT_SIGNATURE * Math.exp(-ageSeconds / FLARE_HEAT_DECAY_SECONDS));
}

function engineHeatSignature(player: PlayerState): number {
  return JET_ENGINE_HEAT_SIGNATURE * (player.input.afterburner ? JET_AFTERBURNER_HEAT_MULTIPLIER : 1);
}

function getMissileGuidanceTarget(room: RoomState, missile: ProjectileState, now: number): MissileGuidanceTarget | undefined {
  if (!missile.targetId) {
    return undefined;
  }

  if (missile.targetType === "flare") {
    const flare = room.projectiles[missile.targetId];
    return flare?.type === "flare" ? { position: flare.position, velocity: flare.velocity } : undefined;
  }

  const target = room.players[missile.targetId];
  return target?.status === "alive" && !isPlayerSpawnProtected(target, now)
    ? { position: target.position, velocity: target.velocity }
    : undefined;
}

function proportionalNavigationVelocity(missile: ProjectileState, target: MissileGuidanceTarget, dt: number): Vec3 {
  const missileVelocity = length(missile.velocity) > 1 ? missile.velocity : scale(normalize(subtract(target.position, missile.position)), MISSILE_SPEED);
  const missileSpeed = length(missileVelocity) > 1 ? length(missileVelocity) : MISSILE_SPEED;
  const missileDirection = normalize(missileVelocity);
  const relativePosition = subtract(target.position, missile.position);
  const range = length(relativePosition);
  if (range <= 1) {
    return scale(missileDirection, MISSILE_SPEED);
  }

  const lineOfSight = scale(relativePosition, 1 / range);
  const relativeVelocity = subtract(target.velocity, missileVelocity);
  const closingSpeed = Math.max(-dot(relativeVelocity, lineOfSight), missileSpeed * 0.2);
  const losRate = scale(cross(relativePosition, relativeVelocity), 1 / Math.max(1, range * range));
  const commandedAcceleration = scale(cross(losRate, missileDirection), MISSILE_NAVIGATION_CONSTANT * closingSpeed);
  const maxAcceleration = missileSpeed * MISSILE_TURN_RATE;
  const accelerationMagnitude = length(commandedAcceleration);
  const limitedAcceleration =
    accelerationMagnitude > maxAcceleration
      ? scale(commandedAcceleration, maxAcceleration / accelerationMagnitude)
      : commandedAcceleration;
  const nextVelocity = add(missileVelocity, scale(limitedAcceleration, dt));
  if (length(nextVelocity) <= 1) {
    return scale(missileDirection, MISSILE_SPEED);
  }

  return scale(normalize(nextVelocity), MISSILE_SPEED);
}

function findBulletHit(room: RoomState, projectile: ProjectileState, previousPosition: Vec3, now: number): PlayerState | undefined {
  return Object.values(room.players)
    .filter((player) => player.id !== projectile.ownerId && player.status === "alive" && !isPlayerSpawnProtected(player, now))
    .map((player) => {
      const closest = closestProjectileToAircraftBulletDamage(previousPosition, projectile.position, player);
      return { player, clearance: closest.clearance, segmentT: closest.segmentT };
    })
    .filter(({ clearance }) => clearance <= BULLET_HIT_RADIUS)
    .sort((a, b) => a.segmentT - b.segmentT || a.clearance - b.clearance)[0]?.player;
}

function findMissileDirectHit(room: RoomState, projectile: ProjectileState, previousPosition: Vec3, now: number): MissilePlayerCandidate | undefined {
  return missilePlayerCandidates(room, projectile, previousPosition, now)
    .filter(({ clearance }) => clearance <= MISSILE_HIT_RADIUS)
    .sort((a, b) => a.clearance - b.clearance || a.segmentT - b.segmentT)[0];
}

function findMissileProximityFuseTarget(room: RoomState, projectile: ProjectileState, previousPosition: Vec3, now: number): MissilePlayerCandidate | undefined {
  return missilePlayerCandidates(room, projectile, previousPosition, now)
    .filter(({ clearance, segmentT, player }) => {
      if (clearance > MISSILE_PROXIMITY_RADIUS) {
        return false;
      }

      return segmentT < 0.98 || !isMissileClosingOnPlayer(projectile, player);
    })
    .sort((a, b) => a.clearance - b.clearance || a.segmentT - b.segmentT)[0];
}

function missilePlayerCandidates(room: RoomState, projectile: ProjectileState, previousPosition: Vec3, now: number): MissilePlayerCandidate[] {
  return Object.values(room.players)
    .filter((player) => player.id !== projectile.ownerId && player.status === "alive" && !isPlayerSpawnProtected(player, now))
    .map((player) => {
      const closest = closestProjectileToAircraftAirframe(previousPosition, projectile.position, player);
      return { player, clearance: closest.clearance, segmentT: closest.segmentT, position: closest.position };
    });
}

function isMissileClosingOnPlayer(projectile: ProjectileState, player: PlayerState): boolean {
  const toPlayer = subtract(player.position, projectile.position);
  if (length(toPlayer) <= 0.001 || length(projectile.velocity) <= 0.001) {
    return false;
  }

  return dot(normalize(projectile.velocity), normalize(toPlayer)) > 0.05;
}

function findMissileFlareHit(room: RoomState, missile: ProjectileState): ProjectileState | undefined {
  if (missile.targetType !== "flare" || !missile.targetId) {
    return undefined;
  }

  const flare = room.projectiles[missile.targetId];
  if (!flare || flare.type !== "flare") {
    return undefined;
  }

  return distance(flare.position, missile.position) <= MISSILE_HIT_RADIUS ? flare : undefined;
}

function applyDamage(
  room: RoomState,
  attackerId: string,
  victimId: string,
  damage: number,
  weapon: "bullet" | "missile",
  now: number,
  events: CombatEvent[]
): void {
  const victim = room.players[victimId];
  if (!victim || victim.status !== "alive") {
    return;
  }

  if (isPlayerSpawnProtected(victim, now)) {
    return;
  }

  victim.health = Math.max(0, victim.health - damage);
  events.push({ type: "hit", roomId: room.id, attackerId, victimId, damage, weapon });

  if (victim.health > 0) {
    return;
  }

  victim.status = "dead";
  victim.deaths += 1;
  victim.respawnAt = now + RESPAWN_MS;
  victim.velocity = { x: 0, y: 0, z: 0 };
  clearMissileLock(victim);
  clearOutOfBoundsWarning(victim);
  clearSpawnProtection(victim);

  const attacker = room.players[attackerId];
  if (attacker && attacker.id !== victim.id) {
    attacker.score += 1;
  }

  events.push({ type: "kill", roomId: room.id, attackerId, victimId });
}

function respawnPlayer(room: RoomState, player: PlayerState, index: number, now: number): void {
  const spawn = selectSpawnForPlayer(room, player.id, index);
  player.status = "alive";
  player.position = cloneVec3(spawn.position);
  player.rotation = { ...spawn.rotation };
  player.orientation = quaternionFromRotation(spawn.rotation);
  player.velocity = scale(playerForward(player), MIN_SPEED);
  player.throttle = CRUISE_THROTTLE;
  player.health = PLAYER_HEALTH;
  player.gunAmmoRemaining = GUN_AMMO_PER_ROUND;
  player.gunCooldown = 0;
  player.missilesRemaining = MISSILE_AMMO_PER_ROUND;
  player.flaresRemaining = FLARE_AMMO_PER_ROUND;
  player.missileCooldown = 0;
  player.flareCooldown = 0;
  clearMissileLock(player);
  clearOutOfBoundsWarning(player);
  activateSpawnProtection(player, now);
  player.respawnAt = 0;
  player.input = neutralInput(now);
}
