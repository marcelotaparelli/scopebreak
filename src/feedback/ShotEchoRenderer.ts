import type { ShotEchoConfig } from "../config/shotEchoConfig.js";
import { decideEchoText, echoTextTimeline, type ShownEcho } from "./EchoDisplayPolicy.js";
import type { EchoFeedback } from "./ShotEcho.js";

const SVG = "http://www.w3.org/2000/svg";

/**
 * SHOT ECHO presentation. A fixed set of DOM/SVG nodes is built once and
 * reused for every shot (no per-shot node creation, one timer per layer).
 * The ghost reticle is drawn in screen space from the camera AT THE SHOT and
 * never follows targets afterwards: it is an echo of that instant.
 */
export class ShotEchoRenderer {
  private root: HTMLElement;
  private svg: SVGSVGElement;
  private ring: SVGCircleElement;
  private mark: SVGPathElement;
  private fix: SVGLineElement;
  private text: HTMLElement;
  private glyph: HTMLElement;
  private title: HTMLElement;
  private detail: HTMLElement;
  private ghostTimer: ReturnType<typeof setTimeout> | null = null;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;
  private textTimer: ReturnType<typeof setTimeout> | null = null;
  /** The one message currently on screen (single slot, never stacked). */
  private shown: ShownEcho | null = null;

  constructor(parent: HTMLElement, private cfg: ShotEchoConfig) {
    this.root = document.createElement("div");
    this.root.id = "shot-echo";
    this.svg = document.createElementNS(SVG, "svg");
    this.svg.setAttribute("class", "echo-ghost");
    this.svg.innerHTML =
      `<defs><marker id="echo-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">` +
      `<path d="M0,0 L8,4 L0,8 Z" class="echo-arrowhead"/></marker></defs>`;
    this.ring = document.createElementNS(SVG, "circle");
    this.ring.setAttribute("class", "echo-ring");
    this.mark = document.createElementNS(SVG, "path");
    this.mark.setAttribute("class", "echo-mark");
    this.fix = document.createElementNS(SVG, "line");
    this.fix.setAttribute("class", "echo-fix");
    this.fix.setAttribute("marker-end", "url(#echo-arrow)");
    this.svg.append(this.ring, this.fix, this.mark);

    this.text = document.createElement("div");
    this.text.className = "echo-text";
    this.glyph = document.createElement("span");
    this.glyph.className = "echo-glyph";
    this.title = document.createElement("span");
    this.title.className = "echo-title";
    this.detail = document.createElement("div");
    this.detail.className = "echo-detail";
    const line = document.createElement("div");
    line.append(this.glyph, this.title);
    this.text.append(line, this.detail);
    this.root.append(this.svg, this.text);
    parent.appendChild(this.root);
  }

  show(fb: EchoFeedback, fovDeg: number, nowMs: number): void {
    const action = decideEchoText(this.shown, fb, nowMs, this.cfg);
    if (action === "replace") this.showText(fb, nowMs);
    else if (action === "clear") this.hideText();
    if (!fb.visible) return;

    const g = fb.analysis.ghost;
    if (!fb.showGhost || !g) {
      this.svg.classList.remove("on");
      return;
    }
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    const f = h / 2 / Math.tan((fovDeg * Math.PI) / 360); // px per tangent unit (vertical fov)
    const px = (t: { x: number; y: number }): [number, number] => [w / 2 + t.x * f, h / 2 - t.y * f];
    const [hx, hy] = px(g.head);
    this.ring.setAttribute("cx", hx.toFixed(1));
    this.ring.setAttribute("cy", hy.toFixed(1));
    this.ring.setAttribute("r", Math.max(3, g.headRadius * f).toFixed(1));
    const [sx, sy] = px(g.shot);
    const k = 5;
    this.mark.setAttribute("d", `M${sx - k},${sy - k}L${sx + k},${sy + k}M${sx - k},${sy + k}L${sx + k},${sy - k}`);
    if (g.fix) {
      const [fx, fy] = px(g.fix);
      this.fix.setAttribute("x1", sx.toFixed(1));
      this.fix.setAttribute("y1", sy.toFixed(1));
      this.fix.setAttribute("x2", fx.toFixed(1));
      this.fix.setAttribute("y2", fy.toFixed(1));
      this.fix.style.display = "";
    } else {
      this.fix.style.display = "none";
    }
    this.svg.setAttribute("class", `echo-ghost tone-${fb.tone} on`);
    this.restart(this.svg);
    if (this.ghostTimer) clearTimeout(this.ghostTimer);
    this.ghostTimer = setTimeout(() => this.svg.classList.remove("on"), this.cfg.ghostReticleDurationMs);
  }

  hide(): void {
    this.hideText();
    this.svg.classList.remove("on");
  }

  /** Full opacity for holdMs, then a smooth fade that ends at feedbackDurationMs. */
  private showText(fb: EchoFeedback, nowMs: number): void {
    const tl = echoTextTimeline(this.cfg);
    this.clearTextTimers();
    this.text.style.setProperty("--echo-fade", `${tl.fadeMs}ms`);
    this.text.className = `echo-text tone-${fb.tone} on`;
    this.glyph.textContent = fb.glyph;
    this.title.textContent = fb.title;
    this.detail.textContent = fb.detail;
    this.restart(this.text);
    this.shown = { corrected: fb.corrected, shownAtMs: nowMs };
    this.fadeTimer = setTimeout(() => this.text.classList.add("fading"), tl.holdMs);
    this.textTimer = setTimeout(() => this.hideText(), tl.totalMs);
  }

  private hideText(): void {
    this.clearTextTimers();
    this.text.classList.remove("on", "fading", "pop");
    this.shown = null;
  }

  private clearTextTimers(): void {
    if (this.fadeTimer) clearTimeout(this.fadeTimer);
    if (this.textTimer) clearTimeout(this.textTimer);
    this.fadeTimer = null;
    this.textTimer = null;
  }

  /** Re-trigger the pop-in transition on an already-visible node. */
  private restart(el: Element): void {
    el.classList.remove("pop");
    void (el as HTMLElement).getBoundingClientRect();
    el.classList.add("pop");
  }
}
