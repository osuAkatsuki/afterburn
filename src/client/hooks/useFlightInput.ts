import { useEffect, useRef } from "react";
import { clamp } from "../../shared/math.js";
import type { InputFrame, RoomState, Vec3 } from "../../shared/types.js";
import { computeMouseAimInstructorAxes, type FlightAxes, type MouseAimPoint } from "../input/mouseAimInstructor.js";

type UseFlightInputOptions = {
  room?: RoomState;
  playerId: string;
  sendInput: (input: InputFrame) => void;
  onLocalInput?: (input: InputFrame) => void;
  onCameraLook?: (look: CameraLookInput) => void;
  getMouseAimAxes?: (aim: MouseAimPoint) => FlightAxes | undefined;
  getMouseAimDirection?: (aim: MouseAimPoint) => Vec3 | undefined;
  setScoreboardVisible: (visible: boolean) => void;
};

export type CameraLookInput = {
  active: boolean;
  yaw: number;
  pitch: number;
};

const MOUSE_AIM_RANGE_X = 0.5;
const MOUSE_AIM_RANGE_Y = 0.5;
const FREE_LOOK_SENSITIVITY = 0.0032;
const FREE_LOOK_MAX_YAW = Math.PI * 0.86;
const FREE_LOOK_MAX_PITCH = Math.PI * 0.36;

