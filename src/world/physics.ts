// Custom kinematic AABB physics — deterministic, frame-rate independent,
// and friendly to future client-side prediction / server reconciliation.
//
// NOTE ON RAPIER: @dimforge/rapier3d-compat is a declared dependency and the
// arena mirrors every static collider into a Rapier world (see TrainingArena)
// so a future authoritative server can validate movement against the same
// geometry. The hot-loop character controller stays custom because tight
// arcade slide/air-strafe feel needs direct velocity control that a
// rigid-body simulation fights against.

export interface AABB {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

export function box(cx: number, minY: number, cz: number, sx: number, sy: number, sz: number): AABB {
  return {
    minX: cx - sx / 2, minY, minZ: cz - sz / 2,
    maxX: cx + sx / 2, maxY: minY + sy, maxZ: cz + sz / 2,
  };
}

export interface KinematicBody {
  x: number; y: number; z: number; // feet position
  vx: number; vy: number; vz: number;
  radius: number;
  height: number;
  grounded: boolean;
}

function overlaps(b: KinematicBody, c: AABB): boolean {
  return (
    b.x + b.radius > c.minX && b.x - b.radius < c.maxX &&
    b.z + b.radius > c.minZ && b.z - b.radius < c.maxZ &&
    b.y < c.maxY && b.y + b.height > c.minY
  );
}

/** Move + collide axis by axis. Mutates body. Includes step-up assist for stairs. */
export function moveAndCollide(body: KinematicBody, dt: number, colliders: AABB[]): void {
  // X axis
  body.x += body.vx * dt;
  for (const c of colliders) {
    if (overlaps(body, c)) {
      // step-up: low obstacle with headroom -> climb
      const stepHeight = c.maxY - body.y;
      if (body.grounded && stepHeight > 0 && stepHeight <= 0.65) {
        body.y = c.maxY + 0.001;
        continue;
      }
      if (body.vx > 0) body.x = c.minX - body.radius - 0.001;
      else if (body.vx < 0) body.x = c.maxX + body.radius + 0.001;
      body.vx = 0;
    }
  }
  // Z axis
  body.z += body.vz * dt;
  for (const c of colliders) {
    if (overlaps(body, c)) {
      const stepHeight = c.maxY - body.y;
      if (body.grounded && stepHeight > 0 && stepHeight <= 0.65) {
        body.y = c.maxY + 0.001;
        continue;
      }
      if (body.vz > 0) body.z = c.minZ - body.radius - 0.001;
      else if (body.vz < 0) body.z = c.maxZ + body.radius + 0.001;
      body.vz = 0;
    }
  }
  // Y axis
  body.y += body.vy * dt;
  body.grounded = false;
  for (const c of colliders) {
    if (overlaps(body, c)) {
      if (body.vy <= 0 && body.y >= c.maxY - 0.6) {
        body.y = c.maxY + 0.001;
        body.vy = 0;
        body.grounded = true;
      } else if (body.vy > 0) {
        body.y = c.minY - body.height - 0.001;
        body.vy = 0;
      } else {
        // side overlap during vertical pass — push out horizontally (min axis)
        const dxMin = Math.abs(body.x + body.radius - c.minX);
        const dxMax = Math.abs(c.maxX - (body.x - body.radius));
        const dzMin = Math.abs(body.z + body.radius - c.minZ);
        const dzMax = Math.abs(c.maxZ - (body.z - body.radius));
        const m = Math.min(dxMin, dxMax, dzMin, dzMax);
        if (m === dxMin) body.x = c.minX - body.radius - 0.001;
        else if (m === dxMax) body.x = c.maxX + body.radius + 0.001;
        else if (m === dzMin) body.z = c.minZ - body.radius - 0.001;
        else body.z = c.maxZ + body.radius + 0.001;
      }
    }
  }
}

export interface WallProbe {
  hit: boolean;
  dist: number;
  nx: number;
  nz: number;
}

/**
 * Headroom check for standing up (e.g. slide exit under a low bar).
 * True when a capsule of `toHeight` at (x,y,z) fits without intersecting
 * solid geometry. Floors at/below the feet are ignored.
 */
export function hasHeadroom(
  x: number, y: number, z: number,
  radius: number, toHeight: number,
  colliders: AABB[],
): boolean {
  const probe: KinematicBody = { x, y, z, vx: 0, vy: 0, vz: 0, radius, height: toHeight, grounded: false };
  for (const c of colliders) {
    if (c.maxY <= y + 0.3) continue; // floor, not ceiling
    if (overlaps(probe, c)) return false;
  }
  return true;
}

/** Cheap horizontal wall proximity probe for wall-kick (4-neighbourhood search). */export function probeWalls(
  x: number, y: number, z: number,
  radius: number, height: number,
  range: number, colliders: AABB[],
): WallProbe {
  const dirs = [
    { dx: 1, dz: 0 }, { dx: -1, dz: 0 }, { dx: 0, dz: 1 }, { dx: 0, dz: -1 },
    { dx: 0.7071, dz: 0.7071 }, { dx: -0.7071, dz: 0.7071 },
    { dx: 0.7071, dz: -0.7071 }, { dx: -0.7071, dz: -0.7071 },
  ];
  const probe: KinematicBody = { x, y, z, vx: 0, vy: 0, vz: 0, radius, height, grounded: false };
  let best: WallProbe = { hit: false, dist: Infinity, nx: 0, nz: 0 };
  const steps = 6;
  for (const d of dirs) {
    for (let i = 1; i <= steps; i++) {
      const t = (range * i) / steps;
      probe.x = x + d.dx * t;
      probe.z = z + d.dz * t;
      probe.y = y;
      let collided = false;
      for (const c of colliders) {
        // ignore floors below feet
        if (c.maxY <= y + 0.3) continue;
        if (overlaps(probe, c)) { collided = true; break; }
      }
      if (collided) {
        if (t < best.dist) best = { hit: true, dist: t, nx: -d.dx, nz: -d.dz };
        break;
      }
    }
  }
  return best;
}
