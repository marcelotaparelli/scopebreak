import type { SkillKind } from "../player/movementRules.js";

const LABELS: Record<SkillKind, string> = {
  headshot: "HEADSHOT +100",
  slideShot: "SLIDE SHOT +25",
  airShot: "AIR SHOT +25",
  wallKickShot: "WALL KICK SHOT +50",
  longShot: "LONG SHOT +25",
};

/** Floating skill-event popups (DOM, pooled by removal after animation). */
export class SkillFeedback {
  constructor(private feedEl: HTMLElement) {}

  show(skills: SkillKind[], headshot: boolean): void {
    for (const s of skills) {
      const div = document.createElement("div");
      div.className = "skill-pop" + (s === "headshot" ? " headshot" : " sub");
      div.textContent = LABELS[s];
      this.feedEl.appendChild(div);
      window.setTimeout(() => div.remove(), 1450);
    }
    if (skills.length === 0 && headshot) {
      const div = document.createElement("div");
      div.className = "skill-pop headshot";
      div.textContent = LABELS["headshot"];
      this.feedEl.appendChild(div);
      window.setTimeout(() => div.remove(), 1450);
    }
    while (this.feedEl.children.length > 6) this.feedEl.firstChild?.remove();
  }
}
