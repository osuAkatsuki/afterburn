import type { PlayerState, RoomState } from "../../shared/types.js";
import { radarContacts } from "../utils/radar.js";

type RadarProps = {
  room?: RoomState;
  localPlayer?: PlayerState;
};

export function Radar({ room, localPlayer }: RadarProps) {
  const dots =
    room && localPlayer
      ? radarContacts(Object.values(room.players), localPlayer)
      : [];

  return (
    <aside className="radar" aria-label="Radar">
      <b />
      {dots.map(({ player, x, y, className }) => (
        <i key={player.id} className={className} style={{ "--x": `${x}px`, "--y": `${y}px`, "--pilot": player.color } as React.CSSProperties} />
      ))}
    </aside>
  );
}
