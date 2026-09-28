import { correctionParts, type ShotAnalysis } from "./ShotAnalyzer.js";
import type { EchoFeedback } from "./ShotEcho.js";

/**
 * Everything the SHOT ECHO plate says, derived purely from the structured
 * diagnosis (no strings in the renderer). Two separate facts, never mixed:
 * - WHERE the bullet (or crosshair) was relative to the head → description;
 * - WHAT to do → the big correction value + direction (usually the opposite).
 */
export interface EchoCopy {
  header: string;
  glyph: string;
  /** Big value: "0.4°", "0.3° / 0.2°", "SPREAD", "ADS +20ms", "COVER", "CORRECTED!" … */
  value: string;
  /** Direction under the value: "RIGHT", "RIGHT / UP" (empty when not a spatial fix). */
  direction: string;
  /** One or two short lines. */
  description: string[];
}

export type Place = { vertical: "above" | "below" | null; horizontal: "left" | "right" | null };

/**
 * Where a point was relative to the head (screen axes, any unit). A minor
 * component (< 25% of the dominant one) is dropped, matching the correction.
 */
export function placeOf(x: number, y: number, minMagnitude = 1e-6): Place {
  const ax = Math.abs(x), ay = Math.abs(y);
  const major = Math.max(ax, ay);
  if (major < minMagnitude) return { vertical: null, horizontal: null };
  return {
    vertical: ay >= major * 0.25 ? (y > 0 ? "above" : "below") : null,
    horizontal: ax >= major * 0.25 ? (x > 0 ? "right" : "left") : null,
  };
}

export function placePhrase(p: Place): string {
  if (p.vertical && p.horizontal) return `${p.vertical} and ${p.horizontal} of the head`;
  if (p.vertical) return `${p.vertical} the head`;
  if (p.horizontal) return `${p.horizontal} of the head`;
  return "at the edge of the head";
}

/** Bullet position relative to the head, from the SAME ghost data the Impact Sketch draws. */
export function bulletPlace(a: ShotAnalysis): Place | null {
  const g = a.ghost;
  if (!g || g.headRadius <= 0) return null;
  return placeOf((g.shot.x - g.head.x) / g.headRadius, (g.shot.y - g.head.y) / g.headRadius);
}

function bodyAdvice(sh: number, sv: number): string {
  const v = sv > 0 ? "higher" : sv < 0 ? "lower" : "";
  const h = sh > 0 ? "right" : sh < 0 ? "left" : "";
  if (v && h) return `Aim ${v} and ${h} for the head.`;
  if (sv > 0) return "Raise your aim to reach the head.";
  if (sv < 0) return "Lower your aim to reach the head.";
  if (h) return `Aim ${h} to reach the head.`;
  return "Adjust onto the head.";
}

const HEADER = "SHOT ECHO";

/** null → nothing on the plate (no plausible target, or a plain headshot). */
export function describeEcho(fb: EchoFeedback, ads: boolean): EchoCopy | null {
  const a = fb.analysis;
  if (fb.corrected) return { header: HEADER, glyph: "✓", value: "CORRECTED!", direction: "", description: ["Perfect adjustment."] };
  if (!fb.visible) return null;

  switch (a.kind) {
    case "aim":
    case "mixed": {
      const c = correctionParts(a.correction!);
      const value = c.values.length ? c.values.join(" / ") : "<0.1°";
      const direction = c.dirs.join(" / ");
      if (a.kind === "aim") {
        const where = bulletPlace(a);
        const lines = a.hit === "body"
          ? ["Body hit.", bodyAdvice(c.sh, c.sv)]
          : [`Shot passed ${placePhrase(where ?? { vertical: null, horizontal: null })}.`];
        return { header: HEADER, glyph: c.arrow, value, direction, description: lines };
      }
      // mixed: the crosshair itself was off (aimOffset), and spread moved the bullet too
      const off = a.aimOffset ? placePhrase(placeOf(a.aimOffset.h, a.aimOffset.v)) : "off the head";
      const first = a.hit === "body" ? `Body hit. Aim was ${off}.` : `Aim was ${off}.`;
      return { header: HEADER, glyph: c.arrow, value, direction, description: [first, "Spread also moved the shot."] };
    }
    case "ads":
      return {
        header: HEADER, glyph: "◔", value: `ADS +${a.adsWaitMs}ms`, direction: "",
        description: ["Your aim was on target.", "Fire after your scope reaches snap precision."],
      };
    case "spread":
      return {
        header: HEADER, glyph: "◌", value: "SPREAD", direction: "",
        description: ["Your aim was on target.", ads ? "Bullet spread caused the miss." : "Hipfire spread caused the miss. Scope in."],
      };
    case "cover":
      return { header: HEADER, glyph: "▣", value: "COVER", direction: "", description: ["Your line was on the head.", "Cover blocked the shot."] };
    case "generic":
      return { header: HEADER, glyph: "", value: "BODY HIT", direction: "", description: ["Head not visible from here."] };
    case "headshot":
    case "none":
      return null;
  }
}
