import { describe, expect, it } from "vitest";
import { RoomHistory } from "../../src/server/net/RoomHistory.js";
import { addPlayerToRoom, createPlayer, createRoomState } from "../../src/shared/simulation.js";

describe("RoomHistory", () => {
  it("samples player state between recorded server frames", () => {
    const history = new RoomHistory(1000);
    const room = createRoomState("HIST1", "p1", 1000);
    const player = createPlayer("p1", "Pilot", 0, 1000);
    addPlayerToRoom(room, player);

    player.status = "alive";
    player.position = { x: 0, y: 100, z: 0 };
    player.velocity = { x: 10, y: 0, z: 0 };
    history.record(room, 1, 1000);

    player.position = { x: 100, y: 200, z: 50 };
    player.velocity = { x: 20, y: 0, z: 10 };
    history.record(room, 2, 1100);

    const sample = history.samplePlayer("HIST1", "p1", 1050);

    expect(sample?.position).toEqual({ x: 50, y: 150, z: 25 });
    expect(sample?.velocity).toEqual({ x: 15, y: 0, z: 5 });
    expect(sample?.clamped).toBe(false);
  });

  it("retains only the configured history window and clamps old samples", () => {
    const history = new RoomHistory(100);
    const room = createRoomState("HIST2", "p1", 1000);
    const player = createPlayer("p1", "Pilot", 0, 1000);
    addPlayerToRoom(room, player);

    player.status = "alive";
    player.position = { x: 0, y: 100, z: 0 };
    history.record(room, 1, 1000);

    player.position = { x: 100, y: 100, z: 0 };
    history.record(room, 2, 1200);

    const sample = history.samplePlayer("HIST2", "p1", 1000);

    expect(sample?.position.x).toBe(100);
    expect(sample?.clamped).toBe(true);
  });
});
