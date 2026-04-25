import { TICK_RATE } from "../../shared/constants.js";
import { distance } from "../../shared/math.js";
import { applyPlayerFlightStep } from "../../shared/simulation.js";
import type { InputFrame, PlayerState, RoomState, Vec3 } from "../../shared/types.js";

const MAX_RECORDED_INPUTS = 96;
const MAX_REPLAYED_INPUTS = 45;
const REPLAY_DT_SECONDS = 1 / TICK_RATE;
const CORRECTION_RATE = 14;
const SNAP_CORRECTION_METERS = 95;
const MIN_SMOOTHED_CORRECTION_METERS = 0.75;

export type LocalPredictionStats = {
  pendingInputs: number;
  predictedMs: number;
  leadMeters: number;
  correctionMeters: number;
  correctionLastMeters: number;
  correctionAgeMs: number;
  correctionIntervalMs: number;
  correctionEvents: number;
  ackSeq: number;
  ackDelta: number;
  ackAgeMs: number;
  ackIntervalMs: number;
};

export class LocalPredictionBuffer {
  private readonly inputs: InputFrame[] = [];
  private predictedPlayer?: PlayerState;
  private renderedPlayer?: PlayerState;
  private previousAuthoritativePlayer?: PlayerState;
  private positionCorrection: Vec3 = { x: 0, y: 0, z: 0 };
  private lastCorrectionMeters = 0;
  private lastCorrectionAt = 0;
  private correctionIntervalMs = 0;
  private correctionEvents = 0;
  private lastAckSeq = 0;
  private lastAckAt = 0;
  private ackDelta = 0;
  private ackIntervalMs = 0;
  private lastRenderTime = 0;
  private stats: LocalPredictionStats = {
    pendingInputs: 0,
    predictedMs: 0,
    leadMeters: 0,
    correctionMeters: 0,
    correctionLastMeters: 0,
    correctionAgeMs: 0,
    correctionIntervalMs: 0,
    correctionEvents: 0,
    ackSeq: 0,
    ackDelta: 0,
    ackAgeMs: 0,
    ackIntervalMs: 0
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
      this.predictedPlayer = undefined;
      this.renderedPlayer = undefined;
      this.previousAuthoritativePlayer = undefined;
      this.positionCorrection = { x: 0, y: 0, z: 0 };
      this.lastCorrectionMeters = 0;
      this.lastCorrectionAt = 0;
      this.correctionIntervalMs = 0;
      this.correctionEvents = 0;
      this.lastAckSeq = 0;
      this.lastAckAt = 0;
      this.ackDelta = 0;
      this.ackIntervalMs = 0;
      this.lastRenderTime = renderTime;
      this.stats = this.emptyStats();
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

    const dt = this.consumeRenderDt(renderTime);
    const authorityChanged = this.hasAuthoritativeChange(player);
    this.updateAckStats(player.lastInputSeq, renderTime);
    const renderedPlayer = this.predictPlayer(targetPlayer, authorityChanged, dt, renderTime);
    this.previousAuthoritativePlayer = clone(player);
    this.renderedPlayer = clone(renderedPlayer);
    room.players[localPlayerId] = renderedPlayer;

    this.stats = {
      pendingInputs: pendingInputs.length,
      predictedMs: pendingInputs.length * REPLAY_DT_SECONDS * 1000,
      leadMeters: distance(authoritativePosition, targetPlayer.position),
      correctionMeters: magnitudeVec3(this.positionCorrection),
      correctionLastMeters: this.lastCorrectionMeters,
      correctionAgeMs: this.lastCorrectionAt > 0 ? renderTime - this.lastCorrectionAt : 0,
      correctionIntervalMs: this.correctionIntervalMs,
      correctionEvents: this.correctionEvents,
      ackSeq: this.lastAckSeq,
      ackDelta: this.ackDelta,
      ackAgeMs: this.lastAckAt > 0 ? renderTime - this.lastAckAt : 0,
      ackIntervalMs: this.ackIntervalMs
    };
    return room;
  }

  clear(): void {
    this.inputs.length = 0;
    this.predictedPlayer = undefined;
    this.renderedPlayer = undefined;
    this.previousAuthoritativePlayer = undefined;
    this.positionCorrection = { x: 0, y: 0, z: 0 };
    this.lastCorrectionMeters = 0;
    this.lastCorrectionAt = 0;
    this.correctionIntervalMs = 0;
    this.correctionEvents = 0;
    this.lastAckSeq = 0;
    this.lastAckAt = 0;
    this.ackDelta = 0;
    this.ackIntervalMs = 0;
    this.lastRenderTime = 0;
    this.stats = this.emptyStats();
  }

  getStats(): LocalPredictionStats {
    return this.stats;
  }

  private pruneAcknowledged(lastInputSeq: number): void {
    while (this.inputs.length > 0 && this.inputs[0].seq <= lastInputSeq) {
      this.inputs.shift();
    }
  }

