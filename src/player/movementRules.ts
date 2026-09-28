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

/**
 * Slide boost on valid entry — DIMINISHING RETURNS, no threshold:
 * close `strength` of the gap to `target`. Run speed gets a big kick,
 * faster entries a progressively smaller one, at/above the target the
 * speed is PRESERVED (never pulled down). Applied once per entry.
 * Continuous and monotonic (slope 1 - strength below target, 1 above),
 * and output ≤ max(current, target), so chains can't pump past target.
 */
export function slideBoostSpeed(current: number, target: number, strength: number): number {
  if (current >= target) return current;
  return current + (target - current) * strength;
}

/**
 * Flow-landing entry (air → ground + fresh Shift): PRESERVE momentum with
 * a small landing cost, never boost — landing is never an energy source,
 * whatever the speed. (Lifting slow landings to the boost floor made the
 * touchdown feel like the moment speed appeared.)
 */
export function flowSlideSpeed(current: number, retention: number): number {
  return current * retention;
}

/** Slide-jump takeoff: keep ~all horizontal momentum, own (lower) vertical. */
export function slideJumpTakeoff(
  horizontalSpeed: number,
  momentumRetention: number,
  verticalForce: number,
): { horizontal: number; vertical: number } {
  return {
    horizontal: horizontalSpeed * momentumRetention,
    vertical: verticalForce,
  };
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
 * Air strafe: DIRECTION and MAGNITUDE are handled separately, so turning
 * responds on the first tick at any speed (the old add-a-vector-and-clamp
 * model turned at accel/speed rad/s — ~100°/s at 15 m/s — and bled speed
 * whenever the wish was > 90° from the velocity).
 *
 * 1. DIRECTION: rotate the real velocity toward the wish (camera + WASD) by
 *    at most `maxTurnRad`; a wish further than `oppositeRad` (S / reversal)
 *    does not rotate. Pure rotation: no energy created or lost.
 * 2. MAGNITUDE (`accel` = airAcceleration × airControl):
 *    - wish ahead: builds speed only up to `wishSpeed` (run speed) — W is
 *      never an air accelerator above run speed;
 *    - wish behind (> 90° after turning): the opposing part brakes — a
 *      reversal costs speed and time;
 *    - excess above `maxAirSpeed` decays gently.
 * No WASD → the caller skips this: the camera is free to aim.
 */
export function airControlStep(
  vx: number,
  vz: number,
  wishX: number,
  wishZ: number,
  maxTurnRad: number,
  oppositeRad: number,
  accel: number,
  maxAirSpeed: number,
  wishSpeed: number,
  dt: number,
): { vx: number; vz: number; diffRad: number; turnRad: number } {
  const wishLen = Math.hypot(wishX, wishZ);
  if (wishLen < 1e-6) return { vx, vz, diffRad: 0, turnRad: 0 };
  const nx = wishX / wishLen;
  const nz = wishZ / wishLen;
  const add = accel * dt;
  const sp = Math.hypot(vx, vz);
  if (sp < 1e-4) {
    // standing jump: input builds speed from zero along the wish
    const s = Math.min(add, wishSpeed);
    return { vx: nx * s, vz: nz * s, diffRad: 0, turnRad: 0 };
  }
  const diff = Math.atan2(vx * nz - vz * nx, vx * nx + vz * nz);
  const turn = Math.abs(diff) > oppositeRad ? 0 : Math.max(-maxTurnRad, Math.min(maxTurnRad, diff));
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const dx = (vx * c - vz * s) / sp;
  const dz = (vx * s + vz * c) / sp;
  const align = Math.cos(diff - turn);
  let newSp = sp;
  if (align > 0 && sp < wishSpeed) newSp = Math.min(wishSpeed, sp + add * align);
  else if (align < 0) newSp = Math.max(0, sp + add * align);
  if (newSp > maxAirSpeed) newSp = Math.max(maxAirSpeed, newSp - newSp * 0.35 * dt);
  return { vx: dx * newSp, vz: dz * newSp, diffRad: diff, turnRad: turn };
}

/**
 * Slide steering: rotate the CURRENT velocity toward the wish direction
 * (camera yaw + WASD) by at most `maxTurnRad` this step. Pure rotation —
 * magnitude is untouched (friction is applied separately). Momentum rules:
 * never snaps to the wish, and a near-opposite wish (|Δ| > oppositeRad,
 * e.g. S while sliding forward) does not steer at all — no reverse-slide.
 */
export function slideSteerStep(
  vx: number,
  vz: number,
  wishX: number,
  wishZ: number,
  maxTurnRad: number,
  oppositeRad: number,
): { vx: number; vz: number; diffRad: number } {
  const sp = Math.hypot(vx, vz);
  if (sp < 1e-6 || Math.hypot(wishX, wishZ) < 1e-6) return { vx, vz, diffRad: 0 };
  // signed angle from velocity to wish
  const diff = Math.atan2(vx * wishZ - vz * wishX, vx * wishX + vz * wishZ);
  if (Math.abs(diff) > oppositeRad) return { vx, vz, diffRad: diff };
  const turn = Math.max(-maxTurnRad, Math.min(maxTurnRad, diff));
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  return { vx: vx * c - vz * s, vz: vx * s + vz * c, diffRad: diff };
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
 * Progressive ADS spread with SNAP PRECISION (baseline feel preserved,
 * timing re-tuned for CLICK-CLICK-BANG).
 * - t=0 → hipSpread (hip fire, wildly imprecise)
 * - quadratic collapse → ~0 at snapMs (snap precision, practically zero)
 * - t>=snapMs → preciseSpread (full precision BEFORE visual scope completes)
 * Crosshair alignment untouched: ADS never shifts yaw/pitch.
 */
export function adsSpreadDeg(args: {
  adsElapsedMs: number;
  snapMs: number;
  hipSpreadDeg: number;
  preciseSpreadDeg: number;
}): number {
  const { snapMs, hipSpreadDeg, preciseSpreadDeg } = args;
  if (snapMs <= 0) return preciseSpreadDeg;
  if (args.adsElapsedMs >= snapMs) return preciseSpreadDeg;
  const k = Math.max(0, Math.min(1, args.adsElapsedMs / snapMs));
  return hipSpreadDeg * (1 - k) * (1 - k);
}

export type LmbDecision = "fire-now" | "buffer-quickshot";
export type PendingQuickshot = "idle" | "wait" | "fire";

/**
 * Pure buffered-shot resolution. A buffered click fires exactly once at
 * ADS-start + snap delay. Ordering proof: pendingLmb >= adsStart always
 * (buffer is only set after ADS starts), so the snap instant always lands
 * within buffer+snap of the click — no linger, no second branch needed.
 * External invalidation (death/switch/reset) clears the buffer explicitly.
 */
export function resolvePendingQuickshot(args: {
  pendingLmbMs: number; // -1 when no shot buffered
  adsStartMs: number;
  snapMs: number;
  nowMs: number;
}): PendingQuickshot {
  if (args.pendingLmbMs < 0) return "idle";
  if (args.nowMs >= args.adsStartMs + args.snapMs) return "fire";
  return "wait";
}

/**
 * Pure LMB routing for Snap Precision (unit-tested, Game executes it).
 * - No ADS started (or started long ago) → fire immediately (hip or full ADS).
 * - ADS started within buffer window but snap not ready → buffer until snap.
 * - ADS already past snap → fire immediately with ~zero spread.
 * Exactly one click → at most one shot (caller consumes the edge/pending).
 */
export function decideLmbEdge(args: {
  sinceAdsStartMs: number; // nowMs - lastAdsStartMs (Infinity if ADS never started)
  adsElapsedMs: number; // time since ADS start (same value; kept explicit for readability)
  quickShotBufferMs: number;
  snapPrecisionMs: number;
}): LmbDecision {
  if (args.sinceAdsStartMs <= args.quickShotBufferMs && args.adsElapsedMs < args.snapPrecisionMs) {
    return "buffer-quickshot";
  }
  return "fire-now";
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
