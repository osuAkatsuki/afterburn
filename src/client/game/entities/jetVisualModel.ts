export type Vec3Tuple = readonly [x: number, y: number, z: number];

export type JetMaterialKey = "body" | "panel" | "accent" | "wing" | "controlSurface";

export type JetTrianglePart = {
  name: string;
  points: [Vec3Tuple, Vec3Tuple, Vec3Tuple];
  material: JetMaterialKey;
};

export type JetControlSurfaceName =
  | "leftAileron"
  | "rightAileron"
  | "elevatorLeft"
  | "elevatorRight"
  | "leftRudder"
  | "rightRudder";

export type JetControlSurfacePart = JetTrianglePart & {
  surface: JetControlSurfaceName;
  hinge: Vec3Tuple;
};

export const JET_VISUAL_MODEL = {
  body: {
    radiusTop: 1.35,
    radiusBottom: 2.05,
    length: 18,
    radialSegments: 18
  },
  nose: {
    radius: 1.38,
    length: 5.7,
    radialSegments: 18,
    position: [0, 0, 11.8] satisfies Vec3Tuple
  },
  canopy: {
    radius: 1.8,
    widthSegments: 18,
    heightSegments: 8,
    scale: [0.85, 0.38, 1.55] satisfies Vec3Tuple,
    position: [0, 1.45, 3.6] satisfies Vec3Tuple
  },
  wingRoots: [
    {
      name: "leftWingRoot",
      size: [8.4, 0.38, 5.8] satisfies Vec3Tuple,
      position: [-4.9, -0.33, -2.4] satisfies Vec3Tuple,
      rotationY: -0.16
    },
    {
      name: "rightWingRoot",
      size: [8.4, 0.38, 5.8] satisfies Vec3Tuple,
      position: [4.9, -0.33, -2.4] satisfies Vec3Tuple,
      rotationY: 0.16
    }
  ],
  fixedTriangles: [
    {
      name: "leftMainWing",
      material: "wing",
      points: [
        [-1.35, -0.15, 1.2],
        [-17.5, -0.25, -3.2],
        [-2.5, -0.2, -8.2]
      ]
    },
    {
      name: "rightMainWing",
      material: "wing",
      points: [
        [1.35, -0.15, 1.2],
        [17.5, -0.25, -3.2],
        [2.5, -0.2, -8.2]
      ]
    },
    {
      name: "leftWingtipAccent",
      material: "accent",
      points: [
        [-11.5, -0.12, -3.8],
        [-17.2, -0.12, -3.2],
        [-12.5, -0.12, -5.4]
      ]
    },
    {
      name: "rightWingtipAccent",
      material: "accent",
      points: [
        [11.5, -0.12, -3.8],
        [17.2, -0.12, -3.2],
        [12.5, -0.12, -5.4]
      ]
    },
    {
      name: "leftTailplane",
      material: "panel",
      points: [
        [-1.15, 0.1, -8.3],
        [-7.6, 0, -11.2],
        [-1.65, 0.05, -13.8]
      ]
    },
    {
      name: "rightTailplane",
      material: "panel",
      points: [
        [1.15, 0.1, -8.3],
        [7.6, 0, -11.2],
        [1.65, 0.05, -13.8]
      ]
    },
    {
      name: "leftVerticalFin",
      material: "panel",
      points: [
        [-1.15, 1.1, -8.4],
        [-2.85, 6.6, -11.7],
        [-1.65, 1.05, -14.2]
      ]
    },
    {
      name: "rightVerticalFin",
      material: "panel",
      points: [
        [1.15, 1.1, -8.4],
        [2.85, 6.6, -11.7],
        [1.65, 1.05, -14.2]
      ]
    }
  ] satisfies JetTrianglePart[],
  controlSurfaces: [
    {
      name: "leftAileron",
      surface: "leftAileron",
      material: "controlSurface",
      hinge: [-11.4, -0.06, -4.65],
      points: [
        [-9.6, -0.06, -4.8],
        [-16.1, -0.06, -3.45],
        [-11.1, -0.06, -6.45]
      ]
    },
    {
      name: "rightAileron",
      surface: "rightAileron",
      material: "controlSurface",
      hinge: [11.4, -0.06, -4.65],
      points: [
        [9.6, -0.06, -4.8],
        [16.1, -0.06, -3.45],
        [11.1, -0.06, -6.45]
      ]
    },
    {
      name: "leftElevator",
      surface: "elevatorLeft",
      material: "controlSurface",
      hinge: [-3.3, 0.1, -12.05],
      points: [
        [-1.65, 0.12, -11.4],
        [-8.4, 0.08, -13.2],
        [-1.9, 0.1, -15.4]
      ]
    },
    {
      name: "rightElevator",
      surface: "elevatorRight",
      material: "controlSurface",
      hinge: [3.3, 0.1, -12.05],
      points: [
        [1.65, 0.12, -11.4],
        [8.4, 0.08, -13.2],
        [1.9, 0.1, -15.4]
      ]
    },
    {
      name: "leftRudder",
      surface: "leftRudder",
      material: "controlSurface",
      hinge: [-1.85, 2.7, -11.85],
      points: [
        [-1.85, 1.35, -10.1],
        [-2.55, 5.25, -11.85],
        [-1.85, 1.25, -13.55]
      ]
    },
    {
      name: "rightRudder",
      surface: "rightRudder",
      material: "controlSurface",
      hinge: [1.85, 2.7, -11.85],
      points: [
        [1.85, 1.35, -10.1],
        [2.55, 5.25, -11.85],
        [1.85, 1.25, -13.55]
      ]
    }
  ] satisfies JetControlSurfacePart[],
  nozzles: [
    {
      name: "leftNozzle",
      radiusTop: 0.62,
      radiusBottom: 0.82,
      length: 1.6,
      radialSegments: 14,
      position: [-0.9, 0, -10.4] satisfies Vec3Tuple
    },
    {
      name: "rightNozzle",
      radiusTop: 0.62,
      radiusBottom: 0.82,
      length: 1.6,
      radialSegments: 14,
      position: [0.9, 0, -10.4] satisfies Vec3Tuple
    }
  ],
  afterburnerFlame: {
    radius: 1.55,
    length: 9,
    radialSegments: 18,
    position: [0, 0, -14.2] satisfies Vec3Tuple
  },
  heatGlow: {
    radius: 2.7,
    widthSegments: 14,
    heightSegments: 8,
    scale: [1, 0.55, 1.6] satisfies Vec3Tuple,
    position: [0, 0, -12.5] satisfies Vec3Tuple
  },
  controlSurfaceMotion: {
    smoothing: 18,
    maxAileronRadians: 0.48,
    maxElevatorRadians: 0.42,
    maxRudderRadians: 0.34
  },
  afterburnerVisual: {
    pulseFrequency: 0.02,
    pulseBase: 0.9,
    pulseAmplitude: 0.08,
    flameScaleAfterburner: [1.35, 1.35, 1.75] satisfies Vec3Tuple,
    flameScaleCruise: [0.58, 0.58, 0.82] satisfies Vec3Tuple,
    flameOpacityAfterburner: 0.84,
    flameOpacityCruise: 0.28,
    heatGlowScaleAfterburner: [1.3, 0.72, 2.1] satisfies Vec3Tuple,
    heatGlowScaleCruise: [0.78, 0.44, 1.15] satisfies Vec3Tuple,
    heatGlowOpacityAfterburner: 0.36,
    heatGlowOpacityCruise: 0.13
  }
} as const;
