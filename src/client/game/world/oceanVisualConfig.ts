export const OCEAN_VISUAL_CONFIG = {
  surface: {
    arenaScale: 5,
    subdivisions: 80,
    positionY: -1,
    material: {
      color: "#0b6f86",
      roughness: 0.34,
      metalness: 0.02,
      clearcoat: 0.38,
      clearcoatRoughness: 0.36,
      reflectivity: 0.24,
      emissive: "#063342",
      emissiveIntensity: 0.055
    },
    animatedRoughness: {
      frequency: 0.21,
      amplitude: 0.015
    },
    animatedClearcoat: {
      base: 0.36,
      frequency: 0.18,
      amplitude: 0.025
    },
    normalRecomputeFrames: 2
  },
  vertexColor: {
    deep: "#07586c",
    mid: "#0d7f92",
    shallow: "#139aac",
    baseMix: 0.48,
    nearShoreMix: 0.28,
    shallowShoreMix: 0.35,
    broadVariation: [
      { xFrequency: 0.0011, zFrequency: 0.0007, amplitude: 0.35 },
      { xFrequency: -0.0008, zFrequency: 0.0013, amplitude: 0.28 },
      { xFrequency: 0.00042, zFrequency: 0.00042, amplitude: 0.18 }
    ]
  },
  waves: [
    { xFrequency: 0.0048, localYFrequency: 0, timeFrequency: 0.72, amplitude: 1.9 },
    { xFrequency: 0.0036, localYFrequency: 0.0036, timeFrequency: 1.05, amplitude: 1.25 },
    { xFrequency: 0, localYFrequency: 0.0078, timeFrequency: -0.86, amplitude: 0.82 },
    { xFrequency: 0.018, localYFrequency: -0.011, timeFrequency: 2.15, amplitude: 0.28 },
    { xFrequency: 0.031, localYFrequency: 0.027, timeFrequency: -2.85, amplitude: 0.1 }
  ],
  shoreDamping: {
    outerScale: 1.34,
    fadeStart: 0.98,
    fadeEnd: 1.34
  },
  shoreFoam: {
    innerRadiusScale: 1.005,
    outerRadiusScale: 1.055,
    segments: 96,
    color: "#d9fbff",
    baseOpacity: 0.1,
    opacityAmplitude: 0.035,
    pulseAmplitude: 0.012,
    pulseFrequency: 1.35,
    opacityFrequency: 1.8,
    positionY: 0.18
  },
  waterGlints: {
    maxCount: 85,
    windAngle: -0.28,
    color: "#e6fbff",
    materialOpacity: 0.08,
    minRadius: 280,
    arenaRadiusScale: 2.15,
    shoreDampingMinimum: 0.82,
    minWidth: 10,
    widthSpread: 34,
    minHeight: 0.9,
    heightSpread: 2.6,
    rotationSpread: 0.28,
    minSpeed: 0.34,
    speedSpread: 0.28,
    minDrift: 8,
    driftSpread: 24,
    minOpacity: 0.025,
    opacitySpread: 0.055,
    colorBase: 0.48,
    colorOpacityMultiplier: 6,
    waveOffsetY: 0.44,
    shimmerBase: 0.78,
    shimmerFrequency: 1.6,
    shimmerOpacityMultiplier: 7
  }
} as const;
