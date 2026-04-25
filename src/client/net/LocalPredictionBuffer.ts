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
};

export class LocalPredictionBuffer {
  private readonly inputs: InputFrame[] = [];
  private renderedPlayer?: PlayerState;
  private previousAuthoritativePlayer?: PlayerState;
  private positionCorrection: Vec3 = { x: 0, y: 0, z: 0 };
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
      this.renderedPlayer = undefined;
      this.previousAuthoritativePlayer = undefined;
      this.positionCorrection = { x: 0, y: 0, z: 0 };
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

    const dt = this.consumeRenderDt(renderTime);
    const authorityChanged = this.hasAuthoritativeChange(player);
    const correctionMeters = authorityChanged && this.renderedPlayer ? distance(this.renderedPlayer.position, targetPlayer.position) : 0;
    const renderedPlayer = this.predictPlayer(targetPlayer, correctionMeters, authorityChanged, dt);
    this.previousAuthoritativePlayer = clone(player);
    this.renderedPlayer = clone(renderedPlayer);
    room.players[localPlayerId] = renderedPlayer;

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
    this.renderedPlayer = undefined;
    this.previousAuthoritativePlayer = undefined;
    this.positionCorrection = { x: 0, y: 0, z: 0 };
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

  private predictPlayer(targetPlayer: PlayerState, correctionMeters: number, authorityChanged: boolean, dt: number): PlayerState {
    if (!this.renderedPlayer || correctionMeters > SNAP_CORRECTION_METERS) {
      this.positionCorrection = { x: 0, y: 0, z: 0 };
      return clone(targetPlayer);
    }

    if (authorityChanged && correctionMeters > MIN_SMOOTHED_CORRECTION_METERS) {
      this.positionCorrection = subtractVec3(this.renderedPlayer.position, targetPlayer.position);
    }

    const alpha = 1 - Math.exp(-dt * CORRECTION_RATE);
    this.positionCorrection = lerpVec3(this.positionCorrection, { x: 0, y: 0, z: 0 }, alpha);

    return {
      ...clone(targetPlayer),
      position: addVec3(targetPlayer.position, this.positionCorrection)
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

function lerpVec3(before: Vec3, after: Vec3, alpha: number): Vec3 {
  return {
    x: lerp(before.x, after.x, alpha),
    y: lerp(before.y, after.y, alpha),
    z: lerp(before.z, after.z, alpha)
  };
}

function lerp(before: number, after: number, alpha: number): number {
  return before + (after - before) * alpha;
}

function clone<T>(value: T): T {
  return typeof structuredClone === "function" ? structuredClone(value) : (JSON.parse(JSON.stringify(value)) as T);
}
