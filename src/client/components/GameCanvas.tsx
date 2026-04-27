import { useEffect, useRef, type RefObject } from "react";
import { DogfightScene, type SceneDebugStats } from "../game/DogfightScene.js";
import type { ClientWorldDebugStats, ClientWorldPresenter } from "../net/ClientWorldPresenter.js";

export type ClientDebugStats = SceneDebugStats & ClientWorldDebugStats & {
  fps: number;
  frameMs: number;
  worstFrameMs: number;
  frameSpikeCount: number;
  frameSpikeMs: number;
  frameSpikeAgeMs: number;
  frameSpikeIntervalMs: number;
};

type GameCanvasProps = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  reticleRef: RefObject<HTMLDivElement | null>;
  targetOverlayRef: RefObject<HTMLDivElement | null>;
  sceneRef: RefObject<DogfightScene | null>;
  worldPresenterRef: RefObject<ClientWorldPresenter>;
  playerId: string;
  debugEnabled: boolean;
  onDebugStats: (stats: ClientDebugStats) => void;
};

export function GameCanvas({
  canvasRef,
  reticleRef,
  targetOverlayRef,
  sceneRef,
  worldPresenterRef,
  playerId,
  debugEnabled,
  onDebugStats
}: GameCanvasProps) {
  const debugEnabledRef = useRef(debugEnabled);
  const onDebugStatsRef = useRef(onDebugStats);
  const playerIdRef = useRef(playerId);

  useEffect(() => {
    debugEnabledRef.current = debugEnabled;
    onDebugStatsRef.current = onDebugStats;
    playerIdRef.current = playerId;
  }, [debugEnabled, onDebugStats, playerId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const scene = new DogfightScene(canvas, reticleRef.current, targetOverlayRef.current);
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

      const sampledRoom = worldPresenterRef.current.sampleRoom(now, playerIdRef.current);
      if (sampledRoom) {
        scene.updateState(sampledRoom, playerIdRef.current);
      }
      scene.render(now);

      if (debugEnabledRef.current && now - lastStatsAt >= 250 && statSampleCount > 0) {
        const averageFrameMs = totalFrameMs / statSampleCount;
        onDebugStatsRef.current({
          ...scene.getDebugStats(),
          ...worldPresenterRef.current.getDebugStats(now),
          fps: averageFrameMs > 0 ? 1000 / averageFrameMs : 0,
          frameMs: averageFrameMs,
          worstFrameMs,
          frameSpikeCount,
          frameSpikeMs,
          frameSpikeAgeMs: frameSpikeAt > 0 ? now - frameSpikeAt : 0,
          frameSpikeIntervalMs
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
  }, [canvasRef, reticleRef, sceneRef, targetOverlayRef, worldPresenterRef]);

  return <canvas className="viewport" ref={canvasRef} />;
}
