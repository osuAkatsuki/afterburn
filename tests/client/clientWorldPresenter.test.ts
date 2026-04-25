import { describe, expect, it } from "vitest";
import { ClientWorldPresenter } from "../../src/client/net/ClientWorldPresenter.js";
import { addPlayerToRoom, createPlayer, createRoomState } from "../../src/shared/simulation.js";
import type { InputFrame, RoomState } from "../../src/shared/types.js";

function input(seq: number, timestamp: number, values: Partial<InputFrame> = {}): InputFrame {
  return {
    seq,
    thrust: 0,
    pitch: 0,
    yaw: 0,
    roll: 0,
    fireGun: false,
    fireMissile: false,
    fireFlare: false,
    afterburner: false,
    timestamp,
    ...values
  };
}

function room(localX: number, remoteZ: number): RoomState {
  const state = createRoomState("VIEW1", "local", 1000);
  const local = createPlayer("local", "Local", 0, 1000);
  const remote = createPlayer("remote", "Remote", 1, 1000);
  state.phase = "playing";
  local.status = "alive";
  remote.status = "alive";
  local.position = { x: localX, y: 100, z: 0 };
  remote.position = { x: 0, y: 100, z: remoteZ };
  addPlayerToRoom(state, local);
  addPlayerToRoom(state, remote);
  return state;
}

describe("ClientWorldPresenter", () => {
  it("samples remote snapshots and keeps local prediction stats together", () => {
    const presenter = new ClientWorldPresenter();
    presenter.setInterpolationDelay(150);
    presenter.setServerClockOffset(1000);
    presenter.setSnapshot({ tick: 1, sentAt: 1000, room: room(0, 0) });
    presenter.setSnapshot({ tick: 2, sentAt: 1100, room: room(100, 100) });
    presenter.recordInput(input(1, 190, { pitch: 1 }));

    const sampled = presenter.sampleRoom(200, "local");
    const stats = presenter.getDebugStats(200);

    expect(sampled?.players.remote.position.z).toBeCloseTo(50);
    expect(stats.snapshotDelayMs).toBe(150);
    expect(stats.pendingInputs).toBe(1);
    expect(stats.predictedMs).toBeGreaterThan(0);
  });

  it("clears prediction independently from buffered snapshots", () => {
    const presenter = new ClientWorldPresenter();
    presenter.setSnapshot({ tick: 1, sentAt: 1000, room: room(0, 0) });
    presenter.recordInput(input(1, 1000, { roll: 1 }));
    presenter.sampleRoom(1100, "local");

    expect(presenter.getDebugStats(1100).pendingInputs).toBe(1);

    presenter.clearPrediction();
    presenter.sampleRoom(1100, "local");

    expect(presenter.getDebugStats(1100).pendingInputs).toBe(0);
  });
});
