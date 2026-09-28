import type { WeaponId } from "../config/weaponConfigs.js";

export interface Vec3 { x: number; y: number; z: number }
export interface Quat { x: number; y: number; z: number; w: number }

/** One target as it was at the shot instant (same matrices the raycast used). */
export interface TargetSample {
  id: number;
  lifeId: number; // bumps on respawn: a correction never carries over to a new life
  alive: boolean;
  headCenter: Vec3;
  headRadius: number;
  /** Clear line from the camera to the head centre (checked only for plausible candidates). */
  headVisible: boolean;
}

/**
 * Plain-data record of a REAL shot, captured inside fire() — i.e. at the
 * effective fire instant (a buffered quickshot is captured when it fires,
 * not when LMB was clicked). No THREE objects: analysis is pure + testable.
 */
export interface ShotSnapshot {
  timeMs: number;
  weaponId: WeaponId;
  origin: Vec3; // camera position
  cameraQuat: Quat; // visual camera orientation (incl. slide roll / recoil kick) → screen space
  fovDeg: number; // vertical fov at the instant
  aimDir: Vec3; // crosshair direction BEFORE spread (what the player aimed)
  shotDir: Vec3; // real direction AFTER spread (what the bullet did)
  spreadDeg: number; // spread cone radius that was applied
  preciseSpreadDeg: number; // spread once snap precision is reached
  ads: boolean;
  adsElapsedMs: number;
  snapPrecisionMs: number;
  sliding: boolean;
  airborne: boolean;
  horizontalSpeed: number;
  result: { targetId: number | null; headshot: boolean; blocked: boolean; distance: number };
  targets: TargetSample[];
}
