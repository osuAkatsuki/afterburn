import { useCallback, useEffect, useRef, useState } from "react";
import type { PlayerState, RoomState } from "../../shared/types.js";
import { GameAudio } from "../audio/GameAudio.js";
import type { CombatNotice } from "./useGameSocket.js";

type UseGameAudioOptions = {
  room?: RoomState;
  localPlayer?: PlayerState;
  playerId: string;
  combatNotice?: CombatNotice;
};

type GameAudioControls = {
  muted: boolean;
  toggleMuted: () => void;
};

const AUDIO_MUTED_KEY = "afterburn.audio.muted";

export function useGameAudio({ room, localPlayer, playerId, combatNotice }: UseGameAudioOptions): GameAudioControls {
  const audioRef = useRef<GameAudio | null>(null);
  const [muted, setMuted] = useState(() => window.localStorage.getItem(AUDIO_MUTED_KEY) === "true");

  useEffect(() => {
    const audio = new GameAudio();
    audio.setMuted(muted);
    audioRef.current = audio;

    const unlock = () => {
      void audio.unlock();
    };

    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      audio.destroy();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(AUDIO_MUTED_KEY, muted ? "true" : "false");
    audioRef.current?.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.updateFlight(localPlayer);
    audio.updateWarnings(room, localPlayer);
  }, [localPlayer, room]);

  useEffect(() => {
    const event = combatNotice?.event;
    if (!event) {
      return;
    }

    audioRef.current?.handleCombatEvent(event, room, playerId);
  }, [combatNotice, playerId, room]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "KeyM" || event.repeat || isEditableTarget(event.target)) {
        return;
      }

      setMuted((current) => {
        const next = !current;
        audioRef.current?.setMuted(next);
        if (!next) {
          window.setTimeout(() => void audioRef.current?.unlock(), 0);
        }
        return next;
      });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      audioRef.current?.setMuted(next);
      if (!next) {
        window.setTimeout(() => void audioRef.current?.unlock(), 0);
      }
      return next;
    });
  }, []);

  return { muted, toggleMuted };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || target.matches("input, textarea, select");
}
