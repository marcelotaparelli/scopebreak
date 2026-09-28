// SHOT ECHO v1 — instant precision feedback (Training only). Live-tunable (F1).

export interface ShotEchoConfig {
  enabled: boolean;
  feedbackDurationMs: number; // correction text, total time on screen (fade included)
  feedbackFadeMs: number; // smooth exit at the END of feedbackDurationMs
  /** A visible CORRECTED is not replaced by a lower-priority message for this long. */
  correctedPriorityMs: number;
  ghostReticleDurationMs: number; // ghost reticle (echo of the analysed instant) — short, never blocks aim
  maximumAnalysisAngleDeg: number; // a miss further than this from any head gets no directional feedback
  correctionRecognitionWindowMs: number; // CORRECTED only if the fixing headshot lands within this window
  /**
   * Corrections aim for the head's inner cone (this fraction of its angular
   * radius), so following the advice lands a clean hit, not a mesh graze.
   */
  validRegionInset: number;
  impactSketchEnabled: boolean; // mini diagram: where the bullet passed vs the head
  impactSketchSize: number; // px
  impactSketchShowArrow: boolean;
  impactSketchShowCenter: boolean;
}

export const shotEchoConfig: ShotEchoConfig = {
  enabled: true,
  feedbackDurationMs: 1500,
  feedbackFadeMs: 250,
  correctedPriorityMs: 700,
  ghostReticleDurationMs: 250,
  maximumAnalysisAngleDeg: 4,
  correctionRecognitionWindowMs: 3000,
  validRegionInset: 0.75,
  impactSketchEnabled: true,
  impactSketchSize: 104,
  impactSketchShowArrow: true,
  impactSketchShowCenter: true,
};
