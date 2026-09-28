import { shotEchoConfig, type ShotEchoConfig } from "../config/shotEchoConfig.js";
import type { ShotSnapshot } from "../combat/ShotSnapshot.js";
import { analyzeShot, formatCorrection, type ShotAnalysis } from "./ShotAnalyzer.js";

/** Visual family — each also has its own glyph/shape, never colour alone. */
export type EchoTone = "aim" | "precision" | "corrected" | "info";

export interface EchoFeedback {
  analysis: ShotAnalysis;
  corrected: boolean;
  /** false → nothing on screen (plain headshot: the existing HEADSHOT popup already speaks). */
  visible: boolean;
  tone: EchoTone;
  glyph: string;
  title: string;
  detail: string;
  showGhost: boolean;
  sound: "tick" | "corrected" | null;
}

/** Local aggregate counters only — no per-shot log, nothing persisted. */
export interface ShotEchoStats {
  analyzed: number;
  headshots: number;
  bodyShots: number;
  nearMisses: number;
  horizontalErrors: number;
  verticalErrors: number;
  spreadLimited: number;
  adsEarly: number;
  corrected: number;
  noTarget: number;
}

interface PendingDiagnosis {
  targetId: number;
  lifeId: number;
  timeMs: number;
  kind: ShotAnalysis["kind"];
  aimOffset: { h: number; v: number };
  correction: { h: number; v: number } | null;
}

const emptyStats = (): ShotEchoStats => ({
  analyzed: 0, headshots: 0, bodyShots: 0, nearMisses: 0, horizontalErrors: 0,
  verticalErrors: 0, spreadLimited: 0, adsEarly: 0, corrected: 0, noTarget: 0,
});

/**
 * SHOT ECHO core: analyse → pick ONE message → remember ONE diagnosis so the
 * next headshot on the same target (same life, inside the window) can be
 * recognised as CORRECTED. Observes only: never touches aim, spread, damage.
 * Memory is O(1): one pending diagnosis + one last result.
 */
export class ShotEcho {
  stats: ShotEchoStats = emptyStats();
  last: { snapshot: ShotSnapshot; feedback: EchoFeedback } | null = null;
  private pending: PendingDiagnosis | null = null;

  constructor(public cfg: ShotEchoConfig = shotEchoConfig) {}

  reset(): void {
    this.stats = emptyStats();
    this.pending = null;
    this.last = null;
  }

  /** Forget the pending diagnosis (player died / respawned / match ended); counters kept. */
  clearPending(): void {
    this.pending = null;
  }

  /** Is a diagnosis waiting for a CORRECTED? (debug / tests) */
  hasPending(): boolean {
    return this.pending !== null;
  }

  onShot(s: ShotSnapshot): EchoFeedback | null {
    if (!this.cfg.enabled) return null;
    const a = analyzeShot(s, this.cfg);
    const corrected = a.kind === "headshot" && this.consumeCorrection(s, a);
    this.count(a, corrected);
    if (a.target && a.aimOffset && a.kind !== "headshot" && a.kind !== "none" && a.kind !== "generic" && a.kind !== "cover") {
      this.pending = {
        targetId: a.target.id, lifeId: a.target.lifeId, timeMs: s.timeMs, kind: a.kind,
        aimOffset: a.aimOffset, correction: a.correction ? { h: a.correction.h, v: a.correction.v } : null,
      };
    }
    const fb = present(a, corrected, s.ads);
    this.last = { snapshot: s, feedback: fb };
    return fb;
  }

  /** Did this headshot apply the previous diagnosis? Consumes it either way (same target). */
  private consumeCorrection(s: ShotSnapshot, a: ShotAnalysis): boolean {
    const p = this.pending;
    if (!p || !a.target) return false;
    if (s.timeMs - p.timeMs > this.cfg.correctionRecognitionWindowMs) {
      this.pending = null;
      return false;
    }
    if (a.target.id !== p.targetId) return false; // other target: keep waiting for the right one
    this.pending = null;
    if (a.target.lifeId !== p.lifeId) return false;
    if (p.kind === "ads" || p.kind === "spread") {
      // lesson was timing/precision: corrected only if this shot was precise
      return s.spreadDeg <= s.preciseSpreadDeg + 1e-9;
    }
    if (!p.correction || !a.aimOffset) return false;
    // moved the crosshair the advised way AND closer to the head centre
    const dh = a.aimOffset.h - p.aimOffset.h;
    const dv = a.aimOffset.v - p.aimOffset.v;
    const along = dh * p.correction.h + dv * p.correction.v;
    return along > 0 && Math.hypot(a.aimOffset.h, a.aimOffset.v) < Math.hypot(p.aimOffset.h, p.aimOffset.v);
  }

  private count(a: ShotAnalysis, corrected: boolean): void {
    const st = this.stats;
    st.analyzed++;
    if (a.hit === "head") st.headshots++;
    if (a.hit === "body") st.bodyShots++;
    if (a.hit === "miss" && a.kind !== "none") st.nearMisses++;
    if (a.kind === "none") st.noTarget++;
    if (a.kind === "spread" || a.kind === "ads" || a.kind === "mixed") st.spreadLimited++;
    if (a.kind === "ads") st.adsEarly++;
    if (a.correction) {
      if (Math.abs(a.correction.h) >= 0.1) st.horizontalErrors++;
      if (Math.abs(a.correction.v) >= 0.1) st.verticalErrors++;
    }
    if (corrected) st.corrected++;
  }
}

function present(a: ShotAnalysis, corrected: boolean, ads: boolean): EchoFeedback {
  const base = { analysis: a, corrected, visible: true, showGhost: a.ghost !== null, sound: "tick" as const };
  const where = a.hit === "body" ? "BODY SHOT" : "NEAR MISS";
  switch (a.kind) {
    case "headshot":
      return corrected
        ? { ...base, tone: "corrected", glyph: "✓", title: "CORRECTED", detail: "HEADSHOT", showGhost: false, sound: "corrected" }
        : { ...base, visible: false, tone: "corrected", glyph: "", title: "", detail: "", showGhost: false, sound: null };
    case "aim":
    case "mixed": {
      const f = formatCorrection(a.correction!);
      return { ...base, tone: "aim", glyph: f.arrow, title: f.text, detail: a.kind === "mixed" ? `${where} · AIM + SPREAD` : where };
    }
    case "ads":
      return { ...base, tone: "precision", glyph: "◔", title: `ADS +${a.adsWaitMs}ms`, detail: `${where} · AIM WAS ON` };
    case "spread":
      return { ...base, tone: "precision", glyph: "◌", title: "SPREAD", detail: ads ? `${where} · AIM WAS ON` : `${where} · AIM WAS ON · SCOPE IN` };
    case "cover":
      return { ...base, tone: "info", glyph: "▣", title: "COVER", detail: "LINE WAS ON · BLOCKED", sound: null };
    case "generic":
      return { ...base, tone: "info", glyph: "", title: "BODY SHOT", detail: "", showGhost: false, sound: null };
    case "none":
      return { ...base, visible: false, tone: "info", glyph: "", title: "", detail: "", showGhost: false, sound: null };
  }
}
