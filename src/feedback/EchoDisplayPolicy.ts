import type { ShotEchoConfig } from "../config/shotEchoConfig.js";
import type { EchoFeedback } from "./ShotEcho.js";

/** What the ONE text slot does when a new shot is analysed. */
export type EchoTextAction = "replace" | "keep" | "clear";

export interface ShownEcho {
  corrected: boolean;
  shownAtMs: number;
}

/**
 * Single-slot policy (never stacks messages):
 * - a visible CORRECTED keeps priority for `correctedPriorityMs` over any
 *   other message (and is never wiped by a plain headshot);
 * - a plain headshot clears stale error advice ("0.4° RIGHT" must not linger
 *   after the player already fixed it) — the existing HEADSHOT popup speaks;
 * - a shot with nothing to analyse keeps the last real advice on screen;
 * - anything else replaces the current message.
 */
export function decideEchoText(current: ShownEcho | null, incoming: EchoFeedback, nowMs: number, cfg: ShotEchoConfig): EchoTextAction {
  const protectedCorrected = current !== null && current.corrected && nowMs - current.shownAtMs < cfg.correctedPriorityMs;
  if (incoming.visible) {
    if (protectedCorrected && !incoming.corrected) return "keep";
    return "replace";
  }
  if (incoming.analysis.kind === "headshot") return current && !current.corrected ? "clear" : "keep";
  return "keep";
}

/** Text timeline: full opacity, then a smooth fade that ENDS at feedbackDurationMs. */
export function echoTextTimeline(cfg: ShotEchoConfig): { holdMs: number; fadeMs: number; totalMs: number } {
  const totalMs = Math.max(0, cfg.feedbackDurationMs);
  const fadeMs = Math.min(Math.max(0, cfg.feedbackFadeMs), totalMs);
  return { holdMs: totalMs - fadeMs, fadeMs, totalMs };
}
