import { MISSILE_PROXIMITY_RADIUS, PLAYER_HIT_RADIUS } from "../../shared/constants.js";
import { applyQuaternion, distance, dot, forwardVector, normalize, quaternionFromRotation, subtract } from "../../shared/math.js";
import type { PlayerState, RoomState } from "../../shared/types.js";

export type IncomingMissileCue = {
  range: number;
  impactSeconds?: number;
  bearingRadians: number;
  clockLabel: string;
};

export function getIncomingMissileCue(room: RoomState | undefined, localPlayer: PlayerState | undefined): IncomingMissileCue | undefined {
  if (!room || !localPlayer || localPlayer.status !== "alive") {
    return undefined;
  }

  const missile = Object.values(room.projectiles)
    .filter((projectile) => projectile.type === "missile" && projectile.targetType === "player" && projectile.targetId === localPlayer.id)
    .map((projectile) => ({ projectile, range: distance(projectile.position, localPlayer.position) }))
    .sort((a, b) => a.range - b.range)[0];

  if (!missile) {
    return undefined;
  }

  const orientation = localPlayer.orientation ?? quaternionFromRotation(localPlayer.rotation);
  const forward = normalize(forwardVector(localPlayer.rotation));
  const right = normalize(applyQuaternion({ x: 1, y: 0, z: 0 }, orientation));
  const offset = normalize(subtract(missile.projectile.position, localPlayer.position));
  const forwardAmount = dot(offset, forward);
  const rightAmount = dot(offset, right);
  const bearingRadians = Math.atan2(rightAmount, forwardAmount);

  return {
    range: missile.range,
    impactSeconds: estimateImpactSeconds(localPlayer, missile.projectile, missile.range),
    bearingRadians,
    clockLabel: clockLabelForBearing(bearingRadians)
  };
}

function estimateImpactSeconds(localPlayer: PlayerState, missile: RoomState["projectiles"][string], range: number): number | undefined {
  const toPlayer = normalize(subtract(localPlayer.position, missile.position));
  const relativeVelocity = subtract(missile.velocity, localPlayer.velocity);
  const closingSpeed = dot(relativeVelocity, toPlayer);
  if (closingSpeed <= 1) {
    return undefined;
  }

  const fuseRange = PLAYER_HIT_RADIUS + MISSILE_PROXIMITY_RADIUS;
  return Math.max(0, (range - fuseRange) / closingSpeed);
}

function clockLabelForBearing(bearingRadians: number): string {
  const normalized = (bearingRadians + Math.PI * 2) % (Math.PI * 2);
  const hour = Math.round(normalized / (Math.PI / 6)) % 12;
  return `${hour === 0 ? 12 : hour} O'CLOCK`;
}
