import * as THREE from "three";
import type { ProjectileState } from "../../../shared/types.js";
import type { Vec3Tuple } from "./jetVisualModel.js";
import { PROJECTILE_VISUAL_MODEL } from "./projectileVisualModel.js";

export class ProjectileRenderer {
  private readonly projectiles = new Map<string, THREE.Object3D>();
  private readonly bulletTracerGeometry = createRotatedCylinderGeometry(
    PROJECTILE_VISUAL_MODEL.bulletTracer.radiusTop,
    PROJECTILE_VISUAL_MODEL.bulletTracer.radiusBottom,
    PROJECTILE_VISUAL_MODEL.bulletTracer.length,
    PROJECTILE_VISUAL_MODEL.bulletTracer.radialSegments
  );
  private readonly bulletTracerMaterial = new THREE.MeshBasicMaterial({
    color: PROJECTILE_VISUAL_MODEL.bulletTracer.material.color,
    transparent: true,
    opacity: PROJECTILE_VISUAL_MODEL.bulletTracer.material.opacity,
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
      new THREE.SphereGeometry(
        PROJECTILE_VISUAL_MODEL.flare.core.radius,
        PROJECTILE_VISUAL_MODEL.flare.core.widthSegments,
        PROJECTILE_VISUAL_MODEL.flare.core.heightSegments
      ),
      new THREE.MeshBasicMaterial({
        color: PROJECTILE_VISUAL_MODEL.flare.core.color,
        transparent: true,
        opacity: PROJECTILE_VISUAL_MODEL.flare.core.opacity
      })
    );
    flare.add(core);

    const corona = new THREE.Mesh(
      new THREE.SphereGeometry(
        PROJECTILE_VISUAL_MODEL.flare.corona.radius,
        PROJECTILE_VISUAL_MODEL.flare.corona.widthSegments,
        PROJECTILE_VISUAL_MODEL.flare.corona.heightSegments
      ),
      new THREE.MeshBasicMaterial({
        color: PROJECTILE_VISUAL_MODEL.flare.corona.color,
        transparent: true,
        opacity: PROJECTILE_VISUAL_MODEL.flare.corona.opacity,
        depthWrite: false
      })
    );
    flare.add(corona);
    return flare;
  }

  private createMissile(): THREE.Group {
    const missile = new THREE.Group();
    missile.userData.projectileType = "missile";
    missile.userData.nextSmokeAt = 0;

    const bodyMaterial = new THREE.MeshStandardMaterial(PROJECTILE_VISUAL_MODEL.missile.body.material);
    const tailMaterial = new THREE.MeshStandardMaterial(PROJECTILE_VISUAL_MODEL.missile.tail.material);
    const noseMaterial = new THREE.MeshStandardMaterial(PROJECTILE_VISUAL_MODEL.missile.nose.material);

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(
        PROJECTILE_VISUAL_MODEL.missile.body.radiusTop,
        PROJECTILE_VISUAL_MODEL.missile.body.radiusBottom,
        PROJECTILE_VISUAL_MODEL.missile.body.length,
        PROJECTILE_VISUAL_MODEL.missile.body.radialSegments
      ),
      bodyMaterial
    );
    body.rotation.x = Math.PI / 2;
    body.castShadow = true;
    missile.add(body);

    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(
        PROJECTILE_VISUAL_MODEL.missile.nose.radius,
        PROJECTILE_VISUAL_MODEL.missile.nose.length,
        PROJECTILE_VISUAL_MODEL.missile.nose.radialSegments
      ),
      noseMaterial
    );
    nose.rotation.x = Math.PI / 2;
    setPosition(nose, PROJECTILE_VISUAL_MODEL.missile.nose.position);
    nose.castShadow = true;
    missile.add(nose);

    const tail = new THREE.Mesh(
      new THREE.CylinderGeometry(
        PROJECTILE_VISUAL_MODEL.missile.tail.radiusTop,
        PROJECTILE_VISUAL_MODEL.missile.tail.radiusBottom,
        PROJECTILE_VISUAL_MODEL.missile.tail.length,
        PROJECTILE_VISUAL_MODEL.missile.tail.radialSegments
      ),
      tailMaterial
    );
    tail.rotation.x = Math.PI / 2;
    setPosition(tail, PROJECTILE_VISUAL_MODEL.missile.tail.position);
    tail.castShadow = true;
    missile.add(tail);

    const finMaterial = new THREE.MeshStandardMaterial(PROJECTILE_VISUAL_MODEL.missile.finMaterial);
    PROJECTILE_VISUAL_MODEL.missile.fins.forEach((part) => {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(...part.size), finMaterial);
      setPosition(fin, part.position);
      fin.castShadow = true;
      missile.add(fin);
    });

    const exhaust = new THREE.Mesh(
      new THREE.ConeGeometry(
        PROJECTILE_VISUAL_MODEL.missile.exhaust.radius,
        PROJECTILE_VISUAL_MODEL.missile.exhaust.length,
        PROJECTILE_VISUAL_MODEL.missile.exhaust.radialSegments
      ),
      new THREE.MeshBasicMaterial({
        color: PROJECTILE_VISUAL_MODEL.missile.exhaust.material.color,
        transparent: true,
        opacity: PROJECTILE_VISUAL_MODEL.missile.exhaust.material.opacity,
        depthWrite: false
      })
    );
    exhaust.rotation.x = -Math.PI / 2;
    setPosition(exhaust, PROJECTILE_VISUAL_MODEL.missile.exhaust.position);
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

function setPosition(object: THREE.Object3D, position: Vec3Tuple): void {
  object.position.set(position[0], position[1], position[2]);
}
