import { describe, expect, it } from "vitest";
import {
  AFTERBURNER_SPEED,
  ARENA_RADIUS,
  BULLET_HIT_RADIUS,
  BULLET_SPEED,
  BULLET_TTL_SECONDS,
  FLARE_AMMO_PER_ROUND,
  MAX_ALTITUDE,
  MAX_SPEED,
  MISSILE_AMMO_PER_ROUND,
  MISSILE_BLAST_RADIUS,
  MISSILE_LOCK_BREAK_DOT,
  MISSILE_LOCK_DOT,
  MISSILE_LOCK_SECONDS,
  MISSILE_DAMAGE,
  MISSILE_SPEED,
  OUT_OF_BOUNDS_GRACE_MS,
  PLAYER_HEALTH,
  PLAYER_HIT_RADIUS,
  RESPAWN_MS,
  SPEED_UNIT,
  TERRAIN_COLLISION_MARGIN,
  TERRAIN_ISLANDS
} from "../../src/shared/constants.js";
import {
  addPlayerToRoom,
  createPlayer,
  createRoomState,
  setPlayerInput,
  startRound,
  stepRoom
} from "../../src/shared/simulation.js";
import { dot, forwardVector, length, normalize, quaternionFromRotation, scale } from "../../src/shared/math.js";
import { isTerrainImpact, terrainHeightAt } from "../../src/shared/terrain.js";
import type { PlayerState, ProjectileState, Rotation } from "../../src/shared/types.js";

function twoPlayerRoom(now = 1000) {
  const room = createRoomState("TEST1", "p1", now);
  addPlayerToRoom(room, createPlayer("p1", "Maverick", 0, now));
  addPlayerToRoom(room, createPlayer("p2", "Viper", 1, now));
  startRound(room, now);
  return room;
}

function holdLock(room: ReturnType<typeof twoPlayerRoom>, attackerId = "p1") {
  const attacker = room.players[attackerId];
  const steps = Math.ceil(MISSILE_LOCK_SECONDS / 0.1) + 1;

  for (let i = 0; i < steps; i += 1) {
    setPlayerInput(attacker, { seq: i + 1 });
    stepRoom(room, 0.1, 1100 + i * 100);
  }
}

function setRotation(player: PlayerState, rotation: Rotation) {
  player.rotation = rotation;
  player.orientation = quaternionFromRotation(rotation);
  player.velocity = scale(forwardVector(rotation), MAX_SPEED);
}

