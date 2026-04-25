import type { PlayerState, ProjectileState, Quaternion, RoomState, Rotation, StateSnapshotPayload, Vec3 } from "../../shared/types.js";

export const SNAPSHOT_INTERPOLATION_DELAY_MS = 110;
const MAX_BUFFERED_SNAPSHOTS = 24;

type BufferedSnapshot = {
  tick: number;
  receivedAt: number;
  room: RoomState;
};

export class SnapshotBuffer {
  private readonly snapshots: BufferedSnapshot[] = [];

  push(snapshot: StateSnapshotPayload, receivedAt = performance.now()): void {
    if (this.snapshots.at(-1)?.tick === snapshot.tick) {
      this.snapshots[this.snapshots.length - 1] = { tick: snapshot.tick, receivedAt, room: snapshot.room };
      return;
    }

    this.snapshots.push({ tick: snapshot.tick, receivedAt, room: snapshot.room });
    this.snapshots.sort((a, b) => a.receivedAt - b.receivedAt || a.tick - b.tick);

    while (this.snapshots.length > MAX_BUFFERED_SNAPSHOTS) {
      this.snapshots.shift();
    }
  }

  clear(): void {
    this.snapshots.length = 0;
  }

  sample(renderTime: number, localPlayerId = ""): RoomState | undefined {
    if (this.snapshots.length === 0) {
      return undefined;
    }

    if (this.snapshots.length === 1) {
      return cloneRoom(this.snapshots[0].room);
    }

    const targetTime = renderTime - SNAPSHOT_INTERPOLATION_DELAY_MS;
    const afterIndex = this.snapshots.findIndex((snapshot) => snapshot.receivedAt >= targetTime);

    if (afterIndex === -1) {
      return cloneRoom(this.latest.room);
    }

    if (afterIndex === 0) {
      return cloneRoom(this.snapshots[0].room);
    }

    const before = this.snapshots[afterIndex - 1];
    const after = this.snapshots[afterIndex];
    const span = Math.max(1, after.receivedAt - before.receivedAt);
    const alpha = clamp01((targetTime - before.receivedAt) / span);
    const sampled = interpolateRooms(before.room, after.room, alpha);

    const latestLocalPlayer = this.latest.room.players[localPlayerId];
    if (latestLocalPlayer) {
      sampled.players[localPlayerId] = clone(latestLocalPlayer);
    }

    return sampled;
  }

  getBufferedMs(renderTime: number): number {
    if (this.snapshots.length === 0) {
      return 0;
    }

    return Math.max(0, renderTime - this.snapshots[0].receivedAt);
  }

  private get latest(): BufferedSnapshot {
    return this.snapshots[this.snapshots.length - 1];
  }
}

function interpolateRooms(before: RoomState, after: RoomState, alpha: number): RoomState {
  const room = cloneRoom(after);

  Object.keys(room.players).forEach((playerId) => {
    const beforePlayer = before.players[playerId];
    const afterPlayer = after.players[playerId];
    if (beforePlayer && afterPlayer && beforePlayer.status === afterPlayer.status) {
      room.players[playerId] = interpolatePlayer(beforePlayer, afterPlayer, alpha);
    }
  });

  Object.keys(room.projectiles).forEach((projectileId) => {
    const beforeProjectile = before.projectiles[projectileId];
    const afterProjectile = after.projectiles[projectileId];
    if (beforeProjectile && afterProjectile && beforeProjectile.type === afterProjectile.type) {
      room.projectiles[projectileId] = interpolateProjectile(beforeProjectile, afterProjectile, alpha);
    }
  });

  room.now = lerp(before.now, after.now, alpha);
  return room;
}

function interpolatePlayer(before: PlayerState, after: PlayerState, alpha: number): PlayerState {
  return {
    ...clone(after),
    position: lerpVec3(before.position, after.position, alpha),
    velocity: lerpVec3(before.velocity, after.velocity, alpha),
    rotation: lerpRotation(before.rotation, after.rotation, alpha),
    orientation: before.orientation && after.orientation ? nlerpQuaternion(before.orientation, after.orientation, alpha) : after.orientation
  };
}

function interpolateProjectile(before: ProjectileState, after: ProjectileState, alpha: number): ProjectileState {
  return {
    ...clone(after),
    position: lerpVec3(before.position, after.position, alpha),
    velocity: lerpVec3(before.velocity, after.velocity, alpha),
    ttl: lerp(before.ttl, after.ttl, alpha)
  };
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
  const quaternion = {
    x: lerp(before.x, after.x * sign, alpha),
    y: lerp(before.y, after.y * sign, alpha),
    z: lerp(before.z, after.z * sign, alpha),
    w: lerp(before.w, after.w * sign, alpha)
  };
  const magnitude = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w) || 1;
  return {
    x: quaternion.x / magnitude,
    y: quaternion.y / magnitude,
    z: quaternion.z / magnitude,
    w: quaternion.w / magnitude
  };
}

function lerp(before: number, after: number, alpha: number): number {
  return before + (after - before) * alpha;
}

function lerpAngle(before: number, after: number, alpha: number): number {
  const delta = ((((after - before + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  return before + delta * alpha;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function cloneRoom(room: RoomState): RoomState {
  return clone(room);
}

function clone<T>(value: T): T {
  return typeof structuredClone === "function" ? structuredClone(value) : (JSON.parse(JSON.stringify(value)) as T);
}
