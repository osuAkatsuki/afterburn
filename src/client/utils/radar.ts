import { applyQuaternion, horizontalLength, normalize, quaternionFromRotation } from "../../shared/math.js";
import type { PlayerState, Vec3 } from "../../shared/types.js";

export const RADAR_RANGE = 1600;
export const RADAR_RADIUS_PX = 42;

export type RadarContact = {
  player: PlayerState;
  x: number;
  y: number;
  className: "self" | "enemy";
};

export function radarContacts(players: PlayerState[], localPlayer: PlayerState): RadarContact[] {
  const heading = radarHeading(localPlayer);
  const right = { x: heading.z, y: 0, z: -heading.x };
  const scale = RADAR_RADIUS_PX / RADAR_RANGE;

  return players
    .filter((player) => player.status === "alive")
    .flatMap<RadarContact>((player) => {
      if (player.id === localPlayer.id) {
        return [{ player, x: 0, y: 0, className: "self" as const }];
      }

      const offset = {
        x: player.position.x - localPlayer.position.x,
        y: 0,
        z: player.position.z - localPlayer.position.z
      };
      const range = horizontalLength(offset);
      if (range > RADAR_RANGE) {
        return [];
      }

      const lateral = offset.x * right.x + offset.z * right.z;
      const forward = offset.x * heading.x + offset.z * heading.z;

      return [
        {
          player,
          // The chase camera uses a 180deg yaw flip, so screen-left/right is mirrored from raw aircraft starboard.
          x: -lateral * scale,
          y: -forward * scale,
          className: "enemy" as const
        }
      ];
    });
}

function radarHeading(player: PlayerState): Vec3 {
  const orientation = player.orientation ?? quaternionFromRotation(player.rotation);
  const forward = applyQuaternion({ x: 0, y: 0, z: 1 }, orientation);
  const horizontal = { x: forward.x, y: 0, z: forward.z };

  if (horizontalLength(horizontal) > 0.00001) {
    return normalize(horizontal);
  }

  return normalize({
    x: Math.sin(player.rotation.yaw),
    y: 0,
    z: Math.cos(player.rotation.yaw)
  });
}
