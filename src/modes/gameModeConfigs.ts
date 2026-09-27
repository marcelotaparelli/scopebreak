import type { GameModeId } from "./GameMode.js";

export const gameModeConfigs: Record<GameModeId, { label: string; playable: boolean; description: string }> = {
  training: { label: "TRAINING", playable: true, description: "Movement + aim range" },
  ffa: { label: "FREE FOR ALL — COMING SOON", playable: false, description: "6 players, kill limit" },
  tdm: { label: "TEAM DEATHMATCH — COMING SOON", playable: false, description: "4v4, score limit" },
  hardpoint: { label: "HARDPOINT — COMING SOON", playable: false, description: "4v4 rotating zone" },
  "kill-confirmed": { label: "KILL CONFIRMED — COMING SOON", playable: false, description: "Collect tags" },
  ctf: { label: "CAPTURE THE FLAG — COMING SOON", playable: false, description: "4v4 flags" },
};
