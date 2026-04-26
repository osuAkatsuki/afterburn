import * as THREE from "three";

export class SkySystem {
  private skyDome?: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly clouds: THREE.Group[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  initialize(): void {
    this.scene.background = new THREE.Color("#91cef7");
    this.scene.fog = new THREE.Fog("#9bd8ff", 2200, 11500);

    this.skyDome = this.createSkyDome();
    this.scene.add(this.skyDome);

    const hemi = new THREE.HemisphereLight("#e8f9ff", "#244c42", 1.55);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight("#fff0c6", 3.45);
    sun.position.set(-860, 1320, -520);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    this.scene.add(sun);

    for (let i = 0; i < 42; i += 1) {
      const cloud = this.createCloud();
      const angle = Math.random() * Math.PI * 2;
      const radius = 1200 + Math.random() * 5400;
      cloud.position.set(Math.sin(angle) * radius, 620 + Math.random() * 820, Math.cos(angle) * radius);
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
      new THREE.SphereGeometry(14500, 48, 20),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          topColor: { value: new THREE.Color("#4ca6ec") },
          horizonColor: { value: new THREE.Color("#d6f1ff") }
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
    const material = new THREE.MeshStandardMaterial({ color: "#f8fbff", roughness: 1, transparent: true, opacity: 0.64 });
    const shadowMaterial = new THREE.MeshStandardMaterial({ color: "#cbdce8", roughness: 1, transparent: true, opacity: 0.3 });
    const count = 7 + Math.floor(Math.random() * 7);

    for (let i = 0; i < count; i += 1) {
      const puff = new THREE.Mesh(new THREE.DodecahedronGeometry(34 + Math.random() * 42, 0), i % 3 === 0 ? shadowMaterial : material);
      puff.position.set((i - count / 2) * 34, Math.random() * 22, (Math.random() - 0.5) * 72);
      puff.scale.set(3.4, 0.38, 1.25);
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
