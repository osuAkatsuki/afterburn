import { add, applyQuaternion, clamp, distance, dot, multiplyQuaternions, quaternionFromRotation, scale, subtract } from "./math.js";
import type { PlayerState, Rotation, Vec3 } from "./types.js";

export type AircraftComponentName =
  | "fuselage"
  | "nose"
  | "leftWingRoot"
  | "rightWingRoot"
  | "leftMainWing"
  | "rightMainWing"
  | "leftWingtipAccent"
  | "rightWingtipAccent"
  | "leftTailplane"
  | "rightTailplane"
  | "leftVerticalFin"
  | "rightVerticalFin"
  | "leftAileron"
  | "rightAileron"
  | "leftElevator"
  | "rightElevator"
  | "leftRudder"
  | "rightRudder";

type TerrainProbeName =
  | "noseBelly"
  | "centerBelly"
  | "tailBelly"
  | "leftWingtip"
  | "rightWingtip"
  | "leftTailtip"
  | "rightTailtip";

export type LocalCapsule = {
  name: AircraftComponentName;
  start: Vec3;
  end: Vec3;
  radius: number;
};

type WorldCapsule = LocalCapsule;

export type LocalBox = {
  name: AircraftComponentName;
  center: Vec3;
  halfExtents: Vec3;
  rotation: Rotation;
};

type WorldBox = LocalBox & {
  axes: [Vec3, Vec3, Vec3];
};

type TerrainProbe = {
  name: TerrainProbeName;
  point: Vec3;
};

export type AircraftShapeHit = {
  range: number;
  clearance: number;
  segmentT: number;
  position: Vec3;
};

const FUSELAGE_BODY_BULLET_CAPSULE: LocalCapsule = {
  name: "fuselage",
  start: { x: 0, y: 0, z: -10.8 },
  end: { x: 0, y: 0, z: 8.9 },
  radius: 2.05
};

const NOSE_BULLET_CAPSULE: LocalCapsule = {
  name: "nose",
  start: { x: 0, y: 0, z: 8.9 },
  end: { x: 0, y: 0, z: 14.45 },
  radius: 0.88
};

const FUSELAGE_AIRFRAME_CAPSULE: LocalCapsule = {
  name: "fuselage",
  start: { x: 0, y: 0, z: -12.4 },
  end: { x: 0, y: 0, z: 14.5 },
  radius: 2.55
};

export const AIRFRAME_BULLET_CAPSULES: readonly LocalCapsule[] = [FUSELAGE_BODY_BULLET_CAPSULE, NOSE_BULLET_CAPSULE];

