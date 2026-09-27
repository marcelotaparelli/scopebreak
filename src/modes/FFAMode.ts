import { ffaMatchConfig } from "../config/ffaConfig.js";
import { skillScores, type SkillKind } from "../player/movementRules.js";
import type { GameMode } from "./GameMode.js";

export interface FFAPlayerScore {
  name: string;
  isBot: boolean;
  kills: number;
  deaths: number;
  headshots: number;
  skillScore: number;
  bestSkill: string | null;
  shots: number;
  hits: number;
}

export interface FFAKillEvent {
  killer: string;
  victim: string;
  weapon: string;
  headshot: boolean;
  skills: SkillKind[];
}

export type FFAMatchState = "playing" | "ended";

/**
 * FFA match logic. DOM-free and render-free: owns score, kill limit,
 * time limit, respawn timers and placement. Combat only reports facts.
 */
export class FFAMode implements GameMode {
  readonly id = "ffa" as const;
  scores: FFAPlayerScore[] = [];
  state: FFAMatchState = "playing";
  winnerIndex = -1;
  endReason: string = "";
  startedAtMs = 0;
  endsAtMs = 0;
  killLimit = ffaMatchConfig.killLimit;
  timeLimitSec = ffaMatchConfig.timeLimitSec;
  respawnMs = ffaMatchConfig.respawnMs;
  private respawnAt = new Map<number, number>();
  private firstDamageAt = new Map<number, number>();
  engagementDurationsMs: number[] = [];
  lastKill: FFAKillEvent | null = null;

  constructor(playerName = "YOU", botNames: string[] = []) {
    this.scores = [
      { name: playerName, isBot: false, kills: 0, deaths: 0, headshots: 0, skillScore: 0, bestSkill: null, shots: 0, hits: 0 },
      ...botNames.map((n) => ({
        name: n, isBot: true, kills: 0, deaths: 0, headshots: 0, skillScore: 0, bestSkill: null, shots: 0, hits: 0,
      })),
    ];
  }

  start(nowMs: number): void {
    this.startedAtMs = nowMs;
    this.endsAtMs = nowMs + this.timeLimitSec * 1000;
    this.state = "playing";
  }

  timeLeftSec(nowMs: number): number {
    return Math.max(0, (this.endsAtMs - nowMs) / 1000);
  }

  registerShot(idx: number): void {
    this.scores[idx]!.shots++;
  }

  registerHit(idx: number, nowMs: number, victimIdx: number): void {
    this.scores[idx]!.hits++;
    if (!this.firstDamageAt.has(victimIdx)) this.firstDamageAt.set(victimIdx, nowMs);
  }

  registerMiss(idx: number): void {
    void idx;
  }

  isAlive(idx: number, nowMs: number): boolean {
    const at = this.respawnAt.get(idx);
    if (at === undefined) return true;
    return nowMs >= at;
  }

  respawnDue(idx: number, nowMs: number): boolean {
    const at = this.respawnAt.get(idx);
    return at !== undefined && nowMs >= at;
  }

  consumeRespawn(idx: number): void {
    this.respawnAt.delete(idx);
    this.firstDamageAt.delete(idx);
  }

  registerKill(args: {
    killerIdx: number;
    victimIdx: number;
    headshot: boolean;
    skills: SkillKind[];
    weapon: string;
    nowMs: number;
  }): FFAKillEvent {
    const { killerIdx, victimIdx, headshot, skills, weapon, nowMs } = args;
    const killer = this.scores[killerIdx]!;
    const victim = this.scores[victimIdx]!;
    killer.kills++;
    victim.deaths++;
    if (headshot) killer.headshots++;
    let gained = 0;
    for (const s of skills) gained += skillScores[s];
    // kill itself is the score in FFA; skill events are flavor + tiebreak
    killer.skillScore += gained + 1;
    const label = skills.find((s) => s !== "headshot") ?? (headshot ? "headshot" : null);
    if (label && !killer.bestSkill) killer.bestSkill = label;

    const started = this.firstDamageAt.get(victimIdx);
    if (started !== undefined) {
      this.engagementDurationsMs.push(Math.max(0, nowMs - started));
      this.firstDamageAt.delete(victimIdx);
    }

    this.respawnAt.set(victimIdx, nowMs + this.respawnMs);

    const ev: FFAKillEvent = { killer: killer.name, victim: victim.name, weapon, headshot, skills };
    this.lastKill = ev;

    if (killer.kills >= this.killLimit && this.state === "playing") {
      this.state = "ended";
      this.winnerIndex = killerIdx;
      this.endReason = `Kill limit ${this.killLimit} — ${killer.name} wins`;
    }
    return ev;
  }

  /** Suicide / arena death without a killer (rare fallback). */
  registerDeath(victimIdx: number, nowMs: number): void {
    this.scores[victimIdx]!.deaths++;
    this.respawnAt.set(victimIdx, nowMs + this.respawnMs);
    this.firstDamageAt.delete(victimIdx);
  }

  placement(): number[] {
    return this.scores
      .map((_, i) => i)
      .sort((a, b) => {
        const A = this.scores[a]!;
        const B = this.scores[b]!;
        if (B.kills !== A.kills) return B.kills - A.kills;
        if (B.headshots !== A.headshots) return B.headshots - A.headshots;
        return B.skillScore - A.skillScore;
      });
  }

  accuracy(idx: number): number {
    const s = this.scores[idx]!;
    return s.shots > 0 ? s.hits / s.shots : 0;
  }

  kd(idx: number): number {
    const s = this.scores[idx]!;
    return s.deaths > 0 ? s.kills / s.deaths : s.kills;
  }

  avgEngagementSec(): number {
    if (this.engagementDurationsMs.length === 0) return 0;
    const sum = this.engagementDurationsMs.reduce((a, b) => a + b, 0);
    return sum / this.engagementDurationsMs.length / 1000;
  }

  update(_dt: number, nowMs = 0): void {
    if (this.state === "playing" && nowMs >= this.endsAtMs && this.endsAtMs > 0) {
      this.state = "ended";
      this.winnerIndex = this.placement()[0] ?? 0;
      this.endReason = `Time limit — ${this.scores[this.winnerIndex]?.name ?? ""} wins`;
    }
  }
}
