import type { PlayerState, ProjectileState, Quaternion, RoomState, Rotation, StateSnapshotPayload, Vec3 } from "../../shared/types.js";

export const SNAPSHOT_INTERPOLATION_DELAY_MS = 110;
export const MAX_SNAPSHOT_INTERPOLATION_DELAY_MS = 220;
const SNAPSHOT_SAFETY_FRAMES = 2;
const JITTER_SAFETY_MULTIPLIER = 1.25;
const MAX_BUFFERED_SNAPSHOTS = 24;

export type SnapshotTimingStats = {
  serverClockSamples: number;
  snapshotHz: number;
  snapshotJitterMs: number;
  transportDelayMs: number;
};

type BufferedSnapshot = {
  tick: number;
  receivedAt: number;
  sentAt: number;
  room: RoomState;
};

export class SnapshotBuffer {
  private readonly snapshots: BufferedSnapshot[] = [];
  private serverClockOffsetMs?: number;
  private interpolationDelayMs = SNAPSHOT_INTERPOLATION_DELAY_MS;

  push(snapshot: StateSnapshotPayload, receivedAt = performance.now(), serverClockOffsetMs?: number): void {
    this.setServerClockOffset(serverClockOffsetMs);
    if (this.snapshots.at(-1)?.tick === snapshot.tick) {
      this.snapshots[this.snapshots.length - 1] = { tick: snapshot.tick, receivedAt, sentAt: snapshot.sentAt, room: snapshot.room };
      return;
    }

    this.snapshots.push({ tick: snapshot.tick, receivedAt, sentAt: snapshot.sentAt, room: snapshot.room });
    this.snapshots.sort((a, b) => a.sentAt - b.sentAt || a.tick - b.tick);

    while (this.snapshots.length > MAX_BUFFERED_SNAPSHOTS) {
      this.snapshots.shift();
    }
  }

  clear(): void {
    this.snapshots.length = 0;
  }

  setServerClockOffset(serverClockOffsetMs?: number): void {
    if (serverClockOffsetMs !== undefined && Number.isFinite(serverClockOffsetMs)) {
      this.serverClockOffsetMs = serverClockOffsetMs;
    }
  }

  setInterpolationDelay(delayMs: number): void {
    if (Number.isFinite(delayMs)) {
      this.interpolationDelayMs = clamp(delayMs, SNAPSHOT_INTERPOLATION_DELAY_MS, MAX_SNAPSHOT_INTERPOLATION_DELAY_MS);
    }
  }

  getInterpolationDelayMs(): number {
    return this.interpolationDelayMs;
  }

  sample(renderTime: number, localPlayerId = ""): RoomState | undefined {
    if (this.snapshots.length === 0) {
      return undefined;
    }

    if (this.snapshots.length === 1) {
      return cloneRoom(this.snapshots[0].room);
    }

    const targetTime = renderTime - this.interpolationDelayMs;
    const afterIndex = this.snapshots.findIndex((snapshot) => this.timelineAt(snapshot) >= targetTime);

    if (afterIndex === -1) {
      return cloneRoom(this.latest.room);
    }

    if (afterIndex === 0) {
      return cloneRoom(this.snapshots[0].room);
    }

    const before = this.snapshots[afterIndex - 1];
    const after = this.snapshots[afterIndex];
    const beforeTime = this.timelineAt(before);
    const afterTime = this.timelineAt(after);
    const span = Math.max(1, afterTime - beforeTime);
    const alpha = clamp01((targetTime - beforeTime) / span);
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

    return Math.max(0, this.timelineAt(this.latest) - (renderTime - this.interpolationDelayMs));
  }

  getLatestServerAgeMs(renderTime: number): number {
    if (this.snapshots.length === 0) {
      return 0;
    }

    return Math.max(0, renderTime - this.timelineAt(this.latest));
  }

  private get latest(): BufferedSnapshot {
    return this.snapshots[this.snapshots.length - 1];
  }

  private timelineAt(snapshot: BufferedSnapshot): number {
    return toClientTimeline(snapshot.sentAt, snapshot.receivedAt, this.serverClockOffsetMs);
  }
}

export function getSnapshotInterpolationDelayMs(stats: SnapshotTimingStats): number {
  if (stats.serverClockSamples <= 0) {
    return SNAPSHOT_INTERPOLATION_DELAY_MS;
  }

  const snapshotIntervalMs = stats.snapshotHz > 0 ? 1000 / stats.snapshotHz : 1000 / 30;
  const targetDelay =
    finiteOrZero(stats.transportDelayMs) +
    snapshotIntervalMs * SNAPSHOT_SAFETY_FRAMES +
    finiteOrZero(stats.snapshotJitterMs) * JITTER_SAFETY_MULTIPLIER;

  return Math.round(clamp(targetDelay, SNAPSHOT_INTERPOLATION_DELAY_MS, MAX_SNAPSHOT_INTERPOLATION_DELAY_MS));
}

function toClientTimeline(serverSentAt: number, receivedAt: number, serverClockOffsetMs?: number): number {
  if (Number.isFinite(serverClockOffsetMs) && serverClockOffsetMs !== undefined) {
    return serverSentAt - serverClockOffsetMs;
  }

  return receivedAt;
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function cloneRoom(room: RoomState): RoomState {
  return clone(room);
}

function clone<T>(value: T): T {
  return typeof structuredClone === "function" ? structuredClone(value) : (JSON.parse(JSON.stringify(value)) as T);
}
