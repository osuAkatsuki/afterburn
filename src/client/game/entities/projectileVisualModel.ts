import type { Vec3Tuple } from "./jetVisualModel.js";

export const PROJECTILE_VISUAL_MODEL = {
  bulletTracer: {
    radiusTop: 0.34,
    radiusBottom: 0.18,
    length: 18,
    radialSegments: 8,
    material: {
      color: "#fff1a8",
      opacity: 0.86
    }
  },
  flare: {
    core: {
      radius: 1.35,
      widthSegments: 10,
      heightSegments: 8,
      color: "#fffbeb",
      opacity: 0.88
    },
    corona: {
      radius: 3.25,
      widthSegments: 10,
      heightSegments: 8,
      color: "#fb923c",
      opacity: 0.26
    }
  },
  missile: {
    body: {
      radiusTop: 1.05,
      radiusBottom: 1.05,
      length: 11,
      radialSegments: 18,
      material: {
        color: "#d8dde4",
        roughness: 0.38,
        metalness: 0.35
      }
    },
    nose: {
      radius: 1.08,
      length: 3.2,
      radialSegments: 18,
      position: [0, 0, 7.1] satisfies Vec3Tuple,
      material: {
        color: "#b91c1c",
        roughness: 0.42,
        metalness: 0.12
      }
    },
    tail: {
      radiusTop: 1.14,
      radiusBottom: 1.14,
      length: 1.3,
      radialSegments: 18,
      position: [0, 0, -5.9] satisfies Vec3Tuple,
      material: {
        color: "#202938",
        roughness: 0.5,
        metalness: 0.2
      }
    },
    fins: [
      {
        name: "topFin",
        size: [0.16, 2.4, 2.9] satisfies Vec3Tuple,
        position: [0, 1.45, -4.6] satisfies Vec3Tuple
      },
      {
        name: "bottomFin",
        size: [0.16, 2.4, 2.9] satisfies Vec3Tuple,
        position: [0, -1.45, -4.6] satisfies Vec3Tuple
      },
      {
        name: "rightFin",
        size: [2.4, 0.16, 2.9] satisfies Vec3Tuple,
        position: [1.45, 0, -4.6] satisfies Vec3Tuple
      },
      {
        name: "leftFin",
        size: [2.4, 0.16, 2.9] satisfies Vec3Tuple,
        position: [-1.45, 0, -4.6] satisfies Vec3Tuple
      }
    ],
    finMaterial: {
      color: "#111827",
      roughness: 0.55,
      metalness: 0.18
    },
    exhaust: {
      radius: 0.85,
      length: 4.6,
      radialSegments: 14,
      position: [0, 0, -8.2] satisfies Vec3Tuple,
      material: {
        color: "#f97316",
        opacity: 0.7
      }
    }
  }
} as const;