export const AIRFRAME_BULLET_BOXES: readonly LocalBox[] = [
  {
    name: "leftWingRoot",
    center: { x: -4.9, y: -0.33, z: -2.4 },
    halfExtents: { x: 4.25, y: 0.42, z: 2.95 },
    rotation: { pitch: 0, yaw: -0.16, roll: 0 }
  },
  {
    name: "rightWingRoot",
    center: { x: 4.9, y: -0.33, z: -2.4 },
    halfExtents: { x: 4.25, y: 0.42, z: 2.95 },
    rotation: { pitch: 0, yaw: 0.16, roll: 0 }
  },
  {
    name: "leftMainWing",
    center: { x: -9.5, y: -0.16, z: -3.95 },
    halfExtents: { x: 6.8, y: 0.32, z: 1.55 },
    rotation: { pitch: 0, yaw: -0.24, roll: 0 }
  },
  {
    name: "rightMainWing",
    center: { x: 9.5, y: -0.16, z: -3.95 },
    halfExtents: { x: 6.8, y: 0.32, z: 1.55 },
    rotation: { pitch: 0, yaw: 0.24, roll: 0 }
  },
  {
    name: "leftWingtipAccent",
    center: { x: -13.7, y: -0.11, z: -4.1 },
    halfExtents: { x: 3.0, y: 0.22, z: 0.72 },
    rotation: { pitch: 0, yaw: -0.2, roll: 0 }
  },
  {
    name: "rightWingtipAccent",
    center: { x: 13.7, y: -0.11, z: -4.1 },
    halfExtents: { x: 3.0, y: 0.22, z: 0.72 },
    rotation: { pitch: 0, yaw: 0.2, roll: 0 }
  },
  {
    name: "leftAileron",
    center: { x: -12.35, y: -0.05, z: -4.9 },
    halfExtents: { x: 3.8, y: 0.24, z: 0.95 },
    rotation: { pitch: 0, yaw: -0.26, roll: 0 }
  },
  {
    name: "rightAileron",
    center: { x: 12.35, y: -0.05, z: -4.9 },
    halfExtents: { x: 3.8, y: 0.24, z: 0.95 },
    rotation: { pitch: 0, yaw: 0.26, roll: 0 }
  },
  {
    name: "leftTailplane",
    center: { x: -3.85, y: 0.06, z: -11.2 },
    halfExtents: { x: 3.35, y: 0.26, z: 1.15 },
    rotation: { pitch: 0, yaw: -0.36, roll: 0 }
  },
  {
    name: "rightTailplane",
    center: { x: 3.85, y: 0.06, z: -11.2 },
    halfExtents: { x: 3.35, y: 0.26, z: 1.15 },
    rotation: { pitch: 0, yaw: 0.36, roll: 0 }
  },
  {
    name: "leftElevator",
    center: { x: -4.05, y: 0.1, z: -13.3 },
    halfExtents: { x: 3.3, y: 0.22, z: 0.92 },
    rotation: { pitch: 0, yaw: -0.24, roll: 0 }
  },
  {
    name: "rightElevator",
    center: { x: 4.05, y: 0.1, z: -13.3 },
    halfExtents: { x: 3.3, y: 0.22, z: 0.92 },
    rotation: { pitch: 0, yaw: 0.24, roll: 0 }
  },
  {
    name: "leftVerticalFin",
    center: { x: -1.88, y: 3.4, z: -11.45 },
    halfExtents: { x: 0.45, y: 2.65, z: 1.55 },
    rotation: { pitch: 0, yaw: -0.14, roll: 0 }
  },
  {
    name: "rightVerticalFin",
    center: { x: 1.88, y: 3.4, z: -11.45 },
    halfExtents: { x: 0.45, y: 2.65, z: 1.55 },
    rotation: { pitch: 0, yaw: 0.14, roll: 0 }
  },
  {
    name: "leftRudder",
    center: { x: -2.05, y: 3.1, z: -11.85 },
    halfExtents: { x: 0.36, y: 2.0, z: 1.08 },
    rotation: { pitch: 0, yaw: -0.14, roll: 0 }
  },
  {
    name: "rightRudder",
    center: { x: 2.05, y: 3.1, z: -11.85 },
    halfExtents: { x: 0.36, y: 2.0, z: 1.08 },
    rotation: { pitch: 0, yaw: 0.14, roll: 0 }
  }
];

const LEFT_MAIN_WING_CAPSULE: LocalCapsule = {
  name: "leftMainWing",
  start: { x: -1.6, y: -0.2, z: -1.8 },
  end: { x: -17.4, y: -0.25, z: -3.4 },
  radius: 0.95
};

const RIGHT_MAIN_WING_CAPSULE: LocalCapsule = {
  name: "rightMainWing",
  start: { x: 1.6, y: -0.2, z: -1.8 },
  end: { x: 17.4, y: -0.25, z: -3.4 },
  radius: 0.95
};

const LEFT_TAILPLANE_CAPSULE: LocalCapsule = {
  name: "leftTailplane",
  start: { x: -1.5, y: 0.05, z: -10.6 },
  end: { x: -8.2, y: 0.06, z: -13.3 },
  radius: 0.75
};

const RIGHT_TAILPLANE_CAPSULE: LocalCapsule = {
  name: "rightTailplane",
  start: { x: 1.5, y: 0.05, z: -10.6 },
  end: { x: 8.2, y: 0.06, z: -13.3 },
  radius: 0.75
};

const LEFT_VERTICAL_FIN_CAPSULE: LocalCapsule = {
  name: "leftVerticalFin",
  start: { x: -1.55, y: 1.15, z: -9.7 },
  end: { x: -2.55, y: 5.8, z: -11.9 },
  radius: 0.72
};

const RIGHT_VERTICAL_FIN_CAPSULE: LocalCapsule = {
  name: "rightVerticalFin",
  start: { x: 1.55, y: 1.15, z: -9.7 },
  end: { x: 2.55, y: 5.8, z: -11.9 },
  radius: 0.72
};

export const AIRFRAME_CAPSULES: readonly LocalCapsule[] = [
  FUSELAGE_AIRFRAME_CAPSULE,
  LEFT_MAIN_WING_CAPSULE,
  RIGHT_MAIN_WING_CAPSULE,
  LEFT_TAILPLANE_CAPSULE,
  RIGHT_TAILPLANE_CAPSULE,
  LEFT_VERTICAL_FIN_CAPSULE,
  RIGHT_VERTICAL_FIN_CAPSULE
];

