import * as THREE from "three";

type ExplosionEffect = {
  group: THREE.Group;
  material: THREE.MeshBasicMaterial;
  born: number;
  life: number;
};

export type WorldPosition = {
  x: number;
  y: number;
  z: number;
};

export class ExplosionSystem {
  private readonly explosions: ExplosionEffect[] = [];
  private readonly explosionShardGeometry = new THREE.TetrahedronGeometry(1, 0);
  private readonly hitSparkGeometry = new THREE.BoxGeometry(1, 1, 1);

  constructor(private readonly scene: THREE.Scene) {}

  spawnExplosion(position: WorldPosition, color: string): void {
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });

    for (let i = 0; i < 16; i += 1) {
      const shard = new THREE.Mesh(this.explosionShardGeometry, material);
      shard.scale.setScalar(3 + Math.random() * 5);
      shard.position.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
      shard.userData.velocity = new THREE.Vector3((Math.random() - 0.5) * 90, (Math.random() - 0.2) * 90, (Math.random() - 0.5) * 90);
      group.add(shard);
    }

    group.position.set(position.x, position.y, position.z);
    this.scene.add(group);
    this.explosions.push({ group, material, born: performance.now(), life: 900 });
  }

  spawnHitSpark(position: WorldPosition, color: string): void {
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    for (let i = 0; i < 9; i += 1) {
      const spark = new THREE.Mesh(this.hitSparkGeometry, material);
      spark.scale.set(1.1, 1.1, 9 + Math.random() * 10);
      spark.position.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
      spark.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      spark.userData.velocity = new THREE.Vector3((Math.random() - 0.5) * 55, (Math.random() - 0.35) * 55, (Math.random() - 0.5) * 55);
      group.add(spark);
    }

    group.position.set(position.x, position.y, position.z);
    this.scene.add(group);
    this.explosions.push({ group, material, born: performance.now(), life: 360 });
  }

  update(now: number, dt: number): void {
    for (let i = this.explosions.length - 1; i >= 0; i -= 1) {
      const explosion = this.explosions[i];
      const age = now - explosion.born;
      const progress = age / explosion.life;

      explosion.group.children.forEach((child) => {
        const velocity = child.userData.velocity as THREE.Vector3;
        child.position.addScaledVector(velocity, dt);
      });
      explosion.material.opacity = 1 - progress;

      if (progress >= 1) {
        this.scene.remove(explosion.group);
        explosion.material.dispose();
        this.explosions.splice(i, 1);
      }
    }
  }

  getExplosionCount(): number {
    return this.explosions.length;
  }

  dispose(): void {
    this.explosions.forEach((explosion) => {
      this.scene.remove(explosion.group);
      explosion.material.dispose();
    });
    this.explosions.length = 0;
    this.explosionShardGeometry.dispose();
    this.hitSparkGeometry.dispose();
  }
}
