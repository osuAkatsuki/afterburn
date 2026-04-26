import * as THREE from "three";
import { CAMERA_FAR } from "../camera/ChaseCamera.js";

type CloudPuff = {
  position: THREE.Vector3;
  scale: THREE.Vector3;
  rotation: THREE.Euler;
  color: THREE.Color;
};

const SKY_DOME_RADIUS = CAMERA_FAR * 0.76;
const CLOUD_COUNT = 14;
const CLOUD_MIN_RADIUS = 1400;
const CLOUD_RADIUS_SPREAD = 5600;
const CLOUD_MIN_ALTITUDE = 840;
const CLOUD_ALTITUDE_SPREAD = 880;

export class SkySystem {
  private skyDome?: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private cloudMesh?: THREE.InstancedMesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly lights: THREE.Light[] = [];
  private readonly cloudMatrix = new THREE.Matrix4();
  private readonly cloudQuaternion = new THREE.Quaternion();

  constructor(private readonly scene: THREE.Scene) {}

  initialize(): void {
    this.scene.background = new THREE.Color("#8ed4ff");
    this.scene.fog = new THREE.Fog("#a8ddf2", 2200, CAMERA_FAR * 0.92);

    this.skyDome = this.createSkyDome();
    this.scene.add(this.skyDome);

    const hemi = new THREE.HemisphereLight("#e8f9ff", "#244c42", 1.55);
    this.scene.add(hemi);
    this.lights.push(hemi);

    const sun = new THREE.DirectionalLight("#fff0c6", 3.45);
    sun.position.set(-860, 1320, -520);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    this.scene.add(sun);
    this.lights.push(sun);

    this.cloudMesh = this.createCloudLayer();
    this.scene.add(this.cloudMesh);
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
    if (this.cloudMesh) {
      this.scene.remove(this.cloudMesh);
      this.cloudMesh.geometry.dispose();
      this.cloudMesh.material.dispose();
      this.cloudMesh = undefined;
    }
    this.lights.forEach((light) => this.scene.remove(light));
    this.lights.length = 0;
  }

  private createSkyDome(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(SKY_DOME_RADIUS, 64, 32),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
        uniforms: {
          topColor: { value: new THREE.Color("#2f83df") },
          midColor: { value: new THREE.Color("#76c7f4") },
          horizonColor: { value: new THREE.Color("#dff6ff") },
          hazeColor: { value: new THREE.Color("#bdeaff") }
        },
        vertexShader: `
          varying vec3 vLocalPosition;
          void main() {
            vLocalPosition = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 topColor;
          uniform vec3 midColor;
          uniform vec3 horizonColor;
          uniform vec3 hazeColor;
          varying vec3 vLocalPosition;
          void main() {
            float h = normalize(vLocalPosition).y;
            float skyMix = smoothstep(-0.08, 0.92, h);
            vec3 color = mix(horizonColor, topColor, skyMix);
            color = mix(color, midColor, smoothstep(0.04, 0.56, h) * 0.28);
            float haze = 1.0 - smoothstep(-0.03, 0.2, abs(h));
            color = mix(color, hazeColor, haze * 0.38);
            gl_FragColor = vec4(color, 1.0);
          }
        `
      })
    );
    dome.frustumCulled = false;
    dome.renderOrder = -1000;
    return dome;
  }

  private createCloudLayer(): THREE.InstancedMesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> {
    const puffs = createCloudPuffs();
    const mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 10, 6),
      new THREE.MeshBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0.68,
        depthWrite: false
      }),
      puffs.length
    );
    mesh.name = "sky-cloud-layer";
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;

    puffs.forEach((puff, index) => {
      this.cloudQuaternion.setFromEuler(puff.rotation);
      this.cloudMatrix.compose(puff.position, this.cloudQuaternion, puff.scale);
      mesh.setMatrixAt(index, this.cloudMatrix);
      mesh.setColorAt(index, puff.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }

    return mesh;
  }
}

function createCloudPuffs(): CloudPuff[] {
  const random = seededRandom(942001);
  const puffs: CloudPuff[] = [];

  for (let cloudIndex = 0; cloudIndex < CLOUD_COUNT; cloudIndex += 1) {
    const angle = random() * Math.PI * 2;
    const radius = CLOUD_MIN_RADIUS + random() * CLOUD_RADIUS_SPREAD;
    const center = new THREE.Vector3(
      Math.sin(angle) * radius,
      CLOUD_MIN_ALTITUDE + random() * CLOUD_ALTITUDE_SPREAD,
      Math.cos(angle) * radius
    );
    const cloudRotation = random() * Math.PI * 2;
    const puffCount = 5 + Math.floor(random() * 4);

    for (let puffIndex = 0; puffIndex < puffCount; puffIndex += 1) {
      const t = puffCount === 1 ? 0 : puffIndex / (puffCount - 1) - 0.5;
      const lateral = (random() - 0.5) * 210;
      const along = t * (360 + random() * 220);
      const cos = Math.cos(cloudRotation);
      const sin = Math.sin(cloudRotation);
      const x = center.x + along * cos - lateral * sin;
      const z = center.z + along * sin + lateral * cos;
      const y = center.y + (random() - 0.5) * 52;
      const puffScale = 95 + random() * 105;
      const shade = 0.82 + random() * 0.16;
      puffs.push({
        position: new THREE.Vector3(x, y, z),
        scale: new THREE.Vector3(puffScale * (1.35 + random() * 1.4), puffScale * (0.16 + random() * 0.12), puffScale * (0.58 + random() * 0.58)),
        rotation: new THREE.Euler((random() - 0.5) * 0.05, cloudRotation + (random() - 0.5) * 0.35, (random() - 0.5) * 0.08),
        color: new THREE.Color(shade, shade * 0.985, shade * 0.965)
      });
    }
  }

  return puffs;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
