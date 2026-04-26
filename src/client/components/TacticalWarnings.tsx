import type { CSSProperties } from "react";
import type { PlayerState, RoomState } from "../../shared/types.js";
import { getIncomingMissileCue } from "../utils/missileThreat.js";

type TacticalWarningsProps = {
  room?: RoomState;
  localPlayer?: PlayerState;
};

type TacticalWarning = {
  text: string;
  tone?: "safe";
};

export function TacticalWarnings({ room, localPlayer }: TacticalWarningsProps) {
  if (!room || !localPlayer || localPlayer.status !== "alive") {
    return null;
  }

  const outOfBoundsSeconds = Math.ceil(localPlayer.outOfBoundsRemainingMs / 1000);
  const protectionSeconds = Math.ceil(localPlayer.spawnProtectionRemainingMs / 1000);
  const incomingMissileCue = getIncomingMissileCue(room, localPlayer);
  const incomingMissile = Boolean(incomingMissileCue);
  const lockedByEnemy = Object.values(room.players).some(
    (player) =>
      player.id !== localPlayer.id &&
      player.status === "alive" &&
      player.missilesRemaining > 0 &&
      player.missileLockAcquired &&
      player.missileLockTargetId === localPlayer.id
  );

  const warnings: TacticalWarning[] = [
    outOfBoundsSeconds > 0 ? { text: `RETURN TO PLAYFIELD IN ${outOfBoundsSeconds}s` } : undefined,
    incomingMissile ? { text: "MISSILE INBOUND" } : lockedByEnemy ? { text: "MISSILE LOCKED ON YOU" } : undefined,
    protectionSeconds > 0 ? { text: `SPAWN PROTECTED ${protectionSeconds}s`, tone: "safe" } : undefined
  ].filter((warning): warning is TacticalWarning => Boolean(warning));

  if (warnings.length === 0) {
    return null;
  }

  return (
    <section className="tactical-warnings" aria-live="assertive">
      {incomingMissileCue ? (
        <div className="missile-direction" style={{ "--missile-bearing": `${incomingMissileCue.bearingRadians}rad` } as CSSProperties}>
          <i aria-hidden="true" />
          <span>MSL {incomingMissileCue.clockLabel}</span>
        </div>
      ) : null}
      {warnings.map((warning) => (
        <div className={`tactical-warning ${warning.tone ?? ""}`} key={warning.text}>
          {warning.text}
        </div>
      ))}
    </section>
  );
}
