import {
  AFTERBURNER_SPEED,
  ARENA_RADIUS,
  BULLET_HIT_RADIUS,
  BULLET_SPEED,
  BULLET_TTL_SECONDS,
  GUN_COOLDOWN_SECONDS,
  GUN_DAMAGE,
  GUN_HEAT_DECAY_PER_SECOND,
  GUN_HEAT_MAX,
  GUN_HEAT_PER_SHOT,
  MAX_ALTITUDE,
  MAX_SPEED,
  MIN_ALTITUDE,
  MIN_SPEED,
  MISSILE_COOLDOWN_SECONDS,
  MISSILE_DAMAGE,
  MISSILE_HIT_RADIUS,
  MISSILE_LOCK_DOT,
  MISSILE_LOCK_RANGE,
  MISSILE_SPEED,
  MISSILE_TTL_SECONDS,
  MISSILE_TURN_RATE,
  PLAYER_HEALTH,
  PLAYER_HIT_RADIUS,
  RESPAWN_MS,
  ROLL_RATE,
  ROUND_MS,
  THROTTLE_ACCELERATION,
  TURN_RATE
} from "./constants.js";
import {
  add,
  clamp,
  cloneVec3,
  distance,
  dot,
  forwardVector,
  horizontalLength,
  lerp,
  lerpAngle,
  normalize,
  sanitizeAxis,
  sanitizeBoolean,
  scale,
  subtract
} from "./math.js";
import type { CombatEvent, InputFrame, PlayerState, ProjectileState, RoomState, Vec3 } from "./types.js";

const palette = ["#ef4444", "#38bdf8", "#facc15", "#a78bfa", "#34d399", "#fb7185"];

export const neutralInput = (timestamp = 0): InputFrame => ({
  seq: 0,
  thrust: 0,
  pitch: 0,
  yaw: 0,
  roll: 0,
  fireGun: false,
  fireMissile: false,
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
    status: "lobby",
    position: spawn.position,
    velocity: { x: 0, y: 0, z: MIN_SPEED },
    rotation: spawn.rotation,
    throttle: 0.45,
    health: PLAYER_HEALTH,
    score: 0,
    deaths: 0,
    gunHeat: 0,
    gunCooldown: 0,
    missileCooldown: 0,
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
    resetPlayerForRound(player, index, now);
  });
}

