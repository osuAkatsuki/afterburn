import type { InputFrame, RoomState, StateSnapshotPayload } from "../../shared/types.js";
import { LocalPredictionBuffer } from "./LocalPredictionBuffer.js";
import { SnapshotBuffer } from "./SnapshotBuffer.js";

export type ClientWorldDebugStats = {
  snapshotBufferMs: number;
  snapshotDelayMs: number;
  snapshotServerAgeMs: number;
  pendingInputs: number;
  predictedMs: number;
  predictionLeadMeters: number;
  correctionMeters: number;
  correctionLastMeters: number;
  correctionAgeMs: number;
  correctionIntervalMs: number;
  correctionEvents: number;
  ackSeq: number;
  ackDelta: number;
  ackAgeMs: number;
  ackIntervalMs: number;
};

export class ClientWorldPresenter {
  private readonly snapshotBuffer = new SnapshotBuffer();
  private readonly localPrediction = new LocalPredictionBuffer();

  setServerClockOffset(serverClockOffsetMs?: number): void {
    this.snapshotBuffer.setServerClockOffset(serverClockOffsetMs);
  }

  setInterpolationDelay(delayMs: number): void {
    this.snapshotBuffer.setInterpolationDelay(delayMs);
  }

  setSnapshot(snapshot?: StateSnapshotPayload): void {
    if (snapshot) {
      this.snapshotBuffer.push(snapshot);
    } else {
      this.snapshotBuffer.clear();
    }
  }

  recordInput(input: InputFrame): void {
    this.localPrediction.recordInput(input);
  }

  clearPrediction(): void {
    this.localPrediction.clear();
  }

  sampleRoom(renderTime: number, localPlayerId: string): RoomState | undefined {
    return this.localPrediction.apply(this.snapshotBuffer.sample(renderTime, localPlayerId), localPlayerId, renderTime);
  }

  getDebugStats(renderTime: number): ClientWorldDebugStats {
    const predictionStats = this.localPrediction.getStats();
    return {
      snapshotBufferMs: this.snapshotBuffer.getBufferedMs(renderTime),
      snapshotDelayMs: this.snapshotBuffer.getInterpolationDelayMs(),
      snapshotServerAgeMs: this.snapshotBuffer.getLatestServerAgeMs(renderTime),
      pendingInputs: predictionStats.pendingInputs,
      predictedMs: predictionStats.predictedMs,
      predictionLeadMeters: predictionStats.leadMeters,
      correctionMeters: predictionStats.correctionMeters,
      correctionLastMeters: predictionStats.correctionLastMeters,
      correctionAgeMs: predictionStats.correctionAgeMs,
      correctionIntervalMs: predictionStats.correctionIntervalMs,
      correctionEvents: predictionStats.correctionEvents,
      ackSeq: predictionStats.ackSeq,
      ackDelta: predictionStats.ackDelta,
      ackAgeMs: predictionStats.ackAgeMs,
      ackIntervalMs: predictionStats.ackIntervalMs
    };
  }
}
