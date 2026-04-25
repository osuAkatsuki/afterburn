import { TICK_RATE } from "../../shared/constants.js";
import { distance } from "../../shared/math.js";
import { applyPlayerFlightStep } from "../../shared/simulation.js";
import type { InputFrame, PlayerState, Quaternion, RoomState, Rotation, Vec3 } from "../../shared/types.js";

const MAX_RECORDED_INPUTS = 96;
const MAX_REPLAYED_INPUTS = 45;
const REPLAY_DT_SECONDS = 1 / TICK_RATE;
const CORRECTION_RATE = 14;
const SNAP_CORRECTION_METERS = 95;

export type LocalPredictionStats = {
  pendingInputs: number;
  predictedMs: number;
  leadMeters: number;
  correctionMeters: number;
};

export class LocalPredictionBuffer {
  private readonly inputs: InputFrame[] = [];
  private smoothedPlayer?: PlayerState;
  private lastRenderTime = 0;
  private stats: LocalPredictionStats = {
    pendingInputs: 0,
    predictedMs: 0,
    leadMeters: 0,
    correctionMeters: 0
  };

  recordInput(input: InputFrame): void {
    if (this.inputs.at(-1)?.seq === input.seq) {
      this.inputs[this.inputs.length - 1] = clone(input);
      return;
    }

    this.inputs.push(clone(input));
    this.inputs.sort((a, b) => a.seq - b.seq);

    while (this.inputs.length > MAX_RECORDED_INPUTS) {
      this.inputs.shift();
    }
  }

  apply(room: RoomState | undefined, localPlayerId: string, renderTime = performance.now()): RoomState | undefined {
    const player = room?.players[localPlayerId];
    if (!room || !player || player.status !== "alive") {
      this.smoothedPlayer = undefined;
      this.lastRenderTime = renderTime;
      this.stats = { pendingInputs: 0, predictedMs: 0, leadMeters: 0, correctionMeters: 0 };
      return room;
    }

    this.pruneAcknowledged(player.lastInputSeq);
    const pendingInputs = this.inputs
      .filter((input) => input.seq > player.lastInputSeq)
      .slice(-MAX_REPLAYED_INPUTS);

    const authoritativePosition = clone(player.position);
    const targetPlayer = clone(player);
    pendingInputs.forEach((input) => {
      applyPlayerFlightStep(targetPlayer, input, REPLAY_DT_SECONDS);
    });

    const correctionMeters = this.smoothedPlayer ? distance(this.smoothedPlayer.position, targetPlayer.position) : 0;
    this.smoothedPlayer = this.smoothPlayer(targetPlayer, correctionMeters, renderTime);
    room.players[localPlayerId] = clone(this.smoothedPlayer);

    this.stats = {
      pendingInputs: pendingInputs.length,
      predictedMs: pendingInputs.length * REPLAY_DT_SECONDS * 1000,
      leadMeters: distance(authoritativePosition, targetPlayer.position),
      correctionMeters
    };
    return room;
  }

  clear(): void {
    this.inputs.length = 0;
    this.smoothedPlayer = undefined;
    this.lastRenderTime = 0;
    this.stats = { pendingInputs: 0, predictedMs: 0, leadMeters: 0, correctionMeters: 0 };
  }

  getStats(): LocalPredictionStats {
    return this.stats;
  }

  private pruneAcknowledged(lastInputSeq: number): void {
    while (this.inputs.length > 0 && this.inputs[0].seq <= lastInputSeq) {
      this.inputs.shift();
    }
  }

  private smoothPlayer(targetPlayer: PlayerState, correctionMeters: number, renderTime: number): PlayerState {
    if (!this.smoothedPlayer || correctionMeters > SNAP_CORRECTION_METERS) {
      this.lastRenderTime = renderTime;
      return clone(targetPlayer);
    }

    const dt = this.lastRenderTime > 0 ? Math.max(0, Math.min(0.1, (renderTime - this.lastRenderTime) / 1000)) : 1 / 60;
    this.lastRenderTime = renderTime;
    const alpha = 1 - Math.exp(-dt * CORRECTION_RATE);
    return {
      ...clone(targetPlayer),
      position: lerpVec3(this.smoothedPlayer.position, targetPlayer.position, alpha),
      velocity: lerpVec3(this.smoothedPlayer.velocity, targetPlayer.velocity, alpha),
      rotation: lerpRotation(this.smoothedPlayer.rotation, targetPlayer.rotation, alpha),
      orientation:
        this.smoothedPlayer.orientation && targetPlayer.orientation
          ? nlerpQuaternion(this.smoothedPlayer.orientation, targetPlayer.orientation, alpha)
          : targetPlayer.orientation
    };
  }
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

function clone<T>(value: T): T {
  return typeof structuredClone === "function" ? structuredClone(value) : (JSON.parse(JSON.stringify(value)) as T);
}
