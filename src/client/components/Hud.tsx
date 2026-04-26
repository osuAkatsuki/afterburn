import type { PlayerState, RoomState } from "../../shared/types.js";
import { altitudeLabel, flareReadyRatio, missileReadyRatio, roundTimeLabel, speedLabel } from "../utils/format.js";

type HudProps = {
  room?: RoomState;
  localPlayer?: PlayerState;
};

export function Hud({ room, localPlayer }: HudProps) {
  const incomingMissile = localPlayer
    ? Object.values(room?.projectiles ?? {}).some((projectile) => projectile.type === "missile" && projectile.targetType === "player" && projectile.targetId === localPlayer.id)
    : false;
  const afterburner = localPlayer?.input.afterburner === true;
  const hasMissiles = (localPlayer?.missilesRemaining ?? 0) > 0;
  const lockProgress = hasMissiles ? localPlayer?.missileLockProgress ?? 0 : 0;
  const lockLabel = hasMissiles && localPlayer?.missileLockAcquired ? "Locked" : lockProgress > 0 ? "Locking" : "Lock";
  const outOfBoundsSeconds = Math.ceil((localPlayer?.outOfBoundsRemainingMs ?? 0) / 1000);
  const statusText =
    outOfBoundsSeconds > 0
      ? `RETURN TO PLAYFIELD IN ${outOfBoundsSeconds}s`
      : incomingMissile
        ? "MISSILE INBOUND"
        : room?.phase.toUpperCase() ?? "LOBBY";

  return (
    <section className={`hud ${incomingMissile || outOfBoundsSeconds > 0 ? "threat" : ""}`} aria-live="polite">
      <div className="hud-top">
        <div className="status-stack">
          <strong>{room ? `ROOM ${room.id}` : "NO ROOM"}</strong>
          <span>{statusText}</span>
        </div>
        <div className="timer">{roundTimeLabel(room)}</div>
      </div>

      <div className="bars">
        <label>
          <span>Hull</span>
          <meter min="0" max="100" value={localPlayer?.health ?? 100} />
        </label>
        <label>
          <span>Heat</span>
          <meter min="0" max="1" value={localPlayer?.gunHeat ?? 0} />
        </label>
        <label>
          <span>A/B</span>
          <meter min="0" max="1" value={afterburner ? 1 : 0} />
        </label>
        <label>
          <span>MSL {localPlayer?.missilesRemaining ?? 0}</span>
          <meter min="0" max="1" value={missileReadyRatio(localPlayer)} />
        </label>
        {hasMissiles ? (
          <label>
            <span>{lockLabel}</span>
            <meter min="0" max="1" value={lockProgress} />
          </label>
        ) : null}
        <label>
          <span>FLR {localPlayer?.flaresRemaining ?? 0}</span>
          <meter min="0" max="1" value={flareReadyRatio(localPlayer)} />
        </label>
      </div>

      <div className="flight-readout">
        <span>{speedLabel(localPlayer)}</span>
        <span>{altitudeLabel(localPlayer)}</span>
        <span>{localPlayer ? `${localPlayer.score} K / ${localPlayer.deaths} D` : "0 K / 0 D"}</span>
      </div>
    </section>
  );
}
