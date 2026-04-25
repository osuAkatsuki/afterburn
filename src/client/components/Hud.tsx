import type { PlayerState, RoomState } from "../../shared/types.js";
import { altitudeLabel, flareReadyRatio, missileReadyRatio, roundTimeLabel, speedLabel } from "../utils/format.js";

type HudProps = {
  room?: RoomState;
  localPlayer?: PlayerState;
};

export function Hud({ room, localPlayer }: HudProps) {
  return (
    <section className="hud" aria-live="polite">
      <div className="hud-top">
        <div className="status-stack">
          <strong>{room ? `ROOM ${room.id}` : "NO ROOM"}</strong>
          <span>{room?.phase.toUpperCase() ?? "LOBBY"}</span>
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
          <span>MSL {localPlayer?.missilesRemaining ?? 0}</span>
          <meter min="0" max="1" value={missileReadyRatio(localPlayer)} />
        </label>
        <label>
          <span>Lock</span>
          <meter min="0" max="1" value={localPlayer?.missileLockProgress ?? 0} />
        </label>
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
