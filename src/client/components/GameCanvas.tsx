import { useEffect, useRef, type RefObject } from "react";
import type { RoomState } from "../../shared/types.js";
import { DogfightScene, type SceneDebugStats } from "../game/DogfightScene.js";

export type ClientDebugStats = SceneDebugStats & {
  fps: number;
  frameMs: number;
  worstFrameMs: number;
};

type GameCanvasProps = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  reticleRef: RefObject<HTMLDivElement | null>;
  sceneRef: RefObject<DogfightScene | null>;
  room?: RoomState;
  playerId: string;
  debugEnabled: boolean;
  onDebugStats: (stats: ClientDebugStats) => void;
};

export function GameCanvas({ canvasRef, reticleRef, sceneRef, room, playerId, debugEnabled, onDebugStats }: GameCanvasProps) {
  const debugEnabledRef = useRef(debugEnabled);
  const onDebugStatsRef = useRef(onDebugStats);

  useEffect(() => {
    debugEnabledRef.current = debugEnabled;
    onDebugStatsRef.current = onDebugStats;
  }, [debugEnabled, onDebugStats]);

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
    let lastStatsAt = 0;
    sceneRef.current = scene;

    const animate = (now: number) => {
      const frameMs = Math.max(0, now - previousNow);
      previousNow = now;
      totalFrameMs += frameMs;
      worstFrameMs = Math.max(worstFrameMs, frameMs);
      statSampleCount += 1;

      scene.render(now);

      if (debugEnabledRef.current && now - lastStatsAt >= 250 && statSampleCount > 0) {
        const averageFrameMs = totalFrameMs / statSampleCount;
        onDebugStatsRef.current({
          ...scene.getDebugStats(),
          fps: averageFrameMs > 0 ? 1000 / averageFrameMs : 0,
          frameMs: averageFrameMs,
          worstFrameMs
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

  useEffect(() => {
    if (room) {
      sceneRef.current?.updateState(room, playerId);
    }
  }, [playerId, room, sceneRef]);

  return <canvas className="viewport" ref={canvasRef} />;
}
