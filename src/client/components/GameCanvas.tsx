import { useEffect, type RefObject } from "react";
import type { RoomState } from "../../shared/types.js";
import { DogfightScene } from "../game/DogfightScene.js";

type GameCanvasProps = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  reticleRef: RefObject<HTMLDivElement | null>;
  sceneRef: RefObject<DogfightScene | null>;
  room?: RoomState;
  playerId: string;
};

export function GameCanvas({ canvasRef, reticleRef, sceneRef, room, playerId }: GameCanvasProps) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const scene = new DogfightScene(canvas, reticleRef.current);
    let frame = 0;
    sceneRef.current = scene;

    const animate = (now: number) => {
      scene.render(now);
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
