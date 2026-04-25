import { describe, expect, it } from "vitest";
import { TICK_RATE } from "../../src/shared/constants.js";
import { addPlayerToRoom, applyPlayerFlightStep, createPlayer, createRoomState, startRound } from "../../src/shared/simulation.js";
import type { InputFrame, RoomState } from "../../src/shared/types.js";
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
  function predictionRoom(id: string): RoomState {
    const room = createRoomState(id, "p1", 1000);
    addPlayerToRoom(room, createPlayer("p1", "Local", 0, 1000));
    startRound(room, 1000);
    return room;
  }

  it("replays unacknowledged local inputs on top of authoritative state", () => {
    const room = predictionRoom("PRED1");
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
    const room = predictionRoom("PRED2");

    const buffer = new LocalPredictionBuffer();
    buffer.recordInput(input(1, { pitch: 1 }));
    buffer.recordInput(input(2, { pitch: 1 }));

    room.players.p1.lastInputSeq = 2;
    buffer.apply(room, "p1");

    expect(buffer.getStats().pendingInputs).toBe(0);
    expect(buffer.getStats().leadMeters).toBe(0);
  });

  it("smooths small authoritative corrections instead of snapping the local render target", () => {
    const buffer = new LocalPredictionBuffer();
    const first = predictionRoom("PRED3");
    first.players.p1.position = { x: 0, y: 200, z: 0 };
    buffer.apply(first, "p1", 1000);

    const corrected = predictionRoom("PRED3");
    corrected.players.p1.position = { x: 30, y: 200, z: 0 };
    const sampled = buffer.apply(corrected, "p1", 1016);

    expect(buffer.getStats().correctionMeters).toBeGreaterThan(0);
    expect(buffer.getStats().correctionMeters).toBeLessThan(30);
    expect(sampled?.players.p1.position.x).toBeGreaterThan(0);
    expect(sampled?.players.p1.position.x).toBeLessThan(30);
  });

  it("does not smooth locally predicted input movement", () => {
    const buffer = new LocalPredictionBuffer();
    const first = predictionRoom("PRED4");
    buffer.apply(first, "p1", 1000);

    const localInput = input(1, { pitch: 1, afterburner: true });
    buffer.recordInput(localInput);

    const next = predictionRoom("PRED4");
    const expectedPlayer = structuredClone(next.players.p1);
    applyPlayerFlightStep(expectedPlayer, localInput, 0.016);

    const predicted = buffer.apply(next, "p1", 1016);

    expect(buffer.getStats().correctionMeters).toBe(0);
    expect(predicted?.players.p1.position.z).toBeCloseTo(expectedPlayer.position.z);
    expect(predicted?.players.p1.rotation.pitch).toBeCloseTo(expectedPlayer.rotation.pitch);
  });

  it("continues predicting local motion between network input ticks", () => {
    const buffer = new LocalPredictionBuffer();
    const first = predictionRoom("PRED5");
    buffer.apply(first, "p1", 1000);

    const localInput = input(1, { pitch: 1, afterburner: true });
    buffer.recordInput(localInput);

    const expectedPlayer = structuredClone(first.players.p1);
    applyPlayerFlightStep(expectedPlayer, localInput, 0.016);
    const predicted = buffer.apply(predictionRoom("PRED5"), "p1", 1016);

    applyPlayerFlightStep(expectedPlayer, localInput, 0.008);
    const continued = buffer.apply(predictionRoom("PRED5"), "p1", 1024);

    expect(continued?.players.p1.position.z).not.toBeCloseTo(predicted?.players.p1.position.z ?? 0);
    expect(continued?.players.p1.position.z).toBeCloseTo(expectedPlayer.position.z);
    expect(continued?.players.p1.rotation.pitch).toBeCloseTo(expectedPlayer.rotation.pitch);
  });
});