export function useFlightInput({
  room,
  playerId,
  sendInput,
  onLocalInput,
  onCameraLook,
  getMouseAimAxes,
  getMouseAimDirection,
  setScoreboardVisible
}: UseFlightInputOptions): void {
  const keys = useRef(new Set<string>());
  const mouseButtons = useRef({ left: false });
  const mouseAim = useRef<MouseAimPoint>({ x: 0, y: 0 });
  const freeLook = useRef<CameraLookInput>({ active: false, yaw: 0, pitch: 0 });
  const seq = useRef(0);
  const nextInputAt = useRef(0);
  const roomRef = useRef(room);
  const playerIdRef = useRef(playerId);
  const sendInputRef = useRef(sendInput);
  const onLocalInputRef = useRef(onLocalInput);
  const onCameraLookRef = useRef(onCameraLook);
  const getMouseAimAxesRef = useRef(getMouseAimAxes);
  const getMouseAimDirectionRef = useRef(getMouseAimDirection);

  useEffect(() => {
    roomRef.current = room;
    playerIdRef.current = playerId;
    sendInputRef.current = sendInput;
    onLocalInputRef.current = onLocalInput;
    onCameraLookRef.current = onCameraLook;
    getMouseAimAxesRef.current = getMouseAimAxes;
    getMouseAimDirectionRef.current = getMouseAimDirection;
  }, [getMouseAimAxes, getMouseAimDirection, onCameraLook, onLocalInput, playerId, room, sendInput]);

  useEffect(() => {
    updateMouseAimMarker(mouseAim.current);

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
      mouseButtons.current.left = false;
      freeLook.current = { active: false, yaw: 0, pitch: 0 };
      onCameraLookRef.current?.(freeLook.current);
      setScoreboardVisible(false);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      const currentRoom = roomRef.current;
      if (currentRoom?.phase !== "playing") {
        return;
      }

      if (freeLook.current.active) {
        freeLook.current = {
          active: true,
          yaw: clamp(freeLook.current.yaw - event.movementX * FREE_LOOK_SENSITIVITY, -FREE_LOOK_MAX_YAW, FREE_LOOK_MAX_YAW),
          pitch: clamp(freeLook.current.pitch - event.movementY * FREE_LOOK_SENSITIVITY, -FREE_LOOK_MAX_PITCH, FREE_LOOK_MAX_PITCH)
        };
        onCameraLookRef.current?.(freeLook.current);
        return;
      }

      mouseAim.current = document.pointerLockElement
        ? pointerAimFromMovement(mouseAim.current, event)
        : pointerAimFromPointerPosition(event);
      updateMouseAimMarker(mouseAim.current);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      if (roomRef.current?.phase === "playing") {
        requestPointerLock(event.target);
      }

      if (event.button === 0) {
        mouseButtons.current.left = true;
        event.preventDefault();
      }

      if (event.button === 2) {
        freeLook.current = { ...freeLook.current, active: true };
        onCameraLookRef.current?.(freeLook.current);
        event.preventDefault();
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.button === 0) {
        mouseButtons.current.left = false;
        event.preventDefault();
      }

      if (event.button === 2) {
        freeLook.current = { active: false, yaw: 0, pitch: 0 };
        onCameraLookRef.current?.(freeLook.current);
        event.preventDefault();
      }
    };
    const onContextMenu = (event: MouseEvent) => {
      if (!isEditableTarget(event.target) && roomRef.current?.phase === "playing") {
        event.preventDefault();
      }
    };
    const onPointerLockChange = () => {
      if (document.pointerLockElement) {
        return;
      }

      if (freeLook.current.active) {
        freeLook.current = { active: false, yaw: 0, pitch: 0 };
        onCameraLookRef.current?.(freeLook.current);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("blur", clearKeys);
    document.addEventListener("pointerlockchange", onPointerLockChange);

    let frame = 0;
    const inputIntervalMs = 1000 / 30;
    const tick = (now: number) => {
      const currentRoom = roomRef.current;
      const currentPlayerId = playerIdRef.current;
      if (currentRoom?.phase === "playing" && currentPlayerId && now >= nextInputAt.current) {
        if (nextInputAt.current <= 0 || now - nextInputAt.current > inputIntervalMs * 4) {
          nextInputAt.current = now;
        }

        nextInputAt.current += inputIntervalMs;
        seq.current += 1;
        const localPlayer = currentRoom.players[currentPlayerId];
        const mouseAxes = freeLook.current.active
          ? { pitch: 0, yaw: 0, roll: 0 }
          : (getMouseAimAxesRef.current?.(mouseAim.current) ??
            computeMouseAimInstructorAxes(mouseAim.current, localPlayer?.rotation.roll ?? 0));
        const keyboardPitch = axis("KeyS", "KeyW", keys.current) || axis("ArrowUp", "ArrowDown", keys.current) || axis("KeyI", "KeyK", keys.current);
        const keyboardYaw = axis("ArrowLeft", "ArrowRight", keys.current) || axis("KeyJ", "KeyL", keys.current);
        const keyboardRoll = axis("KeyA", "KeyD", keys.current);
        const aimDirection = freeLook.current.active ? undefined : getMouseAimDirectionRef.current?.(mouseAim.current);
        const input: InputFrame = {
          seq: seq.current,
          thrust: 0,
          pitch: keyboardPitch || mouseAxes.pitch,
          yaw: keyboardYaw || mouseAxes.yaw,
          roll: keyboardRoll || mouseAxes.roll,
          fireGun: keys.current.has("Space") || mouseButtons.current.left,
          fireMissile: keys.current.has("KeyE"),
          fireFlare: keys.current.has("KeyF"),
          afterburner: keys.current.has("ShiftLeft") || keys.current.has("ShiftRight"),
          aimDirection,
          timestamp: now
        };
        onLocalInputRef.current?.(input);
        sendInputRef.current(input);
      } else if (currentRoom?.phase !== "playing") {
        nextInputAt.current = 0;
        if (document.pointerLockElement) {
          void document.exitPointerLock();
        }
      }

      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("blur", clearKeys);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      if (document.pointerLockElement) {
        void document.exitPointerLock();
      }
      document.documentElement.style.removeProperty("--mouse-aim-x");
      document.documentElement.style.removeProperty("--mouse-aim-y");
    };
  }, [setScoreboardVisible]);
}

function pointerAimFromPointerPosition(event: PointerEvent): MouseAimPoint {
  return pointerAimFromScreenPosition(event.clientX, event.clientY);
}

function pointerAimFromMovement(current: MouseAimPoint, event: PointerEvent): MouseAimPoint {
  const rangeX = Math.max(1, window.innerWidth * MOUSE_AIM_RANGE_X);
  const rangeY = Math.max(1, window.innerHeight * MOUSE_AIM_RANGE_Y);
  const currentScreenX = current.screenX ?? window.innerWidth / 2 + current.x * rangeX;
  const currentScreenY = current.screenY ?? window.innerHeight / 2 + current.y * rangeY;
  return pointerAimFromScreenPosition(currentScreenX + event.movementX, currentScreenY + event.movementY);
}

function pointerAimFromScreenPosition(screenX: number, screenY: number): MouseAimPoint {
  const rangeX = Math.max(1, window.innerWidth * MOUSE_AIM_RANGE_X);
  const rangeY = Math.max(1, window.innerHeight * MOUSE_AIM_RANGE_Y);
  const x = clamp((screenX - window.innerWidth / 2) / rangeX, -1, 1);
  const y = clamp((screenY - window.innerHeight / 2) / rangeY, -1, 1);
  return {
    x,
    y,
    screenX: window.innerWidth / 2 + x * rangeX,
    screenY: window.innerHeight / 2 + y * rangeY
  };
}

function updateMouseAimMarker(aim: MouseAimPoint): void {
  document.documentElement.style.setProperty(
    "--mouse-aim-x",
    `${aim.screenX ?? window.innerWidth / 2 + aim.x * window.innerWidth * MOUSE_AIM_RANGE_X}px`
  );
  document.documentElement.style.setProperty(
    "--mouse-aim-y",
    `${aim.screenY ?? window.innerHeight / 2 + aim.y * window.innerHeight * MOUSE_AIM_RANGE_Y}px`
  );
}

function requestPointerLock(target: EventTarget | null): void {
  if (document.pointerLockElement || !(target instanceof HTMLElement)) {
    return;
  }

  try {
    void target.requestPointerLock();
  } catch {
    // Pointer lock can be blocked by the browser when not triggered from a direct gesture.
  }
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
