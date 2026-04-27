import { forwardRef, useMemo } from "react";
import type { PlayerState, RoomState } from "../../shared/types.js";

type TargetOverlayProps = {
  room?: RoomState;
  localPlayer?: PlayerState;
};

export const TargetOverlay = forwardRef<HTMLDivElement, TargetOverlayProps>(function TargetOverlay({ room, localPlayer }, ref) {
  const targets = useMemo(
    () =>
      Object.values(room?.players ?? {})
        .filter((player) => player.id !== localPlayer?.id && player.status === "alive")
        .sort((first, second) => first.name.localeCompare(second.name)),
    [localPlayer?.id, room]
  );

  return (
    <div className="target-overlay" aria-hidden="true" ref={ref}>
      {targets.map((target) => (
        <div className="target-label" data-player-id={target.id} key={target.id}>
          <div className="target-lock-box">
            <i />
            <i />
            <i />
            <i />
            <b />
          </div>
          <div className="target-travel-vector" />
          <div className="target-label-copy">
            <strong>{target.name}</strong>
            <span className="target-label-range" />
            <em className="target-label-speed" />
          </div>
        </div>
      ))}
    </div>
  );
});
