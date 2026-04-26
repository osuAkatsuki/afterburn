import { COMBAT_HISTORY_MS } from "../../shared/constants.js";
import { clamp, cloneVec3, lerp, lerpAngle, normalizeQuaternion } from "../../shared/math.js";
import type { HistoricalPlayerSample } from "../../shared/simulation.js";
import type { PlayerState, Quaternion, RoomState, Rotation, Vec3 } from "../../shared/types.js";

type RoomHistoryFrame = {
  tick: number;
  serverTime: number;
  players: Record<string, HistoricalPlayerSample>;
};

export type RoomHistorySample = HistoricalPlayerSample & {
  clamped: boolean;
};

export class RoomHistory {
  private readonly framesByRoom = new Map<string, RoomHistoryFrame[]>();

  constructor(private readonly retentionMs = COMBAT_HISTORY_MS) {}

  record(room: RoomState, tick: number, serverTime = room.now): void {
    const frame: RoomHistoryFrame = {
      tick,
      serverTime,
      players: Object.fromEntries(Object.values(room.players).map((player) => [player.id, historicalPlayer(player)]))
    };
    const frames = this.framesByRoom.get(room.id) ?? [];
    frames.push(frame);
    frames.sort((a, b) => a.serverTime - b.serverTime || a.tick - b.tick);

    const oldestAllowed = serverTime - this.retentionMs;
    while (frames.length > 1 && frames[0].serverTime < oldestAllowed) {
      frames.shift();
    }

    this.framesByRoom.set(room.id, frames);
  }

  samplePlayer(roomId: string, playerId: string, serverTime: number): RoomHistorySample | undefined {
    const frames = this.framesByRoom.get(roomId);
    if (!frames || frames.length === 0) {
      return undefined;
    }

    if (serverTime <= frames[0].serverTime) {
      return withClamp(frames[0].players[playerId], true);
    }

    const latest = frames[frames.length - 1];
    if (serverTime >= latest.serverTime) {
      return withClamp(latest.players[playerId], false);
    }

    const afterIndex = frames.findIndex((frame) => frame.serverTime >= serverTime);
    if (afterIndex <= 0) {
      return withClamp(frames[0].players[playerId], true);
    }

    const before = frames[afterIndex - 1];
    const after = frames[afterIndex];
    const beforePlayer = before.players[playerId];
    const afterPlayer = after.players[playerId];
    if (!beforePlayer || !afterPlayer) {
      return withClamp(beforePlayer ?? afterPlayer, false);
    }

    const span = Math.max(1, after.serverTime - before.serverTime);
    const alpha = clamp((serverTime - before.serverTime) / span, 0, 1);
    return {
      id: beforePlayer.id,
      status: beforePlayer.status === afterPlayer.status ? beforePlayer.status : alpha < 0.5 ? beforePlayer.status : afterPlayer.status,
      position: lerpVec3(beforePlayer.position, afterPlayer.position, alpha),
      velocity: lerpVec3(beforePlayer.velocity, afterPlayer.velocity, alpha),
      rotation: lerpRotation(beforePlayer.rotation, afterPlayer.rotation, alpha),
      orientation:
        beforePlayer.orientation && afterPlayer.orientation
          ? nlerpQuaternion(beforePlayer.orientation, afterPlayer.orientation, alpha)
          : (afterPlayer.orientation ?? beforePlayer.orientation),
      spawnProtectionUntil: afterPlayer.spawnProtectionUntil ?? beforePlayer.spawnProtectionUntil,
      clamped: false
    };
  }

  deleteRoom(roomId: string): void {
    this.framesByRoom.delete(roomId);
  }

  clear(): void {
    this.framesByRoom.clear();
  }
}

function historicalPlayer(player: PlayerState): HistoricalPlayerSample {
  return {
    id: player.id,
    status: player.status,
    position: cloneVec3(player.position),
    velocity: cloneVec3(player.velocity),
    rotation: { ...player.rotation },
    orientation: player.orientation ? { ...player.orientation } : undefined,
    spawnProtectionUntil: player.spawnProtectionUntil
  };
}

function withClamp(sample: HistoricalPlayerSample | undefined, clamped: boolean): RoomHistorySample | undefined {
  return sample ? { ...sample, clamped } : undefined;
}

function lerpVec3(before: Vec3, after: Vec3, alpha: number): Vec3 {
  return {
    x: lerp(before.x, after.x, alpha),
    y: lerp(before.y, after.y, alpha),
    z: lerp(before.z, after.z, alpha)
  };
}

function lerpRotation(before: Rotation, after: Rotation, alpha: number): Rotation {
  return {
    pitch: lerpAngle(before.pitch, after.pitch, alpha),
    yaw: lerpAngle(before.yaw, after.yaw, alpha),
    roll: lerpAngle(before.roll, after.roll, alpha)
  };
}

function nlerpQuaternion(before: Quaternion, after: Quaternion, alpha: number): Quaternion {
  const dot = before.x * after.x + before.y * after.y + before.z * after.z + before.w * after.w;
  const sign = dot < 0 ? -1 : 1;
  return normalizeQuaternion({
    x: lerp(before.x, after.x * sign, alpha),
    y: lerp(before.y, after.y * sign, alpha),
    z: lerp(before.z, after.z * sign, alpha),
    w: lerp(before.w, after.w * sign, alpha)
  });
}
