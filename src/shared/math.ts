import type { Quaternion, Rotation, Vec3 } from "./types.js";

export const ZERO_VEC3: Vec3 = { x: 0, y: 0, z: 0 };

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(v: Vec3, scalar: number): Vec3 {
  return { x: v.x * scalar, y: v.y * scalar, z: v.z * scalar };
}

export function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function distance(a: Vec3, b: Vec3): number {
  return length(subtract(a, b));
}

export function normalize(v: Vec3): Vec3 {
  const magnitude = length(v);
  if (magnitude <= 0.00001) {
    return { ...ZERO_VEC3 };
  }

  return scale(v, 1 / magnitude);
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

export function horizontalLength(v: Vec3): number {
  return Math.hypot(v.x, v.z);
}

export function forwardVector(rotation: Rotation): Vec3 {
  const cosPitch = Math.cos(rotation.pitch);

  return normalize({
    x: Math.sin(rotation.yaw) * cosPitch,
    y: Math.sin(rotation.pitch),
    z: Math.cos(rotation.yaw) * cosPitch
  });
}

export function sanitizeAxis(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return clamp(value, -1, 1);
}

export function sanitizeBoolean(value: unknown): boolean {
  return value === true;
}

export function wrapAngle(value: number): number {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

export function lerpAngle(from: number, to: number, t: number): number {
  return from + wrapAngle(to - from) * clamp(t, 0, 1);
}

export function cloneVec3(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

export function quaternionFromAxisAngle(axis: Vec3, angle: number): Quaternion {
  const normalized = normalize(axis);
  const half = angle / 2;
  const s = Math.sin(half);

  return normalizeQuaternion({
    x: normalized.x * s,
    y: normalized.y * s,
    z: normalized.z * s,
    w: Math.cos(half)
  });
}

export function multiplyQuaternions(a: Quaternion, b: Quaternion): Quaternion {
  return normalizeQuaternion({
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
  });
}

export function normalizeQuaternion(q: Quaternion): Quaternion {
  const magnitude = Math.hypot(q.x, q.y, q.z, q.w);
  if (magnitude <= 0.00001) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }

  return {
    x: q.x / magnitude,
    y: q.y / magnitude,
    z: q.z / magnitude,
    w: q.w / magnitude
  };
}

export function applyQuaternion(v: Vec3, q: Quaternion): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);

  return {
    x: v.x + q.w * tx + q.y * tz - q.z * ty,
    y: v.y + q.w * ty + q.z * tx - q.x * tz,
    z: v.z + q.w * tz + q.x * ty - q.y * tx
  };
}

export function quaternionFromRotation(rotation: Rotation): Quaternion {
  const yaw = quaternionFromAxisAngle({ x: 0, y: 1, z: 0 }, rotation.yaw);
  const pitch = quaternionFromAxisAngle({ x: 1, y: 0, z: 0 }, -rotation.pitch);
  const roll = quaternionFromAxisAngle({ x: 0, y: 0, z: 1 }, -rotation.roll);

  return multiplyQuaternions(yaw, multiplyQuaternions(pitch, roll));
}

export function rotationFromQuaternion(q: Quaternion): Rotation {
  const forward = normalize(applyQuaternion({ x: 0, y: 0, z: 1 }, q));
  const up = normalize(applyQuaternion({ x: 0, y: 1, z: 0 }, q));
  const pitch = Math.asin(clamp(forward.y, -1, 1));
  const yaw = Math.atan2(forward.x, forward.z);
  const horizonRight = normalize(cross({ x: 0, y: 1, z: 0 }, forward));

  if (length(horizonRight) <= 0.00001) {
    return { pitch, yaw, roll: 0 };
  }

  const horizonUp = normalize(cross(forward, horizonRight));
  const signedRoll = Math.atan2(dot(cross(horizonUp, up), forward), dot(horizonUp, up));

  return { pitch, yaw, roll: wrapAngle(-signedRoll) };
}
