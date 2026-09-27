export type GameModeId = "training" | "ffa" | "tdm" | "hardpoint" | "kill-confirmed" | "ctf";

export interface GameMode {
  readonly id: GameModeId;
  update(_dt: number): void;
}
