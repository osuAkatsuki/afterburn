import { clamp, distance, length } from "../../shared/math.js";
import type { CombatEvent, PlayerState, RoomState, Vec3 } from "../../shared/types.js";

type AudioContextConstructor = new () => AudioContext;
type WebAudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor;
  };

const MASTER_GAIN = 0.48;
const SILENCE = 0.0001;
const EVENT_HEARING_RANGE = 1200;

export class GameAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private engineOsc?: OscillatorNode;
  private engineWhine?: OscillatorNode;
  private afterburnerNoise?: AudioBufferSourceNode;
  private engineGain?: GainNode;
  private engineWhineGain?: GainNode;
  private afterburnerGain?: GainNode;
  private muted = false;
  private nextLockToneAt = 0;
  private nextThreatToneAt = 0;
  private nextAreaToneAt = 0;

  get available(): boolean {
    return Boolean(getAudioContextConstructor());
  }

  get unlocked(): boolean {
    return this.context?.state === "running";
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.master || !this.context) {
      return;
    }

    this.master.gain.setTargetAtTime(muted ? 0 : MASTER_GAIN, this.context.currentTime, 0.04);
  }

  async unlock(): Promise<void> {
    if (this.muted || !this.ensureContext()) {
      return;
    }

    if (this.context?.state === "suspended") {
      await this.context.resume();
    }
  }

  updateFlight(localPlayer?: PlayerState): void {
    if (!this.context || !this.engineGain || !this.engineOsc || !this.engineWhine || !this.engineWhineGain || !this.afterburnerGain) {
      return;
    }

    const now = this.context.currentTime;
    const alive = localPlayer?.status === "alive";
    const speed = alive ? length(localPlayer.velocity) : 0;
    const speedRatio = clamp(speed / 220, 0, 1.3);
    const afterburner = alive && localPlayer.input.afterburner;
    const hullRatio = clamp((localPlayer?.health ?? 100) / 100, 0, 1);
    const damageRoughness = 1 - hullRatio;

    this.engineOsc.frequency.setTargetAtTime(62 + speedRatio * 54 + damageRoughness * 9, now, 0.05);
    this.engineWhine.frequency.setTargetAtTime(148 + speedRatio * 128 + (afterburner ? 54 : 0), now, 0.06);
    this.engineGain.gain.setTargetAtTime(alive ? 0.024 + speedRatio * 0.026 : 0, now, 0.12);
    this.engineWhineGain.gain.setTargetAtTime(alive ? 0.01 + speedRatio * 0.014 : 0, now, 0.1);
    this.afterburnerGain.gain.setTargetAtTime(afterburner ? 0.072 : 0, now, 0.12);
  }

  updateWarnings(room: RoomState | undefined, localPlayer: PlayerState | undefined): void {
    if (!room || !localPlayer || localPlayer.status !== "alive" || !this.context) {
      return;
    }

    const now = this.context.currentTime;
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

    if ((incomingMissile || lockedByEnemy) && now >= this.nextThreatToneAt) {
      this.playTone(incomingMissile ? 880 : 620, 0.11, incomingMissile ? 0.1 : 0.07, "sawtooth");
      this.playTone(incomingMissile ? 440 : 310, 0.14, incomingMissile ? 0.055 : 0.04, "square", 0.03);
      this.nextThreatToneAt = now + (incomingMissile ? 0.32 : 0.58);
    }

    if (localPlayer.outOfBoundsRemainingMs > 0 && now >= this.nextAreaToneAt) {
      this.playTone(250, 0.18, 0.06, "triangle");
      this.nextAreaToneAt = now + 1;
    }

    if (localPlayer.missileLockProgress > 0 && now >= this.nextLockToneAt) {
      const acquired = localPlayer.missileLockAcquired;
      this.playTone(acquired ? 960 : 620, acquired ? 0.16 : 0.08, acquired ? 0.075 : 0.045, "sine");
      this.nextLockToneAt = now + (acquired ? 0.3 : 0.48 - localPlayer.missileLockProgress * 0.22);
    }
  }

  handleCombatEvent(event: CombatEvent, room: RoomState | undefined, localPlayerId: string): void {
    if (!this.context || !room) {
      return;
    }

    if (event.type === "launch") {
      const volume = event.playerId === localPlayerId ? 1 : this.volumeFromPlayer(room, localPlayerId, event.playerId);
      if (volume <= 0) {
        return;
      }

      if (event.weapon === "bullet") {
        this.playGun(volume);
      } else if (event.weapon === "missile") {
        this.playMissileLaunch(volume);
      } else if (event.weapon === "flare") {
        this.playFlare(volume);
      }
      return;
    }

    if (event.type === "impact") {
      const volume = this.volumeFromPosition(room, localPlayerId, event.position);
      if (event.projectileType === "missile") {
        this.playExplosion(volume, event.reason === "player" ? 1 : 0.82);
      } else {
        this.playBulletImpact(volume);
      }
      return;
    }

    if (event.type === "hit") {
      if (event.weapon !== "bullet" && event.weapon !== "missile") {
        return;
      }

      if (event.attackerId === localPlayerId) {
        this.playHitMarker(event.weapon);
      }
      if (event.victimId === localPlayerId) {
        this.playDamage(event.weapon);
      }
      return;
    }

    if (event.type === "kill") {
      if (event.attackerId === localPlayerId) {
        this.playKillConfirm();
      }
      if (event.victimId === localPlayerId) {
        this.playDamage("missile");
      }
      return;
    }

    if (event.type === "crash") {
      const player = room.players[event.playerId];
      const volume = player ? this.volumeFromPosition(room, localPlayerId, player.position) : 0.4;
      this.playExplosion(volume, 1);
    }
  }

  destroy(): void {
    this.engineOsc?.stop();
    this.engineWhine?.stop();
    this.afterburnerNoise?.stop();
    void this.context?.close();
    this.context = undefined;
    this.master = undefined;
    this.engineOsc = undefined;
    this.engineWhine = undefined;
    this.afterburnerNoise = undefined;
    this.engineGain = undefined;
    this.engineWhineGain = undefined;
    this.afterburnerGain = undefined;
  }

  private ensureContext(): boolean {
    if (this.context) {
      return true;
    }

    const AudioContextConstructor = getAudioContextConstructor();
    if (!AudioContextConstructor) {
      return false;
    }

    const context = new AudioContextConstructor();
    const master = context.createGain();
    master.gain.value = this.muted ? 0 : MASTER_GAIN;
    master.connect(context.destination);

    const engineGain = context.createGain();
    engineGain.gain.value = 0;
    const engineOsc = context.createOscillator();
    engineOsc.type = "sawtooth";
    engineOsc.frequency.value = 70;
    const engineFilter = context.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 420;
    engineOsc.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(master);
    engineOsc.start();

    const engineWhineGain = context.createGain();
    engineWhineGain.gain.value = 0;
    const engineWhine = context.createOscillator();
    engineWhine.type = "triangle";
    engineWhine.frequency.value = 160;
    engineWhine.connect(engineWhineGain);
    engineWhineGain.connect(master);
    engineWhine.start();

    const afterburnerGain = context.createGain();
    afterburnerGain.gain.value = 0;
    const afterburnerFilter = context.createBiquadFilter();
    afterburnerFilter.type = "lowpass";
    afterburnerFilter.frequency.value = 900;
    const afterburnerNoise = context.createBufferSource();
    afterburnerNoise.buffer = createNoiseBuffer(context, 1);
    afterburnerNoise.loop = true;
    afterburnerNoise.connect(afterburnerFilter);
    afterburnerFilter.connect(afterburnerGain);
    afterburnerGain.connect(master);
    afterburnerNoise.start();

    this.context = context;
    this.master = master;
    this.engineOsc = engineOsc;
    this.engineWhine = engineWhine;
    this.afterburnerNoise = afterburnerNoise;
    this.engineGain = engineGain;
    this.engineWhineGain = engineWhineGain;
    this.afterburnerGain = afterburnerGain;
    return true;
  }

  private playGun(volume: number): void {
    this.playNoise(0.045, 0.11 * volume, 1800, 0, 0.004);
    this.playTone(115, 0.035, 0.038 * volume, "square");
  }

  private playMissileLaunch(volume: number): void {
    this.playNoise(0.42, 0.13 * volume, 760, 0, 0.035);
    this.playTone(140, 0.18, 0.06 * volume, "sawtooth");
  }

  private playFlare(volume: number): void {
    this.playNoise(0.16, 0.07 * volume, 1200, 0, 0.012);
    this.playTone(360, 0.08, 0.034 * volume, "triangle");
  }

  private playBulletImpact(volume: number): void {
    this.playNoise(0.06, 0.055 * volume, 2100, 0, 0.003);
    this.playTone(290, 0.045, 0.022 * volume, "triangle");
  }

  private playExplosion(volume: number, intensity: number): void {
    this.playNoise(0.7, 0.18 * volume * intensity, 520, 0, 0.018);
    this.playTone(64, 0.38, 0.09 * volume * intensity, "sawtooth");
    this.playTone(42, 0.55, 0.05 * volume * intensity, "sine", 0.04);
  }

  private playHitMarker(weapon: "bullet" | "missile"): void {
    this.playTone(weapon === "missile" ? 720 : 840, 0.055, 0.075, "sine");
    this.playTone(weapon === "missile" ? 920 : 1120, 0.05, 0.042, "triangle", 0.045);
  }

  private playKillConfirm(): void {
    this.playTone(660, 0.08, 0.07, "triangle");
    this.playTone(880, 0.12, 0.078, "triangle", 0.08);
  }

  private playDamage(weapon: "bullet" | "missile"): void {
    this.playNoise(weapon === "missile" ? 0.28 : 0.11, weapon === "missile" ? 0.16 : 0.075, weapon === "missile" ? 420 : 1500);
    this.playTone(weapon === "missile" ? 86 : 180, weapon === "missile" ? 0.28 : 0.09, weapon === "missile" ? 0.09 : 0.04, "sawtooth");
  }

  private playTone(frequency: number, duration: number, volume: number, type: OscillatorType, delay = 0): void {
    if (!this.context || !this.master || this.muted || volume <= 0) {
      return;
    }

    const start = this.context.currentTime + delay;
    const stop = start + duration;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(SILENCE, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(SILENCE, volume), start + 0.012);
    gain.gain.exponentialRampToValueAtTime(SILENCE, stop);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(start);
    oscillator.stop(stop + 0.03);
  }

  private playNoise(duration: number, volume: number, filterFrequency: number, delay = 0, attack = 0.01): void {
    if (!this.context || !this.master || this.muted || volume <= 0) {
      return;
    }

    const start = this.context.currentTime + delay;
    const stop = start + duration;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    source.buffer = createNoiseBuffer(this.context, Math.max(duration, 0.05));
    filter.type = "lowpass";
    filter.frequency.value = filterFrequency;
    gain.gain.setValueAtTime(SILENCE, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(SILENCE, volume), start + attack);
    gain.gain.exponentialRampToValueAtTime(SILENCE, stop);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(start);
    source.stop(stop + 0.03);
  }

  private volumeFromPlayer(room: RoomState, localPlayerId: string, playerId: string): number {
    const player = room.players[playerId];
    return player ? this.volumeFromPosition(room, localPlayerId, player.position) : 0;
  }

  private volumeFromPosition(room: RoomState, localPlayerId: string, position: Vec3): number {
    const localPlayer = room.players[localPlayerId];
    if (!localPlayer) {
      return 0.35;
    }

    const range = distance(localPlayer.position, position);
    return clamp(1 - range / EVENT_HEARING_RANGE, 0, 1);
  }
}

function createNoiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
  const sampleCount = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
  const samples = buffer.getChannelData(0);

  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.random() * 2 - 1;
  }

  return buffer;
}

function getAudioContextConstructor(): AudioContextConstructor | undefined {
  const audioWindow = window as WebAudioWindow;
  return audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
}
