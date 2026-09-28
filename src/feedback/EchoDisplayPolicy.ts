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

/** The feedback plate (text + Impact Sketch live in ONE box: shown, faded, replaced together). */
export interface EchoSlot extends ShownEcho {
  sketch: boolean;
}

export function applyEchoSlot(
  slot: EchoSlot | null, incoming: EchoFeedback, hasSketch: boolean, nowMs: number, cfg: ShotEchoConfig,
): { action: EchoTextAction; slot: EchoSlot | null } {
  const action = decideEchoText(slot, incoming, nowMs, cfg);
  if (action === "replace") return { action, slot: { corrected: incoming.corrected, shownAtMs: nowMs, sketch: hasSketch } };
  if (action === "clear") return { action, slot: null };
  return { action, slot };
}

/** Slot content still on screen at `nowMs` (null once its timeline ended). */
export function echoSlotAt(slot: EchoSlot | null, nowMs: number, cfg: ShotEchoConfig): EchoSlot | null {
  return slot && nowMs - slot.shownAtMs < echoTextTimeline(cfg).totalMs ? slot : null;
}

/** Text timeline: full opacity, then a smooth fade that ENDS at feedbackDurationMs. */
export function echoTextTimeline(cfg: ShotEchoConfig): { holdMs: number; fadeMs: number; totalMs: number } {
  const totalMs = Math.max(0, cfg.feedbackDurationMs);
  const fadeMs = Math.min(Math.max(0, cfg.feedbackFadeMs), totalMs);
  return { holdMs: totalMs - fadeMs, fadeMs, totalMs };
}
