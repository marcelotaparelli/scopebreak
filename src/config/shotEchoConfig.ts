// SHOT ECHO v1 — instant precision feedback (Training only). Live-tunable (F1).

export interface ShotEchoConfig {
  enabled: boolean;
  feedbackDurationMs: number; // correction text on screen
  ghostReticleDurationMs: number; // ghost reticle (echo of the analysed instant)
  maximumAnalysisAngleDeg: number; // a miss further than this from any head gets no directional feedback
  correctionRecognitionWindowMs: number; // CORRECTED only if the fixing headshot lands within this window
  /**
   * Corrections aim for the head's inner cone (this fraction of its angular
   * radius), so following the advice lands a clean hit, not a mesh graze.
   */
  validRegionInset: number;
}

export const shotEchoConfig: ShotEchoConfig = {
  enabled: true,
  feedbackDurationMs: 750,
  ghostReticleDurationMs: 250,
  maximumAnalysisAngleDeg: 4,
  correctionRecognitionWindowMs: 3000,
  validRegionInset: 0.75,
};
