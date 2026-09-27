import type { SkillKind } from "../player/movementRules.js";
import { skillScores } from "../player/movementRules.js";
import type { GameMode } from "./GameMode.js";

export interface TrainingStats {
  shots: number;
  hits: number;
  headshots: number;
  skillScore: number;
  bestCombo: number;
}

/** Training owns scoring. Combat only reports hit facts. */
export class TrainingMode implements GameMode {
  readonly id = "training" as const;
  stats: TrainingStats = { shots: 0, hits: 0, headshots: 0, skillScore: 0, bestCombo: 0 };
  private combo = 0;

  registerShot(): void {
    this.stats.shots++;
    this.combo = 0;
  }

  registerHit(args: { headshot: boolean; skills: SkillKind[]; distance: number }): void {
    this.stats.hits++;
    if (args.headshot) this.stats.headshots++;
    let gained = 0;
    for (const s of args.skills) gained += skillScores[s];
    this.stats.skillScore += gained;
    if (gained > 0) {
      this.combo += gained;
      this.stats.bestCombo = Math.max(this.stats.bestCombo, this.combo);
    }
  }

  registerMiss(): void {
    this.combo = 0;
  }

  accuracy(): number {
    if (this.stats.shots === 0) return 0;
    return this.stats.hits / this.stats.shots;
  }

  update(_dt: number): void {
    // training has no timers yet
  }
}
