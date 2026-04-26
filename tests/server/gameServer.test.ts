import { describe, expect, it } from "vitest";
import { DISCONNECT_GRACE_MS, MAX_PLAYERS } from "../../src/shared/constants.js";
import { GameRoomManager, normalizeInterpolationDelayMs, normalizeLatencyMs } from "../../src/server/gameServer.js";

function ids(...values: string[]) {
  const queue = [...values];
  return () => queue.shift() ?? "ROOMX";
}

describe("GameRoomManager", () => {
  it("creates rooms, joins guests, and enforces capacity", () => {
    const manager = new GameRoomManager(ids("ABCDE"));
    const created = manager.createRoom("host", "Host");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    for (let i = 1; i < MAX_PLAYERS; i += 1) {
      const joined = manager.joinRoom("abcde", `p${i}`, `Pilot ${i}`);
      expect(joined.ok).toBe(true);
    }

    const full = manager.joinRoom("ABCDE", "overflow", "Overflow");
    expect(full.ok).toBe(false);
    expect(full.ok ? "" : full.message).toMatch(/full/i);
  });

  it("requires ready pilots before a normal launch", () => {
    const manager = new GameRoomManager(ids("READY"));
    const created = manager.createRoom("host", "Host", 1000);
    expect(created.ok).toBe(true);
    manager.joinRoom("READY", "guest", "Guest", 1000);

    const unready = manager.startRoom("host", 1100);
    expect(unready.ok).toBe(false);
    expect(unready.ok ? "" : unready.message).toMatch(/ready up/i);

    manager.setReady("host", true, 1110);
    const waiting = manager.startRoom("host", 1120);
    expect(waiting.ok).toBe(false);
    expect(waiting.ok ? "" : waiting.message).toMatch(/all pilots/i);

    manager.setReady("guest", true, 1130);
    const started = manager.startRoom("host", 1140);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.room.phase).toBe("playing");
    expect(started.room.players.host.status).toBe("alive");
    expect(started.room.players.guest.status).toBe("alive");
    expect(started.room.players.host.ready).toBe(false);
    expect(started.room.players.guest.ready).toBe(false);
  });

  it("lets the host force start after another pilot is ready", () => {
    const manager = new GameRoomManager(ids("FORCE"));
    const created = manager.createRoom("host", "Host", 1000);
    expect(created.ok).toBe(true);
    manager.joinRoom("FORCE", "guest-a", "Guest A", 1000);
    manager.joinRoom("FORCE", "guest-b", "Guest B", 1000);

    manager.setReady("host", true, 1100);
    const tooSoon = manager.startRoom("host", 1110, true);
    expect(tooSoon.ok).toBe(false);
    expect(tooSoon.ok ? "" : tooSoon.message).toMatch(/another ready/i);

    manager.setReady("guest-a", true, 1120);
    const started = manager.startRoom("host", 1130, true);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.room.phase).toBe("playing");
    expect(started.room.players["guest-b"].status).toBe("alive");
  });

  it("lets the host launch solo and allows late joins into an active room", () => {
    const manager = new GameRoomManager(ids("DROP1"));
    const created = manager.createRoom("host", "Host", 1000);
    expect(created.ok).toBe(true);

    manager.setReady("host", true, 1050);
    const started = manager.startRoom("host", 1100);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.room.phase).toBe("playing");
    expect(Object.keys(started.room.players)).toHaveLength(1);

    const joined = manager.joinRoom("DROP1", "guest", "Guest", 1200);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.room.phase).toBe("playing");
    expect(joined.room.players.guest.status).toBe("alive");
    expect(joined.room.players.guest.health).toBe(100);
  });

  it("keeps callsigns unique within a room", () => {
    const manager = new GameRoomManager(ids("NAMES"));
    const created = manager.createRoom("host", "cmyui", 1000, "host-client");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const duplicate = manager.joinRoom("NAMES", "guest-a", "CMYUI", 1000, "guest-client-a");
    const secondDuplicate = manager.joinRoom("NAMES", "guest-b", "cmyui", 1000, "guest-client-b");
    expect(duplicate.ok).toBe(true);
    expect(secondDuplicate.ok).toBe(true);
    if (!duplicate.ok || !secondDuplicate.ok) return;

    expect(created.room.players["host-client"].name).toBe("cmyui");
    expect(duplicate.room.players["guest-client-a"].name).toBe("CMYUI 2");
    expect(secondDuplicate.room.players["guest-client-b"].name).toBe("cmyui 3");

    const names = Object.values(secondDuplicate.room.players).map((player) => player.name.toLocaleLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it("renames joined players and keeps callsigns unique", () => {
    const manager = new GameRoomManager(ids("RENAM"));
    const created = manager.createRoom("host", "Host", 1000, "host-client");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const joined = manager.joinRoom("RENAM", "guest", "Guest", 1000, "guest-client");
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;

    const hostRename = manager.renamePlayer("host", "Eagle", 1100);
    const guestRename = manager.renamePlayer("guest", "eagle", 1200);

    expect(hostRename.ok).toBe(true);
    expect(guestRename.ok).toBe(true);
    if (!hostRename.ok || !guestRename.ok) return;
    expect(guestRename.room.players["host-client"].name).toBe("Eagle");
    expect(guestRename.room.players["guest-client"].name).toBe("eagle 2");
    expect(guestRename.room.now).toBe(1200);
    expect(manager.renamePlayer("missing", "Ghost").ok).toBe(false);
  });

  it("does not let an active duplicate client id take over another tab", () => {
    const manager = new GameRoomManager(ids("TABS1"));
    const created = manager.createRoom("socket-a", "Pilot", 1000, "same-client");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const joined = manager.joinRoom("TABS1", "socket-b", "Pilot", 1000, "same-client");
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;

    expect(joined.playerId).not.toBe("same-client");
    expect(Object.keys(joined.room.players)).toHaveLength(2);
    expect(joined.room.players["same-client"]).toBeDefined();
    expect(joined.room.players[joined.playerId]).toBeDefined();
  });

  it("lets the host add and remove ready bots", () => {
    const manager = new GameRoomManager(ids("BOTS1"));
    const created = manager.createRoom("host", "Host", 1000, "host-client");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const bot = manager.addBot("host", 1100);
    expect(bot.ok).toBe(true);
    if (!bot.ok) return;

    expect(bot.room.players[bot.playerId].isBot).toBe(true);
    expect(bot.room.players[bot.playerId].botSkill).toBe("regular");
    expect(bot.room.players[bot.playerId].ready).toBe(true);
    expect(bot.room.players[bot.playerId].name).toBe("Bandit 1");

    const aceBot = manager.addBot("host", 1150, "ace");
    expect(aceBot.ok).toBe(true);
    if (!aceBot.ok) return;
    expect(aceBot.room.players[aceBot.playerId].botSkill).toBe("ace");

    const guest = manager.joinRoom("BOTS1", "guest", "Guest", 1200, "guest-client");
    expect(guest.ok).toBe(true);
    expect(manager.addBot("guest", 1300).ok).toBe(false);

    const removed = manager.removeBot("host", bot.playerId, 1400);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.room.players[bot.playerId]).toBeUndefined();
  });

  it("uses bots as ready players and generates bot input during rounds", () => {
    const manager = new GameRoomManager(ids("BOTS2"));
    const created = manager.createRoom("host", "Host", 1000, "host-client");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const bot = manager.addBot("host", 1050);
    expect(bot.ok).toBe(true);
    if (!bot.ok) return;
    manager.setReady("host", true, 1100);

    const started = manager.startRoom("host", 1150);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.room.players[bot.playerId].status).toBe("alive");

    manager.tickRooms(1183);
    expect(manager.getRoom("BOTS2")?.players[bot.playerId].lastInputSeq).toBeGreaterThan(0);
  });

  it("transfers host on disconnect and removes empty rooms", () => {
    const manager = new GameRoomManager(ids("HOSTS"));
    manager.createRoom("host", "Host");
    manager.joinRoom("HOSTS", "guest", "Guest");

    const changed = manager.removePlayer("host");
    expect(changed[0]?.hostId).toBe("guest");
    expect(manager.getRoom("HOSTS")).toBeDefined();

    manager.removePlayer("guest");
    expect(manager.getRoom("HOSTS")).toBeUndefined();
  });

  it("removes bot-only rooms after the last human leaves", () => {
    const manager = new GameRoomManager(ids("BOTS3"));
    const created = manager.createRoom("host", "Host", 1000, "host-client");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(manager.addBot("host", 1100).ok).toBe(true);

    manager.removePlayer("host-client", 1200);

    expect(manager.getRoom("BOTS3")).toBeUndefined();
  });

  it("keeps disconnected players for a short reconnect grace window", () => {
    const manager = new GameRoomManager(ids("RECON"));
    const created = manager.createRoom("socket-a", "Host", 1000, "client-a");
    expect(created.ok).toBe(true);
    manager.setReady("socket-a", true, 1050);
    const started = manager.startRoom("socket-a", 1100);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const player = started.room.players["client-a"];
    player.score = 2;
    manager.setInput("socket-a", { seq: 5, roll: 1 });

    const changed = manager.disconnectSocket("socket-a", 1200);
    expect(changed[0]?.players["client-a"]).toBeDefined();
    expect(manager.getRoom("RECON")?.players["client-a"].score).toBe(2);
    expect(manager.getRoom("RECON")?.players["client-a"].input.roll).toBe(0);

    const rejoined = manager.joinRoom("RECON", "socket-b", "Host", 1300, "client-a");
    expect(rejoined.ok).toBe(true);
    if (!rejoined.ok) return;
    expect(rejoined.playerId).toBe("client-a");
    expect(rejoined.room.players["client-a"].score).toBe(2);

    manager.setInput("socket-b", { seq: 6, roll: -1 });
    expect(manager.getRoom("RECON")?.players["client-a"].lastInputSeq).toBe(0);
    manager.tickRooms(1333);
    expect(manager.getRoom("RECON")?.players["client-a"].lastInputSeq).toBe(6);
  });

  it("expires disconnected players after the reconnect grace window", () => {
    const manager = new GameRoomManager(ids("EXPRY"));
    manager.createRoom("host-socket", "Host", 1000, "host-client");
    manager.joinRoom("EXPRY", "guest-socket", "Guest", 1000, "guest-client");

    manager.disconnectSocket("host-socket", 1100);
    expect(manager.getRoom("EXPRY")?.players["host-client"]).toBeDefined();
    expect(manager.getRoom("EXPRY")?.hostId).toBe("host-client");

    manager.tickRooms(1100 + DISCONNECT_GRACE_MS - 1);
    expect(manager.getRoom("EXPRY")?.players["host-client"]).toBeDefined();

    const cleanup = manager.tickRooms(1100 + DISCONNECT_GRACE_MS);
    expect(manager.getRoom("EXPRY")?.players["host-client"]).toBeUndefined();
    expect(manager.getRoom("EXPRY")?.hostId).toBe("guest-client");
    expect(cleanup[0]?.room.id).toBe("EXPRY");
  });

  it("accepts input only for active players in active rounds", () => {
    const manager = new GameRoomManager(ids("INPUT"));
    manager.createRoom("host", "Host");
    manager.joinRoom("INPUT", "guest", "Guest");
    manager.setInput("host", { seq: 1, thrust: 1 });
    expect(manager.getRoom("INPUT")?.players.host.lastInputSeq).toBe(0);

    manager.setReady("host", true);
    manager.setReady("guest", true);
    manager.startRoom("host");
    manager.setInput("host", { seq: 1, thrust: 1 });
    expect(manager.getRoom("INPUT")?.players.host.lastInputSeq).toBe(0);
    manager.tickRooms();
    expect(manager.getRoom("INPUT")?.players.host.lastInputSeq).toBe(1);
  });

  it("stores sanitized latency for connected players", () => {
    const manager = new GameRoomManager(ids("PING1"));
    const created = manager.createRoom("socket-a", "Host", 1000, "client-a");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const room = manager.setLatency("socket-a", 87.6, 120.4, 1100);

    expect(room?.players["client-a"].latencyMs).toBe(88);
    expect(room?.now).toBe(1100);
    expect(manager.setLatency("missing", 44)).toBeUndefined();
    expect(normalizeLatencyMs(-10)).toBe(0);
    expect(normalizeLatencyMs(12_000)).toBe(9999);
    expect(normalizeLatencyMs(Number.NaN)).toBe(0);
    expect(normalizeInterpolationDelayMs(120.4)).toBe(120);
    expect(normalizeInterpolationDelayMs(9999)).toBe(250);
    expect(normalizeInterpolationDelayMs(Number.NaN)).toBe(0);
  });

  it("processes normal queued inputs in order", () => {
    const manager = new GameRoomManager(ids("QUEUE"));
    manager.createRoom("host", "Host", 1000);
    manager.setReady("host", true, 1050);
    manager.startRoom("host", 1100);

    manager.setInput("host", { seq: 1, roll: 1 });
    manager.setInput("host", { seq: 2, roll: -1 });
    expect(manager.getRoom("QUEUE")?.players.host.lastInputSeq).toBe(0);

    manager.tickRooms(1133);
    expect(manager.getRoom("QUEUE")?.players.host.lastInputSeq).toBe(1);
    expect(manager.getRoom("QUEUE")?.players.host.input.roll).toBe(1);

    manager.tickRooms(1166);
    expect(manager.getRoom("QUEUE")?.players.host.lastInputSeq).toBe(2);
    expect(manager.getRoom("QUEUE")?.players.host.input.roll).toBe(-1);

    manager.setInput("host", { seq: 1, roll: 0 });
    manager.tickRooms(1199);
    expect(manager.getRoom("QUEUE")?.players.host.lastInputSeq).toBe(2);
    expect(manager.getRoom("QUEUE")?.players.host.input.roll).toBe(-1);
  });

  it("preserves queued one-shot fire inputs when collapsing input backlog", () => {
    const manager = new GameRoomManager(ids("FIREQ"));
    manager.createRoom("host", "Host", 1000);
    manager.setReady("host", true, 1050);
    manager.startRoom("host", 1100);
    const host = manager.getRoom("FIREQ")?.players.host;
    if (host) {
      host.spawnProtectionUntil = undefined;
      host.spawnProtectionRemainingMs = 0;
    }

    manager.setInput("host", { seq: 1, fireGun: true });
    manager.setInput("host", { seq: 2, fireGun: false });
    const results = manager.tickRooms(1133);

    expect(manager.getRoom("FIREQ")?.players.host.lastInputSeq).toBe(1);
    expect(Object.values(manager.getRoom("FIREQ")?.projectiles ?? {}).filter((projectile) => projectile.type === "bullet")).toHaveLength(1);
    expect(results[0]?.events).toContainEqual({ type: "launch", roomId: "FIREQ", playerId: "host", weapon: "bullet" });

    manager.tickRooms(1166);
    expect(manager.getRoom("FIREQ")?.players.host.lastInputSeq).toBe(2);
  });
});