export function resetPlayerForRound(player: PlayerState, index: number, now: number): void {
  const spawn = spawnForIndex(index);
  player.status = "alive";
  player.position = cloneVec3(spawn.position);
  player.velocity = scale(forwardVector(spawn.rotation), MIN_SPEED);
  player.rotation = { ...spawn.rotation };
  player.throttle = 0.45;
  player.health = PLAYER_HEALTH;
  player.score = 0;
  player.deaths = 0;
  player.gunHeat = 0;
  player.gunCooldown = 0;
  player.missileCooldown = 0;
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

  stepProjectiles(room, dt, now, events);

  if (now >= room.endsAt) {
    room.phase = "ended";
    room.winnerId = getWinnerId(room);
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
  player.gunHeat = Math.max(0, player.gunHeat - GUN_HEAT_DECAY_PER_SECOND * dt);

  player.throttle = clamp(player.throttle + player.input.thrust * THROTTLE_ACCELERATION * dt, 0, 1);
  player.rotation.pitch = clamp(player.rotation.pitch + player.input.pitch * TURN_RATE * dt, -1.05, 1.05);
  player.rotation.yaw += player.input.yaw * TURN_RATE * dt;
  player.rotation.roll = clamp(lerp(player.rotation.roll, player.input.roll, dt * ROLL_RATE), -1, 1);

  const targetMax = player.input.afterburner ? AFTERBURNER_SPEED : MAX_SPEED;
  const speed = lerp(MIN_SPEED, targetMax, player.throttle);
  const forward = forwardVector(player.rotation);
  player.velocity = scale(forward, speed);
  player.position = add(player.position, scale(player.velocity, dt));
  enforceArenaBounds(player, dt);

  if (player.input.fireGun && player.gunCooldown <= 0 && player.gunHeat < GUN_HEAT_MAX) {
    fireGun(room, player, now, events);
  }

  if (player.input.fireMissile && player.missileCooldown <= 0) {
    fireMissile(room, player, now, events);
  }
}

function enforceArenaBounds(player: PlayerState, dt: number): void {
  player.position.y = clamp(player.position.y, MIN_ALTITUDE, MAX_ALTITUDE);
  const horizontal = horizontalLength(player.position);

  if (horizontal > ARENA_RADIUS) {
    const scaleBack = ARENA_RADIUS / horizontal;
    player.position.x *= scaleBack;
    player.position.z *= scaleBack;
    const centerYaw = Math.atan2(-player.position.x, -player.position.z);
    player.rotation.yaw = lerpAngle(player.rotation.yaw, centerYaw, dt * 2.6);
  }
}

function fireGun(room: RoomState, player: PlayerState, now: number, events: CombatEvent[]): void {
  const forward = forwardVector(player.rotation);
  const id = `${player.id}-b-${now}-${Math.random().toString(36).slice(2, 7)}`;
  room.projectiles[id] = {
    id,
    type: "bullet",
    ownerId: player.id,
    position: add(player.position, scale(forward, 28)),
    velocity: add(player.velocity, scale(forward, BULLET_SPEED)),
    ttl: BULLET_TTL_SECONDS,
    damage: GUN_DAMAGE,
    createdAt: now
  };
  player.gunCooldown = GUN_COOLDOWN_SECONDS;
  player.gunHeat = clamp(player.gunHeat + GUN_HEAT_PER_SHOT, 0, GUN_HEAT_MAX);
  events.push({ type: "launch", roomId: room.id, playerId: player.id, weapon: "bullet" });
}

function fireMissile(room: RoomState, player: PlayerState, now: number, events: CombatEvent[]): void {
  const target = findMissileTarget(room, player);
  if (!target) {
    return;
  }

  const forward = forwardVector(player.rotation);
  const id = `${player.id}-m-${now}-${Math.random().toString(36).slice(2, 7)}`;
  room.projectiles[id] = {
    id,
    type: "missile",
    ownerId: player.id,
    targetId: target.id,
    position: add(player.position, scale(forward, 35)),
    velocity: scale(forward, MISSILE_SPEED),
    ttl: MISSILE_TTL_SECONDS,
    damage: MISSILE_DAMAGE,
    createdAt: now
  };
  player.missileCooldown = MISSILE_COOLDOWN_SECONDS;
  events.push({ type: "launch", roomId: room.id, playerId: player.id, weapon: "missile" });
}

function findMissileTarget(room: RoomState, player: PlayerState): PlayerState | undefined {
  const forward = forwardVector(player.rotation);

  return Object.values(room.players)
    .filter((candidate) => candidate.id !== player.id && candidate.status === "alive")
    .map((candidate) => {
      const offset = subtract(candidate.position, player.position);
      const range = distance(candidate.position, player.position);
      const lock = dot(forward, normalize(offset));
      return { candidate, range, lock };
    })
    .filter(({ range, lock }) => range <= MISSILE_LOCK_RANGE && lock >= MISSILE_LOCK_DOT)
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
      const target = room.players[projectile.targetId];
      if (target?.status === "alive") {
        const desired = scale(normalize(subtract(target.position, projectile.position)), MISSILE_SPEED);
        projectile.velocity = scale(normalize(add(scale(projectile.velocity, 1 - clamp(MISSILE_TURN_RATE * dt, 0, 1)), scale(desired, clamp(MISSILE_TURN_RATE * dt, 0, 1)))), MISSILE_SPEED);
      }
    }

    projectile.position = add(projectile.position, scale(projectile.velocity, dt));
    const hit = findProjectileHit(room, projectile);
    if (!hit) {
      return;
    }

    applyDamage(room, projectile.ownerId, hit.id, projectile.damage, projectile.type, now, events);
    delete room.projectiles[projectile.id];
  });
}

function findProjectileHit(room: RoomState, projectile: ProjectileState): PlayerState | undefined {
  const radius = projectile.type === "missile" ? MISSILE_HIT_RADIUS : BULLET_HIT_RADIUS;

  return Object.values(room.players).find((player) => {
    if (player.id === projectile.ownerId || player.status !== "alive") {
      return false;
    }

    return distance(player.position, projectile.position) <= PLAYER_HIT_RADIUS + radius;
  });
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
  player.velocity = scale(forwardVector(spawn.rotation), MIN_SPEED);
  player.throttle = 0.45;
  player.health = PLAYER_HEALTH;
  player.gunHeat = 0;
  player.gunCooldown = 0;
  player.missileCooldown = Math.min(player.missileCooldown, 1);
  player.respawnAt = 0;
  player.input = neutralInput(now);
}
