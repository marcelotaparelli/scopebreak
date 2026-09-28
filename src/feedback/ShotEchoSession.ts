import type { ShotEchoConfig } from "../config/shotEchoConfig.js";
import type { ShotSnapshot } from "../combat/ShotSnapshot.js";
import { ShotEcho, type EchoFeedback } from "./ShotEcho.js";

/** Where SHOT ECHO may run. Online play is listed so it is explicitly OFF. */
export type EchoMode = "menu" | "training" | "ffa-offline" | "online";

/**
 * SHOT ECHO across game modes: one ShotEcho, gated per mode, fed ONLY by the
 * local player's shots, and reset on every lifecycle edge so no stale
 * diagnosis survives a match start, rematch, player death/respawn or mode
 * switch. Pure (no DOM): the renderer is driven by what this returns.
 */
export class ShotEchoSession {
  readonly echo: ShotEcho;
  mode: EchoMode = "menu";

  constructor(private cfg: ShotEchoConfig) {
    this.echo = new ShotEcho(cfg);
  }

  isActive(): boolean {
    if (!this.cfg.enabled) return false;
    if (this.mode === "training") return this.cfg.trainingEnabled;
    if (this.mode === "ffa-offline") return this.cfg.ffaEnabled;
    return false;
  }

  /** Mode entered / match (re)started: fresh diagnosis and counters. */
  start(mode: EchoMode): void {
    this.mode = mode;
    this.echo.reset();
  }

  /** Player died or respawned, or the match ended: nothing carries over. */
  interrupt(): void {
    this.echo.clearPending();
  }

  /** Only the local player's shots are analysed; any other shooter is ignored. */
  onShot(shooterId: number, localPlayerId: number, s: ShotSnapshot): EchoFeedback | null {
    if (shooterId !== localPlayerId || !this.isActive()) return null;
    return this.echo.onShot(s);
  }
}
