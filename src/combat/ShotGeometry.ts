import type { Quat, Vec3 } from "./ShotSnapshot.js";

// Pure angular geometry for SHOT ECHO. Degrees at the API edge, radians inside.

export const DEG = Math.PI / 180;

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
export function len(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}
export function norm(a: Vec3): Vec3 {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}
/** Angle between two unit vectors, radians. */
export function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
}

/** Rotate v by the INVERSE of q (world → camera space). */
export function toCamera(v: Vec3, q: Quat): Vec3 {
  // same form as THREE.Vector3.applyQuaternion, with the conjugate quaternion
  const qx = -q.x, qy = -q.y, qz = -q.z, qw = q.w;
  const tx = 2 * (qy * v.z - qz * v.y);
  const ty = 2 * (qz * v.x - qx * v.z);
  const tz = 2 * (qx * v.y - qy * v.x);
  return {
    x: v.x + qw * tx + qy * tz - qz * ty,
    y: v.y + qw * ty + qz * tx - qx * tz,
    z: v.z + qw * tz + qx * ty - qy * tx,
  };
}

/** Screen-aligned angles of a world direction in the camera frame: +az = right, +el = up (radians). */
export function cameraAngles(dirWorld: Vec3, q: Quat): { az: number; el: number } {
  const v = toCamera(dirWorld, q);
  return { az: Math.atan2(v.x, -v.z), el: Math.atan2(v.y, Math.hypot(v.x, v.z)) };
}

/** Tangent-plane (screen) coordinates of a world direction for this camera; null if behind. */
export function screenTangent(dirWorld: Vec3, q: Quat): { x: number; y: number } | null {
  const v = toCamera(dirWorld, q);
  if (-v.z <= 1e-6) return null;
  return { x: v.x / -v.z, y: v.y / -v.z };
}

/** Angular cone a sphere subtends from `origin`. */
export function headCone(origin: Vec3, center: Vec3, radius: number): { dir: Vec3; halfAngle: number; distance: number } {
  const d = sub(center, origin);
  const distance = len(d);
  return { dir: norm(d), halfAngle: Math.asin(Math.min(1, radius / Math.max(distance, 1e-6))), distance };
}

/**
 * Nearest direction inside a cone (axis `c`, half-angle `inner`) to `d`:
 * the smallest rotation of the aim that lands inside the valid region.
 * Returns `d` itself when it is already inside.
 */
export function nearestInCone(d: Vec3, c: Vec3, inner: number): Vec3 {
  const ang = angleBetween(d, c);
  if (ang <= inner) return d;
  const k = dot(d, c);
  const w = norm({ x: d.x - c.x * k, y: d.y - c.y * k, z: d.z - c.z * k });
  if (len(sub(d, { x: c.x * k, y: c.y * k, z: c.z * k })) < 1e-9) return c; // degenerate (exactly opposite)
  const cs = Math.cos(inner), sn = Math.sin(inner);
  return norm({ x: c.x * cs + w.x * sn, y: c.y * cs + w.y * sn, z: c.z * cs + w.z * sn });
}

/** Screen-axis correction (degrees) that turns `from` into `to`, in the shot's camera frame. */
export function correctionDeg(from: Vec3, to: Vec3, q: Quat): { h: number; v: number; total: number } {
  const a = cameraAngles(from, q);
  const b = cameraAngles(to, q);
  let dAz = b.az - a.az;
  if (dAz > Math.PI) dAz -= 2 * Math.PI;
  if (dAz < -Math.PI) dAz += 2 * Math.PI;
  return { h: dAz / DEG, v: (b.el - a.el) / DEG, total: angleBetween(from, to) / DEG };
}
