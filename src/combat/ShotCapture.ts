import * as THREE from "three";
import type { WeaponId } from "../config/weaponConfigs.js";
import type { HitscanResult } from "./HitDetection.js";
import type { ShotSnapshot, TargetSample, Vec3 } from "./ShotSnapshot.js";

const v3 = (v: THREE.Vector3): Vec3 => ({ x: v.x, y: v.y, z: v.z });

/**
 * Anything the hitscan can hit that SHOT ECHO can analyse: training targets
 * and FFA bots alike. `meshes` are the REAL combat hitboxes (head mesh has
 * userData.part === "head"); `lifeId` changes on every respawn.
 */
export interface EchoTarget {
  readonly id: number;
  readonly lifeId: number;
  readonly alive: boolean;
  readonly meshes: THREE.Object3D[];
}

export interface ShotCaptureInput {
  nowMs: number; // the EFFECTIVE fire instant (fire() is only reached on a real shot)
  weaponId: WeaponId;
  camera: THREE.PerspectiveCamera;
  aimDir: THREE.Vector3;
  shotDir: THREE.Vector3;
  spreadDeg: number;
  preciseSpreadDeg: number;
  ads: boolean;
  adsElapsedMs: number;
  snapPrecisionMs: number;
  sliding: boolean;
  airborne: boolean;
  horizontalSpeed: number;
  result: HitscanResult;
  targets: readonly EchoTarget[];
  walls: THREE.Object3D[];
  maximumAnalysisAngleDeg: number;
}

/**
 * Freezes a real shot into plain data. Reads the SAME matrices the hitscan
 * raycast used (no matrix refresh) so analysis matches what actually happened.
 * Line-of-sight raycasts run only for plausible candidates (the hit target +
 * heads within the analysis angle) — never per frame, never for every target.
 */
export class ShotCapture {
  private ray = new THREE.Raycaster();
  private tmp = new THREE.Vector3();
  private toHead = new THREE.Vector3();

  capture(i: ShotCaptureInput): ShotSnapshot {
    const origin = i.camera.position;
    const hitTarget = i.result.target ? i.targets.find((t) => t === (i.result.target as unknown)) ?? null : null;
    const maxRad = (i.maximumAnalysisAngleDeg * Math.PI) / 180;
    const samples: TargetSample[] = [];
    for (const t of i.targets) {
      const head = t.meshes.find((m) => m.userData["part"] === "head") as THREE.Mesh | undefined;
      if (!head) continue;
      const center = this.tmp.setFromMatrixPosition(head.matrixWorld);
      const geo = head.geometry;
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const radius = (geo.boundingSphere?.radius ?? 0) * head.matrixWorld.getMaxScaleOnAxis();
      this.toHead.subVectors(center, origin);
      const dist = this.toHead.length();
      this.toHead.divideScalar(dist || 1);
      const half = Math.asin(Math.min(1, radius / Math.max(dist, 1e-6)));
      const off = Math.min(this.toHead.angleTo(i.aimDir), this.toHead.angleTo(i.shotDir)) - half;
      const candidate = t.alive && (t === hitTarget || off <= maxRad);
      samples.push({
        id: t.id, lifeId: t.lifeId, alive: t.alive,
        headCenter: v3(center), headRadius: radius,
        headVisible: candidate && this.lineOfSight(origin, this.toHead, dist - radius, i.walls),
      });
    }
    const q = i.camera.quaternion;
    return {
      timeMs: i.nowMs,
      weaponId: i.weaponId,
      origin: v3(origin),
      cameraQuat: { x: q.x, y: q.y, z: q.z, w: q.w },
      fovDeg: i.camera.fov,
      aimDir: v3(i.aimDir),
      shotDir: v3(i.shotDir),
      spreadDeg: i.spreadDeg,
      preciseSpreadDeg: i.preciseSpreadDeg,
      ads: i.ads,
      adsElapsedMs: i.adsElapsedMs,
      snapPrecisionMs: i.snapPrecisionMs,
      sliding: i.sliding,
      airborne: i.airborne,
      horizontalSpeed: i.horizontalSpeed,
      result: {
        targetId: hitTarget ? hitTarget.id : null,
        headshot: i.result.headshot,
        blocked: i.result.blocked,
        distance: i.result.distance,
      },
      targets: samples,
    };
  }

  /** Nothing solid between the camera and the head surface. */
  private lineOfSight(origin: THREE.Vector3, dir: THREE.Vector3, far: number, walls: THREE.Object3D[]): boolean {
    if (far <= 0) return true;
    this.ray.set(origin, dir);
    this.ray.far = far;
    return this.ray.intersectObjects(walls, false).length === 0;
  }
}
