import * as THREE from "three";
import type { ProjectileState } from "../../../shared/types.js";

export class ProjectileRenderer {
  private readonly projectiles = new Map<string, THREE.Object3D>();
  private readonly bulletTracerGeometry = createRotatedCylinderGeometry(0.34, 0.18, 18, 8);
  private readonly bulletTracerMaterial = new THREE.MeshBasicMaterial({
    color: "#fff1a8",
    transparent: true,
    opacity: 0.86,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  private readonly projectileForward = new THREE.Vector3(0, 0, 1);
  private readonly projectileVelocity = new THREE.Vector3();

  constructor(private readonly scene: THREE.Scene) {}

  sync(projectiles: Record<string, ProjectileState>): void {
    const ids = new Set(Object.keys(projectiles));
    this.projectiles.forEach((mesh, id) => {
      if (!ids.has(id)) {
        this.scene.remove(mesh);
        this.disposeProjectile(mesh);
        this.projectiles.delete(id);
      }
    });

    Object.values(projectiles).forEach((projectile) => {
      let mesh = this.projectiles.get(projectile.id);
      if (!mesh) {
        mesh = this.createProjectile(projectile);
        this.scene.add(mesh);
        this.projectiles.set(projectile.id, mesh);
      }

      mesh.position.set(projectile.position.x, projectile.position.y, projectile.position.z);
      this.projectileVelocity.set(projectile.velocity.x, projectile.velocity.y, projectile.velocity.z).normalize();
      mesh.quaternion.setFromUnitVectors(this.projectileForward, this.projectileVelocity);
    });
  }

  forEachMissile(callback: (projectile: THREE.Object3D) => void): void {
    this.projectiles.forEach((projectile) => {
      if (projectile.userData.projectileType === "missile") {
        callback(projectile);
      }
    });
  }

  getProjectileCount(): number {
    return this.projectiles.size;
  }

  dispose(): void {
    this.projectiles.forEach((projectile) => {
      this.scene.remove(projectile);
      this.disposeProjectile(projectile);
    });
    this.projectiles.clear();
    this.bulletTracerGeometry.dispose();
    this.bulletTracerMaterial.dispose();
  }

  private createProjectile(projectile: ProjectileState): THREE.Object3D {
    if (projectile.type === "missile") {
      return this.createMissile();
    }

    if (projectile.type === "flare") {
      return this.createFlare();
    }

    return this.createBulletTracer();
  }

  private createBulletTracer(): THREE.Mesh {
    const tracer = new THREE.Mesh(this.bulletTracerGeometry, this.bulletTracerMaterial);
    tracer.userData.sharedResources = true;
    return tracer;
  }

  private createFlare(): THREE.Group {
    const flare = new THREE.Group();
    flare.userData.projectileType = "flare";

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(1.35, 10, 8),
      new THREE.MeshBasicMaterial({ color: "#fffbeb", transparent: true, opacity: 0.88 })
    );
    flare.add(core);

    const corona = new THREE.Mesh(
      new THREE.SphereGeometry(3.25, 10, 8),
      new THREE.MeshBasicMaterial({ color: "#fb923c", transparent: true, opacity: 0.26, depthWrite: false })
    );
    flare.add(corona);
    return flare;
  }

  private createMissile(): THREE.Group {
    const missile = new THREE.Group();
    missile.userData.projectileType = "missile";
    missile.userData.nextSmokeAt = 0;

    const bodyMaterial = new THREE.MeshStandardMaterial({ color: "#d8dde4", roughness: 0.38, metalness: 0.35 });
    const darkMaterial = new THREE.MeshStandardMaterial({ color: "#202938", roughness: 0.5, metalness: 0.2 });
    const warningMaterial = new THREE.MeshStandardMaterial({ color: "#b91c1c", roughness: 0.42, metalness: 0.12 });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 11, 18), bodyMaterial);
    body.rotation.x = Math.PI / 2;
    body.castShadow = true;
    missile.add(body);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(1.08, 3.2, 18), warningMaterial);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 7.1;
    nose.castShadow = true;
    missile.add(nose);

    const tail = new THREE.Mesh(new THREE.CylinderGeometry(1.14, 1.14, 1.3, 18), darkMaterial);
    tail.rotation.x = Math.PI / 2;
    tail.position.z = -5.9;
    tail.castShadow = true;
    missile.add(tail);

    const finMaterial = new THREE.MeshStandardMaterial({ color: "#111827", roughness: 0.55, metalness: 0.18 });
    const finGeometries = [
      { geometry: new THREE.BoxGeometry(0.16, 2.4, 2.9), position: new THREE.Vector3(0, 1.45, -4.6) },
      { geometry: new THREE.BoxGeometry(0.16, 2.4, 2.9), position: new THREE.Vector3(0, -1.45, -4.6) },
      { geometry: new THREE.BoxGeometry(2.4, 0.16, 2.9), position: new THREE.Vector3(1.45, 0, -4.6) },
      { geometry: new THREE.BoxGeometry(2.4, 0.16, 2.9), position: new THREE.Vector3(-1.45, 0, -4.6) }
    ];

    finGeometries.forEach(({ geometry, position }) => {
      const fin = new THREE.Mesh(geometry, finMaterial);
      fin.position.copy(position);
      fin.castShadow = true;
      missile.add(fin);
    });

    const exhaust = new THREE.Mesh(
      new THREE.ConeGeometry(0.85, 4.6, 14),
      new THREE.MeshBasicMaterial({ color: "#f97316", transparent: true, opacity: 0.7, depthWrite: false })
    );
    exhaust.rotation.x = -Math.PI / 2;
    exhaust.position.z = -8.2;
    missile.add(exhaust);
    return missile;
  }

  private disposeProjectile(projectile: THREE.Object3D): void {
    projectile.traverse((object) => {
      if ((object as THREE.Mesh).isMesh && !object.userData.sharedResources) {
        const mesh = object as THREE.Mesh;
        mesh.geometry.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((material) => material.dispose());
      }
    });
  }
}

function createRotatedCylinderGeometry(radiusTop: number, radiusBottom: number, height: number, radialSegments: number): THREE.CylinderGeometry {
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}