  private predictPlayer(targetPlayer: PlayerState, authorityChanged: boolean, dt: number, renderTime: number): PlayerState {
    if (!this.predictedPlayer || !this.renderedPlayer) {
      this.predictedPlayer = clone(targetPlayer);
      this.positionCorrection = { x: 0, y: 0, z: 0 };
      this.lastCorrectionMeters = 0;
      return clone(targetPlayer);
    }

    const previousPredictedPlayer = clone(this.predictedPlayer);
    const predictedPlayer = authorityChanged ? clone(targetPlayer) : clone(previousPredictedPlayer);
    applyPlayerFlightStep(predictedPlayer, this.inputs.at(-1) ?? targetPlayer.input, dt);

    if (authorityChanged) {
      const correction = subtractVec3(previousPredictedPlayer.position, predictedPlayer.position);
      const correctionMeters = magnitudeVec3(correction);
      this.lastCorrectionMeters = correctionMeters;

      if (correctionMeters > SNAP_CORRECTION_METERS) {
        this.predictedPlayer = clone(targetPlayer);
        this.positionCorrection = { x: 0, y: 0, z: 0 };
        this.recordCorrection(correctionMeters, renderTime);
        return clone(targetPlayer);
      }

      if (correctionMeters > 0.001) {
        this.positionCorrection = addVec3(this.positionCorrection, correction);
      }

      if (correctionMeters > MIN_SMOOTHED_CORRECTION_METERS) {
        this.recordCorrection(correctionMeters, renderTime);
      }
    }

    const alpha = 1 - Math.exp(-dt * CORRECTION_RATE);
    const correctionStep = scaleVec3(this.positionCorrection, alpha);
    this.positionCorrection = subtractVec3(this.positionCorrection, correctionStep);
    this.predictedPlayer = clone(predictedPlayer);

    return {
      ...clone(targetPlayer),
      position: addVec3(predictedPlayer.position, this.positionCorrection),
      velocity: predictedPlayer.velocity,
      rotation: predictedPlayer.rotation,
      orientation: predictedPlayer.orientation,
      throttle: predictedPlayer.throttle,
      input: predictedPlayer.input
    };
  }

  private consumeRenderDt(renderTime: number): number {
    const dt = this.lastRenderTime > 0 ? Math.max(0, Math.min(0.1, (renderTime - this.lastRenderTime) / 1000)) : 1 / 60;
    this.lastRenderTime = renderTime;
    return dt;
  }

  private hasAuthoritativeChange(player: PlayerState): boolean {
    if (!this.previousAuthoritativePlayer) {
      return true;
    }

    return (
      player.lastInputSeq !== this.previousAuthoritativePlayer.lastInputSeq ||
      distance(player.position, this.previousAuthoritativePlayer.position) > 0.001 ||
      distance(player.velocity, this.previousAuthoritativePlayer.velocity) > 0.001 ||
      player.status !== this.previousAuthoritativePlayer.status
    );
  }

  private updateAckStats(ackSeq: number, renderTime: number): void {
    if (ackSeq === this.lastAckSeq) {
      return;
    }

    this.ackDelta = ackSeq - this.lastAckSeq;
    this.ackIntervalMs = this.lastAckAt > 0 ? renderTime - this.lastAckAt : 0;
    this.lastAckSeq = ackSeq;
    this.lastAckAt = renderTime;
  }

  private recordCorrection(correctionMeters: number, renderTime: number): void {
    this.correctionIntervalMs = this.lastCorrectionAt > 0 ? renderTime - this.lastCorrectionAt : 0;
    this.lastCorrectionAt = renderTime;
    this.lastCorrectionMeters = correctionMeters;
    this.correctionEvents += 1;
  }

  private emptyStats(): LocalPredictionStats {
    return {
      pendingInputs: 0,
      predictedMs: 0,
      leadMeters: 0,
      correctionMeters: 0,
      correctionLastMeters: 0,
      correctionAgeMs: 0,
      correctionIntervalMs: 0,
      correctionEvents: 0,
      ackSeq: 0,
      ackDelta: 0,
      ackAgeMs: 0,
      ackIntervalMs: 0
    };
  }
}

function addVec3(before: Vec3, after: Vec3): Vec3 {
  return {
    x: before.x + after.x,
    y: before.y + after.y,
    z: before.z + after.z
  };
}

function subtractVec3(before: Vec3, after: Vec3): Vec3 {
  return {
    x: before.x - after.x,
    y: before.y - after.y,
    z: before.z - after.z
  };
}

function scaleVec3(value: Vec3, scalar: number): Vec3 {
  return {
    x: value.x * scalar,
    y: value.y * scalar,
    z: value.z * scalar
  };
}

function magnitudeVec3(value: Vec3): number {
  return Math.hypot(value.x, value.y, value.z);
}

function clone<T>(value: T): T {
  return typeof structuredClone === "function" ? structuredClone(value) : (JSON.parse(JSON.stringify(value)) as T);
}