describe("shared simulation", () => {
  it("keeps weapon and aircraft speeds on the requested ratios", () => {
    expect(MAX_SPEED).toBe(SPEED_UNIT * 1.5);
    expect(AFTERBURNER_SPEED).toBe(SPEED_UNIT * 2);
    expect(BULLET_SPEED).toBe(SPEED_UNIT * 3);
    expect(BULLET_TTL_SECONDS).toBeCloseTo(0.85 * 3);
    expect(MISSILE_SPEED).toBe(SPEED_UNIT * 4);
  });

  it("moves aircraft with sanitized input and warns outside the soft ceiling", () => {
    const room = twoPlayerRoom();
    const player = room.players.p1;
    player.position.y = MAX_ALTITUDE + 500;

    setPlayerInput(player, {
      seq: 1,
      thrust: 1,
      pitch: 4,
      yaw: -4,
      roll: 9,
      afterburner: true
    });

    stepRoom(room, 1 / 30, 1033);

    expect(player.input.pitch).toBe(1);
    expect(player.input.yaw).toBe(-1);
    expect(player.input.roll).toBe(1);
    expect(player.position.y).toBeGreaterThan(MAX_ALTITUDE);
    expect(player.status).toBe("alive");
    expect(player.outOfBoundsRemainingMs).toBeGreaterThan(0);
  });

  it("keeps level flight near cruise speed but lets dives build energy", () => {
    const room = twoPlayerRoom();
    const player = room.players.p1;
    player.position = { x: 0, y: 500, z: 0 };
    setRotation(player, { pitch: 0, yaw: 0, roll: 0 });

    for (let i = 0; i < 10; i += 1) {
      setPlayerInput(player, { seq: i + 1 });
      stepRoom(room, 0.1, 1100 + i * 100);
    }

    expect(length(player.velocity)).toBeGreaterThan(MAX_SPEED * 0.9);
    expect(length(player.velocity)).toBeLessThan(MAX_SPEED * 1.12);

    setRotation(player, { pitch: -0.65, yaw: 0, roll: 0 });
    for (let i = 10; i < 24; i += 1) {
      setPlayerInput(player, { seq: i + 1 });
      stepRoom(room, 0.1, 1100 + i * 100);
    }

    expect(length(player.velocity)).toBeGreaterThan(MAX_SPEED * 1.05);
  });

  it("makes inverted neutral flight sink but lets pitch generate recovery lift", () => {
    const room = twoPlayerRoom();
    const player = room.players.p1;

    player.position = { x: 0, y: 500, z: 0 };
    setRotation(player, { pitch: 0, yaw: 0, roll: Math.PI });
    player.velocity = { x: 0, y: 0, z: MAX_SPEED };
    stepRoom(room, 0.2, 1100);
    const neutralVerticalSpeed = player.velocity.y;
    expect(neutralVerticalSpeed).toBeLessThan(-8);

    player.position = { x: 0, y: 500, z: 0 };
    setRotation(player, { pitch: 0.36, yaw: 0, roll: Math.PI });
    player.velocity = { x: 0, y: 0, z: MAX_SPEED };
    stepRoom(room, 0.2, 1300);

    expect(player.velocity.y).toBeGreaterThan(neutralVerticalSpeed + 8);
  });

  it("crashes aircraft on ocean impact without awarding score", () => {
    const room = twoPlayerRoom();
    const player = room.players.p1;
    const other = room.players.p2;

    player.position = { x: ARENA_RADIUS * 0.75, y: TERRAIN_COLLISION_MARGIN - 1, z: 0 };
    const events = stepRoom(room, 0, 1050);

    expect(events).toContainEqual({ type: "crash", roomId: room.id, playerId: player.id, reason: "terrain" });
    expect(player.status).toBe("dead");
    expect(player.health).toBe(0);
    expect(player.deaths).toBe(1);
    expect(other.score).toBe(0);
  });

  it("does not crash aircraft while they still have visible terrain clearance", () => {
    const room = twoPlayerRoom();
    const player = room.players.p1;

    player.position = { x: ARENA_RADIUS * 0.75, y: TERRAIN_COLLISION_MARGIN + 3, z: 0 };
    stepRoom(room, 0, 1050);

    expect(player.status).toBe("alive");
  });

  it("detects terrain impact across a fast descent segment", () => {
    expect(
      isTerrainImpact(
        { x: ARENA_RADIUS * 0.75, y: -4, z: 0 },
        { x: ARENA_RADIUS * 0.75, y: 18, z: 0 }
      )
    ).toBe(true);
  });

  it("crashes aircraft on mountain impact", () => {
    const room = twoPlayerRoom();
    const player = room.players.p1;
    const island = TERRAIN_ISLANDS[0];
    const peak = island.peaks[0];
    const x = island.x + peak.x;
    const z = island.z + peak.z;
    const terrain = terrainHeightAt(x, z);

    expect(terrain.kind).toBe("mountain");
    player.position = { x, y: terrain.height + TERRAIN_COLLISION_MARGIN - 0.1, z };
    const events = stepRoom(room, 0, 1050);

    expect(events).toContainEqual({ type: "crash", roomId: room.id, playerId: player.id, reason: "terrain" });
    expect(player.status).toBe("dead");
  });

  it("starts and clears the soft play-area warning", () => {
    const room = twoPlayerRoom();
    const player = room.players.p1;

    player.position = { x: ARENA_RADIUS + 25, y: 190, z: 0 };
    stepRoom(room, 0, 1050);

    expect(player.status).toBe("alive");
    expect(player.outOfBoundsRemainingMs).toBe(OUT_OF_BOUNDS_GRACE_MS);

    player.position = { x: ARENA_RADIUS - 25, y: 190, z: 0 };
    stepRoom(room, 0, 2050);

    expect(player.outOfBoundsUntil).toBeUndefined();
    expect(player.outOfBoundsRemainingMs).toBe(0);
  });

  it("crashes aircraft when the soft play-area timer expires", () => {
    const room = twoPlayerRoom();
    const player = room.players.p1;

    player.position = { x: ARENA_RADIUS + 100, y: 190, z: 0 };
    stepRoom(room, 0, 1050);
    expect(player.status).toBe("alive");

    const events = stepRoom(room, 0, 1050 + OUT_OF_BOUNDS_GRACE_MS);

    expect(events).toContainEqual({ type: "crash", roomId: room.id, playerId: player.id, reason: "out-of-bounds" });
    expect(player.status).toBe("dead");
    expect(player.health).toBe(0);
  });

  it("applies bullet hits, awards kills, and respawns players", () => {
    const room = twoPlayerRoom();
    const attacker = room.players.p1;
    const victim = room.players.p2;

    attacker.position = { x: 0, y: 120, z: 0 };
    setRotation(attacker, { pitch: 0, yaw: 0, roll: 0 });
    victim.position = { x: 0, y: 120, z: 90 };
    victim.health = 12;

    setPlayerInput(attacker, { seq: 1, fireGun: true });
    const events = stepRoom(room, 0.1, 1050);

    expect(events.some((event) => event.type === "kill")).toBe(true);
    expect(attacker.score).toBe(1);
    expect(victim.health).toBe(0);
    expect(victim.status).toBe("dead");

    const respawnEvents = stepRoom(room, 1 / 30, 1050 + RESPAWN_MS + 1);
    expect(respawnEvents.some((event) => event.type === "respawn")).toBe(true);
    expect(victim.status).toBe("alive");
    expect(victim.health).toBe(PLAYER_HEALTH);
  });

  it("keeps bullet hit radius close to the tracer width", () => {
    const room = twoPlayerRoom();
    const attacker = room.players.p1;
    const victim = room.players.p2;

    expect(BULLET_HIT_RADIUS).toBeLessThanOrEqual(3);

    attacker.position = { x: 0, y: 120, z: 0 };
    setRotation(attacker, { pitch: 0, yaw: 0, roll: 0 });
    victim.position = { x: PLAYER_HIT_RADIUS + BULLET_HIT_RADIUS + 3, y: 120, z: 28 };
    victim.health = 12;

    setPlayerInput(attacker, { seq: 1, fireGun: true });
    const events = stepRoom(room, 0, 1050);

    expect(events.some((event) => event.type === "hit")).toBe(false);
    expect(victim.health).toBe(12);
  });

  it("fires guns from alternating muzzles converging toward the nose aim point", () => {
    const room = twoPlayerRoom();
    const attacker = room.players.p1;

    attacker.position = { x: 0, y: 160, z: 0 };
    setRotation(attacker, { pitch: 0, yaw: 0, roll: 0 });
    setPlayerInput(attacker, { seq: 1, fireGun: true });
    stepRoom(room, 0, 1050);

    const bullet = Object.values(room.projectiles).find((projectile) => projectile.type === "bullet");
    expect(bullet).toBeDefined();
    expect(Math.abs(bullet?.position.x ?? 0)).toBeGreaterThan(7);
    expect(Math.sign(bullet?.velocity.x ?? 0)).toBe(-Math.sign(bullet?.position.x ?? 0));
    expect(bullet?.velocity.z).toBeGreaterThan(BULLET_SPEED * 0.98);
  });

  it("stops bullets with a light impact when they hit terrain", () => {
    const room = twoPlayerRoom();
    const bullet: ProjectileState = {
      id: "terrain-bullet",
      type: "bullet",
      ownerId: "p1",
      position: { x: ARENA_RADIUS * 0.75, y: TERRAIN_COLLISION_MARGIN - 0.1, z: 0 },
      velocity: { x: 0, y: -BULLET_SPEED, z: 0 },
      ttl: 1,
      damage: 12,
      createdAt: 1000
    };
    room.projectiles[bullet.id] = bullet;

    const events = stepRoom(room, 0, 1050);

    expect(room.projectiles[bullet.id]).toBeUndefined();
    expect(events).toContainEqual({
      type: "impact",
      roomId: room.id,
      ownerId: "p1",
      projectileType: "bullet",
      position: bullet.position,
      reason: "terrain"
    });
  });

  it("detonates missiles on terrain and applies blast damage nearby", () => {
    const room = twoPlayerRoom();
    const owner = room.players.p1;
    const victim = room.players.p2;
    owner.position = { x: -MISSILE_BLAST_RADIUS * 3, y: 160, z: 0 };
    victim.position = { x: ARENA_RADIUS * 0.75, y: 8, z: 28 };
    victim.health = PLAYER_HEALTH;

    const missile: ProjectileState = {
      id: "terrain-missile",
      type: "missile",
      ownerId: owner.id,
      position: { x: ARENA_RADIUS * 0.75, y: TERRAIN_COLLISION_MARGIN - 0.1, z: 0 },
      velocity: { x: 0, y: -MISSILE_SPEED, z: 0 },
      ttl: 1,
      damage: MISSILE_DAMAGE,
      createdAt: 1000
    };
    room.projectiles[missile.id] = missile;

    const events = stepRoom(room, 0, 1050);

    expect(room.projectiles[missile.id]).toBeUndefined();
    expect(events).toContainEqual({
      type: "impact",
      roomId: room.id,
      ownerId: owner.id,
      projectileType: "missile",
      position: missile.position,
      reason: "terrain"
    });
    expect(events.some((event) => event.type === "hit" && event.weapon === "missile" && event.victimId === victim.id)).toBe(true);
    expect(victim.health).toBeLessThan(PLAYER_HEALTH);
  });

  it("proximity-fuses missiles near players and removes the missile", () => {
    const room = twoPlayerRoom();
    const owner = room.players.p1;
    const victim = room.players.p2;
    owner.position = { x: -400, y: 180, z: 0 };
    victim.position = { x: 0, y: 180, z: 0 };
    victim.health = MISSILE_DAMAGE;

    const missile: ProjectileState = {
      id: "proximity-missile",
      type: "missile",
      ownerId: owner.id,
      position: { x: 0, y: 180, z: 48 },
      velocity: { x: 0, y: 0, z: -MISSILE_SPEED },
      ttl: 1,
      damage: MISSILE_DAMAGE,
      createdAt: 1000
    };
    room.projectiles[missile.id] = missile;

    const events = stepRoom(room, 0, 1050);

    expect(room.projectiles[missile.id]).toBeUndefined();
    expect(events.some((event) => event.type === "impact" && event.projectileType === "missile" && event.reason === "player")).toBe(true);
    expect(events.some((event) => event.type === "kill" && event.victimId === victim.id)).toBe(true);
  });

  it("lets roll persist without turning until pitch is applied", () => {
    const room = twoPlayerRoom();
    const player = room.players.p1;
    setRotation(player, { pitch: 0, yaw: 0, roll: 0 });

    setPlayerInput(player, { seq: 1, roll: 1 });
    stepRoom(room, 0.1, 1100);
    stepRoom(room, 0.1, 1200);
    stepRoom(room, 0.1, 1300);

    const bankedRoll = player.rotation.roll;
    expect(bankedRoll).toBeGreaterThan(0.4);
    expect(player.rotation.yaw).toBeCloseTo(0, 3);

    setPlayerInput(player, { seq: 2, roll: 0 });
    stepRoom(room, 0.1, 1400);
    stepRoom(room, 0.1, 1500);

    expect(player.rotation.roll).toBeCloseTo(bankedRoll, 3);
    expect(player.rotation.yaw).toBeCloseTo(0, 3);

    setPlayerInput(player, { seq: 3, pitch: 1 });
    stepRoom(room, 0.1, 1600);

    expect(player.rotation.yaw).toBeGreaterThan(0);
  });

  it("allows pitch input to continue through a full vertical loop", () => {
    const room = twoPlayerRoom();
    const player = room.players.p1;
    setRotation(player, { pitch: 0, yaw: 0, roll: 0 });

    setPlayerInput(player, { seq: 1, pitch: 1 });

    for (let i = 0; i < 12; i += 1) {
      stepRoom(room, 0.1, 1100 + i * 100);
    }

    expect(player.rotation.pitch).toBeGreaterThan(1.05);

    for (let i = 12; i < 24; i += 1) {
      stepRoom(room, 0.1, 1100 + i * 100);
    }

    expect(player.rotation.pitch).toBeLessThan(0);
  });

  it("fires unlocked missiles straight and locked missiles as homing shots", () => {
    const room = twoPlayerRoom();
    const attacker = room.players.p1;
    const target = room.players.p2;

    attacker.position = { x: 0, y: 160, z: 0 };
    setRotation(attacker, { pitch: 0, yaw: 0, roll: 0 });
    target.position = { x: 0, y: 160, z: 240 };
    setRotation(target, { pitch: 0, yaw: 0, roll: 0 });

    setPlayerInput(attacker, { seq: 1, fireMissile: true });
    stepRoom(room, 1 / 30, 1033);
    const dumbfire = Object.values(room.projectiles).find((projectile) => projectile.type === "missile");
    expect(dumbfire?.targetId).toBeUndefined();
    expect(dumbfire?.targetType).toBeUndefined();
    expect(attacker.missilesRemaining).toBe(MISSILE_AMMO_PER_ROUND - 1);

    attacker.missileCooldown = 0;
    holdLock(room);
    expect(attacker.missileLockAcquired).toBe(true);

    setPlayerInput(attacker, { seq: 20, fireMissile: true });
    stepRoom(room, 1 / 30, 2400);

    const missile = Object.values(room.projectiles).find((projectile) => projectile.type === "missile" && projectile.targetId === "p2");
    expect(missile?.targetId).toBe("p2");
    expect(missile?.targetType).toBe("player");
    expect(attacker.missileCooldown).toBeGreaterThan(0);
    expect(attacker.missilesRemaining).toBe(MISSILE_AMMO_PER_ROUND - 2);
  });

  it("uses a narrow lock cone and a tight break cone", () => {
    const acquireAngle = Math.acos(MISSILE_LOCK_DOT);
    const breakAngle = Math.acos(MISSILE_LOCK_BREAK_DOT);
    expect(acquireAngle).toBeLessThan(0.13);
    expect(breakAngle).toBeLessThan(0.18);

    const room = twoPlayerRoom();
    const attacker = room.players.p1;
    const target = room.players.p2;

    attacker.position = { x: 0, y: 160, z: 0 };
    setRotation(attacker, { pitch: 0, yaw: 0, roll: 0 });
    target.position = { x: 80, y: 160, z: 240 };
    setRotation(target, { pitch: 0, yaw: 0, roll: 0 });

    const offNoseDot = dot(normalize({ x: target.position.x, y: 0, z: target.position.z }), { x: 0, y: 0, z: 1 });
    expect(offNoseDot).toBeLessThan(MISSILE_LOCK_DOT);

    holdLock(room);
    expect(attacker.missileLockAcquired).toBe(false);
  });

  it("limits missiles and flares while alive and reloads them on respawn", () => {
    const room = twoPlayerRoom();
    const attacker = room.players.p1;
    const target = room.players.p2;

    attacker.position = { x: 0, y: 160, z: 0 };
    setRotation(attacker, { pitch: 0, yaw: 0, roll: 0 });
    target.position = { x: 0, y: 160, z: 240 };
    setRotation(target, { pitch: 0, yaw: Math.PI, roll: 0 });

    attacker.missilesRemaining = 1;
    attacker.missileLockTargetId = target.id;
    attacker.missileLockProgress = 1;
    attacker.missileLockAcquired = true;
    setPlayerInput(attacker, { seq: 20, fireMissile: true });
    stepRoom(room, 1 / 30, 2400);
    expect(attacker.missilesRemaining).toBe(0);
    expect(Object.values(room.projectiles).filter((projectile) => projectile.type === "missile")).toHaveLength(1);

    attacker.missileCooldown = 0;
    attacker.missileLockTargetId = target.id;
    attacker.missileLockProgress = 1;
    attacker.missileLockAcquired = true;
    setPlayerInput(attacker, { seq: 40, fireMissile: true });
    stepRoom(room, 1 / 30, 3800);
    expect(Object.values(room.projectiles).filter((projectile) => projectile.type === "missile")).toHaveLength(1);

    target.flaresRemaining = 1;
    setPlayerInput(target, { seq: 1, fireFlare: true });
    stepRoom(room, 1 / 30, 3833);
    expect(target.flaresRemaining).toBe(0);
    expect(Object.values(room.projectiles).filter((projectile) => projectile.type === "flare")).toHaveLength(1);

    target.flareCooldown = 0;
    setPlayerInput(target, { seq: 2, fireFlare: true });
    stepRoom(room, 1 / 30, 3866);
    expect(Object.values(room.projectiles).filter((projectile) => projectile.type === "flare")).toHaveLength(1);

    target.status = "dead";
    target.respawnAt = 3900;
    stepRoom(room, 1 / 30, 3901);
    expect(target.status).toBe("alive");
    expect(target.flaresRemaining).toBe(FLARE_AMMO_PER_ROUND);
    expect(target.missilesRemaining).toBe(MISSILE_AMMO_PER_ROUND);
    expect(target.flareCooldown).toBe(0);
    expect(target.missileCooldown).toBe(0);
    expect(attacker.missilesRemaining).toBe(0);

    startRound(room, 5000);
    expect(room.players.p1.missilesRemaining).toBe(MISSILE_AMMO_PER_ROUND);
    expect(room.players.p1.flaresRemaining).toBe(FLARE_AMMO_PER_ROUND);
  });

  it("clears missile lock when target leaves the lock cone", () => {
    const room = twoPlayerRoom();
    const attacker = room.players.p1;
    const target = room.players.p2;

    attacker.position = { x: 0, y: 160, z: 0 };
    setRotation(attacker, { pitch: 0, yaw: 0, roll: 0 });
    target.position = { x: 0, y: 160, z: 240 };
    setRotation(target, { pitch: 0, yaw: 0, roll: 0 });

    holdLock(room);
    expect(attacker.missileLockAcquired).toBe(true);

    target.position = { x: 500, y: 160, z: 0 };
    setPlayerInput(attacker, { seq: 20 });
    stepRoom(room, 0.1, 2400);

    expect(attacker.missileLockTargetId).toBeUndefined();
    expect(attacker.missileLockAcquired).toBe(false);
  });

  it("lets flares distract locked missiles", () => {
    const room = twoPlayerRoom();
    const attacker = room.players.p1;
    const target = room.players.p2;

    attacker.position = { x: 0, y: 160, z: 0 };
    setRotation(attacker, { pitch: 0, yaw: 0, roll: 0 });
    target.position = { x: 0, y: 160, z: 240 };
    setRotation(target, { pitch: 0, yaw: 0, roll: 0 });

    holdLock(room);
    setPlayerInput(attacker, { seq: 20, fireMissile: true });
    stepRoom(room, 1 / 30, 2400);
    const missile = Object.values(room.projectiles).find((projectile) => projectile.type === "missile");
    expect(missile?.targetType).toBe("player");

    setRotation(target, { pitch: 0, yaw: Math.PI, roll: 0 });
    setPlayerInput(target, { seq: 1, fireFlare: true });
    const events = stepRoom(room, 1 / 30, 2433);

    const flare = Object.values(room.projectiles).find((projectile) => projectile.type === "flare");
    expect(flare).toBeDefined();
    expect(missile?.targetId).toBe(flare?.id);
    expect(missile?.targetType).toBe("flare");
    expect(events).toContainEqual({ type: "launch", roomId: room.id, playerId: target.id, weapon: "flare" });
  });

  it("ends the round and selects the score leader", () => {
    const room = twoPlayerRoom();
    room.players.p1.score = 3;
    room.players.p2.score = 1;

    stepRoom(room, 1 / 30, room.endsAt + 1);

    expect(room.phase).toBe("ended");
    expect(room.winnerId).toBe("p1");
  });
});
