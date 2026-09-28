import type { ShotEchoConfig } from "../config/shotEchoConfig.js";
import {
  angleBetween, cameraAngles, correctionDeg, DEG, headCone, nearestInCone, screenTangent,
} from "../combat/ShotGeometry.js";
import type { ShotSnapshot, TargetSample, Vec3 } from "../combat/ShotSnapshot.js";

/**
 * What one real shot teaches. Exactly ONE diagnosis per shot:
 * - headshot   no error
 * - aim        crosshair was off the head → spatial correction (spread too small to matter)
 * - mixed      crosshair off AND spread large enough to also have moved the bullet
 * - ads        crosshair on the head, pre-snap spread moved the bullet, and
 *              waiting until snap precision would have hit → "ADS +Nms"
 * - spread     crosshair on the head, spread moved the bullet (hipfire / no timing fix)
 * - cover      the line was on the head but geometry in front stopped the bullet
 * - generic    a body hit whose head is hidden: no direction can be justified
 * - none       nothing plausible to analyse (scenery shot, hidden target, too far)
 */
export type EchoKind = "headshot" | "aim" | "mixed" | "ads" | "spread" | "cover" | "generic" | "none";

export interface Correction { h: number; v: number; total: number }
export interface Tangent { x: number; y: number }

export interface ShotAnalysis {
  kind: EchoKind;
  hit: "head" | "body" | "miss";
  target: TargetSample | null;
  /** Crosshair → inner head region, screen axes in degrees (+h right, +v up). Player-controllable part. */
  correction: Correction | null;
  /** Crosshair relative to head centre (deg, same frame) — used to verify CORRECTED later. */
  aimOffset: { h: number; v: number } | null;
  aimOnHead: boolean;
  shotOnHead: boolean;
  /** ms still missing to snap precision (kind "ads" only). */
  adsWaitMs: number | null;
  /** Ghost reticle in tangent-plane coords of the camera AT THE SHOT (null when nothing to draw). */
  ghost: { shot: Tangent; head: Tangent; headRadius: number; fix: Tangent | null } | null;
}

const NONE = (hit: ShotAnalysis["hit"]): ShotAnalysis => ({
  kind: "none", hit, target: null, correction: null, aimOffset: null,
  aimOnHead: false, shotOnHead: false, adsWaitMs: null, ghost: null,
});

/**
 * Target to analyse:
 * - the target actually hit (body shot) — always, if its head is visible;
 * - otherwise the visible, alive head closest in ANGLE (not 3D distance) to
 *   either the crosshair or the bullet, within maximumAnalysisAngle.
 * Hidden heads are never candidates: no direction toward what you can't see.
 */
export function selectTarget(s: ShotSnapshot, cfg: ShotEchoConfig): TargetSample | null {
  if (s.result.targetId !== null) {
    const hitT = s.targets.find((t) => t.id === s.result.targetId) ?? null;
    return hitT && hitT.headVisible ? hitT : null;
  }
  let best: TargetSample | null = null;
  let bestAng = Infinity;
  for (const t of s.targets) {
    if (!t.alive || !t.headVisible) continue;
    const cone = headCone(s.origin, t.headCenter, t.headRadius);
    const off = Math.min(angleBetween(s.shotDir, cone.dir), angleBetween(s.aimDir, cone.dir)) - cone.halfAngle;
    if (off <= cfg.maximumAnalysisAngleDeg * DEG && off < bestAng) {
      bestAng = off;
      best = t;
    }
  }
  return best;
}

