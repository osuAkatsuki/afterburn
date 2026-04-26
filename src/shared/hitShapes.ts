import { add, applyQuaternion, clamp, distance, dot, quaternionFromRotation, scale, subtract } from "./math.js";
import type { PlayerState, Vec3 } from "./types.js";

type AircraftComponentName =
  | "fuselage"
  | "leftMainWing"
  | "rightMainWing"
  | "leftTailplane"
  | "rightTailplane"
  | "leftVerticalFin"
  | "rightVerticalFin";

type TerrainProbeName =
  | "noseBelly"
  | "centerBelly"
  | "tailBelly"
  | "leftWingtip"
  | "rightWingtip"
  | "leftTailtip"
  | "rightTailtip";

type LocalCapsule = {
  name: AircraftComponentName;
  start: Vec3;
  end: Vec3;
  radius: number;
};

type WorldCapsule = LocalCapsule;

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

const FUSELAGE_BULLET_HIT_CAPSULE: LocalCapsule = {
  name: "fuselage",
  start: { x: 0, y: 0, z: -12.4 },
  end: { x: 0, y: 0, z: 14.5 },
  radius: 2.35
};

const FUSELAGE_AIRFRAME_CAPSULE: LocalCapsule = {
  ...FUSELAGE_BULLET_HIT_CAPSULE,
  radius: 2.55
};

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

const AIRFRAME_CAPSULES: LocalCapsule[] = [
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

export function closestProjectileToAircraftFuselage(start: Vec3, end: Vec3, player: PlayerState): AircraftShapeHit {
  return closestProjectileToCapsules(start, end, [worldCapsule(player, FUSELAGE_BULLET_HIT_CAPSULE)]);
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
