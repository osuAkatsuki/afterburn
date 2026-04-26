import { useEffect, useRef, type RefObject } from "react";
import type { RoomState } from "../../shared/types.js";
import type { DogfightScene } from "../game/DogfightScene.js";
import { unprocessedCombatNotices, type CombatNotice } from "../utils/combatFeedback.js";

export function useCombatEventEffects(
  sceneRef: RefObject<DogfightScene | null>,
  room: RoomState | undefined,
  combatNotices: CombatNotice[]
): void {
  const latestRoomRef = useRef<RoomState | undefined>(undefined);
  const processedNoticeId = useRef(0);

  useEffect(() => {
    latestRoomRef.current = room;
  }, [room]);

  useEffect(() => {
    const pendingNotices = unprocessedCombatNotices(combatNotices, processedNoticeId.current);
    if (pendingNotices.length === 0) {
      return;
    }

    processedNoticeId.current = pendingNotices[pendingNotices.length - 1].id;

    pendingNotices.forEach(({ event }) => {
      if (event.type === "impact") {
        sceneRef.current?.spawnProjectileImpact(event.position, event.projectileType);
        return;
      }

      if (event.type === "crash") {
        const player = latestRoomRef.current?.players[event.playerId];
        if (player) {
          sceneRef.current?.spawnExplosion(player.position, player.color);
        }
        return;
      }

      if (event.type !== "hit" && event.type !== "kill") {
        return;
      }

      const victim = latestRoomRef.current?.players[event.victimId];
      if (!victim) {
        return;
      }

      if (event.type === "hit") {
        sceneRef.current?.spawnHitSpark(victim.position, event.weapon === "missile" ? "#f97316" : "#fef08a");
        return;
      }

      sceneRef.current?.spawnExplosion(victim.position, victim.color);
    });
  }, [combatNotices, sceneRef]);
}