const TERRAIN_PROBES: TerrainProbe[] = [
  { name: "noseBelly", point: { x: 0, y: -2.35, z: 12.8 } },
  { name: "centerBelly", point: { x: 0, y: -2.45, z: 0 } },
  { name: "tailBelly", point: { x: 0, y: -1.9, z: -12.8 } },
  { name: "leftWingtip", point: { x: -17.5, y: -0.45, z: -3.3 } },
  { name: "rightWingtip", point: { x: 17.5, y: -0.45, z: -3.3 } },
  { name: "leftTailtip", point: { x: -8.2, y: -0.2, z: -13.4 } },
  { name: "rightTailtip", point: { x: 8.2, y: -0.2, z: -13.4 } }
];

export function closestProjectileToAircraftBulletDamage(start: Vec3, end: Vec3, player: PlayerState): AircraftShapeHit {
  return [
    ...AIRFRAME_BULLET_CAPSULES.map((capsule) => closestProjectileToCapsules(start, end, [worldCapsule(player, capsule)])),
    ...aircraftBulletBoxes(player).map((box) => closestProjectileToBox(start, end, box))
  ].sort((a, b) => a.clearance - b.clearance || a.segmentT - b.segmentT)[0];
}

export function closestProjectileToAircraftAirframe(start: Vec3, end: Vec3, player: PlayerState): AircraftShapeHit {
  return closestProjectileToCapsules(start, end, aircraftAirframeCapsules(player));
}

export function distanceToAircraftAirframe(point: Vec3, player: PlayerState): number {
  return Math.min(
    ...aircraftAirframeCapsules(player).map((capsule) => {
      const closest = closestPointOnSegment(capsule.start, capsule.end, point);
      return Math.max(0, closest.range - capsule.radius);
    })
  );
}

export function aircraftIntersectsAircraft(first: PlayerState, second: PlayerState, padding = 1.15): boolean {
  const firstCapsules = aircraftAirframeCapsules(first);
  const secondCapsules = aircraftAirframeCapsules(second);

  return firstCapsules.some((firstCapsule) =>
    secondCapsules.some((secondCapsule) => {
      const closest = closestSegmentToSegment(firstCapsule.start, firstCapsule.end, secondCapsule.start, secondCapsule.end);
      return closest.range <= firstCapsule.radius + secondCapsule.radius + padding;
    })
  );
}

export function aircraftTerrainProbePoints(player: PlayerState): Vec3[] {
  return TERRAIN_PROBES.map(({ point }) => transformLocalPoint(player, point));
}

function aircraftAirframeCapsules(player: PlayerState): WorldCapsule[] {
  return AIRFRAME_CAPSULES.map((capsule) => worldCapsule(player, capsule));
}

function aircraftBulletBoxes(player: PlayerState): WorldBox[] {
  const aircraftQuaternion = player.orientation ?? quaternionFromRotation(player.rotation);
  return AIRFRAME_BULLET_BOXES.map((box) => {
    const localQuaternion = quaternionFromRotation(box.rotation);
    const worldQuaternion = multiplyQuaternions(aircraftQuaternion, localQuaternion);
    return {
      ...box,
      center: transformLocalPoint(player, box.center),
      axes: [
        applyQuaternion({ x: 1, y: 0, z: 0 }, worldQuaternion),
        applyQuaternion({ x: 0, y: 1, z: 0 }, worldQuaternion),
        applyQuaternion({ x: 0, y: 0, z: 1 }, worldQuaternion)
      ]
    };
  });
}

function worldCapsule(player: PlayerState, capsule: LocalCapsule): WorldCapsule {
  return {
    name: capsule.name,
    start: transformLocalPoint(player, capsule.start),
    end: transformLocalPoint(player, capsule.end),
    radius: capsule.radius
  };
}

function transformLocalPoint(player: PlayerState, point: Vec3): Vec3 {
  return add(player.position, applyQuaternion(point, player.orientation ?? quaternionFromRotation(player.rotation)));
}

function closestProjectileToCapsules(start: Vec3, end: Vec3, capsules: WorldCapsule[]): AircraftShapeHit {
  return capsules
    .map((capsule) => {
      const closest = closestSegmentToSegment(start, end, capsule.start, capsule.end);
      return {
        range: closest.range,
        clearance: Math.max(0, closest.range - capsule.radius),
        segmentT: closest.firstT,
        position: closest.firstPoint
      };
    })
    .sort((a, b) => a.clearance - b.clearance || a.segmentT - b.segmentT)[0];
}

function closestProjectileToBox(start: Vec3, end: Vec3, box: WorldBox): AircraftShapeHit {
  const localStart = projectPointIntoBox(start, box);
  const localEnd = projectPointIntoBox(end, box);
  const hitT = segmentAabbIntersectionT(localStart, localEnd, box.halfExtents);
  if (hitT !== undefined) {
    return {
      range: 0,
      clearance: 0,
      segmentT: hitT,
      position: add(start, scale(subtract(end, start), hitT))
    };
  }

  const closest = closestSegmentToAabb(localStart, localEnd, box.halfExtents);
  return {
    range: closest.range,
    clearance: closest.range,
    segmentT: closest.t,
    position: add(start, scale(subtract(end, start), closest.t))
  };
}

