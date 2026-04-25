import { useEffect, useRef, type RefObject } from "react";
import type { InputFrame, RoomState } from "../../shared/types.js";

type UseFlightInputOptions = {
  room?: RoomState;
  playerId: string;
  sendInput: (input: InputFrame) => void;
  setScoreboardVisible: (visible: boolean) => void;
};

export function useFlightInput({ room, playerId, sendInput, setScoreboardVisible }: UseFlightInputOptions): void {
  const keys = useRef(new Set<string>());
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isGameKey(event.code)) {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();
      keys.current.add(event.code);
      if (event.code === "Tab") {
        setScoreboardVisible(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!isGameKey(event.code)) {
        return;
      }

      keys.current.delete(event.code);
      if (isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();
      if (event.code === "Tab") {
        setScoreboardVisible(false);
      }
    };
    const clearKeys = () => {
      keys.current.clear();
      setScoreboardVisible(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearKeys);

    let frame = 0;
    const tick = (now: number) => {
      const currentRoom = roomRef.current;
      const currentPlayerId = playerIdRef.current;
      if (currentRoom?.phase === "playing" && currentPlayerId && now - lastInputSent.current >= 1000 / 30) {
        lastInputSent.current = now;
        seq.current += 1;
        sendInputRef.current({
          seq: seq.current,
          thrust: 0,
          pitch: axis("KeyS", "KeyW", keys.current) || axis("ArrowUp", "ArrowDown", keys.current) || axis("KeyI", "KeyK", keys.current),
          yaw: axis("ArrowLeft", "ArrowRight", keys.current) || axis("KeyJ", "KeyL", keys.current),
          roll: axis("KeyA", "KeyD", keys.current),
          fireGun: keys.current.has("Space"),
          fireMissile: keys.current.has("KeyE"),
          fireFlare: keys.current.has("KeyF"),
          afterburner: keys.current.has("ShiftLeft") || keys.current.has("ShiftRight"),
          timestamp: now
        });
      }

      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearKeys);
    };
  }, [setScoreboardVisible]);
}

function axis(positiveKey: string, negativeKey: string, keys: Set<string>): number {
  return (keys.has(positiveKey) ? 1 : 0) + (keys.has(negativeKey) ? -1 : 0);
}

function isGameKey(code: string): boolean {
  return (
    code === "KeyW" ||
    code === "KeyA" ||
    code === "KeyS" ||
    code === "KeyD" ||
    code === "KeyI" ||
    code === "KeyJ" ||
    code === "KeyK" ||
    code === "KeyL" ||
    code === "KeyE" ||
    code === "KeyF" ||
    code === "Space" ||
    code === "Tab" ||
    code === "ArrowUp" ||
    code === "ArrowDown" ||
    code === "ArrowLeft" ||
    code === "ArrowRight" ||
    code === "ShiftLeft" ||
    code === "ShiftRight"
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || target.matches("input, textarea, select");
}
