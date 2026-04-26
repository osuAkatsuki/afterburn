import { clamp, lerp } from "./math.js";

export function valueNoise2D(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const x1 = x0 + 1;
  const z1 = z0 + 1;
  const tx = smoothstep(x - x0);
  const tz = smoothstep(z - z0);

  const a = hash2D(x0, z0, seed);
  const b = hash2D(x1, z0, seed);
  const c = hash2D(x0, z1, seed);
  const d = hash2D(x1, z1, seed);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz) * 2 - 1;
}

export function fbm2D(x: number, z: number, seed: number, octaves: number, lacunarity = 2, gain = 0.5): number {
  let amplitude = 0.5;
  let frequency = 1;
  let value = 0;
  let amplitudeSum = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    value += valueNoise2D(x * frequency, z * frequency, seed + octave * 1013) * amplitude;
    amplitudeSum += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  return amplitudeSum > 0 ? clamp(value / amplitudeSum, -1, 1) : 0;
}

export function ridgedNoise2D(x: number, z: number, seed: number, octaves: number): number {
  let amplitude = 0.58;
  let frequency = 1;
  let value = 0;
  let amplitudeSum = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    const ridge = 1 - Math.abs(valueNoise2D(x * frequency, z * frequency, seed + octave * 2039));
    value += ridge * ridge * amplitude;
    amplitudeSum += amplitude;
    amplitude *= 0.48;
    frequency *= 2.05;
  }

  return amplitudeSum > 0 ? clamp(value / amplitudeSum, 0, 1) : 0;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function hash2D(x: number, z: number, seed: number): number {
  let hash = seed | 0;
  hash ^= Math.imul(x, 374761393);
  hash ^= Math.imul(z, 668265263);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967295;
}
