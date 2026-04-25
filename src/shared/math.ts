import type { Rotation, Vec3 } from "./types.js";

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
