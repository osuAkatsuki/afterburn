import { describe, expect, it } from "vitest";
import {
  AFTERBURNER_SPEED,
  ARENA_RADIUS,
  BULLET_HIT_RADIUS,
  BULLET_SPEED,
  BULLET_TTL_SECONDS,
  FLARE_DECOY_RANGE,
  FLARE_AMMO_PER_ROUND,
  FLARE_COOLDOWN_SECONDS,
  FLARE_HEAT_DECAY_SECONDS,
  FLARE_MIN_HEAT_SIGNATURE,
  FLARE_PEAK_HEAT_SIGNATURE,
  FLARE_TTL_SECONDS,
  GUN_AMMO_PER_ROUND,
  GUN_CONVERGENCE_DISTANCE,
  JET_AFTERBURNER_HEAT_MULTIPLIER,
  JET_ENGINE_HEAT_SIGNATURE,
  MAX_ALTITUDE,
  MAX_SPEED,
  MISSILE_AMMO_PER_ROUND,
  MISSILE_ARMING_DISTANCE,
  MISSILE_BLAST_RADIUS,
  MISSILE_LOCK_BREAK_DOT,
  MISSILE_LOCK_DOT,
  MISSILE_LOCK_RANGE,
  MISSILE_LOCK_SECONDS,
  MISSILE_DAMAGE,
  MISSILE_HIT_RADIUS,
  MISSILE_NAVIGATION_CONSTANT,
  MISSILE_PROXIMITY_RADIUS,
  MISSILE_SEEKER_GIMBAL_DOT,
  MISSILE_SEEKER_GATE_DOT,
  MISSILE_SPEED,
  MISSILE_TTL_SECONDS,
  OUT_OF_BOUNDS_GRACE_MS,
  PLAYER_HEALTH,
  RESPAWN_MS,
  SPAWN_ALTITUDE_MAX,
  SPAWN_ALTITUDE_MIN,
  SPAWN_PROTECTION_MS,
  SPAWN_RING_MAX,
  SPAWN_RING_MIN,
  SPEED_UNIT,
  TICK_RATE,
  TERRAIN_COLLISION_MARGIN,
  TERRAIN_ISLANDS
} from "../../src/shared/constants.js";
import {
  addPlayerToRoom,
  applyPlayerFlightStep,
  createPlayer,
  createRoomState,
  isPlayerSpawnProtected,
  setPlayerInput,
  spawnForIndex,
  startRound,
  stepRoom
} from "../../src/shared/simulation.js";
import { distance, dot, forwardVector, length, normalize, quaternionFromRotation, scale, subtract } from "../../src/shared/math.js";
import { isTerrainImpact, terrainHeightAt } from "../../src/shared/terrain.js";
import { AIRFRAME_BULLET_BOXES, closestProjectileToAircraftBulletDamage } from "../../src/shared/hitShapes.js";
import type { PlayerState, ProjectileState, Rotation } from "../../src/shared/types.js";

function twoPlayerRoom(now = 1000) {
  const room = createRoomState("TEST1", "p1", now);
  addPlayerToRoom(room, createPlayer("p1", "Maverick", 0, now));
  addPlayerToRoom(room, createPlayer("p2", "Viper", 1, now));
  startRound(room, now);
  clearSpawnProtectionForTest(room);
  return room;
}

function clearSpawnProtectionForTest(room: ReturnType<typeof createRoomState>) {
  Object.values(room.players).forEach((player) => {
    player.spawnProtectionUntil = undefined;
    player.spawnProtectionRemainingMs = 0;
  });
}

function directionToTarget(attacker: PlayerState, target: PlayerState) {
  return normalize(subtract(target.position, attacker.position));
}

