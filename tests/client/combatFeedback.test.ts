import { describe, expect, it } from "vitest";
import { combatFeedbackItemsForNotice, unprocessedCombatNotices, type CombatNotice } from "../../src/client/utils/combatFeedback.js";

describe("combat feedback", () => {
  it("keeps back-to-back hit and kill notices instead of collapsing them", () => {
    const notices: CombatNotice[] = [
      {
        id: 1,
        event: {
          type: "hit",
          roomId: "ROOM1",
          attackerId: "p1",
          victimId: "p2",
          damage: 100,
          weapon: "bullet"
        }
      },
      {
        id: 2,
        event: {
          type: "kill",
          roomId: "ROOM1",
          attackerId: "p1",
          victimId: "p2"
        }
      }
    ];

    const items = unprocessedCombatNotices(notices, 0).flatMap((notice) =>
      combatFeedbackItemsForNotice(notice, "p1", { p2: "Bandit" })
    );

    expect(items.map((item) => item.text)).toEqual(["HIT Bandit +100", "KILL Bandit"]);
  });

  it("filters already processed combat notices", () => {
    const notices: CombatNotice[] = [
      { id: 10, event: { type: "launch", roomId: "ROOM1", playerId: "p1", weapon: "bullet" } },
      { id: 11, event: { type: "kill", roomId: "ROOM1", attackerId: "p1", victimId: "p2" } },
      { id: 12, event: { type: "crash", roomId: "ROOM1", playerId: "p2", reason: "terrain" } }
    ];

    expect(unprocessedCombatNotices(notices, 10).map((notice) => notice.id)).toEqual([11, 12]);
  });

  it("shows incoming damage and destruction for the victim", () => {
    const hitNotice: CombatNotice = {
      id: 1,
      event: {
        type: "hit",
        roomId: "ROOM1",
        attackerId: "p1",
        victimId: "p2",
        damage: 35,
        weapon: "missile"
      }
    };
    const killNotice: CombatNotice = {
      id: 2,
      event: {
        type: "kill",
        roomId: "ROOM1",
        attackerId: "p1",
        victimId: "p2"
      }
    };

    expect(combatFeedbackItemsForNotice(hitNotice, "p2", {}).map((item) => item.text)).toEqual(["-35"]);
    expect(combatFeedbackItemsForNotice(killNotice, "p2", {}).map((item) => item.text)).toEqual(["DESTROYED"]);
  });
});