export function analyzeShot(s: ShotSnapshot, cfg: ShotEchoConfig): ShotAnalysis {
  const hit: ShotAnalysis["hit"] = s.result.headshot ? "head" : s.result.targetId !== null ? "body" : "miss";
  if (hit === "head") {
    const t = s.targets.find((x) => x.id === s.result.targetId) ?? null;
    const a = t ? offsetFromHead(s, t) : null;
    return { ...NONE("head"), kind: "headshot", target: t, aimOffset: a, aimOnHead: true, shotOnHead: true };
  }

  const target = selectTarget(s, cfg);
  if (!target) {
    // body hit with a hidden head: say what happened, never a direction
    return hit === "body" ? { ...NONE("body"), kind: "generic" } : NONE(hit);
  }

  const cone = headCone(s.origin, target.headCenter, target.headRadius);
  const inner = cone.halfAngle * cfg.validRegionInset;
  const aimAng = angleBetween(s.aimDir, cone.dir);
  const shotAng = angleBetween(s.shotDir, cone.dir);
  const aimOnHead = aimAng <= inner;
  const shotOnHead = shotAng <= cone.halfAngle;
  const ghost = buildGhost(s, cone.dir, cone.halfAngle, inner);
  const base = { hit, target, aimOnHead, shotOnHead, ghost, aimOffset: offsetFromHead(s, target), adsWaitMs: null };

  // the bullet's line crossed the head but something in front stopped it
  if (shotOnHead && s.result.blocked && s.result.distance < cone.distance - target.headRadius) {
    return { ...base, kind: "cover", correction: null };
  }

  if (aimOnHead) {
    // crosshair was right: the bullet was moved by spread — never blame the aim
    const preSnap = s.ads && s.adsElapsedMs < s.snapPrecisionMs && s.spreadDeg > s.preciseSpreadDeg + 1e-9;
    // waiting would provably hit: aim offset + precise spread still inside the valid region
    if (preSnap && aimAng + s.preciseSpreadDeg * DEG <= inner) {
      return { ...base, kind: "ads", correction: null, adsWaitMs: Math.ceil(s.snapPrecisionMs - s.adsElapsedMs) };
    }
    return { ...base, kind: "spread", correction: null };
  }

  const fix = nearestInCone(s.aimDir, cone.dir, inner);
  const correction = correctionDeg(s.aimDir, fix, s.cameraQuat);
  // spread large relative to the aim error: both contributed
  const kind: EchoKind = s.spreadDeg <= correction.total * 0.5 ? "aim" : "mixed";
  return { ...base, kind, correction };
}

/** Crosshair offset from the head centre in the shot's screen axes (degrees). */
function offsetFromHead(s: ShotSnapshot, t: TargetSample): { h: number; v: number } {
  const c = headCone(s.origin, t.headCenter, t.headRadius);
  const a = cameraAngles(s.aimDir, s.cameraQuat);
  const b = cameraAngles(c.dir, s.cameraQuat);
  return { h: (a.az - b.az) / DEG, v: (a.el - b.el) / DEG };
}

function buildGhost(s: ShotSnapshot, headDir: Vec3, halfAngle: number, inner: number): ShotAnalysis["ghost"] {
  const shot = screenTangent(s.shotDir, s.cameraQuat);
  const head = screenTangent(headDir, s.cameraQuat);
  if (!shot || !head) return null;
  const fixDir = nearestInCone(s.shotDir, headDir, inner);
  const fix = angleBetween(fixDir, s.shotDir) > 1e-9 ? screenTangent(fixDir, s.cameraQuat) : null;
  return { shot, head, headRadius: Math.tan(halfAngle), fix };
}

// ---------------- presentation text (short, glanceable) ----------------

const ARROWS: Record<string, string> = {
  "1,0": "→", "-1,0": "←", "0,1": "↑", "0,-1": "↓",
  "1,1": "↗", "-1,1": "↖", "1,-1": "↘", "-1,-1": "↙",
};

/**
 * Correction split into display parts. Values are rounded UP to 0.1°
 * (following them reaches the valid region); a component under 25% of the
 * dominant one is dropped so the player reads ONE clear instruction.
 * Horizontal first, then vertical.
 */
export function correctionParts(c: Correction): { arrow: string; values: string[]; dirs: string[]; sh: number; sv: number } {
  const ah = Math.abs(c.h), av = Math.abs(c.v);
  const major = Math.max(ah, av);
  const useH = ah >= 0.05 && ah >= major * 0.25;
  const useV = av >= 0.05 && av >= major * 0.25;
  const up = (x: number): string => (Math.ceil(x * 10 - 1e-9) / 10).toFixed(1);
  const sh = useH ? Math.sign(c.h) : 0;
  const sv = useV ? Math.sign(c.v) : 0;
  const values: string[] = [];
  const dirs: string[] = [];
  if (useH) { values.push(`${up(ah)}°`); dirs.push(c.h > 0 ? "RIGHT" : "LEFT"); }
  if (useV) { values.push(`${up(av)}°`); dirs.push(c.v > 0 ? "UP" : "DOWN"); }
  return { arrow: ARROWS[`${sh},${sv}`] ?? "·", values, dirs, sh, sv };
}

/** One-line correction text, e.g. "0.3° RIGHT + 0.2° UP". */
export function formatCorrection(c: Correction): { arrow: string; text: string } {
  const p = correctionParts(c);
  if (p.values.length === 0) return { arrow: "·", text: `<0.1°` };
  return { arrow: p.arrow, text: p.values.map((v, i) => `${v} ${p.dirs[i]}`).join(" + ") };
}
