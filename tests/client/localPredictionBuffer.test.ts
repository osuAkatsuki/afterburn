import { describe, expect, it } from "vitest";
import { TICK_RATE } from "../../src/shared/constants.js";
import { addPlayerToRoom, createPlayer, createRoomState, startRound } from "../../src/shared/simulation.js";
import type { InputFrame } from "../../src/shared/types.js";
import { LocalPredictionBuffer } from "../../src/client/net/LocalPredictionBuffer.js";

function input(seq: number, values: Partial<InputFrame> = {}): InputFrame {
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
    timestamp: 1000 + seq * (1000 / TICK_RATE),
    ...values
  };
}

describe("LocalPredictionBuffer", () => {
  it("replays unacknowledged local inputs on top of authoritative state", () => {
    const room = createRoomState("PRED1", "p1", 1000);
    addPlayerToRoom(room, createPlayer("p1", "Local", 0, 1000));
    startRound(room, 1000);
    room.players.p1.lastInputSeq = 1;

    const buffer = new LocalPredictionBuffer();
    buffer.recordInput(input(1, { roll: 1 }));
    buffer.recordInput(input(2, { roll: 1 }));
    buffer.recordInput(input(3, { roll: 1, afterburner: true }));

    const before = room.players.p1.position.z;
    const predicted = buffer.apply(room, "p1");

    expect(predicted?.players.p1.position.z).not.toBeCloseTo(before);
    expect(predicted?.players.p1.rotation.roll).toBeGreaterThan(0);
    expect(buffer.getStats().pendingInputs).toBe(2);
    expect(buffer.getStats().predictedMs).toBeCloseTo(2 * (1000 / TICK_RATE));
    expect(buffer.getStats().leadMeters).toBeGreaterThan(0);
  });

  it("drops acknowledged inputs after reconciliation", () => {
    const room = createRoomState("PRED2", "p1", 1000);
    addPlayerToRoom(room, createPlayer("p1", "Local", 0, 1000));
    startRound(room, 1000);

    const buffer = new LocalPredictionBuffer();
    buffer.recordInput(input(1, { pitch: 1 }));
    buffer.recordInput(input(2, { pitch: 1 }));

    room.players.p1.lastInputSeq = 2;
    buffer.apply(room, "p1");

    expect(buffer.getStats().pendingInputs).toBe(0);
    expect(buffer.getStats().leadMeters).toBe(0);
  });
});
