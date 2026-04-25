import { describe, expect, it } from "vitest";
import { MAX_PLAYERS } from "../../src/shared/constants.js";
import { GameRoomManager } from "../../src/server/gameServer.js";

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

  it("lets the host launch a sandbox round without guest readiness", () => {
    const manager = new GameRoomManager(ids("READY"));
    const created = manager.createRoom("host", "Host", 1000);
    expect(created.ok).toBe(true);
    manager.joinRoom("READY", "guest", "Guest", 1000);

    const started = manager.startRoom("host", 1100);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.room.phase).toBe("playing");
    expect(started.room.players.host.status).toBe("alive");
    expect(started.room.players.guest.status).toBe("alive");
  });

  it("lets the host launch solo and allows late joins into an active room", () => {
    const manager = new GameRoomManager(ids("DROP1"));
    const created = manager.createRoom("host", "Host", 1000);
    expect(created.ok).toBe(true);

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

  it("accepts input only for active players in active rounds", () => {
    const manager = new GameRoomManager(ids("INPUT"));
    manager.createRoom("host", "Host");
    manager.joinRoom("INPUT", "guest", "Guest");
    manager.setInput("host", { seq: 1, thrust: 1 });
    expect(manager.getRoom("INPUT")?.players.host.lastInputSeq).toBe(0);

    manager.startRoom("host");
    manager.setInput("host", { seq: 1, thrust: 1 });
    expect(manager.getRoom("INPUT")?.players.host.lastInputSeq).toBe(1);
  });
});
