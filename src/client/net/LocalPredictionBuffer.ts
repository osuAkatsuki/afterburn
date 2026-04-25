import { TICK_RATE } from "../../shared/constants.js";
import { distance } from "../../shared/math.js";
import { applyPlayerFlightStep } from "../../shared/simulation.js";
import type { InputFrame, RoomState } from "../../shared/types.js";

const MAX_RECORDED_INPUTS = 96;
const MAX_REPLAYED_INPUTS = 45;
const REPLAY_DT_SECONDS = 1 / TICK_RATE;

export type LocalPredictionStats = {
  pendingInputs: number;
  predictedMs: number;
  leadMeters: number;
};

export class LocalPredictionBuffer {
  private readonly inputs: InputFrame[] = [];
  private stats: LocalPredictionStats = {
    pendingInputs: 0,
    predictedMs: 0,
    leadMeters: 0
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

  apply(room: RoomState | undefined, localPlayerId: string): RoomState | undefined {
    const player = room?.players[localPlayerId];
    if (!room || !player || player.status !== "alive") {
      this.stats = { pendingInputs: 0, predictedMs: 0, leadMeters: 0 };
      return room;
    }

    this.pruneAcknowledged(player.lastInputSeq);
    const pendingInputs = this.inputs
      .filter((input) => input.seq > player.lastInputSeq)
      .slice(-MAX_REPLAYED_INPUTS);

    if (pendingInputs.length === 0) {
      this.stats = { pendingInputs: 0, predictedMs: 0, leadMeters: 0 };
      return room;
    }

    const authoritativePosition = clone(player.position);
    pendingInputs.forEach((input) => {
      applyPlayerFlightStep(player, input, REPLAY_DT_SECONDS);
    });

    this.stats = {
      pendingInputs: pendingInputs.length,
      predictedMs: pendingInputs.length * REPLAY_DT_SECONDS * 1000,
      leadMeters: distance(authoritativePosition, player.position)
    };
    return room;
  }

  clear(): void {
    this.inputs.length = 0;
    this.stats = { pendingInputs: 0, predictedMs: 0, leadMeters: 0 };
  }

  getStats(): LocalPredictionStats {
    return this.stats;
  }

  private pruneAcknowledged(lastInputSeq: number): void {
    while (this.inputs.length > 0 && this.inputs[0].seq <= lastInputSeq) {
      this.inputs.shift();
    }
  }
}

function clone<T>(value: T): T {
  return typeof structuredClone === "function" ? structuredClone(value) : (JSON.parse(JSON.stringify(value)) as T);
}
