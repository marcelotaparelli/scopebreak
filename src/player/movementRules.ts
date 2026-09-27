// Pure movement / combat rules — no THREE, no DOM.
// Everything here is unit-tested with `bun test`.

export function canStartSlide(args: {
  grounded: boolean;
  alreadySliding: boolean;
  horizontalSpeed: number;
  minimumSlideSpeed: number;
  cooldownRemainingMs: number;
}): boolean {
  if (!args.grounded) return false;
  if (args.alreadySliding) return false;
  if (args.cooldownRemainingMs > 0) return false;
  return args.horizontalSpeed >= args.minimumSlideSpeed;
}

export function slideEntrySpeed(entrySpeed: number, boost: number): number {
  return entrySpeed * boost;
}

/** Friction-decayed slide speed after dt seconds. */
export function slideSpeedAfter(current: number, friction: number, dt: number): number {
  return Math.max(0, current - friction * current * dt);
}

export function applyMomentumRetention(speed: number, retention: number): number {
  return speed * retention;
}

export function slideJumpVelocity(
  horizontalSpeed: number,
  horizontalMultiplier: number,
  verticalForce: number,
): { horizontal: number; vertical: number } {
  return {
    horizontal: horizontalSpeed * horizontalMultiplier,
    vertical: verticalForce,
  };
}

/**
 * Gradual air control: steer current horizontal velocity toward wish dir
 * without allowing instant 180s. Returns new horizontal speed vector (x,z).
 */
export function airControlStep(
  vx: number,
  vz: number,
  wishX: number,
  wishZ: number,
  airAcceleration: number,
  airControl: number,
  maxAirSpeed: number,
  dt: number,
): { vx: number; vz: number } {
  const wishLen = Math.hypot(wishX, wishZ);
  if (wishLen < 1e-6) return { vx, vz };
  const nx = wishX / wishLen;
  const nz = wishZ / wishLen;
  const oldSpeed = Math.hypot(vx, vz);
  const add = airAcceleration * airControl * dt;
  let nvx = vx + nx * add;
  let nvz = vz + nz * add;
  // Firm speed ceiling: keep prior excess momentum but decay it toward the
  // cap instead of letting strafe pumping grow speed without bound.
  const allowed = Math.max(maxAirSpeed, oldSpeed - oldSpeed * 0.35 * dt);
  const sp = Math.hypot(nvx, nvz);
  if (sp > allowed) {
    const s = allowed / sp;
    nvx *= s;
    nvz *= s;
  }
  return { vx: nvx, vz: nvz };
}

/** Flow landing: Shift pressed within window before OR after touchdown. */
export function isFlowLanding(args: {
  timeSinceShiftMs: number; // ms since Shift went down (Infinity if not pressed)
  timeSinceLandMs: number; // ms since touchdown (Infinity if airborne)
  windowMs: number;
}): boolean {
  // pressed shortly before landing (buffered) or shortly after landing
  return (
    args.timeSinceShiftMs <= args.windowMs || args.timeSinceLandMs <= args.windowMs
  ) && args.timeSinceShiftMs < 10_000 && args.timeSinceLandMs < 10_000;
}

export function canWallKick(args: {
  airborne: boolean;
  wallAvailable: boolean;
  alreadyKickedThisAirtime: boolean;
}): boolean {
  return args.airborne && args.wallAvailable && !args.alreadyKickedThisAirtime;
}

export function isPrecisionReady(adsElapsedMs: number, windowMs: number): boolean {
  return adsElapsedMs >= windowMs;
}

/**
 * Progressive ADS spread curve (baseline-preserving).
 * Thresholds unchanged: precision-ready still at adsMs.
 * - t=0 → hipSpread (hip fire)
 * - t≈0.4 → hipSpread*0.45 (old mid-transition value, reached fast)
 * - t=1 → preciseSpread (full precision BEFORE visual scope completes)
 * Crosshair alignment untouched: ADS never shifts yaw/pitch.
 */
export function adsSpreadDeg(args: {
  adsElapsedMs: number;
  adsMs: number;
  hipSpreadDeg: number;
  preciseSpreadDeg: number;
}): number {
  const { adsMs, hipSpreadDeg, preciseSpreadDeg } = args;
  if (adsMs <= 0) return preciseSpreadDeg;
  const t = Math.max(0, Math.min(1, args.adsElapsedMs / adsMs));
  if (t >= 1) return preciseSpreadDeg;
  const mid = hipSpreadDeg * 0.45;
  if (t <= 0.4) {
    const k = t / 0.4;
    const eased = 1 - (1 - k) * (1 - k); // fast initial collapse, same endpoints
    return hipSpreadDeg + (mid - hipSpreadDeg) * eased;
  }
  const k = (t - 0.4) / 0.6;
  const eased = k * k; // accelerating reward for learning the timing
  return mid + (preciseSpreadDeg - mid) * eased;
}

export function canFire(nowMs: number, lastShotMs: number, cooldownMs: number): boolean {
  return nowMs - lastShotMs >= cooldownMs;
}

export interface DamageResult {
  damage: number;
  killed: boolean;
  headshot: boolean;
}

export function computeDamage(args: {
  headshot: boolean;
  bodyDamage: number;
  headDamage: number;
  targetHealth: number;
}): DamageResult {
  const damage = args.headshot ? args.headDamage : args.bodyDamage;
  return { damage, headshot: args.headshot, killed: damage >= args.targetHealth };
}

export type SkillKind = "headshot" | "slideShot" | "airShot" | "wallKickShot" | "longShot";

export interface SkillContext {
  headshot: boolean;
  sliding: boolean;
  airborne: boolean;
  wallKickRecent: boolean;
  distance: number;
  longShotDistance: number;
  killed: boolean;
}

export const skillScores: Record<SkillKind, number> = {
  headshot: 100,
  slideShot: 25,
  airShot: 25,
  wallKickShot: 50,
  longShot: 25,
};

/** Pure skill-event detection (does not mutate score; GameMode owns that). */
export function detectSkillEvents(ctx: SkillContext): SkillKind[] {
  const out: SkillKind[] = [];
  if (!ctx.killed && !ctx.headshot) {
    // non-lethal body hits still count movement style events
  }
  if (ctx.headshot) out.push("headshot");
  if (ctx.sliding) out.push("slideShot");
  if (ctx.airborne) out.push("airShot");
  if (ctx.wallKickRecent) out.push("wallKickShot");
  if (ctx.distance >= ctx.longShotDistance) out.push("longShot");
  return out;
}
