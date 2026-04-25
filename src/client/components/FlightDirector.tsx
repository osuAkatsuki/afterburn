import type { PlayerState, RoomState } from "../../shared/types.js";
import { altitudeLabel, speedLabel } from "../utils/format.js";

type FlightDirectorProps = {
  room?: RoomState;
  localPlayer?: PlayerState;
};

export function FlightDirector({ room, localPlayer }: FlightDirectorProps) {
  if (!localPlayer || localPlayer.status !== "alive") {
    return null;
  }

  const heading = normalizeHeading(localPlayer.rotation.yaw);
  const incomingMissile = Object.values(room?.projectiles ?? {}).some(
    (projectile) => projectile.type === "missile" && projectile.targetType === "player" && projectile.targetId === localPlayer.id
  );
  const afterburner = localPlayer.input.afterburner;
  const hullCritical = localPlayer.health > 0 && localPlayer.health <= 35;
  const outOfBoundsSeconds = Math.ceil(localPlayer.outOfBoundsRemainingMs / 1000);

  return (
    <section className="flight-director" aria-hidden="true">
      <div className="heading-tape">
        <span>HDG</span>
        <strong>{heading.toString().padStart(3, "0")}</strong>
      </div>

      <div className="hud-scale hud-scale-left">
        <span>SPD</span>
        <strong>{speedLabel(localPlayer).replace(" KT", "")}</strong>
      </div>

      <div className="hud-scale hud-scale-right">
        <span>ALT</span>
        <strong>{altitudeLabel(localPlayer).replace(" M", "")}</strong>
      </div>

      <div className="annunciators">
        {outOfBoundsSeconds > 0 ? <strong className="danger">AREA {outOfBoundsSeconds.toString().padStart(2, "0")}</strong> : null}
        {incomingMissile ? <strong className="danger">MISSILE</strong> : null}
        {hullCritical ? <strong className="danger">HULL</strong> : null}
        {afterburner ? <strong className="active">A/B</strong> : null}
      </div>
    </section>
  );
}

function normalizeHeading(yaw: number): number {
  return Math.round((((yaw * 180) / Math.PI) % 360 + 360) % 360);
}
