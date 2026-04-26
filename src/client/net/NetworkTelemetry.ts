import type { NetPingPayload, NetPongPayload, StateSnapshotPayload } from "../../shared/types.js";

export type NetworkStats = {
  rttMs: number;
  serverClockOffsetMs: number;
  serverClockSamples: number;
  snapshotHz: number;
  snapshotJitterMs: number;
  lastSnapshotAt: number;
  transportDelayMs: number;
  snapshotBytes: number;
  reconnects: number;
};

export const PING_INTERVAL_MS = 1000;

const INITIAL_NETWORK_STATS: NetworkStats = {
  rttMs: 0,
  serverClockOffsetMs: 0,
  serverClockSamples: 0,
  snapshotHz: 0,
  snapshotJitterMs: 0,
  lastSnapshotAt: 0,
  transportDelayMs: 0,
  snapshotBytes: 0,
  reconnects: 0
};

export class NetworkTelemetry {
  private stats: NetworkStats = { ...INITIAL_NETWORK_STATS };
  private previousSnapshotAt = 0;
  private previousSnapshotSentAt = 0;
  private snapshotIntervalMs = 0;
  private serverClockOffsetMs?: number;
  private serverClockSamples = 0;
  private connectCount = 0;

  hasConnected(): boolean {
    return this.connectCount > 0;
  }

  recordConnect(): NetworkStats {
    this.connectCount += 1;
    this.stats = {
      ...this.stats,
      reconnects: Math.max(0, this.connectCount - 1)
    };
    return this.getStats();
  }

  recordSnapshot(payload: StateSnapshotPayload, receivedAt = performance.now()): NetworkStats {
    const previous = this.previousSnapshotAt;
    const previousSentAt = this.previousSnapshotSentAt;
    this.previousSnapshotAt = receivedAt;
    this.previousSnapshotSentAt = payload.sentAt;
    const sentAtLocal = toClientTimeline(payload.sentAt, receivedAt, this.serverClockOffsetMs);
    const transportDelayMs = Math.max(0, receivedAt - sentAtLocal);
    const snapshotBytes = payload.tick % 15 === 0 || this.stats.snapshotBytes <= 0 ? estimateSnapshotBytes(payload) : this.stats.snapshotBytes;

    if (previous <= 0) {
      this.stats = {
        ...this.stats,
        lastSnapshotAt: receivedAt,
        transportDelayMs,
        snapshotBytes
      };
      return this.getStats();
    }

    const receiveInterval = receivedAt - previous;
    const serverInterval = previousSentAt > 0 ? Math.max(1, payload.sentAt - previousSentAt) : receiveInterval;
    const smoothedInterval = this.snapshotIntervalMs > 0 ? this.snapshotIntervalMs * 0.85 + serverInterval * 0.15 : serverInterval;
    const jitter = Math.abs(receiveInterval - serverInterval);
    this.snapshotIntervalMs = smoothedInterval;

    this.stats = {
      ...this.stats,
      snapshotHz: smoothedInterval > 0 ? 1000 / smoothedInterval : 0,
      snapshotJitterMs: this.stats.snapshotJitterMs * 0.85 + jitter * 0.15,
      lastSnapshotAt: receivedAt,
      transportDelayMs: this.stats.transportDelayMs > 0 ? this.stats.transportDelayMs * 0.85 + transportDelayMs * 0.15 : transportDelayMs,
      snapshotBytes: this.stats.snapshotBytes > 0 ? this.stats.snapshotBytes * 0.85 + snapshotBytes * 0.15 : snapshotBytes
    };
    return this.getStats();
  }

  recordPong(payload: NetPongPayload, receivedAt = performance.now()): NetworkStats {
    const rttMs = Math.max(0, receivedAt - payload.clientTime);
    const estimatedServerAtReceive = payload.serverTime + rttMs / 2;
    const sampledOffset = estimatedServerAtReceive - receivedAt;
    const nextOffset = this.serverClockOffsetMs === undefined ? sampledOffset : this.serverClockOffsetMs * 0.9 + sampledOffset * 0.1;
    this.serverClockOffsetMs = nextOffset;
    this.serverClockSamples += 1;

    this.stats = {
      ...this.stats,
      rttMs,
      serverClockOffsetMs: nextOffset,
      serverClockSamples: this.serverClockSamples
    };
    return this.getStats();
  }

  getStats(): NetworkStats {
    return { ...this.stats };
  }
}

export function createPingPayload(now = performance.now()): NetPingPayload {
  return { clientTime: now };
}

function toClientTimeline(serverTime: number, fallbackClientTime: number, serverClockOffsetMs?: number): number {
  if (serverClockOffsetMs === undefined || !Number.isFinite(serverClockOffsetMs)) {
    return fallbackClientTime;
  }

  return serverTime - serverClockOffsetMs;
}

function estimateSnapshotBytes(payload: StateSnapshotPayload): number {
  try {
    return JSON.stringify(payload).length;
  } catch {
    return 0;
  }
}
