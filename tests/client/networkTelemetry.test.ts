import { describe, expect, it } from "vitest";
import { NetworkTelemetry, createPingPayload } from "../../src/client/net/NetworkTelemetry.js";
import { createRoomState } from "../../src/shared/simulation.js";

describe("NetworkTelemetry", () => {
  it("tracks reconnect count after the first connection", () => {
    const telemetry = new NetworkTelemetry();

    expect(telemetry.hasConnected()).toBe(false);
    expect(telemetry.recordConnect().reconnects).toBe(0);
    expect(telemetry.hasConnected()).toBe(true);
    expect(telemetry.recordConnect().reconnects).toBe(1);
  });

  it("estimates clock offset and transport delay from pong and snapshots", () => {
    const telemetry = new NetworkTelemetry();

    const clockStats = telemetry.recordPong({ clientTime: 100, serverTime: 1100 }, 200);
    expect(clockStats.rttMs).toBe(100);
    expect(clockStats.serverClockOffsetMs).toBe(950);
    expect(clockStats.serverClockSamples).toBe(1);

    const room = createRoomState("NET01", "p1", 1000);
    const snapshotStats = telemetry.recordSnapshot({ tick: 1, sentAt: 1150, room }, 230);
    expect(snapshotStats.transportDelayMs).toBe(30);
    expect(snapshotStats.lastSnapshotAt).toBe(230);
  });

  it("computes snapshot rate and receive jitter from server send intervals", () => {
    const telemetry = new NetworkTelemetry();
    const room = createRoomState("NET02", "p1", 1000);

    telemetry.recordSnapshot({ tick: 1, sentAt: 1000, room }, 100);
    const stats = telemetry.recordSnapshot({ tick: 2, sentAt: 1033, room }, 150);

    expect(stats.snapshotHz).toBeCloseTo(1000 / 33);
    expect(stats.snapshotJitterMs).toBeCloseTo(2.55);
  });

  it("creates net ping payloads from the current client clock", () => {
    expect(createPingPayload(1234)).toEqual({ clientTime: 1234 });
  });
});
