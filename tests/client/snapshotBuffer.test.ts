import { describe, expect, it } from "vitest";
import { addPlayerToRoom, createPlayer, createRoomState } from "../../src/shared/simulation.js";
import type { RoomState, StateSnapshotPayload } from "../../src/shared/types.js";
import {
  getSnapshotInterpolationDelayMs,
  MAX_SNAPSHOT_INTERPOLATION_DELAY_MS,
  SNAPSHOT_INTERPOLATION_DELAY_MS,
  SnapshotBuffer
} from "../../src/client/net/SnapshotBuffer.js";

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

  it("uses a configured interpolation delay for remote state", () => {
    const buffer = new SnapshotBuffer();
    buffer.setInterpolationDelay(150);
    buffer.push({ ...snapshot(1, makeRoom(0, 0)), sentAt: 1000 }, 100, 1000);
    buffer.push({ ...snapshot(2, makeRoom(100, 100)), sentAt: 1100 }, 220, 1000);

    const sampled = buffer.sample(200, "local");

    expect(buffer.getInterpolationDelayMs()).toBe(150);
    expect(sampled?.players.remote.position.z).toBeCloseTo(50);
  });

  it("sizes interpolation delay from measured transport and jitter", () => {
    expect(
      getSnapshotInterpolationDelayMs({
        serverClockSamples: 0,
        snapshotHz: 0,
        snapshotJitterMs: 0,
        transportDelayMs: 0
      })
    ).toBe(SNAPSHOT_INTERPOLATION_DELAY_MS);

    expect(
      getSnapshotInterpolationDelayMs({
        serverClockSamples: 8,
        snapshotHz: 30,
        snapshotJitterMs: 20,
        transportDelayMs: 75
      })
    ).toBe(167);

    expect(
      getSnapshotInterpolationDelayMs({
        serverClockSamples: 8,
        snapshotHz: 20,
        snapshotJitterMs: 80,
        transportDelayMs: 180
      })
    ).toBe(MAX_SNAPSHOT_INTERPOLATION_DELAY_MS);
  });
});
