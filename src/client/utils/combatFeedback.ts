import type { CombatEvent } from "../../shared/types.js";

export type CombatNotice = {
  id: number;
  event: CombatEvent;
};

export type CombatFeedbackItem = {
  id: string;
  kind: "hit" | "kill" | "damage";
  text: string;
};

export function combatFeedbackItemsForNotice(
  notice: CombatNotice,
  playerId: string,
  playerNames: Record<string, string>
): CombatFeedbackItem[] {
  const { event } = notice;
  const items: CombatFeedbackItem[] = [];

  if (event.type === "hit") {
    if (event.attackerId === playerId) {
      items.push({
        id: `${notice.id}-hit`,
        kind: "hit",
        text: `HIT ${playerName(playerNames, event.victimId)} +${event.damage}`
      });
    }

    if (event.victimId === playerId) {
      items.push({
        id: `${notice.id}-damage`,
        kind: "damage",
        text: `-${event.damage}`
      });
    }
  }

  if (event.type === "kill") {
    if (event.attackerId === playerId) {
      items.push({
        id: `${notice.id}-kill`,
        kind: "kill",
        text: `KILL ${playerName(playerNames, event.victimId)}`
      });
    }

    if (event.victimId === playerId) {
      items.push({
        id: `${notice.id}-damage`,
        kind: "damage",
        text: "DESTROYED"
      });
    }
  }

  if (event.type === "crash" && event.playerId === playerId) {
    items.push({
      id: `${notice.id}-crash`,
      kind: "damage",
      text: crashText(event.reason)
    });
  }

  return items;
}

export function unprocessedCombatNotices(notices: CombatNotice[], lastProcessedId: number): CombatNotice[] {
  return notices.filter((notice) => notice.id > lastProcessedId);
}

function playerName(playerNames: Record<string, string>, playerId: string): string {
  return playerNames[playerId] ?? "Target";
}

function crashText(reason: Extract<CombatEvent, { type: "crash" }>["reason"]): string {
  if (reason === "out-of-bounds") {
    return "OUT OF BOUNDS";
  }

  if (reason === "collision") {
    return "COLLISION";
  }

  return "IMPACT";
}