function holdLock(room: ReturnType<typeof twoPlayerRoom>, attackerId = "p1", targetId = "p2") {
  const attacker = room.players[attackerId];
  const target = room.players[targetId];
  const steps = Math.ceil(MISSILE_LOCK_SECONDS / 0.1) + 1;

  for (let i = 0; i < steps; i += 1) {
    setPlayerInput(attacker, { seq: i + 1, aimDirection: target ? directionToTarget(attacker, target) : undefined });
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
    expect(BULLET_SPEED).toBe(SPEED_UNIT * 16);
    expect(BULLET_TTL_SECONDS).toBeCloseTo(0.85 * 3);
    expect(MISSILE_SPEED).toBe(SPEED_UNIT * 6);
    expect(MISSILE_NAVIGATION_CONSTANT).toBeGreaterThanOrEqual(3);
    expect(MISSILE_NAVIGATION_CONSTANT).toBeLessThanOrEqual(5);
    expect(MISSILE_TTL_SECONDS).toBeGreaterThan(9);
    expect(MISSILE_LOCK_RANGE).toBeCloseTo(MISSILE_SPEED * MISSILE_TTL_SECONDS * 0.9);
    expect(FLARE_DECOY_RANGE).toBeGreaterThan(400);
    expect(FLARE_COOLDOWN_SECONDS).toBeLessThan(0.25);
    expect(FLARE_AMMO_PER_ROUND).toBe(24);
    expect(GUN_AMMO_PER_ROUND).toBe(480);
    expect(FLARE_PEAK_HEAT_SIGNATURE).toBeGreaterThan(JET_ENGINE_HEAT_SIGNATURE);
    expect(FLARE_MIN_HEAT_SIGNATURE).toBeLessThan(JET_ENGINE_HEAT_SIGNATURE);
    expect(FLARE_HEAT_DECAY_SECONDS).toBeLessThan(FLARE_TTL_SECONDS);
    expect(JET_AFTERBURNER_HEAT_MULTIPLIER).toBeGreaterThan(1);
    expect(MISSILE_SEEKER_GATE_DOT).toBeGreaterThan(0.5);
  });

  it("keeps the play area large enough for setup space and outer terrain", () => {
    expect(ARENA_RADIUS).toBeGreaterThanOrEqual(3000);
    expect(MAX_ALTITUDE).toBe(1800);
    expect(ARENA_RADIUS).toBeGreaterThan(SPAWN_RING_MAX * 2);
    expect(ARENA_RADIUS).toBeGreaterThan(GUN_CONVERGENCE_DISTANCE * 4);

    const outermostTerrain = Math.max(
      ...TERRAIN_ISLANDS.map((island) => {
        const islandRadius = Math.max(island.beachRadius * island.beachScaleX, island.beachRadius * island.beachScaleZ);
        return Math.hypot(island.x, island.z) + islandRadius;
      })
    );

    expect(outermostTerrain).toBeLessThan(ARENA_RADIUS);
  });

  it("spawns aircraft on a wider staggered ring facing roughly inward", () => {
    for (let index = 0; index < 6; index += 1) {
      const spawn = spawnForIndex(index);
      const horizontalRange = Math.hypot(spawn.position.x, spawn.position.z);
      const towardCenter = normalize({ x: -spawn.position.x, y: 0, z: -spawn.position.z });
      const forward = forwardVector(spawn.rotation);
      const terrain = terrainHeightAt(spawn.position.x, spawn.position.z);

      expect(horizontalRange).toBeGreaterThanOrEqual(SPAWN_RING_MIN);
      expect(horizontalRange).toBeLessThanOrEqual(SPAWN_RING_MAX);
      expect(spawn.position.y).toBeGreaterThanOrEqual(SPAWN_ALTITUDE_MIN);
      expect(spawn.position.y).toBeLessThanOrEqual(SPAWN_ALTITUDE_MAX);
      expect(dot(normalize({ x: forward.x, y: 0, z: forward.z }), towardCenter)).toBeGreaterThan(0.94);
      expect(terrain.kind).not.toBe("mountain");
    }
  });

  it("starts rounds with brief spawn protection", () => {
    const room = createRoomState("PROT0", "p1", 1000);
    addPlayerToRoom(room, createPlayer("p1", "Maverick", 0, 1000));
    startRound(room, 1000);

    expect(room.players.p1.spawnProtectionRemainingMs).toBe(SPAWN_PROTECTION_MS);
    expect(isPlayerSpawnProtected(room.players.p1, 1000 + SPAWN_PROTECTION_MS - 1)).toBe(true);
    expect(isPlayerSpawnProtected(room.players.p1, 1000 + SPAWN_PROTECTION_MS)).toBe(false);
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
      aimDirection: { x: 0, y: 0, z: 8 },
      afterburner: true
    });

    stepRoom(room, 1 / 30, 1033);

    expect(player.input.pitch).toBe(1);
    expect(player.input.yaw).toBe(-1);
    expect(player.input.roll).toBe(1);
    expect(player.input.aimDirection).toEqual({ x: 0, y: 0, z: 1 });
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

  it("uses the exported flight step for server aircraft movement", () => {
    const room = twoPlayerRoom();
    const serverPlayer = room.players.p1;
    const predictedPlayer = structuredClone(serverPlayer);
    const input = {
      seq: 1,
      thrust: 0,
      pitch: 0.8,
      yaw: 0,
      roll: 1,
      fireGun: false,
      fireMissile: false,
      fireFlare: false,
      afterburner: true,
      timestamp: 1000
    };

    setPlayerInput(serverPlayer, input);
    stepRoom(room, 1 / TICK_RATE, 1100);
    applyPlayerFlightStep(predictedPlayer, input, 1 / TICK_RATE);

    expect(predictedPlayer.position.x).toBeCloseTo(serverPlayer.position.x);
    expect(predictedPlayer.position.y).toBeCloseTo(serverPlayer.position.y);
    expect(predictedPlayer.position.z).toBeCloseTo(serverPlayer.position.z);
    expect(predictedPlayer.rotation.roll).toBeCloseTo(serverPlayer.rotation.roll);
    expect(predictedPlayer.velocity.z).toBeCloseTo(serverPlayer.velocity.z);
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

  it("quickly realigns velocity with the aircraft nose after a skid", () => {
    const room = twoPlayerRoom();
    const player = room.players.p1;
    player.position = { x: 0, y: 500, z: 0 };
    setRotation(player, { pitch: 0, yaw: 0, roll: 0 });
    player.velocity = { x: MAX_SPEED, y: 0, z: 0 };

    for (let i = 0; i < 12; i += 1) {
      setPlayerInput(player, { seq: i + 1 });
      stepRoom(room, 1 / TICK_RATE, 1100 + i * (1000 / TICK_RATE));
    }

    expect(dot(normalize(player.velocity), forwardVector(player.rotation))).toBeGreaterThan(0.94);
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

  it("crashes aircraft when a wingtip contacts terrain", () => {
    const room = twoPlayerRoom();
    const player = room.players.p1;

    player.position = { x: ARENA_RADIUS * 0.75, y: 10, z: 0 };
    setRotation(player, { pitch: 0, yaw: 0, roll: -Math.PI / 2 });

    const events = stepRoom(room, 0, 1050);

    expect(events).toContainEqual({ type: "crash", roomId: room.id, playerId: player.id, reason: "terrain" });
    expect(player.status).toBe("dead");
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

  it("crashes both aircraft on player collision without awarding score", () => {
    const room = twoPlayerRoom();
    const first = room.players.p1;
    const second = room.players.p2;

    first.position = { x: ARENA_RADIUS * 0.5, y: 220, z: 0 };
    setRotation(first, { pitch: 0, yaw: 0, roll: 0 });
    second.position = { x: ARENA_RADIUS * 0.5 + 34.2, y: 220, z: 0 };
    setRotation(second, { pitch: 0, yaw: 0, roll: 0 });

    const events = stepRoom(room, 0, 1050);

    expect(events).toContainEqual({ type: "crash", roomId: room.id, playerId: first.id, reason: "collision" });
    expect(events).toContainEqual({ type: "crash", roomId: room.id, playerId: second.id, reason: "collision" });
    expect(first.status).toBe("dead");
    expect(second.status).toBe("dead");
    expect(first.health).toBe(0);
    expect(second.health).toBe(0);
    expect(first.deaths).toBe(1);
    expect(second.deaths).toBe(1);
    expect(first.score).toBe(0);
    expect(second.score).toBe(0);
  });

  it("requires airframe overlap for aircraft collisions", () => {
    const room = twoPlayerRoom();
    const first = room.players.p1;
    const second = room.players.p2;

    first.position = { x: ARENA_RADIUS * 0.5, y: 220, z: 0 };
    setRotation(first, { pitch: 0, yaw: 0, roll: 0 });
    second.position = { x: ARENA_RADIUS * 0.5 + 38, y: 220, z: 0 };
    setRotation(second, { pitch: 0, yaw: 0, roll: 0 });

    const events = stepRoom(room, 0, 1050);

    expect(events).not.toContainEqual({ type: "crash", roomId: room.id, playerId: first.id, reason: "collision" });
    expect(events).not.toContainEqual({ type: "crash", roomId: room.id, playerId: second.id, reason: "collision" });
    expect(first.status).toBe("alive");
    expect(second.status).toBe("alive");
  });

  it("prevents protected spawns from causing or receiving immediate collision kills", () => {
    const room = twoPlayerRoom();
    const first = room.players.p1;
    const second = room.players.p2;
    first.position = { x: 0, y: 260, z: 0 };
    setRotation(first, { pitch: 0, yaw: 0, roll: 0 });
    second.position = { x: 4, y: 260, z: 0 };
    setRotation(second, { pitch: 0, yaw: 0, roll: 0 });
    first.spawnProtectionUntil = 4000;
    first.spawnProtectionRemainingMs = 3000;

    stepRoom(room, 0, 1050);

    expect(first.status).toBe("alive");
    expect(second.status).toBe("alive");

    first.spawnProtectionUntil = 1051;
    const events = stepRoom(room, 0, 4050);

    expect(events).toContainEqual({ type: "crash", roomId: room.id, playerId: first.id, reason: "collision" });
    expect(events).toContainEqual({ type: "crash", roomId: room.id, playerId: second.id, reason: "collision" });
  });

  it("disables protected spawn gun and missile launches", () => {
    const room = twoPlayerRoom();
    const attacker = room.players.p1;
    attacker.spawnProtectionUntil = 4000;
    attacker.spawnProtectionRemainingMs = 3000;
    attacker.missileCooldown = 0;

    setPlayerInput(attacker, { seq: 1, fireGun: true, fireMissile: true });
    const events = stepRoom(room, 0.1, 1050);

    expect(Object.values(room.projectiles).filter((projectile) => projectile.type === "bullet" || projectile.type === "missile")).toHaveLength(0);
    expect(events.some((event) => event.type === "launch" && (event.weapon === "bullet" || event.weapon === "missile"))).toBe(false);
  });

  it("ignores weapon hits against protected spawns", () => {
    const room = twoPlayerRoom();
    const victim = room.players.p2;
    victim.position = { x: 0, y: 260, z: 0 };
    victim.health = 12;
    victim.spawnProtectionUntil = 4000;
    victim.spawnProtectionRemainingMs = 3000;

    const bullet: ProjectileState = {
      id: "protected-bullet",
      type: "bullet",
      ownerId: "p1",
      position: { ...victim.position },
      velocity: { x: 0, y: 0, z: 0 },
      ttl: 1,
      damage: 12,
      createdAt: 1000
    };
    room.projectiles[bullet.id] = bullet;

    const events = stepRoom(room, 0, 1050);

    expect(victim.status).toBe("alive");
    expect(victim.health).toBe(12);
    expect(events.some((event) => event.type === "hit" || event.type === "kill")).toBe(false);
  });

  it("applies bullet hits, awards kills, and respawns players", () => {
    const room = twoPlayerRoom();
    const attacker = room.players.p1;
    const victim = room.players.p2;

    attacker.position = { x: 0, y: 420, z: 0 };
    setRotation(attacker, { pitch: 0, yaw: 0, roll: 0 });
    victim.position = { x: -7.6, y: 420, z: 90 };
    victim.health = 12;

    setPlayerInput(attacker, { seq: 1, fireGun: true });
    const events = stepRoom(room, 0.05, 1050);

    expect(events.some((event) => event.type === "kill")).toBe(true);
    expect(attacker.score).toBe(1);
    expect(victim.health).toBe(0);
    expect(victim.status).toBe("dead");

    const respawnEvents = stepRoom(room, 1 / 30, 1050 + RESPAWN_MS + 1);
    expect(respawnEvents.some((event) => event.type === "respawn")).toBe(true);
    expect(victim.status).toBe("alive");
    expect(victim.health).toBe(PLAYER_HEALTH);
  });

  it("respawns away from nearby enemies when another safe spawn is available", () => {
    const room = twoPlayerRoom();
    const respawning = room.players.p1;
    const enemy = room.players.p2;
    const campedSpawn = spawnForIndex(0);

    enemy.position = { ...campedSpawn.position };
    respawning.status = "dead";
    respawning.respawnAt = 2000;

    const events = stepRoom(room, 0, 2000);

    expect(events).toContainEqual({ type: "respawn", roomId: room.id, playerId: respawning.id });
    expect(respawning.status).toBe("alive");
    expect(distance(respawning.position, enemy.position)).toBeGreaterThan(650);
    expect(respawning.spawnProtectionRemainingMs).toBe(SPAWN_PROTECTION_MS);
  });

  it("keeps bullet hit radius close to the tracer width", () => {
    const room = twoPlayerRoom();
    const attacker = room.players.p1;
    const victim = room.players.p2;

    expect(BULLET_HIT_RADIUS).toBeLessThanOrEqual(0.5);

    attacker.position = { x: 0, y: 120, z: 0 };
    setRotation(attacker, { pitch: 0, yaw: 0, roll: 0 });
    victim.position = { x: -11.2, y: 125, z: 80 };
    setRotation(victim, { pitch: 0, yaw: 0, roll: 0 });
    victim.health = 12;

    setPlayerInput(attacker, { seq: 1, fireGun: true });
    const events = stepRoom(room, 0.05, 1050);

    expect(events.some((event) => event.type === "hit")).toBe(false);
    expect(victim.health).toBe(12);
  });

  it("counts gun hits against the visible wing and tail damage surfaces", () => {
    const room = twoPlayerRoom();
    const attacker = room.players.p1;
    const victim = room.players.p2;
    attacker.position = { x: 0, y: 160, z: 0 };
    victim.position = { x: 0, y: 160, z: 80 };
    setRotation(victim, { pitch: 0, yaw: 0, roll: 0 });
    victim.health = PLAYER_HEALTH;

    room.projectiles["wing-hit"] = {
      id: "wing-hit",
      type: "bullet",
      ownerId: attacker.id,
      position: { x: -10, y: 159.8, z: 72 },
      velocity: { x: 0, y: 0, z: BULLET_SPEED },
      ttl: 1,
      damage: 12,
      createdAt: 1000
    };

    const events = stepRoom(room, 1 / 120, 1050);

    expect(events).toContainEqual({
      type: "hit",
      roomId: room.id,
      attackerId: attacker.id,
      victimId: victim.id,
      damage: 12,
      weapon: "bullet"
    });
    expect(victim.health).toBe(PLAYER_HEALTH - 12);
    expect(room.projectiles["wing-hit"]).toBeUndefined();
  });

  it("can validate gun hits against a lag-compensated historical target pose", () => {
    const room = twoPlayerRoom();
    const attacker = room.players.p1;
    const victim = room.players.p2;
    attacker.position = { x: 0, y: 160, z: 0 };
    victim.position = { x: 80, y: 160, z: 150 };
    setRotation(victim, { pitch: 0, yaw: 0, roll: 0 });

    room.projectiles["rewind-hit"] = {
      id: "rewind-hit",
      type: "bullet",
      ownerId: attacker.id,
      position: { x: 0, y: 160, z: 110 },
      velocity: { x: 0, y: 0, z: BULLET_SPEED },
      ttl: 1,
      damage: 12,
      createdAt: 900,
      combatRewindMs: 100
    };

    const events = stepRoom(room, 0.05, 1000, {
      sampleHistoricalPlayer: (playerId) =>
        playerId === victim.id
          ? {
              id: victim.id,
              status: "alive",
              position: { x: 0, y: 160, z: 150 },
              velocity: { x: 0, y: 0, z: 0 },
              rotation: { pitch: 0, yaw: 0, roll: 0 },
              orientation: quaternionFromRotation({ pitch: 0, yaw: 0, roll: 0 })
            }
          : undefined
    });

    expect(events).toContainEqual({
      type: "hit",
      roomId: room.id,
      attackerId: attacker.id,
      victimId: victim.id,
      damage: 12,
      weapon: "bullet"
    });
    expect(victim.health).toBe(PLAYER_HEALTH - 12);
  });

  it("does not lag-compensate bullets without a server rewind context", () => {
    const room = twoPlayerRoom();
    const attacker = room.players.p1;
    const victim = room.players.p2;
    attacker.position = { x: 0, y: 160, z: 0 };
    victim.position = { x: 80, y: 160, z: 150 };
    setRotation(victim, { pitch: 0, yaw: 0, roll: 0 });

    room.projectiles["current-miss"] = {
      id: "current-miss",
      type: "bullet",
      ownerId: attacker.id,
      position: { x: 0, y: 160, z: 110 },
      velocity: { x: 0, y: 0, z: BULLET_SPEED },
      ttl: 1,
      damage: 12,
      createdAt: 900,
      combatRewindMs: 100
    };

    const events = stepRoom(room, 0.05, 1000);

    expect(events.some((event) => event.type === "hit")).toBe(false);
    expect(victim.health).toBe(PLAYER_HEALTH);
  });

  it("does not inflate gun hits outside the visible wing surface", () => {
    const victim = createPlayer("p2", "Viper", 1, 1000);
    victim.position = { x: 0, y: 160, z: 80 };
    setRotation(victim, { pitch: 0, yaw: 0, roll: 0 });

    const closest = closestProjectileToAircraftBulletDamage(
      { x: -10, y: 161.2, z: 72 },
      { x: -10, y: 161.2, z: 88 },
      victim
    );

    expect(closest.clearance).toBeGreaterThan(BULLET_HIT_RADIUS);
  });

  it("defines named gun damage boxes for wings and control surfaces", () => {
    expect(AIRFRAME_BULLET_BOXES.map((box) => box.name)).toEqual([
      "leftWingRoot",
      "rightWingRoot",
      "leftMainWing",
      "rightMainWing",
      "leftWingtipAccent",
      "rightWingtipAccent",
      "leftAileron",
      "rightAileron",
      "leftTailplane",
      "rightTailplane",
      "leftElevator",
      "rightElevator",
      "leftVerticalFin",
      "rightVerticalFin",
      "leftRudder",
      "rightRudder"
    ]);
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
      createdAt: 0
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

  it("kills planes on direct missile impact", () => {
    const room = twoPlayerRoom();
    const owner = room.players.p1;
    const victim = room.players.p2;
    owner.position = { x: -400, y: 180, z: 0 };
    victim.position = { x: 0, y: 180, z: 0 };
    victim.health = PLAYER_HEALTH;

    const missile: ProjectileState = {
      id: "direct-hit-missile",
      type: "missile",
      ownerId: owner.id,
      position: { x: 0, y: 180, z: -MISSILE_SPEED / 60 },
      velocity: { x: 0, y: 0, z: MISSILE_SPEED },
      ttl: 1,
      damage: MISSILE_DAMAGE,
      createdAt: 0
    };
    room.projectiles[missile.id] = missile;

    const events = stepRoom(room, 1 / 30, 1050);

    expect(room.projectiles[missile.id]).toBeUndefined();
    expect(events).toContainEqual({
      type: "hit",
      roomId: room.id,
      attackerId: owner.id,
      victimId: victim.id,
      damage: PLAYER_HEALTH,
      weapon: "missile"
    });
    expect(events.some((event) => event.type === "kill" && event.victimId === victim.id)).toBe(true);
    expect(victim.status).toBe("dead");
  });

  it("does not proximity-fuse early while a missile is still closing for a direct impact", () => {
    const room = twoPlayerRoom();
    const owner = room.players.p1;
    const victim = room.players.p2;
    owner.position = { x: -400, y: 180, z: 0 };
    victim.position = { x: 0, y: 180, z: 0 };
    victim.health = PLAYER_HEALTH;

    const missile: ProjectileState = {
      id: "closing-missile",
      type: "missile",
      ownerId: owner.id,
      position: { x: 0, y: 180, z: MISSILE_PROXIMITY_RADIUS - 4 },
      velocity: { x: 0, y: 0, z: -MISSILE_SPEED },
      ttl: 1,
      damage: MISSILE_DAMAGE,
      createdAt: 0
    };
    room.projectiles[missile.id] = missile;

    const events = stepRoom(room, 0.001, 1050);

    expect(room.projectiles[missile.id]).toBeDefined();
    expect(events.some((event) => event.type === "impact" && event.projectileType === "missile")).toBe(false);
    expect(victim.health).toBe(PLAYER_HEALTH);
  });

  it("proximity-fuses missiles near players after a near miss and removes the missile", () => {
    const room = twoPlayerRoom();
    const owner = room.players.p1;
    const victim = room.players.p2;
    owner.position = { x: -400, y: 180, z: 0 };
    victim.position = { x: 0, y: 180, z: 0 };
    victim.health = PLAYER_HEALTH;

    const missile: ProjectileState = {
      id: "proximity-missile",
      type: "missile",
      ownerId: owner.id,
      position: { x: -MISSILE_SPEED * 0.0005, y: 180 + MISSILE_HIT_RADIUS + 12, z: 0 },
      velocity: { x: MISSILE_SPEED, y: 0, z: 0 },
      ttl: 1,
      damage: MISSILE_DAMAGE,
      createdAt: 0
    };
    room.projectiles[missile.id] = missile;

    const events = stepRoom(room, 0.001, 1050);

    expect(room.projectiles[missile.id]).toBeUndefined();
    expect(events.some((event) => event.type === "impact" && event.projectileType === "missile" && event.reason === "player")).toBe(true);
    expect(events.some((event) => event.type === "hit" && event.victimId === victim.id && event.weapon === "missile")).toBe(true);
    expect(events.some((event) => event.type === "kill" && event.victimId === victim.id)).toBe(false);
    expect(victim.health).toBeLessThan(PLAYER_HEALTH);
    expect(victim.health).toBeGreaterThan(0);
  });

  it("does not fuse missiles against players before the warhead arms", () => {
    const room = twoPlayerRoom();
    const victim = room.players.p2;
    victim.position = { x: 0, y: 180, z: 0 };
    victim.health = MISSILE_DAMAGE;

    const missile: ProjectileState = {
      id: "unarmed-missile",
      type: "missile",
      ownerId: "p1",
      position: { ...victim.position },
      velocity: { x: 0, y: 0, z: 0 },
      ttl: 1,
      damage: MISSILE_DAMAGE,
      createdAt: 1000
    };
    room.projectiles[missile.id] = missile;

    const unarmedAt = 1000 + Math.max(1, Math.floor((MISSILE_ARMING_DISTANCE / MISSILE_SPEED) * 1000) - 1);
    const unarmedEvents = stepRoom(room, 0, unarmedAt);

    expect(room.projectiles[missile.id]).toBeDefined();
    expect(victim.status).toBe("alive");
    expect(victim.health).toBe(MISSILE_DAMAGE);
    expect(unarmedEvents.some((event) => event.type === "hit" || event.type === "kill")).toBe(false);

    const armedAt = 1000 + Math.ceil((MISSILE_ARMING_DISTANCE / MISSILE_SPEED) * 1000) + 1;
    const armedEvents = stepRoom(room, 0, armedAt);

    expect(room.projectiles[missile.id]).toBeUndefined();
    expect(armedEvents.some((event) => event.type === "kill" && event.victimId === victim.id)).toBe(true);
  });

  it("leads crossing missile targets with proportional navigation", () => {
    const room = twoPlayerRoom();
    const target = room.players.p2;
    target.position = { x: 0, y: 260, z: 1200 };
    setRotation(target, { pitch: 0, yaw: Math.PI / 2, roll: 0 });
    target.velocity = { x: MAX_SPEED, y: 0, z: 0 };

    const missile: ProjectileState = {
      id: "pn-crossing",
      type: "missile",
      ownerId: "p1",
      targetId: target.id,
      targetType: "player",
      position: { x: 0, y: 260, z: 0 },
      velocity: { x: 0, y: 0, z: MISSILE_SPEED },
      ttl: 2,
      damage: MISSILE_DAMAGE,
      createdAt: 0
    };
    room.projectiles[missile.id] = missile;

    stepRoom(room, 1 / 30, 1050);

    expect(missile.velocity.x).toBeGreaterThan(0);
    expect(missile.position.x).toBeGreaterThan(0);
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
    delete room.projectiles[dumbfire?.id ?? ""];

    attacker.missileCooldown = 0;
    holdLock(room);
    expect(attacker.missileLockAcquired).toBe(true);

    setPlayerInput(attacker, { seq: 20, aimDirection: directionToTarget(attacker, target), fireMissile: true });
    stepRoom(room, 1 / 30, 2400);

    const missile = Object.values(room.projectiles).find((projectile) => projectile.type === "missile" && projectile.targetId === "p2");
    expect(missile?.targetId).toBe("p2");
    expect(missile?.targetType).toBe("player");
    expect(attacker.missileCooldown).toBeGreaterThan(0);
    expect(attacker.missilesRemaining).toBe(MISSILE_AMMO_PER_ROUND - 2);
  });

  it("can acquire missile locks up to the derived missile range", () => {
    const room = twoPlayerRoom();
    const attacker = room.players.p1;
    const target = room.players.p2;

    attacker.position = { x: 0, y: 260, z: 0 };
    setRotation(attacker, { pitch: 0, yaw: 0, roll: 0 });
    target.position = { x: 0, y: 260, z: MISSILE_LOCK_RANGE - 40 };
    setRotation(target, { pitch: 0, yaw: Math.PI, roll: 0 });

    holdLock(room);

    expect(attacker.missileLockTargetId).toBe(target.id);
    expect(attacker.missileLockAcquired).toBe(true);

    target.position = {
      x: attacker.position.x + MISSILE_LOCK_RANGE + 300,
      y: attacker.position.y,
      z: attacker.position.z
    };
    setPlayerInput(attacker, { seq: 40, aimDirection: directionToTarget(attacker, target) });
    stepRoom(room, 0.1, room.now + 100);

    expect(attacker.missileLockTargetId).toBeUndefined();
  });

  it("uses cursor aim inside the seeker gimbal while launches still leave the aircraft nose", () => {
    const room = twoPlayerRoom();
    const attacker = room.players.p1;
    const target = room.players.p2;

    attacker.position = { x: 0, y: 260, z: 0 };
    setRotation(attacker, { pitch: 0, yaw: 0, roll: 0 });
    target.position = { x: 700, y: 260, z: 3000 };
    setRotation(target, { pitch: 0, yaw: Math.PI, roll: 0 });

    const targetDirection = normalize(subtract(target.position, attacker.position));
    const noseForward = forwardVector(attacker.rotation);
    expect(dot(targetDirection, noseForward)).toBeLessThan(MISSILE_LOCK_DOT);
    expect(dot(targetDirection, noseForward)).toBeGreaterThan(MISSILE_SEEKER_GIMBAL_DOT);

    for (let i = 0; i < Math.ceil(MISSILE_LOCK_SECONDS / 0.1) + 1; i += 1) {
      setPlayerInput(attacker, { seq: i + 1, aimDirection: targetDirection });
      stepRoom(room, 0.1, 1100 + i * 100);
    }

    expect(attacker.missileLockAcquired).toBe(true);
    expect(attacker.missileLockTargetId).toBe(target.id);

    setPlayerInput(attacker, { seq: 80, aimDirection: targetDirection, fireMissile: true });
    stepRoom(room, 0, room.now + 100);

    const missile = Object.values(room.projectiles).find((projectile) => projectile.type === "missile" && projectile.ownerId === attacker.id);
    expect(missile?.targetId).toBe(target.id);
    expect(dot(normalize(missile?.velocity ?? { x: 0, y: 0, z: 0 }), noseForward)).toBeGreaterThan(0.99);
  });

  it("clears missile locks while free look omits cursor aim", () => {
    const room = twoPlayerRoom();
    const attacker = room.players.p1;
    const target = room.players.p2;

    attacker.position = { x: 0, y: 260, z: 0 };
    setRotation(attacker, { pitch: 0, yaw: 0, roll: 0 });
    target.position = { x: 700, y: 260, z: 3000 };
    setRotation(target, { pitch: 0, yaw: Math.PI, roll: 0 });

    holdLock(room);
    expect(attacker.missileLockAcquired).toBe(true);

    setPlayerInput(attacker, { seq: 80 });
    stepRoom(room, 0.1, room.now + 100);

    expect(attacker.missileLockTargetId).toBeUndefined();
    expect(attacker.missileLockAcquired).toBe(false);
  });

  it("falls back to nose locks when cursor aim is outside the seeker gimbal", () => {
    const room = twoPlayerRoom();
    const attacker = room.players.p1;
    const target = room.players.p2;

    attacker.position = { x: 0, y: 260, z: 0 };
    setRotation(attacker, { pitch: 0, yaw: 0, roll: 0 });
    target.position = { x: 0, y: 260, z: 3000 };
    setRotation(target, { pitch: 0, yaw: Math.PI, roll: 0 });

    const outsideGimbal = normalize({ x: 3000, y: 0, z: 1000 });
    expect(dot(outsideGimbal, forwardVector(attacker.rotation))).toBeLessThan(MISSILE_SEEKER_GIMBAL_DOT);

    for (let i = 0; i < Math.ceil(MISSILE_LOCK_SECONDS / 0.1) + 1; i += 1) {
      setPlayerInput(attacker, { seq: i + 1, aimDirection: outsideGimbal });
      stepRoom(room, 0.1, 1100 + i * 100);
    }

    expect(attacker.missileLockTargetId).toBe(target.id);
    expect(attacker.missileLockAcquired).toBe(true);
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

    const noseForward = forwardVector(attacker.rotation);
    for (let i = 0; i < Math.ceil(MISSILE_LOCK_SECONDS / 0.1) + 1; i += 1) {
      setPlayerInput(attacker, { seq: i + 1, aimDirection: noseForward });
      stepRoom(room, 0.1, 1100 + i * 100);
    }

    expect(attacker.missileLockAcquired).toBe(false);
  });

  it("limits gun rounds, missiles, and flares while alive and reloads them on respawn", () => {
    const room = twoPlayerRoom();
    const attacker = room.players.p1;
    const target = room.players.p2;

    attacker.position = { x: 0, y: 420, z: 0 };
    setRotation(attacker, { pitch: 0, yaw: 0, roll: 0 });
    target.position = { x: 0, y: 420, z: 240 };
    setRotation(target, { pitch: 0, yaw: Math.PI, roll: 0 });

    attacker.gunAmmoRemaining = 1;
    setPlayerInput(attacker, { seq: 10, fireGun: true });
    stepRoom(room, 0, 2300);
    expect(attacker.gunAmmoRemaining).toBe(0);
    expect(Object.values(room.projectiles).filter((projectile) => projectile.type === "bullet")).toHaveLength(1);

    attacker.gunCooldown = 0;
    setPlayerInput(attacker, { seq: 11, fireGun: true });
    stepRoom(room, 0, 2333);
    expect(Object.values(room.projectiles).filter((projectile) => projectile.type === "bullet")).toHaveLength(1);

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
    stepRoom(room, 0, 2401);
    expect(Object.values(room.projectiles).filter((projectile) => projectile.type === "missile")).toHaveLength(1);
    expect(attacker.missileLockTargetId).toBeUndefined();
    expect(attacker.missileLockAcquired).toBe(false);

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
    expect(target.gunAmmoRemaining).toBe(GUN_AMMO_PER_ROUND);
    expect(target.flareCooldown).toBe(0);
    expect(target.missileCooldown).toBe(0);
    expect(attacker.missilesRemaining).toBe(0);
    expect(attacker.gunAmmoRemaining).toBe(0);

    startRound(room, 5000);
    expect(room.players.p1.gunAmmoRemaining).toBe(GUN_AMMO_PER_ROUND);
    expect(room.players.p1.missilesRemaining).toBe(MISSILE_AMMO_PER_ROUND);
    expect(room.players.p1.flaresRemaining).toBe(FLARE_AMMO_PER_ROUND);
  });

  it("dispenses held flares from alternating underside launchers", () => {
    const room = twoPlayerRoom();
    const target = room.players.p2;

    target.position = { x: 0, y: 220, z: 0 };
    setRotation(target, { pitch: 0, yaw: 0, roll: 0 });
    target.flaresRemaining = 3;

    setPlayerInput(target, { seq: 1, fireFlare: true });
    let now = 1200;
    stepRoom(room, 1 / 30, now);
    for (let i = 0; i < Math.ceil(FLARE_COOLDOWN_SECONDS / (1 / 30)) + 1; i += 1) {
      now += 1000 / 30;
      stepRoom(room, 1 / 30, now);
    }

    const flares = Object.values(room.projectiles).filter((projectile) => projectile.type === "flare");
    expect(flares).toHaveLength(2);
    expect(flares[0].position.x).toBeGreaterThan(0);
    expect(flares[1].position.x).toBeLessThan(0);
    expect(flares.every((flare) => flare.position.y < 220)).toBe(true);
    expect(flares.every((flare) => flare.velocity.y < 0)).toBe(true);
    expect(target.flaresRemaining).toBe(1);
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
    setPlayerInput(attacker, { seq: 20, aimDirection: forwardVector(attacker.rotation) });
    stepRoom(room, 0.1, 2400);

    expect(attacker.missileLockTargetId).toBeUndefined();
    expect(attacker.missileLockAcquired).toBe(false);
  });

  it("lets fresh hot flares distract locked missiles inside the seeker gate", () => {
    const room = twoPlayerRoom();
    const target = room.players.p2;
    target.position = { x: 0, y: 220, z: 320 };
    setRotation(target, { pitch: 0, yaw: 0, roll: 0 });

    const missile: ProjectileState = {
      id: "close-flare-decoy",
      type: "missile",
      ownerId: "p1",
      targetId: "p2",
      targetType: "player",
      position: { x: 0, y: 220, z: 0 },
      velocity: { x: 0, y: 0, z: MISSILE_SPEED },
      ttl: 1,
      damage: MISSILE_DAMAGE,
      createdAt: 1000
    };
    const flare: ProjectileState = {
      id: "close-flare",
      type: "flare",
      ownerId: "p2",
      position: { x: 0, y: 220, z: 60 },
      velocity: { x: 0, y: 0, z: 0 },
      ttl: 1,
      damage: 0,
      createdAt: 1000
    };
    room.projectiles[missile.id] = missile;
    room.projectiles[flare.id] = flare;

    stepRoom(room, 0, 1050);

    expect(missile.targetId).toBe(flare.id);
    expect(missile.targetType).toBe("flare");
  });

  it("keeps cooled flares ignored when the engine return is stronger", () => {
    const room = twoPlayerRoom();
    const target = room.players.p2;
    target.position = { x: 0, y: 220, z: 260 };
    setRotation(target, { pitch: 0, yaw: 0, roll: 0 });

    const missile: ProjectileState = {
      id: "long-flare-decoy",
      type: "missile",
      ownerId: "p1",
      targetId: "p2",
      targetType: "player",
      position: { x: 0, y: 220, z: 0 },
      velocity: { x: 0, y: 0, z: MISSILE_SPEED },
      ttl: 1,
      damage: MISSILE_DAMAGE,
      createdAt: 1000
    };
    const flare: ProjectileState = {
      id: "wide-flare",
      type: "flare",
      ownerId: "p2",
      position: { x: 0, y: 220, z: 80 },
      velocity: { x: 0, y: 0, z: 0 },
      ttl: 1,
      damage: 0,
      createdAt: -5000
    };
    room.projectiles[missile.id] = missile;
    room.projectiles[flare.id] = flare;

    stepRoom(room, 0, 1050);

    expect(missile.targetId).toBe(target.id);
    expect(missile.targetType).toBe("player");
  });

  it("ends the round and selects the score leader", () => {
    const room = twoPlayerRoom();
    room.players.p1.score = 3;
    room.players.p2.score = 1;

    stepRoom(room, 1 / 30, room.endsAt + 1);

    expect(room.phase).toBe("ended");
    expect(room.winnerId).toBe("p1");
  });

  it("keeps bots ready after a round ends", () => {
    const room = twoPlayerRoom();
    room.players.p2.isBot = true;
    room.players.p1.ready = true;
    room.players.p2.ready = false;

    stepRoom(room, 1 / 30, room.endsAt + 1);

    expect(room.phase).toBe("ended");
    expect(room.players.p1.ready).toBe(false);
    expect(room.players.p2.ready).toBe(true);
  });
});
