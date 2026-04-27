import type { RoomNetworkDebugStats, RoomState, Vec3 } from "../../shared/types.js";
import type { ClientDebugStats } from "../components/GameCanvas.js";
import type { NetworkStats } from "./NetworkTelemetry.js";

export type NetworkCaptureSummary = {
  label: string;
  recording: boolean;
  samples: number;
  durationMs: number;
  startedAt?: string;
  stoppedAt?: string;
};

export type NetworkCaptureSample = {
  index: number;
  timeMs: number;
  elapsedMs: number;
  roomId?: string;
  phase?: RoomState["phase"];
  playerId?: string;
  localStatus?: string;
  localPosition?: Vec3;
  localVelocity?: Vec3;
  frame?: {
    fps: number;
    frameMs: number;
    worstFrameMs: number;
    frameSpikeCount: number;
    frameSpikeMs: number;
    frameSpikeIntervalMs: number;
  };
  network: {
    rttMs: number;
    snapshotHz: number;
    snapshotJitterMs: number;
    receiveAgeMs: number;
    transportDelayMs: number;
    snapshotBytes: number;
    reconnects: number;
  };
  interpolation?: {
    serverAgeMs: number;
    delayMs: number;
    bufferAheadMs: number;
  };
  prediction?: {
    predictedMs: number;
    leadMeters: number;
    correctionMeters: number;
    correctionLastMeters: number;
    correctionAgeMs: number;
    correctionIntervalMs: number;
    correctionEvents: number;
    pendingInputs: number;
    ackSeq: number;
    ackDelta: number;
    ackAgeMs: number;
    ackIntervalMs: number;
  };
  server?: {
    historySamples: number;
    historyClampedSamples: number;
    localPlayer?: RoomNetworkDebugStats["players"][string];
  };
};

export type NetworkCaptureData = Omit<NetworkCaptureSummary, "samples"> & {
  version: 1;
  exportedAt: string;
  sampleCount: number;
  samples: NetworkCaptureSample[];
};

export type NetworkCaptureRecordInput = {
  nowMs?: number;
  room?: RoomState;
  playerId?: string;
  networkStats: NetworkStats;
  debugStats?: ClientDebugStats;
};

export class NetworkCapture {
  private label = "manual";
  private recording = false;
  private startedAtMs = 0;
  private stoppedAtMs = 0;
  private startedAtIso?: string;
  private stoppedAtIso?: string;
  private readonly samples: NetworkCaptureSample[] = [];

  start(label = "manual", nowMs = performance.now()): NetworkCaptureSummary {
    this.label = label.trim() || "manual";
    this.recording = true;
    this.startedAtMs = nowMs;
    this.stoppedAtMs = 0;
    this.startedAtIso = new Date().toISOString();
    this.stoppedAtIso = undefined;
    this.samples.length = 0;
    return this.getSummary(nowMs);
  }

  stop(nowMs = performance.now()): NetworkCaptureSummary {
    if (this.recording) {
      this.stoppedAtMs = nowMs;
      this.stoppedAtIso = new Date().toISOString();
    }
    this.recording = false;
    return this.getSummary(nowMs);
  }

  clear(nowMs = performance.now()): NetworkCaptureSummary {
    this.samples.length = 0;
    this.stoppedAtMs = this.recording ? 0 : nowMs;
    this.stoppedAtIso = this.recording ? undefined : new Date().toISOString();
    return this.getSummary(nowMs);
  }

  record(input: NetworkCaptureRecordInput): NetworkCaptureSummary | undefined {
    if (!this.recording) {
      return undefined;
    }

    const nowMs = input.nowMs ?? performance.now();
    this.samples.push(createSample(input, this.samples.length, nowMs, Math.max(0, nowMs - this.startedAtMs)));
    return this.getSummary(nowMs);
  }

  getSummary(nowMs = performance.now()): NetworkCaptureSummary {
    const endMs = this.recording ? nowMs : this.stoppedAtMs || this.startedAtMs;
    return {
      label: this.label,
      recording: this.recording,
      samples: this.samples.length,
      durationMs: Math.max(0, endMs - this.startedAtMs),
      startedAt: this.startedAtIso,
      stoppedAt: this.stoppedAtIso
    };
  }

  exportData(nowMs = performance.now()): NetworkCaptureData {
    const summary = this.getSummary(nowMs);
    return {
      ...summary,
      version: 1,
      exportedAt: new Date().toISOString(),
      sampleCount: summary.samples,
      samples: this.samples.map((sample) => ({ ...sample }))
    };
  }

  exportJson(space = 2): string {
    return JSON.stringify(this.exportData(), null, space);
  }
}

function createSample(input: NetworkCaptureRecordInput, index: number, nowMs: number, elapsedMs: number): NetworkCaptureSample {
  const localPlayer = input.playerId && input.room ? input.room.players[input.playerId] : undefined;
  const receiveAgeMs = input.networkStats.lastSnapshotAt > 0 ? Math.max(0, nowMs - input.networkStats.lastSnapshotAt) : 0;
  const localServerDebug = input.playerId ? input.networkStats.serverDebug?.players[input.playerId] : undefined;

  return {
    index,
    timeMs: nowMs,
    elapsedMs,
    roomId: input.room?.id,
    phase: input.room?.phase,
    playerId: input.playerId,
    localStatus: localPlayer?.status,
    localPosition: localPlayer ? { ...localPlayer.position } : undefined,
    localVelocity: localPlayer ? { ...localPlayer.velocity } : undefined,
    frame: input.debugStats
      ? {
          fps: input.debugStats.fps,
          frameMs: input.debugStats.frameMs,
          worstFrameMs: input.debugStats.worstFrameMs,
          frameSpikeCount: input.debugStats.frameSpikeCount,
          frameSpikeMs: input.debugStats.frameSpikeMs,
          frameSpikeIntervalMs: input.debugStats.frameSpikeIntervalMs
        }
      : undefined,
    network: {
      rttMs: input.networkStats.rttMs,
      snapshotHz: input.networkStats.snapshotHz,
      snapshotJitterMs: input.networkStats.snapshotJitterMs,
      receiveAgeMs,
      transportDelayMs: input.networkStats.transportDelayMs,
      snapshotBytes: input.networkStats.snapshotBytes,
      reconnects: input.networkStats.reconnects
    },
    interpolation: input.debugStats
      ? {
          serverAgeMs: input.debugStats.snapshotServerAgeMs,
          delayMs: input.debugStats.snapshotDelayMs,
          bufferAheadMs: input.debugStats.snapshotBufferMs
        }
      : undefined,
    prediction: input.debugStats
      ? {
          predictedMs: input.debugStats.predictedMs,
          leadMeters: input.debugStats.predictionLeadMeters,
          correctionMeters: input.debugStats.correctionMeters,
          correctionLastMeters: input.debugStats.correctionLastMeters,
          correctionAgeMs: input.debugStats.correctionAgeMs,
          correctionIntervalMs: input.debugStats.correctionIntervalMs,
          correctionEvents: input.debugStats.correctionEvents,
          pendingInputs: input.debugStats.pendingInputs,
          ackSeq: input.debugStats.ackSeq,
          ackDelta: input.debugStats.ackDelta,
          ackAgeMs: input.debugStats.ackAgeMs,
          ackIntervalMs: input.debugStats.ackIntervalMs
        }
      : undefined,
    server: input.networkStats.serverDebug
      ? {
          historySamples: input.networkStats.serverDebug.historySamples,
          historyClampedSamples: input.networkStats.serverDebug.historyClampedSamples,
          localPlayer: localServerDebug ? { ...localServerDebug } : undefined
        }
      : undefined
  };
}
