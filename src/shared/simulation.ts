import {
  AFTERBURNER_SPEED,
  AIRCRAFT_COLLISION_RADIUS,
  AOA_LIFT_ACCELERATION,
  BULLET_HIT_RADIUS,
  BULLET_SPEED,
  BULLET_TTL_SECONDS,
  CRUISE_THROTTLE,
  FLARE_COOLDOWN_SECONDS,
  FLARE_AMMO_PER_ROUND,
  FLARE_DECOY_RANGE,
  FLARE_SPEED,
  FLARE_TTL_SECONDS,
  GRAVITY_ACCELERATION,
  GUN_CONVERGENCE_DISTANCE,
  GUN_COOLDOWN_SECONDS,
  GUN_DAMAGE,
  GUN_HEAT_DECAY_PER_SECOND,
  GUN_HEAT_MAX,
  GUN_HEAT_PER_SHOT,
  LIFT_ACCELERATION,
  MAX_AIRFRAME_SPEED,
  MAX_LIFT_ACCELERATION,
  MAX_SPEED,
  MIN_SPEED,
  MISSILE_COOLDOWN_SECONDS,
  MISSILE_AMMO_PER_ROUND,
  MISSILE_DAMAGE,
  MISSILE_HIT_RADIUS,
  MISSILE_BLAST_RADIUS,
  MISSILE_LOCK_BREAK_DOT,
  MISSILE_LOCK_DOT,
  MISSILE_LOCK_RANGE,
  MISSILE_LOCK_SECONDS,
  MISSILE_MIN_BLAST_DAMAGE,
  MISSILE_PROXIMITY_RADIUS,
  MISSILE_SPEED,
  MISSILE_TTL_SECONDS,
  MISSILE_TURN_RATE,
  PLAYER_HEALTH,
  PLAYER_HIT_RADIUS,
  RESPAWN_MS,
  ROLL_RATE,
  ROUND_MS,
  TURN_RATE,
  OUT_OF_BOUNDS_GRACE_MS,
  STALL_SPEED,
  AIR_DRAG,
  ENGINE_RESPONSE,
  VELOCITY_ALIGNMENT
} from "./constants.js";
import {
  add,
  applyQuaternion,
  clamp,
  cloneVec3,
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
import { isOutsidePlayArea, isTerrainImpact } from "./terrain.js";
import type { CombatEvent, InputFrame, PlayerState, ProjectileState, RoomState, Vec3 } from "./types.js";

const palette = ["#ef4444", "#38bdf8", "#facc15", "#a78bfa", "#34d399", "#fb7185"];
type ProjectileImpactReason = "terrain" | "player" | "flare";

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
    timestamp: typeof input?.timestamp === "number" && Number.isFinite(input.timestamp) ? input.timestamp : 0
  };
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
    gunHeat: 0,
    gunCooldown: 0,
    missilesRemaining: MISSILE_AMMO_PER_ROUND,
    flaresRemaining: FLARE_AMMO_PER_ROUND,
    missileCooldown: 0,
    flareCooldown: 0,
    missileLockProgress: 0,
    missileLockAcquired: false,
    outOfBoundsRemainingMs: 0,
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
  player.gunHeat = 0;
  player.gunCooldown = 0;
  player.missilesRemaining = MISSILE_AMMO_PER_ROUND;
  player.flaresRemaining = FLARE_AMMO_PER_ROUND;
  player.missileCooldown = 0;
  player.flareCooldown = 0;
  clearMissileLock(player);
  clearOutOfBoundsWarning(player);
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
  const angle = (Math.PI * 2 * index) / 6;
  const radius = 360;

  return {
    position: {
      x: Math.sin(angle) * radius,
      y: 190 + (index % 3) * 45,
      z: Math.cos(angle) * radius
    },
    rotation: {
      pitch: 0,
      yaw: angle + Math.PI,
      roll: 0
    }
  };
}

