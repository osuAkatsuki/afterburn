import { describe, expect, it } from "vitest";

import { ARENA_RADIUS, MAX_ALTITUDE, MAX_SPEED, MISSILE_DAMAGE, MISSILE_SPEED } from "../../src/shared/constants.js";
import { forwardVector, quaternionFromRotation, scale } from "../../src/shared/math.js";
import { addPlayerToRoom, createPlayer, createRoomState, startRound } from "../../src/shared/simulation.js";
import type { PlayerState, ProjectileState, Rotation } from "../../src/shared/types.js";
import { createBotInput } from "../../src/server/botPilot.js";

describe("bot pilot", () => {
  it("breaks away instead of flying straight into close head-on targets", () => {
    const { room, bot, target } = botRoom();
    bot.position = { x: 0, y: 260, z: 0 };
    target.position = { x: 0, y: 260, z: 220 };
    setRotation(bot, { pitch: 0, yaw: 0, roll: 0 });
    setRotation(target, { pitch: 0, yaw: Math.PI, roll: 0 });
    bot.missileLockAcquired = true;

    const input = createBotInput(room, bot, 1600);

    expect(input.afterburner).toBe(true);
    expect(input.fireGun).toBe(false);
    expect(input.fireMissile).toBe(false);
    expect(Math.abs(input.roll)).toBeGreaterThan(0.5);
    expect(input.pitch).toBeGreaterThan(0.2);
  });

  it("does not instantly flare against newly detected missiles", () => {
    const { room, bot } = botRoom();
    addThreatMissile(room, bot, "early-threat", 1000, 250);

    const input = createBotInput(room, bot, 1100);

    expect(input.fireFlare).toBe(false);
  });

  it("flares against older close missiles that are still closing", () => {
    const { room, bot } = botRoom();
    addThreatMissile(room, bot, "mature-threat", 1000, 50);

    const input = createBotInput(room, bot, 2500);

    expect(input.fireFlare).toBe(true);
  });

  it("does not flare against missiles that are moving away", () => {
    const { room, bot } = botRoom();
    const missile = addThreatMissile(room, bot, "departing-threat", 1000, 50);
    missile.velocity = { x: 0, y: 0, z: MISSILE_SPEED };

    const input = createBotInput(room, bot, 2500);

    expect(input.fireFlare).toBe(false);
  });

  it("recovers downward when above the playfield ceiling", () => {
    const { room, bot } = botRoom();
    bot.position = { x: 0, y: MAX_ALTITUDE + 120, z: 0 };
    setRotation(bot, { pitch: 0.25, yaw: 0, roll: 0 });

    const input = createBotInput(room, bot, 1600);

    expect(input.afterburner).toBe(true);
    expect(input.pitch).toBeLessThan(0);
  });

  it("steers back toward the arena after leaving the horizontal playfield", () => {
    const { room, bot } = botRoom();
    bot.position = { x: ARENA_RADIUS + 220, y: 420, z: 0 };
    setRotation(bot, { pitch: 0, yaw: Math.PI / 2, roll: 0 });

    const input = createBotInput(room, bot, 1600);

    expect(input.afterburner).toBe(true);
    expect(input.pitch).toBeGreaterThanOrEqual(0);
    expect(Math.abs(input.roll)).toBeGreaterThan(0.4);
  });
});

function botRoom() {
  const room = createRoomState("BOTP1", "human", 1000);
  const bot = createPlayer("bot-1", "Bandit 1", 0, 1000);
  const target = createPlayer("human", "Maverick", 1, 1000);
  bot.isBot = true;
  addPlayerToRoom(room, bot);
  addPlayerToRoom(room, target);
  startRound(room, 1000);
  Object.values(room.players).forEach((player) => {
    player.spawnProtectionUntil = undefined;
    player.spawnProtectionRemainingMs = 0;
  });
  return { room, bot: room.players[bot.id], target: room.players[target.id] };
}

function setRotation(player: PlayerState, rotation: Rotation): void {
  player.rotation = rotation;
  player.orientation = quaternionFromRotation(rotation);
  player.velocity = scale(forwardVector(rotation), MAX_SPEED);
}

function addThreatMissile(room: ReturnType<typeof createRoomState>, bot: PlayerState, id: string, createdAt: number, range: number): ProjectileState {
  bot.position = { x: 0, y: 260, z: 0 };
  const missile: ProjectileState = {
    id,
    type: "missile",
    ownerId: "human",
    targetId: bot.id,
    targetType: "player",
    position: { x: 0, y: 260, z: range },
    velocity: { x: 0, y: 0, z: -MISSILE_SPEED },
    ttl: 1,
    damage: MISSILE_DAMAGE,
    createdAt
  };
  room.projectiles[missile.id] = missile;
  return missile;
}
