import * as THREE from "three";
import type { RoomState } from "../../../shared/types.js";
import type { JetRenderer } from "../entities/JetRenderer.js";
import type { ProjectileRenderer } from "../entities/ProjectileRenderer.js";
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
      this.spawnExplosion(position, "#f97316");
      for (let i = 0; i < 18; i += 1) {
        const direction = new THREE.Vector3(
          (Math.random() - 0.5) * 24,
          10 + Math.random() * 28,
          (Math.random() - 0.5) * 24
        );
        this.smokeSystem.spawnPuff({
          origin,
          velocity: direction,
          color: i % 3 === 0 ? "#facc15" : "#6b7280",
          opacity: i % 3 === 0 ? 0.22 : 0.38,
          life: 1.25 + Math.random() * 0.9,
          size: 2.8 + Math.random() * 2.8,
          growth: 3.2,
          additive: i % 3 === 0
        });
      }
      return;
    }

    this.spawnHitSpark(position, "#fef08a");
    this.smokeSystem.spawnPuff({
      origin,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 8, 5 + Math.random() * 8, (Math.random() - 0.5) * 8),
      color: "#d6d3ce",
      opacity: 0.22,
      life: 0.65,
      size: 1.1,
      growth: 2.1
    });
  }

  private updateJetEffects(now: number, room: RoomState | undefined): void {
    Object.values(room?.players ?? {}).forEach((player) => {
      const jet = this.jetRenderer.getJet(player.id);
      if (player.status !== "alive" || !jet || !jet.visible) {
        return;
      }

      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(jet.quaternion).normalize();
      const origin = jet.position.clone().addScaledVector(forward, -15);

      if (player.input.afterburner && now >= (jet.userData.nextAfterburnerPuffAt as number)) {
        jet.userData.nextAfterburnerPuffAt = now + 70;
        this.smokeSystem.spawnPuff({
          origin,
          velocity: forward
            .clone()
            .multiplyScalar(-38)
            .add(new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3)),
          color: "#8bd3ff",
          opacity: 0.22,
          life: 0.55,
          size: 1.5,
          growth: 2.6,
          additive: true
        });
      }

      if (player.health > 0 && player.health <= 35 && now >= (jet.userData.nextDamageSmokeAt as number)) {
        jet.userData.nextDamageSmokeAt = now + 115;
        this.smokeSystem.spawnPuff({
          origin: origin.clone().add(new THREE.Vector3((Math.random() - 0.5) * 5, 0, (Math.random() - 0.5) * 5)),
          velocity: forward
            .clone()
            .multiplyScalar(-12)
            .add(new THREE.Vector3((Math.random() - 0.5) * 6, 4 + Math.random() * 4, (Math.random() - 0.5) * 6)),
          color: "#4b5563",
          opacity: 0.32,
          life: 1.35,
          size: 2.4,
          growth: 2.4
        });
      }
    });
  }

  private updateMissileSmoke(now: number): void {
    this.projectileRenderer.forEachMissile((projectile) => {
      if (now < (projectile.userData.nextSmokeAt as number)) {
        return;
      }

      projectile.userData.nextSmokeAt = now + 55;
      const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(projectile.quaternion).normalize();
      const origin = projectile.position.clone().addScaledVector(direction, -8.6);
      this.smokeSystem.spawnMissileTrail(origin, direction);
    });
  }
}
