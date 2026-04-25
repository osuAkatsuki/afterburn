import { useEffect, useRef, type RefObject } from "react";
import { clamp } from "../../shared/math.js";
import type { InputFrame, RoomState } from "../../shared/types.js";

type UseFlightInputOptions = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  room?: RoomState;
  playerId: string;
  sendInput: (input: InputFrame) => void;
  setScoreboardVisible: (visible: boolean) => void;
};

export function useFlightInput({ canvasRef, room, playerId, sendInput, setScoreboardVisible }: UseFlightInputOptions): void {
  const keys = useRef(new Set<string>());
  const aim = useRef({ x: 0, y: 0 });
  const mouse = useRef({ primary: false, secondary: false });
  const seq = useRef(0);
  const lastInputSent = useRef(0);
  const roomRef = useRef(room);
  const playerIdRef = useRef(playerId);
  const sendInputRef = useRef(sendInput);

  useEffect(() => {
    roomRef.current = room;
    playerIdRef.current = playerId;
    sendInputRef.current = sendInput;
  }, [playerId, room, sendInput]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      keys.current.add(event.code);
      if (event.code === "Tab") {
        event.preventDefault();
        setScoreboardVisible(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keys.current.delete(event.code);
      if (event.code === "Tab") {
        setScoreboardVisible(false);
      }
    };
    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement === canvas) {
        aim.current.x = clamp(aim.current.x + event.movementX / 90, -1, 1);
        aim.current.y = clamp(aim.current.y + event.movementY / 90, -1, 1);
        return;
      }

      aim.current.x = clamp((event.clientX / window.innerWidth - 0.5) * 2.2, -1, 1);
      aim.current.y = clamp((event.clientY / window.innerHeight - 0.5) * 2.2, -1, 1);
    };
    const onMouseDown = (event: MouseEvent) => {
      if (roomRef.current?.phase === "playing") {
        void canvas.requestPointerLock();
      }

      if (event.button === 0) {
        mouse.current.primary = true;
      }
      if (event.button === 2) {
        mouse.current.secondary = true;
      }
    };
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 0) {
        mouse.current.primary = false;
      }
      if (event.button === 2) {
        mouse.current.secondary = false;
      }
    };
    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("contextmenu", onContextMenu);

    let frame = 0;
    const tick = (now: number) => {
      const currentRoom = roomRef.current;
      const currentPlayerId = playerIdRef.current;
      if (currentRoom?.phase === "playing" && currentPlayerId && now - lastInputSent.current >= 1000 / 30) {
        lastInputSent.current = now;
        seq.current += 1;
        sendInputRef.current({
          seq: seq.current,
          thrust: (keys.current.has("KeyW") ? 1 : 0) + (keys.current.has("KeyS") ? -1 : 0),
          pitch: clamp(-aim.current.y, -1, 1),
          yaw: clamp(-aim.current.x, -1, 1),
          roll: (keys.current.has("KeyD") ? 1 : 0) + (keys.current.has("KeyA") ? -1 : 0),
          fireGun: mouse.current.primary || keys.current.has("Space"),
          fireMissile: mouse.current.secondary || keys.current.has("KeyE"),
          afterburner: keys.current.has("ShiftLeft") || keys.current.has("ShiftRight"),
          timestamp: now
        });

        if (document.pointerLockElement === canvas) {
          aim.current.x *= 0.92;
          aim.current.y *= 0.92;
        }
      }

      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("contextmenu", onContextMenu);
    };
  }, [canvasRef, setScoreboardVisible]);
}
