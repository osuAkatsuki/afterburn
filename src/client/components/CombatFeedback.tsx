import { useEffect, useRef, useState } from "react";
import type { RoomState } from "../../shared/types.js";
import {
  combatFeedbackItemsForNotices,
  unprocessedCombatNotices,
  type CombatFeedbackItem,
  type CombatNotice
} from "../utils/combatFeedback.js";

type CombatFeedbackProps = {
  notices: CombatNotice[];
  playerId: string;
  room?: RoomState;
};

const FEEDBACK_LIFETIME_MS = 1150;

export function CombatFeedback({ notices, playerId, room }: CombatFeedbackProps) {
  const [items, setItems] = useState<CombatFeedbackItem[]>([]);
  const processedNoticeId = useRef(0);
  const playerNames = useRef<Record<string, string>>({});
  const timeouts = useRef<number[]>([]);

  useEffect(() => {
    playerNames.current = Object.fromEntries(Object.values(room?.players ?? {}).map((player) => [player.id, player.name]));
  }, [room]);

  useEffect(() => {
    return () => {
      timeouts.current.forEach((timeout) => window.clearTimeout(timeout));
      timeouts.current = [];
    };
  }, []);

  useEffect(() => {
    if (!playerId) {
      return;
    }

    const pendingNotices = unprocessedCombatNotices(notices, processedNoticeId.current);
    if (pendingNotices.length === 0) {
      return;
    }

    processedNoticeId.current = pendingNotices[pendingNotices.length - 1].id;
    const nextItems = combatFeedbackItemsForNotices(pendingNotices, playerId, playerNames.current);

    if (nextItems.length === 0) {
      return;
    }

    setItems((current) => [...current, ...nextItems].slice(-8));
    const timeout = window.setTimeout(() => {
      setItems((current) => current.filter((item) => !nextItems.some((next) => next.id === item.id)));
      timeouts.current = timeouts.current.filter((currentTimeout) => currentTimeout !== timeout);
    }, FEEDBACK_LIFETIME_MS);

    timeouts.current.push(timeout);
  }, [notices, playerId]);

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
