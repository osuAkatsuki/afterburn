import { useEffect, useRef, useState } from "react";
import { DogfightScene, type FreeCameraPose, type SceneDebugStats } from "../game/DogfightScene.js";
import type { Vec3 } from "../../shared/types.js";

type TerrainQaState = {
  name: string;
  pose: FreeCameraPose;
  stats?: SceneDebugStats;
};

type CaptureSize = {
  width: number;
  height: number;
};

const DEFAULT_POSE: FreeCameraPose = {
  position: { x: 0, y: 980, z: -1800 },
  target: { x: -220, y: 180, z: -140 }
};

declare global {
  interface Window {
    __afterburnTerrainQa?: {
      setPose: (pose: FreeCameraPose) => void;
      getStats: () => SceneDebugStats | undefined;
    };
  }
}

export function TerrainQaCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<DogfightScene | null>(null);
  const statsRef = useRef<SceneDebugStats | undefined>(undefined);
  const poseRef = useRef<FreeCameraPose>(parseTerrainQaPose(window.location.search));
  const captureSize = parseCaptureSize(window.location.search);
  const captureStyle = captureSize ? { width: `${captureSize.width}px`, height: `${captureSize.height}px` } : undefined;
  const [state, setState] = useState<TerrainQaState>(() => {
    return {
      name: new URLSearchParams(window.location.search).get("qaName") ?? "terrain-qa",
      pose: poseRef.current
    };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const scene = new DogfightScene(canvas, null);
    let frame = 0;
    let lastStatsAt = 0;
    sceneRef.current = scene;
    scene.setFreeCameraPose(poseRef.current);
    for (let i = 0; i < 4; i += 1) {
      scene.render(performance.now() + i * 16);
    }
    statsRef.current = scene.getDebugStats();

    window.__afterburnTerrainQa = {
      setPose: (pose) => {
        poseRef.current = pose;
        scene.setFreeCameraPose(pose);
        setState((current) => ({ ...current, pose }));
      },
      getStats: () => statsRef.current
    };

    const animate = (now: number) => {
      scene.render(now);
      if (now - lastStatsAt >= 250) {
        const stats = scene.getDebugStats();
        statsRef.current = stats;
        setState((current) => ({ ...current, stats }));
        lastStatsAt = now;
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frame);
      scene.destroy();
      sceneRef.current = null;
      delete window.__afterburnTerrainQa;
    };
  }, []);

  return (
    <div className="terrain-qa-shell" style={captureStyle}>
      <canvas className="viewport" ref={canvasRef} style={captureStyle} />
      {new URLSearchParams(window.location.search).get("overlay") !== "0" && (
        <aside className="terrain-qa-overlay">
          <strong>{state.name}</strong>
          <span>
            pos {formatVec(state.pose.position)} / target {formatVec(state.pose.target)}
          </span>
          {state.stats && (
            <span>
              {state.stats.triangles.toLocaleString()} tris / {state.stats.drawCalls} calls / {state.stats.objects} objects
            </span>
          )}
        </aside>
      )}
    </div>
  );
}

function parseTerrainQaPose(search: string): FreeCameraPose {
  const params = new URLSearchParams(search);
  return {
    position: parseVec3(params.get("camera"), DEFAULT_POSE.position),
    target: parseVec3(params.get("target"), DEFAULT_POSE.target)
  };
}

function parseCaptureSize(search: string): CaptureSize | undefined {
  const params = new URLSearchParams(search);
  const width = Number(params.get("captureWidth"));
  const height = Number(params.get("captureHeight"));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }

  return { width, height };
}

function parseVec3(value: string | null, fallback: Vec3): Vec3 {
  if (!value) {
    return fallback;
  }

  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return fallback;
  }

  return { x: parts[0], y: parts[1], z: parts[2] };
}

function formatVec(vec: Vec3): string {
  return `${Math.round(vec.x)},${Math.round(vec.y)},${Math.round(vec.z)}`;
}
