import { sanitizeInput } from "../../shared/simulation.js";
import type { InputFrame } from "../../shared/types.js";

const MAX_QUEUED_INPUTS = 96;
const MAX_ORDERED_BACKLOG = 3;

export type PlayerInputQueueStats = {
  queued: number;
  dropped: number;
  consumed: number;
};

export class PlayerInputQueue {
  private readonly inputs: InputFrame[] = [];
  private dropped = 0;
  private consumed = 0;

  enqueue(input: Partial<InputFrame>, lastProcessedSeq: number): boolean {
    const sanitized = sanitizeInput(input, 0);
    if (sanitized.seq <= lastProcessedSeq) {
      return false;
    }

    const lastQueued = this.inputs.at(-1);
    if (lastQueued && sanitized.seq < lastQueued.seq) {
      this.dropped += 1;
      return false;
    }

    if (lastQueued && sanitized.seq === lastQueued.seq) {
      this.inputs[this.inputs.length - 1] = sanitized;
      return true;
    }

    this.inputs.push(sanitized);
    while (this.inputs.length > MAX_QUEUED_INPUTS) {
      this.inputs.shift();
      this.dropped += 1;
    }
    return true;
  }

  consume(lastProcessedSeq: number): InputFrame | undefined {
    while (this.inputs.length > 0 && this.inputs[0].seq <= lastProcessedSeq) {
      this.inputs.shift();
      this.dropped += 1;
    }

    if (this.inputs.length === 0) {
      return undefined;
    }

    const consumeCount = this.inputs.length > MAX_ORDERED_BACKLOG ? this.inputs.length - MAX_ORDERED_BACKLOG + 1 : 1;
    const consumedInputs = this.inputs.splice(0, consumeCount);
    this.consumed += consumedInputs.length;
    const selected = consumedInputs[consumedInputs.length - 1];

    return {
      ...selected,
      fireGun: consumedInputs.some((input) => input.fireGun),
      fireMissile: consumedInputs.some((input) => input.fireMissile),
      fireFlare: consumedInputs.some((input) => input.fireFlare)
    };
  }

  isEmpty(): boolean {
    return this.inputs.length === 0;
  }

  stats(): PlayerInputQueueStats {
    return {
      queued: this.inputs.length,
      dropped: this.dropped,
      consumed: this.consumed
    };
  }
}
