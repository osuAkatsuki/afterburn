import { describe, expect, it } from "vitest";
import { MAX_ALTITUDE, MIN_ALTITUDE, PLAYER_HEALTH, RESPAWN_MS } from "../../src/shared/constants.js";
import {
  addPlayerToRoom,
  createPlayer,
  createRoomState,
  setPlayerInput,
  startRound,
  stepRoom
} from "../../src/shared/simulation.js";

function twoPlayerRoom(now = 1000) {
  const room = createRoomState("TEST1", "p1", now);
  addPlayerToRoom(room, createPlayer("p1", "Maverick", 0, now));
  addPlayerToRoom(room, createPlayer("p2", "Viper", 1, now));
  startRound(room, now);
  return room;
}

describe("shared simulation", () => {
  it("moves aircraft with sanitized input and keeps them inside altitude bounds", () => {
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
    expect(player.position.y).toBeLessThanOrEqual(MAX_ALTITUDE);

    player.position.y = MIN_ALTITUDE - 100;
    stepRoom(room, 1 / 30, 1066);
    expect(player.position.y).toBeGreaterThanOrEqual(MIN_ALTITUDE);
  });

  it("applies bullet hits, awards kills, and respawns players", () => {
    const room = twoPlayerRoom();
    const attacker = room.players.p1;
    const victim = room.players.p2;

    attacker.position = { x: 0, y: 120, z: 0 };
    attacker.rotation = { pitch: 0, yaw: 0, roll: 0 };
    victim.position = { x: 0, y: 120, z: 90 };
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

  it("launches homing missiles only when a target is locked", () => {
    const room = twoPlayerRoom();
    const attacker = room.players.p1;
    const target = room.players.p2;

    attacker.position = { x: 0, y: 160, z: 0 };
    attacker.rotation = { pitch: 0, yaw: 0, roll: 0 };
    target.position = { x: 0, y: 160, z: 240 };

    setPlayerInput(attacker, { seq: 1, fireMissile: true });
    stepRoom(room, 1 / 30, 1033);

    const missile = Object.values(room.projectiles).find((projectile) => projectile.type === "missile");
    expect(missile?.targetId).toBe("p2");
    expect(attacker.missileCooldown).toBeGreaterThan(0);
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
