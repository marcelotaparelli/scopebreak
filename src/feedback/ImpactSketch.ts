import type { ShotEchoConfig } from "../config/shotEchoConfig.js";
import { headCone, nearestInCone, screenTangent } from "../combat/ShotGeometry.js";
import type { ShotSnapshot } from "../combat/ShotSnapshot.js";
import type { EchoKind, ShotAnalysis } from "./ShotAnalyzer.js";

/** A point in HEAD-RADIUS units relative to the head centre, screen axes (+x right, +y up). */
export interface SketchPoint { x: number; y: number }

/**
 * Impact Sketch: a tiny 2D diagram of the shot INSTANT — where the bullet
 * passed relative to the head, in the shot's screen plane. Built from the
 * existing analysis (ghost tangent coords) — no new analysis, no tracking.
 */
export interface ImpactSketch {
  kind: EchoKind;
  /**
   * Head radii from the sketch centre to its edge. ADAPTIVE framing: zoomed
   * so the head and the X fill the drawing (near miss → big head), up to
   * MAX_EXTENT for far misses. Positions are never moved — only the frame.
   */
  extent: number;
  /** Valid headshot region radius (validRegionInset), in head radii. */
  inset: number;
  /** Where the bullet passed (the X). */
  bullet: SketchPoint;
  /** True when the bullet was beyond the drawing: X pinned to the rim, direction kept. */
  bulletClamped: boolean;
  /** Crosshair (the +) — drawn when it tells something the X doesn't (spread moved the bullet). */
  aim: SketchPoint | null;
  /** Arrow: crosshair (or the X when they coincide) → nearest point of the valid region. Aim errors only. */
  arrowFrom: SketchPoint | null;
  arrowTo: SketchPoint | null;
}

export type SketchSuppression = "disabled" | "no-target" | "headshot" | "cover" | "generic" | "no-projection";

export interface ImpactSketchResult {
  sketch: ImpactSketch | null;
  suppressed: SketchSuppression | null;
  /** Normalised bullet offset (head radii), also reported when suppressed for ambiguity. */
  offset: SketchPoint | null;
}

const MAX_EXTENT = 3; // widest frame: ±3 head radii (beyond → pinned to the rim, direction kept)
export const MIN_EXTENT = 1.4; // tightest frame: the head fills ~70% of the drawing
const RIM = MAX_EXTENT * 0.84; // pinned X (half-size 0.16 × frame) still fits inside the frame

/** Tightest frame that still shows the head, every marker and room for the X glyph. */
export function frameExtent(points: SketchPoint[]): number {
  const reach = Math.max(1, ...points.map((p) => Math.hypot(p.x, p.y)));
  return Math.min(MAX_EXTENT, Math.max(MIN_EXTENT, reach * 1.18 + 0.2));
}

export function buildImpactSketch(s: ShotSnapshot, a: ShotAnalysis, cfg: ShotEchoConfig): ImpactSketchResult {
  if (!cfg.enabled || !cfg.impactSketchEnabled) return { sketch: null, suppressed: "disabled", offset: null };
  if (a.kind === "headshot") return { sketch: null, suppressed: "headshot", offset: null };
  if (a.kind === "generic") return { sketch: null, suppressed: "generic", offset: null };
  if (!a.target || a.kind === "none") return { sketch: null, suppressed: "no-target", offset: null };
  const g = a.ghost;
  if (!g || g.headRadius <= 0) return { sketch: null, suppressed: "no-projection", offset: null };

  const rel = (t: { x: number; y: number }): SketchPoint => ({ x: (t.x - g.head.x) / g.headRadius, y: (t.y - g.head.y) / g.headRadius });
  const bulletRaw = rel(g.shot);
  // cover: the line WAS on the head — a sketch would say "you missed", which is wrong
  if (a.kind === "cover") return { sketch: null, suppressed: "cover", offset: bulletRaw };

  const d = Math.hypot(bulletRaw.x, bulletRaw.y);
  const bulletClamped = d > RIM;
  const bullet = bulletClamped ? { x: (bulletRaw.x / d) * RIM, y: (bulletRaw.y / d) * RIM } : bulletRaw;

  const aimT = screenTangent(s.aimDir, s.cameraQuat);
  const aimRel = aimT ? rel(aimT) : null;
  const spreadMoved = a.kind === "spread" || a.kind === "ads" || a.kind === "mixed";
  const aim = aimRel && spreadMoved && Math.hypot(aimRel.x - bulletRaw.x, aimRel.y - bulletRaw.y) > 0.15 ? clampPoint(aimRel) : null;

  let arrowTo: SketchPoint | null = null;
  if ((a.kind === "aim" || a.kind === "mixed") && a.target) {
    // same target point the text correction uses: crosshair → inner head region
    const cone = headCone(s.origin, a.target.headCenter, a.target.headRadius);
    const fixT = screenTangent(nearestInCone(s.aimDir, cone.dir, cone.halfAngle * cfg.validRegionInset), s.cameraQuat);
    if (fixT) arrowTo = rel(fixT);
  }
  return {
    sketch: {
      kind: a.kind, extent: frameExtent([bullet, ...(aim ? [aim] : []), ...(arrowTo ? [arrowTo] : [])]),
      inset: cfg.validRegionInset, bullet, bulletClamped, aim,
      arrowFrom: arrowTo ? (aimRel ? clampPoint(aimRel) : bullet) : null, arrowTo,
    },
    suppressed: null,
    offset: bulletRaw,
  };
}

/** Square sketch side: exactly the measured height of the text column, never below the floor. */
export function sketchSizeFor(textColumnHeightPx: number, cfg: ShotEchoConfig): number {
  return Math.max(cfg.impactSketchMinSize, Math.round(textColumnHeightPx));
}

function clampPoint(p: SketchPoint): SketchPoint {
  const d = Math.hypot(p.x, p.y);
  return d > RIM ? { x: (p.x / d) * RIM, y: (p.y / d) * RIM } : p;
}
