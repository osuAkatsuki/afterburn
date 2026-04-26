import { describe, expect, it } from "vitest";
import { PlayerInputQueue } from "../../src/server/net/PlayerInputQueue.js";

describe("PlayerInputQueue", () => {
  it("consumes normal input backlogs in sequence", () => {
    const queue = new PlayerInputQueue();
    queue.enqueue({ seq: 1, roll: 1 }, 0);
    queue.enqueue({ seq: 2, roll: -1 }, 0);

    expect(queue.consume(0)?.seq).toBe(1);
    expect(queue.consume(1)?.seq).toBe(2);
    expect(queue.consume(2)).toBeUndefined();
  });

  it("catches up large backlogs while preserving one-shot weapon edges", () => {
    const queue = new PlayerInputQueue();
    queue.enqueue({ seq: 1, fireGun: true, roll: 1 }, 0);
    queue.enqueue({ seq: 2, fireGun: false, roll: 0.5 }, 0);
    queue.enqueue({ seq: 3, fireGun: false, roll: 0 }, 0);
    queue.enqueue({ seq: 4, fireGun: false, roll: -0.5 }, 0);
    queue.enqueue({ seq: 5, fireGun: false, roll: -1 }, 0);

    const input = queue.consume(0);

    expect(input?.seq).toBe(3);
    expect(input?.roll).toBe(0);
    expect(input?.fireGun).toBe(true);
    expect(queue.stats().queued).toBe(2);
  });

  it("rejects stale and out-of-order inputs", () => {
    const queue = new PlayerInputQueue();

    expect(queue.enqueue({ seq: 1, roll: 1 }, 2)).toBe(false);
    expect(queue.enqueue({ seq: 4, roll: 1 }, 2)).toBe(true);
    expect(queue.enqueue({ seq: 3, roll: -1 }, 2)).toBe(false);
    expect(queue.consume(2)?.seq).toBe(4);
  });
});
