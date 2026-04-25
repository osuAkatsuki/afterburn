import { describe, expect, it } from "vitest";
import { addPlayerToRoom, createPlayer, createRoomState } from "../../src/shared/simulation.js";
import type { RoomState, StateSnapshotPayload } from "../../src/shared/types.js";
import { SNAPSHOT_INTERPOLATION_DELAY_MS, SnapshotBuffer } from "../../src/client/net/SnapshotBuffer.js";

function makeRoom(localX: number, remoteZ: number): RoomState {
  const room = createRoomState("NET01", "local", 1000);
  const local = createPlayer("local", "Local", 0, 1000);
  const remote = createPlayer("remote", "Remote", 1, 1000);
  local.position = { x: localX, y: 100, z: 0 };
  remote.position = { x: 0, y: 100, z: remoteZ };
  addPlayerToRoom(room, local);
  addPlayerToRoom(room, remote);
  return room;
}

function snapshot(tick: number, room: RoomState): StateSnapshotPayload {
  return {
    tick,
    sentAt: 1000 + tick,
    room
  };
}

describe("SnapshotBuffer", () => {
  it("interpolates remote state while keeping the local player on the newest snapshot", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshot(1, makeRoom(0, 0)), 0);
    buffer.push(snapshot(2, makeRoom(100, 100)), 50);

    const sampled = buffer.sample(SNAPSHOT_INTERPOLATION_DELAY_MS + 25, "local");

    expect(sampled?.players.remote.position.z).toBeCloseTo(50);
    expect(sampled?.players.local.position.x).toBe(100);
  });

  it("uses the newest snapshot when render time outruns the buffer", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshot(1, makeRoom(0, 0)), 0);
    buffer.push(snapshot(2, makeRoom(100, 100)), 50);

    const sampled = buffer.sample(SNAPSHOT_INTERPOLATION_DELAY_MS + 500, "local");

    expect(sampled?.players.remote.position.z).toBe(100);
    expect(sampled?.players.local.position.x).toBe(100);
  });

  it("interpolates on server send time instead of jittered receive time when clock offset is known", () => {
    const buffer = new SnapshotBuffer();
    buffer.push({ ...snapshot(1, makeRoom(0, 0)), sentAt: 1000 }, 100, 900);
    buffer.push({ ...snapshot(2, makeRoom(100, 100)), sentAt: 1050 }, 220, 900);

    const sampled = buffer.sample(SNAPSHOT_INTERPOLATION_DELAY_MS + 125, "local");

    expect(sampled?.players.remote.position.z).toBeCloseTo(50);
    expect(buffer.getBufferedMs(SNAPSHOT_INTERPOLATION_DELAY_MS + 125)).toBeCloseTo(25);
    expect(buffer.getLatestServerAgeMs(180)).toBeCloseTo(30);
  });
});