function projectPointIntoBox(point: Vec3, box: WorldBox): Vec3 {
  const relative = subtract(point, box.center);
  return {
    x: dot(relative, box.axes[0]),
    y: dot(relative, box.axes[1]),
    z: dot(relative, box.axes[2])
  };
}

function segmentAabbIntersectionT(start: Vec3, end: Vec3, halfExtents: Vec3): number | undefined {
  let tMin = 0;
  let tMax = 1;
  const direction = subtract(end, start);

  for (const axis of ["x", "y", "z"] as const) {
    const origin = start[axis];
    const delta = direction[axis];
    const min = -halfExtents[axis];
    const max = halfExtents[axis];

    if (Math.abs(delta) < 0.000001) {
      if (origin < min || origin > max) {
        return undefined;
      }
      continue;
    }

    let near = (min - origin) / delta;
    let far = (max - origin) / delta;
    if (near > far) {
      [near, far] = [far, near];
    }
    tMin = Math.max(tMin, near);
    tMax = Math.min(tMax, far);
    if (tMin > tMax) {
      return undefined;
    }
  }

  return clamp(tMin, 0, 1);
}

function closestSegmentToAabb(start: Vec3, end: Vec3, halfExtents: Vec3): { range: number; t: number } {
  let low = 0;
  let high = 1;
  for (let i = 0; i < 22; i += 1) {
    const firstT = low + (high - low) / 3;
    const secondT = high - (high - low) / 3;
    const firstDistance = pointAabbDistance(pointOnSegment(start, end, firstT), halfExtents);
    const secondDistance = pointAabbDistance(pointOnSegment(start, end, secondT), halfExtents);
    if (firstDistance < secondDistance) {
      high = secondT;
    } else {
      low = firstT;
    }
  }
  const t = (low + high) / 2;
  return { range: pointAabbDistance(pointOnSegment(start, end, t), halfExtents), t };
}

function pointOnSegment(start: Vec3, end: Vec3, t: number): Vec3 {
  return add(start, scale(subtract(end, start), t));
}

function pointAabbDistance(point: Vec3, halfExtents: Vec3): number {
  const closest = {
    x: clamp(point.x, -halfExtents.x, halfExtents.x),
    y: clamp(point.y, -halfExtents.y, halfExtents.y),
    z: clamp(point.z, -halfExtents.z, halfExtents.z)
  };
  return distance(point, closest);
}

function closestPointOnSegment(start: Vec3, end: Vec3, point: Vec3): { range: number; t: number; position: Vec3 } {
  const segment = subtract(end, start);
  const lengthSquared = dot(segment, segment);
  if (lengthSquared <= 0.00001) {
    return { range: distance(start, point), t: 0, position: start };
  }

  const t = clamp(dot(subtract(point, start), segment) / lengthSquared, 0, 1);
  const position = add(start, scale(segment, t));
  return { range: distance(position, point), t, position };
}

function closestSegmentToSegment(
  firstStart: Vec3,
  firstEnd: Vec3,
  secondStart: Vec3,
  secondEnd: Vec3
): { range: number; firstT: number; secondT: number; firstPoint: Vec3; secondPoint: Vec3 } {
  const d1 = subtract(firstEnd, firstStart);
  const d2 = subtract(secondEnd, secondStart);
  const r = subtract(firstStart, secondStart);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s = 0;
  let t = 0;

  if (a <= 0.00001 && e <= 0.00001) {
    return {
      range: distance(firstStart, secondStart),
      firstT: 0,
      secondT: 0,
      firstPoint: firstStart,
      secondPoint: secondStart
    };
  }

  if (a <= 0.00001) {
    t = clamp(f / e, 0, 1);
  } else {
    const c = dot(d1, r);
    if (e <= 0.00001) {
      s = clamp(-c / a, 0, 1);
    } else {
      const b = dot(d1, d2);
      const denominator = a * e - b * b;
      if (denominator !== 0) {
        s = clamp((b * f - c * e) / denominator, 0, 1);
      }

      const tNumerator = b * s + f;
      if (tNumerator < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (tNumerator > e) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      } else {
        t = tNumerator / e;
      }
    }
  }

  const firstPoint = add(firstStart, scale(d1, s));
  const secondPoint = add(secondStart, scale(d2, t));
  return {
    range: distance(firstPoint, secondPoint),
    firstT: s,
    secondT: t,
    firstPoint,
    secondPoint
  };
}
