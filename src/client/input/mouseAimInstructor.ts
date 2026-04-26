import { applyQuaternion, clamp, dot, normalize } from "../../shared/math.js";
import type { Quaternion, Vec3 } from "../../shared/types.js";

export type MouseAimPoint = {
  x: number;
  y: number;
  screenX?: number;
  screenY?: number;
};

export type FlightAxes = {
  pitch: number;
  yaw: number;
  roll: number;
};

const AIM_DEADZONE = 0.035;
const ROLL_GAIN = 2.15;
const PITCH_GAIN = 1.35;
const YAW_GAIN = 0.035;
const RUDDER_LIMIT = 0.06;

export function computeMouseAimInstructorAxes(aim: MouseAimPoint, currentRoll: number): FlightAxes {
  const aimX = applyDeadzone(aim.x);
  const aimY = applyDeadzone(aim.y);
  return axesFromLocalTarget({ x: aimX, y: -aimY, z: 1 });
}

export function computeMouseAimInstructorAxesFromDirection(targetDirection: Vec3, orientation: Quaternion, currentRoll: number): FlightAxes {
  const target = normalize(targetDirection);
  const localTarget = localDirection(target, orientation);
  const axes = axesFromLocalTarget(localTarget);

  return {
    pitch: normalizeAxis(axes.pitch),
    yaw: normalizeAxis(axes.yaw),
    roll: normalizeAxis(axes.roll)
  };
}

export function isNeutralMouseAim(aim: MouseAimPoint): boolean {
  return Math.abs(aim.x) < AIM_DEADZONE && Math.abs(aim.y) < AIM_DEADZONE;
}

function axesFromLocalTarget(localTarget: Vec3): FlightAxes {
  const forward = Math.max(0.08, localTarget.z);
  const yawError = Math.atan2(localTarget.x, forward);
  const pitchError = Math.atan2(localTarget.y, forward);

  return {
    pitch: normalizeAxis(clamp(pitchError * PITCH_GAIN, -1, 1)),
    yaw: normalizeAxis(clamp(yawError * YAW_GAIN, -RUDDER_LIMIT, RUDDER_LIMIT)),
    roll: normalizeAxis(clamp(-yawError * ROLL_GAIN, -1, 1))
  };
}

function localDirection(target: Vec3, orientation: Quaternion): Vec3 {
  const forward = normalize(applyQuaternion({ x: 0, y: 0, z: 1 }, orientation));
  const right = normalize(applyQuaternion({ x: 1, y: 0, z: 0 }, orientation));
  const up = normalize(applyQuaternion({ x: 0, y: 1, z: 0 }, orientation));
  return {
    x: dot(target, right),
    y: dot(target, up),
    z: dot(target, forward)
  };
}

function applyDeadzone(value: number): number {
  return Math.abs(value) < AIM_DEADZONE ? 0 : value;
}

function normalizeAxis(value: number): number {
  return Math.abs(value) < 0.00001 ? 0 : value;
}