function stepPlayer(room: RoomState, player: PlayerState, dt: number, now: number, events: CombatEvent[]): void {
  player.gunCooldown = Math.max(0, player.gunCooldown - dt);
  player.missileCooldown = Math.max(0, player.missileCooldown - dt);
  player.flareCooldown = Math.max(0, player.flareCooldown - dt);
  player.gunHeat = Math.max(0, player.gunHeat - GUN_HEAT_DECAY_PER_SECOND * dt);

  const previousPosition = cloneVec3(player.position);
  applyPlayerFlightStep(player, player.input, dt);
  if (resolveArenaHazards(room, player, now, events, previousPosition)) {
    return;
  }

  updateMissileLock(room, player, dt);

  if (player.input.fireGun && player.gunCooldown <= 0 && player.gunHeat < GUN_HEAT_MAX) {
    fireGun(room, player, now, events);
  }

  if (player.input.fireMissile && player.missileCooldown <= 0 && player.missilesRemaining > 0) {
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
  if (isTerrainImpact(player.position, previousPosition)) {
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

      if (distance(player.position, other.position) <= AIRCRAFT_COLLISION_RADIUS * 2) {
        crashPlayer(room, player, "collision", now, events);
        crashPlayer(room, other, "collision", now, events);
      }
    }
  }
}

function clearOutOfBoundsWarning(player: PlayerState): void {
  player.outOfBoundsUntil = undefined;
  player.outOfBoundsRemainingMs = 0;
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
  player.gunHeat = clamp(player.gunHeat + GUN_HEAT_PER_SHOT, 0, GUN_HEAT_MAX);
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
  const id = `${player.id}-f-${now}-${Math.random().toString(36).slice(2, 7)}`;
  room.projectiles[id] = {
    id,
    type: "flare",
    ownerId: player.id,
    position: add(player.position, scale(forward, -24)),
    velocity: add(scale(player.velocity, 0.35), scale(forward, -FLARE_SPEED)),
    ttl: FLARE_TTL_SECONDS,
    damage: 0,
    createdAt: now
  };
  player.flaresRemaining = Math.max(0, player.flaresRemaining - 1);
  player.flareCooldown = FLARE_COOLDOWN_SECONDS;
  events.push({ type: "launch", roomId: room.id, playerId: player.id, weapon: "flare" });
}

