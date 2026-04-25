import * as THREE from "three";

export class SkySystem {
  private skyDome?: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly clouds: THREE.Group[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  initialize(): void {
    this.scene.background = new THREE.Color("#8bd3ff");
    this.scene.fog = new THREE.Fog("#8bd3ff", 900, 3800);

    this.skyDome = this.createSkyDome();
    this.scene.add(this.skyDome);

    const hemi = new THREE.HemisphereLight("#dff6ff", "#1f5666", 1.75);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight("#fff3c4", 3.2);
    sun.position.set(-620, 980, -360);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    this.scene.add(sun);

    for (let i = 0; i < 28; i += 1) {
      const cloud = this.createCloud();
      const angle = Math.random() * Math.PI * 2;
      const radius = 400 + Math.random() * 1300;
      cloud.position.set(Math.sin(angle) * radius, 260 + Math.random() * 420, Math.cos(angle) * radius);
      this.clouds.push(cloud);
      this.scene.add(cloud);
    }
  }

  update(camera: THREE.Camera): void {
    this.skyDome?.position.copy(camera.position);
  }

  dispose(): void {
    if (this.skyDome) {
      this.scene.remove(this.skyDome);
      this.skyDome.geometry.dispose();
      this.skyDome.material.dispose();
    }
    this.clouds.forEach((cloud) => {
      this.scene.remove(cloud);
      disposeObject(cloud);
    });
    this.clouds.length = 0;
  }

  private createSkyDome(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(5200, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          topColor: { value: new THREE.Color("#5eb8f2") },
          horizonColor: { value: new THREE.Color("#bfeaff") }
        },
        vertexShader: `
          varying vec3 vWorldPosition;
          void main() {
            vWorldPosition = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 topColor;
          uniform vec3 horizonColor;
          varying vec3 vWorldPosition;
          void main() {
            float h = normalize(vWorldPosition).y;
            float mixAmount = smoothstep(-0.12, 0.82, h);
            gl_FragColor = vec4(mix(horizonColor, topColor, mixAmount), 1.0);
          }
        `
      })
    );
    dome.frustumCulled = false;
    return dome;
  }

  private createCloud(): THREE.Group {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: "#f8fbff", roughness: 1, transparent: true, opacity: 0.72 });
    const shadowMaterial = new THREE.MeshStandardMaterial({ color: "#d7e5ef", roughness: 1, transparent: true, opacity: 0.34 });
    const count = 5 + Math.floor(Math.random() * 5);

    for (let i = 0; i < count; i += 1) {
      const puff = new THREE.Mesh(new THREE.DodecahedronGeometry(24 + Math.random() * 26, 0), i % 3 === 0 ? shadowMaterial : material);
      puff.position.set((i - count / 2) * 24, Math.random() * 14, (Math.random() - 0.5) * 32);
      puff.scale.set(2.1, 0.46, 0.92);
      group.add(puff);
    }

    return group;
  }
}

function disposeObject(object: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  object.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      geometries.add(mesh.geometry);
      const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      meshMaterials.forEach((material) => materials.add(material));
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}
