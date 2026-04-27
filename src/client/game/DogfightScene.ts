import * as THREE from "three";
import type { RoomState, Vec3 } from "../../shared/types.js";
import { CAMERA_FAR, ChaseCamera } from "./camera/ChaseCamera.js";
import type { CameraLookInput } from "../hooks/useFlightInput.js";
import {
  computeMouseAimInstructorAxes,
  type FlightAxes,
  type MouseAimPoint
} from "../input/mouseAimInstructor.js";
import { JetRenderer } from "./entities/JetRenderer.js";
import { ProjectileRenderer } from "./entities/ProjectileRenderer.js";
import { CombatEffectsSystem } from "./effects/CombatEffectsSystem.js";
import { ExplosionSystem } from "./effects/ExplosionSystem.js";
import type { WorldPosition } from "./effects/ExplosionSystem.js";
import { SmokeSystem } from "./effects/SmokeSystem.js";
import { ReticleProjector } from "./targeting/ReticleProjector.js";
import { TargetOverlayProjector } from "./targeting/TargetOverlayProjector.js";
import { OceanSystem } from "./world/OceanSystem.js";
import { SkySystem } from "./world/SkySystem.js";
import { TerrainSystem } from "./world/TerrainSystem.js";

export type SceneDebugStats = {
  objects: number;
  jets: number;
  projectiles: number;
  smokePuffs: number;
  explosions: number;
  waterGlints: number;
  drawCalls: number;
  triangles: number;
  lines: number;
  points: number;
  geometries: number;
  textures: number;
  pixelRatio: number;
  width: number;
  height: number;
};

export class DogfightScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, CAMERA_FAR);
  private readonly chaseCamera = new ChaseCamera(this.camera);
  private readonly reticleProjector: ReticleProjector;
  private readonly targetOverlayProjector: TargetOverlayProjector;
  private readonly clock = new THREE.Clock();
  private readonly jetRenderer = new JetRenderer(this.scene);
  private readonly projectileRenderer = new ProjectileRenderer(this.scene);
  private readonly explosionSystem = new ExplosionSystem(this.scene);
  private readonly oceanSystem = new OceanSystem(this.scene);
  private readonly skySystem = new SkySystem(this.scene);
  private readonly terrainSystem = new TerrainSystem(this.scene, this.oceanSystem);
  private readonly smokeSystem = new SmokeSystem(this.scene);
  private readonly combatEffects = new CombatEffectsSystem(
    this.explosionSystem,
    this.smokeSystem,
    this.jetRenderer,
    this.projectileRenderer
  );
  private readonly debugSize = new THREE.Vector2();
  private readonly aimRay = new THREE.Vector3();
  private state: RoomState | undefined;
  private localPlayerId = "";
  private cameraLook: CameraLookInput = { active: false, yaw: 0, pitch: 0 };

  private readonly resize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  constructor(canvas: HTMLCanvasElement, reticle: HTMLElement | null, targetOverlay: HTMLElement | null) {
    this.reticleProjector = new ReticleProjector(reticle, this.camera, (playerId) =>
      this.jetRenderer.getJet(playerId)
    );
    this.targetOverlayProjector = new TargetOverlayProjector(targetOverlay, this.camera, (playerId) =>
      this.jetRenderer.getJet(playerId)
    );
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.camera.position.set(0, 260, -520);

    this.buildWorld();
    window.addEventListener("resize", this.resize);
  }

  updateState(room: RoomState, localPlayerId: string): void {
    this.state = room;
    this.localPlayerId = localPlayerId;
    this.jetRenderer.sync(room);
    this.projectileRenderer.sync(room.projectiles);
  }

  spawnExplosion(position: WorldPosition, color: string): void {
    this.combatEffects.spawnExplosion(position, color);
  }

  spawnHitSpark(position: WorldPosition, color: string): void {
    this.combatEffects.spawnHitSpark(position, color);
  }

  spawnProjectileImpact(position: WorldPosition, projectileType: "bullet" | "missile"): void {
    this.combatEffects.spawnProjectileImpact(position, projectileType);
  }

  setCameraLook(look: CameraLookInput): void {
    this.cameraLook = look;
  }

  computeMouseAimAxes(aim: MouseAimPoint): FlightAxes | undefined {
    const local = this.state?.players[this.localPlayerId];
    const localJet = this.jetRenderer.getJet(this.localPlayerId);
    if (!local || local.status !== "alive" || !localJet?.visible) {
      return undefined;
    }

    return computeMouseAimInstructorAxes(aim, local.rotation.roll);
  }

  computeMouseAimDirection(aim: MouseAimPoint): Vec3 | undefined {
    const local = this.state?.players[this.localPlayerId];
    if (!local || local.status !== "alive") {
      return undefined;
    }

    const screenX = aim.screenX ?? window.innerWidth / 2;
    const screenY = aim.screenY ?? window.innerHeight / 2;
    const ndcX = (screenX / window.innerWidth) * 2 - 1;
    const ndcY = -(screenY / window.innerHeight) * 2 + 1;
    const direction = this.aimRay
      .set(ndcX, ndcY, 0.5)
      .unproject(this.camera)
      .sub(this.camera.position)
      .normalize();

    return { x: direction.x, y: direction.y, z: direction.z };
  }

  render(now: number): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.oceanSystem.update(now);
    this.jetRenderer.update(dt, this.state, this.localPlayerId);
    this.chaseCamera.update(dt, this.state?.players[this.localPlayerId], this.jetRenderer.getJet(this.localPlayerId), this.cameraLook);
    this.skySystem.update(this.camera);
    this.reticleProjector.update(this.state, this.localPlayerId);
    this.targetOverlayProjector.update(this.state, this.localPlayerId);
    this.combatEffects.update(now, dt, this.state);
    this.renderer.render(this.scene, this.camera);
  }

  destroy(): void {
    window.removeEventListener("resize", this.resize);
    this.jetRenderer.dispose();
    this.projectileRenderer.dispose();
    this.explosionSystem.dispose();
    this.skySystem.dispose();
    this.terrainSystem.dispose();
    this.oceanSystem.dispose();
    this.smokeSystem.dispose();
    this.renderer.dispose();
  }

  getDebugStats(): SceneDebugStats {
    let objects = 0;
    this.scene.traverse(() => {
      objects += 1;
    });

    const size = this.renderer.getSize(this.debugSize);
    const renderInfo = this.renderer.info.render;
    const memoryInfo = this.renderer.info.memory;
    return {
      objects,
      jets: this.jetRenderer.getJetCount(),
      projectiles: this.projectileRenderer.getProjectileCount(),
      smokePuffs: this.smokeSystem.getPuffCount(),
      explosions: this.explosionSystem.getExplosionCount(),
      waterGlints: this.oceanSystem.getWaterGlintCount(),
      drawCalls: renderInfo.calls,
      triangles: renderInfo.triangles,
      lines: renderInfo.lines,
      points: renderInfo.points,
      geometries: memoryInfo.geometries,
      textures: memoryInfo.textures,
      pixelRatio: this.renderer.getPixelRatio(),
      width: size.width,
      height: size.height
    };
  }

  private buildWorld(): void {
    this.skySystem.initialize();
    this.oceanSystem.initialize();
    this.smokeSystem.initialize();
    this.terrainSystem.initialize();
  }
}
