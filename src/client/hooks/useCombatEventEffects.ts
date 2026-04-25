import { useEffect, useRef, type RefObject } from "react";
import type { RoomState } from "../../shared/types.js";
import type { DogfightScene } from "../game/DogfightScene.js";
import type { CombatNotice } from "./useGameSocket.js";

export function useCombatEventEffects(
  sceneRef: RefObject<DogfightScene | null>,
  room: RoomState | undefined,
  combatNotice: CombatNotice | undefined
): void {
  const latestRoomRef = useRef<RoomState | undefined>(undefined);

  useEffect(() => {
    latestRoomRef.current = room;
  }, [room]);

  useEffect(() => {
    const event = combatNotice?.event;
    if (!event) {
      return;
    }

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
  }, [combatNotice, sceneRef]);
}
