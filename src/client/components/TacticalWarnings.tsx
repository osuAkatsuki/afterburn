import type { PlayerState, RoomState } from "../../shared/types.js";

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
  const incomingMissile = Object.values(room.projectiles).some(
    (projectile) => projectile.type === "missile" && projectile.targetType === "player" && projectile.targetId === localPlayer.id
  );
  const lockedByEnemy = Object.values(room.players).some(
    (player) =>
      player.id !== localPlayer.id &&
      player.status === "alive" &&
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
      {warnings.map((warning) => (
        <div className={`tactical-warning ${warning.tone ?? ""}`} key={warning.text}>
          {warning.text}
        </div>
      ))}
    </section>
  );
}