function updateMissileLock(room: RoomState, player: PlayerState, dt: number): void {
  const currentTarget =
    player.missileLockTargetId && isLockValid(room, player, player.missileLockTargetId, MISSILE_LOCK_BREAK_DOT)
      ? room.players[player.missileLockTargetId]
      : undefined;
  const target = currentTarget ?? findMissileLockCandidate(room, player, MISSILE_LOCK_DOT);

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

function isLockValid(room: RoomState, player: PlayerState, targetId: string, requiredDot: number): boolean {
  const target = room.players[targetId];
  if (!target || target.id === player.id || target.status !== "alive") {
    return false;
  }

  const offset = subtract(target.position, player.position);
  const range = distance(target.position, player.position);
  if (range > MISSILE_LOCK_RANGE) {
    return false;
  }

  return dot(playerForward(player), normalize(offset)) >= requiredDot;
}

function findMissileLockCandidate(room: RoomState, player: PlayerState, requiredDot: number): PlayerState | undefined {
  const forward = playerForward(player);

  return Object.values(room.players)
    .filter((candidate) => candidate.id !== player.id && candidate.status === "alive")
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
      const flare = findMissileFlareTarget(room, projectile);
      if (flare) {
        projectile.targetId = flare.id;
        projectile.targetType = "flare";
      }

      const targetPosition = getMissileTargetPosition(room, projectile);
      if (targetPosition) {
        const desired = scale(normalize(subtract(targetPosition, projectile.position)), MISSILE_SPEED);
        projectile.velocity = scale(normalize(add(scale(projectile.velocity, 1 - clamp(MISSILE_TURN_RATE * dt, 0, 1)), scale(desired, clamp(MISSILE_TURN_RATE * dt, 0, 1)))), MISSILE_SPEED);
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

      const hit = findMissileFuseTarget(room, projectile);
      if (hit) {
        detonateMissile(room, projectile, "player", now, events, hit.id);
        delete room.projectiles[projectile.id];
      }
      return;
    }

    const hit = findBulletHit(room, projectile);
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

  Object.values(room.players).forEach((player) => {
    if (player.status !== "alive" || player.id === projectile.ownerId) {
      return;
    }

    const range = distance(player.position, projectile.position);
    if (range > MISSILE_BLAST_RADIUS + PLAYER_HIT_RADIUS) {
      return;
    }

    const damage =
      player.id === directPlayerId
        ? MISSILE_DAMAGE
        : Math.round(
            MISSILE_MIN_BLAST_DAMAGE +
              (MISSILE_DAMAGE - MISSILE_MIN_BLAST_DAMAGE) * (1 - clamp(range / (MISSILE_BLAST_RADIUS + PLAYER_HIT_RADIUS), 0, 1))
          );

    applyDamage(room, projectile.ownerId, player.id, damage, "missile", now, events);
  });
}

function findMissileFlareTarget(room: RoomState, missile: ProjectileState): ProjectileState | undefined {
  return Object.values(room.projectiles)
    .filter((projectile) => projectile.type === "flare" && projectile.ownerId !== missile.ownerId)
    .map((flare) => ({ flare, range: distance(flare.position, missile.position) }))
    .filter(({ range }) => range <= FLARE_DECOY_RANGE)
    .sort((a, b) => a.range - b.range)[0]?.flare;
}

function getMissileTargetPosition(room: RoomState, missile: ProjectileState): Vec3 | undefined {
  if (!missile.targetId) {
    return undefined;
  }

  if (missile.targetType === "flare") {
    return room.projectiles[missile.targetId]?.position;
  }

  const target = room.players[missile.targetId];
  return target?.status === "alive" ? target.position : undefined;
}

function findBulletHit(room: RoomState, projectile: ProjectileState): PlayerState | undefined {
  return Object.values(room.players).find((player) => {
    if (player.id === projectile.ownerId || player.status !== "alive") {
      return false;
    }

    return distance(player.position, projectile.position) <= PLAYER_HIT_RADIUS + BULLET_HIT_RADIUS;
  });
}

function findMissileFuseTarget(room: RoomState, projectile: ProjectileState): PlayerState | undefined {
  return Object.values(room.players)
    .filter((player) => player.id !== projectile.ownerId && player.status === "alive")
    .map((player) => ({ player, range: distance(player.position, projectile.position) }))
    .filter(({ range }) => range <= PLAYER_HIT_RADIUS + Math.max(MISSILE_HIT_RADIUS, MISSILE_PROXIMITY_RADIUS))
    .sort((a, b) => a.range - b.range)[0]?.player;
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

  const attacker = room.players[attackerId];
  if (attacker && attacker.id !== victim.id) {
    attacker.score += 1;
  }

  events.push({ type: "kill", roomId: room.id, attackerId, victimId });
}

function respawnPlayer(room: RoomState, player: PlayerState, index: number, now: number): void {
  const spawn = spawnForIndex(index);
  player.status = "alive";
  player.position = cloneVec3(spawn.position);
  player.rotation = { ...spawn.rotation };
  player.orientation = quaternionFromRotation(spawn.rotation);
  player.velocity = scale(playerForward(player), MIN_SPEED);
  player.throttle = CRUISE_THROTTLE;
  player.health = PLAYER_HEALTH;
  player.gunHeat = 0;
  player.gunCooldown = 0;
  player.missilesRemaining = MISSILE_AMMO_PER_ROUND;
  player.flaresRemaining = FLARE_AMMO_PER_ROUND;
  player.missileCooldown = 0;
  player.flareCooldown = 0;
  clearMissileLock(player);
  clearOutOfBoundsWarning(player);
  player.respawnAt = 0;
  player.input = neutralInput(now);
}
