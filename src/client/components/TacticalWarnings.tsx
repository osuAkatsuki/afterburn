import type { PlayerState, RoomState } from "../../shared/types.js";

type TacticalWarningsProps = {
  room?: RoomState;
  localPlayer?: PlayerState;
};

export function TacticalWarnings({ room, localPlayer }: TacticalWarningsProps) {
  if (!room || !localPlayer || localPlayer.status !== "alive") {
    return null;
  }

  const outOfBoundsSeconds = Math.ceil(localPlayer.outOfBoundsRemainingMs / 1000);
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

  const warnings = [
    outOfBoundsSeconds > 0 ? `RETURN TO PLAYFIELD IN ${outOfBoundsSeconds}s` : "",
    incomingMissile ? "MISSILE INBOUND" : lockedByEnemy ? "MISSILE LOCKED ON YOU" : ""
  ].filter(Boolean);

  if (warnings.length === 0) {
    return null;
  }

  return (
    <section className="tactical-warnings" aria-live="assertive">
      {warnings.map((warning) => (
        <div className="tactical-warning" key={warning}>
          {warning}
        </div>
      ))}
    </section>
  );
}
