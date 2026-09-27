export interface FFAMatchConfig {
  killLimit: number;
  timeLimitSec: number;
  respawnMs: number;
  maxPlayers: number; // human + bots, architected for 6
  botCount: number;
}

export const ffaMatchConfig: FFAMatchConfig = {
  killLimit: 15,
  timeLimitSec: 300, // 5 min fallback
  respawnMs: 1500, // fast respawn: death → feedback → move again
  maxPlayers: 6,
  botCount: 5,
};

export const BOT_NAMES = ["Bot 1", "Bot 2", "Bot 3", "Bot 4", "Bot 5"];

/** Spread-out spawn points to reduce obvious spawn kills. */
export const FFA_SPAWNS: Array<{ x: number; y: number; z: number }> = [
  { x: 0, y: 0.1, z: 42 },
  { x: -28, y: 0.1, z: 30 },
  { x: 28, y: 0.1, z: 30 },
  { x: -24, y: 0.1, z: -40 },
  { x: 24, y: 0.1, z: -40 },
  { x: 0, y: 3.1, z: -8 },
];
