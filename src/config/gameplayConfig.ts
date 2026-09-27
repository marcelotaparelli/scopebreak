export interface GameplayConfig {
  precisionWindowMs: number; // full-ADS "max stabilized" feedback (yellow ring), NOT a fire gate
  snapPrecisionDelayMs: number; // legacy alias target — per-weapon snapPrecisionMs is authoritative
  quickShotBufferMs: number; // LMB window after ADS start that buffers into a snap shot
  hipfireSpreadDeg: number;
  adsSpreadDeg: number;
  longShotDistance: number;
  targetRespawnMs: number;
}

export const gameplayConfig: GameplayConfig = {
  precisionWindowMs: 100,
  snapPrecisionDelayMs: 45,
  quickShotBufferMs: 90,
  hipfireSpreadDeg: 5.5,
  adsSpreadDeg: 0.0,
  longShotDistance: 40,
  targetRespawnMs: 2000,
};
