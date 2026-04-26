import * as THREE from "three";
import type { RoomState } from "../../../shared/types.js";
import type { JetRenderer } from "../entities/JetRenderer.js";
import type { ProjectileRenderer } from "../entities/ProjectileRenderer.js";
import { EFFECT_PRESETS } from "./effectPresets.js";
import type { ExplosionSystem, WorldPosition } from "./ExplosionSystem.js";
import type { SmokeSystem } from "./SmokeSystem.js";

export class CombatEffectsSystem {
  constructor(
    private readonly explosionSystem: ExplosionSystem,
    private readonly smokeSystem: SmokeSystem,
    private readonly jetRenderer: JetRenderer,
    private readonly projectileRenderer: ProjectileRenderer
  ) {}

  update(now: number, dt: number, room: RoomState | undefined): void {
    this.updateJetEffects(now, room);
    this.updateMissileSmoke(now);
    this.smokeSystem.update(dt);
    this.explosionSystem.update(now, dt);
  }

  spawnExplosion(position: WorldPosition, color: string): void {
    this.explosionSystem.spawnExplosion(position, color);
  }

  spawnHitSpark(position: WorldPosition, color: string): void {
    this.explosionSystem.spawnHitSpark(position, color);
  }

  spawnProjectileImpact(position: WorldPosition, projectileType: "bullet" | "missile"): void {
    const origin = new THREE.Vector3(position.x, position.y, position.z);

    if (projectileType === "missile") {
      const preset = EFFECT_PRESETS.missileImpact;
      this.spawnExplosion(position, preset.explosionColor);
      for (let i = 0; i < preset.smokePuffCount; i += 1) {
        const additive = i % preset.flameEveryNthPuff === 0;
        const direction = new THREE.Vector3(
          (Math.random() - 0.5) * preset.lateralSpread,
          preset.verticalVelocityBase + Math.random() * preset.verticalVelocitySpread,
          (Math.random() - 0.5) * preset.lateralSpread
        );
        this.smokeSystem.spawnPuff({
          origin,
          velocity: direction,
          color: additive ? preset.flameColor : preset.smokeColor,
          opacity: additive ? preset.flameOpacity : preset.smokeOpacity,
          life: preset.lifeBase + Math.random() * preset.lifeSpread,
          size: preset.sizeBase + Math.random() * preset.sizeSpread,
          growth: preset.growth,
          additive
        });
      }
      return;
    }

    const preset = EFFECT_PRESETS.bulletImpact;
    this.spawnHitSpark(position, preset.sparkColor);
    this.smokeSystem.spawnPuff({
      origin,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * preset.lateralVelocitySpread,
        preset.verticalVelocityBase + Math.random() * preset.verticalVelocitySpread,
        (Math.random() - 0.5) * preset.lateralVelocitySpread
      ),
      color: preset.smokeColor,
      opacity: preset.opacity,
      life: preset.life,
      size: preset.size,
      growth: preset.growth
    });
  }

  private updateJetEffects(now: number, room: RoomState | undefined): void {
    Object.values(room?.players ?? {}).forEach((player) => {
      const jet = this.jetRenderer.getJet(player.id);
      if (player.status !== "alive" || !jet || !jet.visible) {
        return;
      }

      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(jet.quaternion).normalize();
      const afterburnerPreset = EFFECT_PRESETS.afterburnerPuff;
      const damagePreset = EFFECT_PRESETS.damageSmoke;
      const origin = jet.position.clone().addScaledVector(forward, afterburnerPreset.engineOffset);

      if (player.input.afterburner && now >= (jet.userData.nextAfterburnerPuffAt as number)) {
        jet.userData.nextAfterburnerPuffAt = now + afterburnerPreset.intervalMs;
        this.smokeSystem.spawnPuff({
          origin,
          velocity: forward
            .clone()
            .multiplyScalar(afterburnerPreset.backwardVelocity)
            .add(randomVector(afterburnerPreset.randomVelocitySpread)),
          color: afterburnerPreset.color,
          opacity: afterburnerPreset.opacity,
          life: afterburnerPreset.life,
          size: afterburnerPreset.size,
          growth: afterburnerPreset.growth,
          additive: true
        });
      }

      if (player.health > 0 && player.health <= damagePreset.healthThreshold && now >= (jet.userData.nextDamageSmokeAt as number)) {
        jet.userData.nextDamageSmokeAt = now + damagePreset.intervalMs;
        this.smokeSystem.spawnPuff({
          origin: origin.clone().add(new THREE.Vector3((Math.random() - 0.5) * damagePreset.originSpread, 0, (Math.random() - 0.5) * damagePreset.originSpread)),
          velocity: forward
            .clone()
            .multiplyScalar(damagePreset.backwardVelocity)
            .add(
              new THREE.Vector3(
                (Math.random() - 0.5) * damagePreset.lateralVelocitySpread,
                damagePreset.verticalVelocityBase + Math.random() * damagePreset.verticalVelocitySpread,
                (Math.random() - 0.5) * damagePreset.lateralVelocitySpread
              )
            ),
          color: damagePreset.color,
          opacity: damagePreset.opacity,
          life: damagePreset.life,
          size: damagePreset.size,
          growth: damagePreset.growth
        });
      }
    });
  }

  private updateMissileSmoke(now: number): void {
    this.projectileRenderer.forEachMissile((projectile) => {
      if (now < (projectile.userData.nextSmokeAt as number)) {
        return;
      }

      projectile.userData.nextSmokeAt = now + EFFECT_PRESETS.missileTrail.intervalMs;
      const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(projectile.quaternion).normalize();
      const origin = projectile.position.clone().addScaledVector(direction, EFFECT_PRESETS.missileTrail.exhaustOffset);
      this.smokeSystem.spawnMissileTrail(origin, direction);
    });
  }
}

function randomVector(spread: number): THREE.Vector3 {
  return new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread);
}
