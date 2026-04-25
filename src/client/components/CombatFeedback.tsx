import { useEffect, useRef, useState } from "react";
import type { CombatEvent, RoomState } from "../../shared/types.js";

type CombatNotice = {
  id: number;
  event: CombatEvent;
};

type FeedbackItem = {
  id: string;
  kind: "hit" | "kill" | "damage";
  text: string;
};

type CombatFeedbackProps = {
  notice?: CombatNotice;
  playerId: string;
  room?: RoomState;
};

export function CombatFeedback({ notice, playerId, room }: CombatFeedbackProps) {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const processedNoticeId = useRef<number | undefined>(undefined);
  const playerNames = useRef<Record<string, string>>({});

  useEffect(() => {
    playerNames.current = Object.fromEntries(Object.values(room?.players ?? {}).map((player) => [player.id, player.name]));
  }, [room]);

  useEffect(() => {
    const event = notice?.event;
    if (!event || !playerId || notice.id === processedNoticeId.current) {
      return;
    }
    processedNoticeId.current = notice.id;

    const nextItems: FeedbackItem[] = [];

    if (event.type === "hit") {
      if (event.attackerId === playerId) {
        const victimName = playerNames.current[event.victimId] ?? "Target";
        nextItems.push({
          id: `${notice.id}-hit`,
          kind: "hit",
          text: `HIT ${victimName} +${event.damage}`
        });
      }

      if (event.victimId === playerId) {
        nextItems.push({
          id: `${notice.id}-damage`,
          kind: "damage",
          text: `-${event.damage}`
        });
      }
    }

    if (event.type === "kill") {
      if (event.attackerId === playerId) {
        const victimName = playerNames.current[event.victimId] ?? "Target";
        nextItems.push({
          id: `${notice.id}-kill`,
          kind: "kill",
          text: `KILL ${victimName}`
        });
      }

      if (event.victimId === playerId) {
        nextItems.push({
          id: `${notice.id}-damage`,
          kind: "damage",
          text: "DESTROYED"
        });
      }
    }

    if (event.type === "crash" && event.playerId === playerId) {
      nextItems.push({
        id: `${notice.id}-crash`,
        kind: "damage",
        text: event.reason === "out-of-bounds" ? "OUT OF BOUNDS" : "IMPACT"
      });
    }

    if (nextItems.length === 0) {
      return;
    }

    setItems((current) => [...current, ...nextItems].slice(-5));
    const timeout = window.setTimeout(() => {
      setItems((current) => current.filter((item) => !nextItems.some((next) => next.id === item.id)));
    }, 820);

    return () => window.clearTimeout(timeout);
  }, [notice, playerId]);

  const damageItems = items.filter((item) => item.kind === "damage");
  const confirmations = items.filter((item) => item.kind !== "damage");

  return (
    <div className="combat-feedback" aria-live="polite">
      {damageItems.map((item) => (
        <div className="damage-flash" key={item.id}>
          <span>{item.text}</span>
        </div>
      ))}
      <div className="hit-confirmations">
        {confirmations.map((item) => (
          <div className={`hit-confirmation ${item.kind}`} key={item.id}>
            {item.text}
          </div>
        ))}
      </div>
    </div>
  );
}
