import { useEffect, useRef, type RefObject } from "react";
import type { StateSnapshotPayload } from "../../shared/types.js";
import { DogfightScene, type SceneDebugStats } from "../game/DogfightScene.js";
import type { LocalPredictionBuffer } from "../net/LocalPredictionBuffer.js";
import { SnapshotBuffer, SNAPSHOT_INTERPOLATION_DELAY_MS } from "../net/SnapshotBuffer.js";

export type ClientDebugStats = SceneDebugStats & {
  fps: number;
  frameMs: number;
  worstFrameMs: number;
  frameSpikeCount: number;
  frameSpikeMs: number;
  frameSpikeAgeMs: number;
  frameSpikeIntervalMs: number;
  snapshotBufferMs: number;
  snapshotDelayMs: number;
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

type GameCanvasProps = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  reticleRef: RefObject<HTMLDivElement | null>;
  sceneRef: RefObject<DogfightScene | null>;
  localPredictionRef: RefObject<LocalPredictionBuffer>;
  snapshot?: StateSnapshotPayload;
  playerId: string;
  debugEnabled: boolean;
  onDebugStats: (stats: ClientDebugStats) => void;
};

export function GameCanvas({ canvasRef, reticleRef, sceneRef, localPredictionRef, snapshot, playerId, debugEnabled, onDebugStats }: GameCanvasProps) {
  const debugEnabledRef = useRef(debugEnabled);
  const onDebugStatsRef = useRef(onDebugStats);
  const playerIdRef = useRef(playerId);
  const snapshotBufferRef = useRef(new SnapshotBuffer());

  useEffect(() => {
    debugEnabledRef.current = debugEnabled;
    onDebugStatsRef.current = onDebugStats;
    playerIdRef.current = playerId;
  }, [debugEnabled, onDebugStats, playerId]);

  useEffect(() => {
    if (snapshot) {
      snapshotBufferRef.current.push(snapshot);
    } else {
      snapshotBufferRef.current.clear();
    }
  }, [snapshot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const scene = new DogfightScene(canvas, reticleRef.current);
    let frame = 0;
    let previousNow = performance.now();
    let statSampleCount = 0;
    let totalFrameMs = 0;
    let worstFrameMs = 0;
    let frameSpikeCount = 0;
    let frameSpikeMs = 0;
    let frameSpikeAt = 0;
    let frameSpikeIntervalMs = 0;
    let lastStatsAt = 0;
    sceneRef.current = scene;

    const animate = (now: number) => {
      const frameMs = Math.max(0, now - previousNow);
      previousNow = now;
      totalFrameMs += frameMs;
      worstFrameMs = Math.max(worstFrameMs, frameMs);
      statSampleCount += 1;
      if (frameMs >= 24) {
        frameSpikeCount += 1;
        frameSpikeIntervalMs = frameSpikeAt > 0 ? now - frameSpikeAt : 0;
        frameSpikeAt = now;
        frameSpikeMs = frameMs;
      }

      const sampledRoom = localPredictionRef.current.apply(snapshotBufferRef.current.sample(now, playerIdRef.current), playerIdRef.current, now);
      if (sampledRoom) {
        scene.updateState(sampledRoom, playerIdRef.current);
      }
      scene.render(now);

      if (debugEnabledRef.current && now - lastStatsAt >= 250 && statSampleCount > 0) {
        const averageFrameMs = totalFrameMs / statSampleCount;
        const predictionStats = localPredictionRef.current.getStats();
        onDebugStatsRef.current({
          ...scene.getDebugStats(),
          fps: averageFrameMs > 0 ? 1000 / averageFrameMs : 0,
          frameMs: averageFrameMs,
          worstFrameMs,
          frameSpikeCount,
          frameSpikeMs,
          frameSpikeAgeMs: frameSpikeAt > 0 ? now - frameSpikeAt : 0,
          frameSpikeIntervalMs,
          snapshotBufferMs: snapshotBufferRef.current.getBufferedMs(now),
          snapshotDelayMs: SNAPSHOT_INTERPOLATION_DELAY_MS,
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
        });
        lastStatsAt = now;
        statSampleCount = 0;
        totalFrameMs = 0;
        worstFrameMs = 0;
      }

      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frame);
      scene.destroy();
      sceneRef.current = null;
    };
  }, [canvasRef, reticleRef, sceneRef]);

  return <canvas className="viewport" ref={canvasRef} />;
}
