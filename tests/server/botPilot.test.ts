import { describe, expect, it } from "vitest";

import { ARENA_RADIUS, MAX_ALTITUDE, MAX_SPEED, MISSILE_DAMAGE, MISSILE_SEEKER_GIMBAL_DOT, MISSILE_SPEED } from "../../src/shared/constants.js";
import { dot, forwardVector, normalize, quaternionFromRotation, scale, subtract } from "../../src/shared/math.js";
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

  it("breaks defensively and cuts afterburner while flaring against mature missile threats", () => {
    const { room, bot } = botRoom();
    addThreatMissile(room, bot, "defensive-threat", 1000, 320);

    const input = createBotInput(room, bot, 2500);

    expect(input.fireFlare).toBe(true);
    expect(input.afterburner).toBe(false);
    expect(input.fireGun).toBe(false);
    expect(input.fireMissile).toBe(false);
    expect(Math.abs(input.roll)).toBeGreaterThan(0.35);
  });

  it("flares against older close missiles that are still closing", () => {
    const { room, bot } = botRoom();
    addThreatMissile(room, bot, "mature-threat", 1000, 50);

    const input = createBotInput(room, bot, 2500);

    expect(input.fireFlare).toBe(true);
  });

  it("lets regular bots miss some valid missile flare opportunities", () => {
    const { room, bot } = botRoom();
    addThreatMissile(room, bot, "late-threat", 1000, 50);

    const input = createBotInput(room, bot, 3000);

    expect(input.fireFlare).toBe(false);
  });

  it("lets ace bots defend against the same missile more reliably", () => {
    const { room, bot } = botRoom();
    bot.botSkill = "ace";
    addThreatMissile(room, bot, "late-threat", 1000, 50);

    const input = createBotInput(room, bot, 3000);

    expect(input.fireFlare).toBe(true);
  });

  it("uses seeker gimbal aim against off-nose targets", () => {
    const { room, bot, target } = botRoom();
    bot.position = { x: 0, y: 260, z: 0 };
    target.position = { x: 700, y: 260, z: 3000 };
    setRotation(bot, { pitch: 0, yaw: 0, roll: 0 });
    setRotation(target, { pitch: 0, yaw: Math.PI, roll: 0 });

    const targetDirection = normalize(subtract(target.position, bot.position));
    expect(dot(targetDirection, forwardVector(bot.rotation))).toBeGreaterThan(MISSILE_SEEKER_GIMBAL_DOT);

    const input = createBotInput(room, bot, 1600);

    expect(input.aimDirection?.x).toBeCloseTo(targetDirection.x);
    expect(input.aimDirection?.z).toBeCloseTo(targetDirection.z);
  });

  it("pressures score leaders instead of only chasing the nearest aircraft", () => {
    const { room, bot, target } = botRoom();
    const leader = createPlayer("leader", "Leader", 2, 1000);
    addPlayerToRoom(room, leader);
    leader.status = "alive";
    leader.score = 10;

    bot.position = { x: 0, y: 260, z: 0 };
    target.position = { x: -450, y: 260, z: 760 };
    leader.position = { x: 450, y: 260, z: 1100 };
    setRotation(bot, { pitch: 0, yaw: 0, roll: 0 });
    setRotation(target, { pitch: 0, yaw: Math.PI, roll: 0 });
    setRotation(leader, { pitch: 0, yaw: Math.PI, roll: 0 });

    const input = createBotInput(room, bot, 1600);

    expect(input.aimDirection?.x).toBeGreaterThan(0);
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
