import { FLARE_COOLDOWN_SECONDS, MISSILE_COOLDOWN_SECONDS } from "../../shared/constants.js";
import { clamp } from "../../shared/math.js";
import type { PlayerState, RoomState } from "../../shared/types.js";

export function formatTime(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function roundTimeLabel(room?: RoomState): string {
  if (!room) {
    return "05:00";
  }

  const remaining = room.phase === "playing" ? Math.max(0, room.endsAt - room.now) : room.roundMs;
  return formatTime(remaining);
}

export function playerStatusLabel(room: RoomState, player: PlayerState): string {
  if (room.phase === "playing") {
    const status = player.status === "dead" ? "Respawning" : "Flying";
    if (player.isBot) {
      return `Bot / ${status}`;
    }
    return room.hostId === player.id ? `Host / ${status}` : status;
  }

  const ready = player.ready ? "Ready" : "Not ready";
  if (player.isBot) {
    return `Bot / ${ready}`;
  }
  return room.hostId === player.id ? `Host / ${ready}` : ready;
}

export function missileReadyRatio(player?: PlayerState): number {
  if (!player) {
    return 1;
  }

  if (player.missilesRemaining <= 0) {
    return 0;
  }

  return 1 - clamp(player.missileCooldown / MISSILE_COOLDOWN_SECONDS, 0, 1);
}

export function flareReadyRatio(player?: PlayerState): number {
  if (!player) {
    return 1;
  }

  if (player.flaresRemaining <= 0) {
    return 0;
  }

  return 1 - clamp(player.flareCooldown / FLARE_COOLDOWN_SECONDS, 0, 1);
}

export function speedLabel(player?: PlayerState): string {
  if (!player) {
    return "000 KT";
  }

  const speed = Math.hypot(player.velocity.x, player.velocity.y, player.velocity.z);
  return `${Math.round(speed).toString().padStart(3, "0")} KT`;
}

export function altitudeLabel(player?: PlayerState): string {
  if (!player) {
    return "000 M";
  }

  return `${Math.round(player.position.y).toString().padStart(3, "0")} M`;
}

export function sortedPlayers(room?: RoomState): PlayerState[] {
  return Object.values(room?.players ?? {}).sort((a, b) => b.score - a.score || a.deaths - b.deaths);
}
