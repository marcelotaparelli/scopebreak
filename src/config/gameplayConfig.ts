export interface GameplayConfig {
  precisionWindowMs: number;
  hipfireSpreadDeg: number;
  adsSpreadDeg: number;
  longShotDistance: number;
  targetRespawnMs: number;
}

export const gameplayConfig: GameplayConfig = {
  precisionWindowMs: 100,
  hipfireSpreadDeg: 5.5,
  adsSpreadDeg: 0.0,
  longShotDistance: 40,
  targetRespawnMs: 2000,
};
