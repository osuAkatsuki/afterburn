import { describe, expect, it } from "vitest";
import { createPlayer, createRoomState } from "../../src/shared/simulation.js";
import { NetworkCapture } from "../../src/client/net/NetworkCapture.js";
import type { ClientDebugStats } from "../../src/client/components/GameCanvas.js";
import type { NetworkStats } from "../../src/client/net/NetworkTelemetry.js";

describe("NetworkCapture", () => {
  it("records debug/network samples and exports JSON", () => {
    const capture = new NetworkCapture();
    const room = createRoomState("QA001", "p1", 1000);
    room.players.p1 = createPlayer("p1", "Pilot", 0, 1000);

    expect(capture.start("regional", 1000)).toMatchObject({ recording: true, samples: 0 });
    const summary = capture.record({
      nowMs: 1250,
      room,
      playerId: "p1",
      networkStats: networkStats(),
      debugStats: debugStats()
    });

    expect(summary).toMatchObject({ recording: true, samples: 1, durationMs: 250 });
    capture.stop(1500);

    const data = capture.exportData(1500);
    expect(data.label).toBe("regional");
    expect(data.sampleCount).toBe(1);
    expect(data.samples[0]).toMatchObject({
      roomId: "QA001",
      playerId: "p1",
      network: { rttMs: 82 },
      prediction: { correctionEvents: 3 },
      server: { historySamples: 4, historyClampedSamples: 1 }
    });
    expect(JSON.parse(capture.exportJson()).sampleCount).toBe(1);
  });
});

function networkStats(): NetworkStats {
  return {
    rttMs: 82,
    serverClockOffsetMs: 0,
    serverClockSamples: 1,
    snapshotHz: 30,
    snapshotJitterMs: 3.5,
    lastSnapshotAt: 1200,
    transportDelayMs: 42,
    snapshotBytes: 2048,
    reconnects: 0,
    serverDebug: {
      historySamples: 4,
      historyClampedSamples: 1,
      players: {
        p1: {
          combatRewindMs: 151,
          inputQueued: 2,
          inputDropped: 1,
          inputConsumed: 9
        }
      }
    }
  };
}

function debugStats(): ClientDebugStats {
  return {
    fps: 120,
    frameMs: 8,
    worstFrameMs: 12,
    frameSpikeCount: 0,
    frameSpikeMs: 0,
    frameSpikeAgeMs: 0,
    frameSpikeIntervalMs: 0,
    snapshotServerAgeMs: 100,
    snapshotDelayMs: 110,
    snapshotBufferMs: 40,
    pendingInputs: 3,
    ackSeq: 20,
    ackDelta: 1,
    ackAgeMs: 5,
    ackIntervalMs: 33,
    predictedMs: 100,
    predictionLeadMeters: 18,
    correctionMeters: 0.5,
    correctionLastMeters: 1.5,
    correctionAgeMs: 10,
    correctionIntervalMs: 1200,
    correctionEvents: 3,
    drawCalls: 30,
    triangles: 12000,
    lines: 8,
    points: 0,
    objects: 200,
    geometries: 120,
    textures: 1,
    width: 1280,
    height: 720,
    pixelRatio: 2,
    jets: 2,
    projectiles: 1,
    smokePuffs: 4,
    explosions: 0,
    waterGlints: 32
  };
}
