import type { ShotEchoConfig } from "../config/shotEchoConfig.js";
import { applyEchoSlot, echoTextTimeline, type EchoSlot } from "./EchoDisplayPolicy.js";
import type { EchoCopy } from "./EchoCopy.js";
import { sketchSizeFor, X_HALF, type ImpactSketch, type SketchPoint } from "./ImpactSketch.js";
import type { EchoFeedback } from "./ShotEcho.js";

const SVG = "http://www.w3.org/2000/svg";

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, cls: string): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  el.setAttribute("class", cls);
  return el;
}

/**
 * SHOT ECHO presentation. A fixed set of DOM/SVG nodes is built once and
 * reused for every shot (no per-shot node creation, one timer per layer).
 * The ghost reticle is drawn in screen space from the camera AT THE SHOT and
 * never follows targets afterwards: it is an echo of that instant.
 * The Impact Sketch lives INSIDE the feedback plate (sketch | text), so it
 * shows, fades and is replaced together with the text by construction.
 */
export class ShotEchoRenderer {
  private root: HTMLElement;
  private svg: SVGSVGElement;
  private ring: SVGCircleElement;
  private mark: SVGPathElement;
  private fix: SVGLineElement;
  private text: HTMLElement;
  private head: HTMLElement;
  private glyph: HTMLElement;
  private value: HTMLElement;
  private dir: HTMLElement;
  private right: HTMLElement;
  private desc: HTMLElement[];
  // Impact Sketch nodes (head-radius units, y up → drawn with y flipped)
  private sketch: SVGSVGElement;
  private skValid: SVGCircleElement;
  private skHead: SVGCircleElement;
  private skCenter: SVGCircleElement;
  private skArrow: SVGLineElement;
  private skAim: SVGPathElement;
  private skBullet: SVGPathElement;
  private skMarker: SVGMarkerElement;
  private ghostTimer: ReturnType<typeof setTimeout> | null = null;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;
  private textTimer: ReturnType<typeof setTimeout> | null = null;
  /** The one plate currently on screen (single slot, never stacked). */
  private slot: EchoSlot | null = null;

  constructor(parent: HTMLElement, private cfg: ShotEchoConfig) {
    this.root = document.createElement("div");
    this.root.id = "shot-echo";
    this.svg = svgEl("svg", "echo-ghost");
    this.svg.innerHTML =
      `<defs><marker id="echo-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">` +
      `<path d="M0,0 L8,4 L0,8 Z" class="echo-arrowhead"/></marker></defs>`;
    this.ring = svgEl("circle", "echo-ring");
    this.mark = svgEl("path", "echo-mark");
    this.fix = svgEl("line", "echo-fix");
    this.fix.setAttribute("marker-end", "url(#echo-arrow)");
    this.svg.append(this.ring, this.fix, this.mark);

    this.sketch = svgEl("svg", "echo-sketch");
    this.sketch.innerHTML =
      `<defs><marker id="echo-sk-arrow" viewBox="0 0 8 8" refX="6.5" refY="4" markerUnits="userSpaceOnUse" markerWidth="0.55" markerHeight="0.55" orient="auto">` +
      `<path d="M0,0 L8,4 L0,8 Z" class="sk-arrowhead"/></marker></defs>`;
    this.skMarker = this.sketch.querySelector("marker") as SVGMarkerElement;
    this.skValid = svgEl("circle", "sk-valid");
    this.skHead = svgEl("circle", "sk-head");
    this.skHead.setAttribute("r", "1");
    this.skCenter = svgEl("circle", "sk-center");
    this.skArrow = svgEl("line", "sk-arrow");
    this.skArrow.setAttribute("marker-end", "url(#echo-sk-arrow)");
    this.skAim = svgEl("path", "sk-aim");
    this.skBullet = svgEl("path", "sk-bullet");
    for (const el of [this.skValid, this.skHead, this.skCenter, this.skArrow, this.skAim, this.skBullet]) {
      el.setAttribute("vector-effect", "non-scaling-stroke");
      this.sketch.appendChild(el);
    }

    // plate: discreet header, then [ Impact Sketch | value / direction / description ]
    const div = (cls: string, tag = "div"): HTMLElement => {
      const el = document.createElement(tag);
      el.className = cls;
      return el;
    };
    this.text = div("echo-text");
    this.head = div("echo-head");
    this.glyph = div("echo-glyph", "span");
    this.value = div("echo-value", "span");
    this.dir = div("echo-dir");
    this.desc = [div("echo-desc"), div("echo-desc")];
    const main = div("echo-main");
    main.append(this.glyph, this.value);
    // header lives in the text column so the sketch spans ALL the text
    const right = div("echo-right");
    right.append(this.head, main, this.dir, ...this.desc);
    this.right = right;
    const body = div("echo-body");
    body.append(this.sketch, right);
    this.text.append(body);
    this.root.append(this.svg, this.text);
    parent.appendChild(this.root);
  }

  show(fb: EchoFeedback, fovDeg: number, nowMs: number, sketch: ImpactSketch | null, copy: EchoCopy | null): void {
    const next = applyEchoSlot(this.slot, fb, sketch !== null, nowMs, this.cfg);
    if (next.action === "replace") this.showText(fb, sketch, copy);
    else if (next.action === "clear") this.hideText();
    this.slot = next.slot;
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
    this.slot = null;
    this.svg.classList.remove("on");
  }

  /** Full opacity for holdMs, then a smooth fade that ends at feedbackDurationMs (sketch included). */
  private showText(fb: EchoFeedback, sketch: ImpactSketch | null, copy: EchoCopy | null): void {
    const tl = echoTextTimeline(this.cfg);
    this.clearTextTimers();
    this.text.style.setProperty("--echo-fade", `${tl.fadeMs}ms`);
    this.text.className = `echo-text tone-${fb.tone} on${sketch ? " has-sketch" : ""}`;
    const c: EchoCopy = copy ?? { header: "SHOT ECHO", glyph: fb.glyph, value: fb.title, direction: "", description: fb.detail ? [fb.detail] : [] };
    this.head.textContent = c.header;
    this.glyph.textContent = c.glyph;
    this.glyph.style.display = c.glyph ? "" : "none";
    this.value.textContent = c.value;
    this.dir.textContent = c.direction;
    this.dir.style.display = c.direction ? "" : "none";
    this.desc.forEach((el, i) => {
      el.textContent = c.description[i] ?? "";
      el.style.display = c.description[i] ? "" : "none";
    });
    this.drawSketch(sketch);
    this.restart(this.text);
    this.fadeTimer = setTimeout(() => this.text.classList.add("fading"), tl.holdMs);
    this.textTimer = setTimeout(() => {
      this.hideText();
      this.slot = null;
    }, tl.totalMs);
  }

  /** Redraw the reused sketch nodes; hidden entirely when there is nothing honest to draw. */
  private drawSketch(sk: ImpactSketch | null): void {
    if (!sk) {
      this.sketch.style.display = "none";
      return;
    }
    // text is already filled: match its real rendered height (any font / line count)
    const size = sketchSizeFor(this.right.offsetHeight, this.cfg);
    const e = sk.extent;
    this.sketch.style.display = "";
    this.sketch.setAttribute("width", String(size));
    this.sketch.setAttribute("height", String(size));
    this.sketch.setAttribute("viewBox", `${-e} ${-e} ${2 * e} ${2 * e}`);
    this.skValid.setAttribute("r", sk.inset.toFixed(3));
    // glyphs scale with the frame, so X / + / dot / arrowhead read the same at any zoom
    this.skCenter.setAttribute("r", (e * 0.045).toFixed(3));
    this.skMarker.setAttribute("markerWidth", (e * 0.2).toFixed(3));
    this.skMarker.setAttribute("markerHeight", (e * 0.2).toFixed(3));
    this.skCenter.style.display = this.cfg.impactSketchShowCenter ? "" : "none";

    const P = (p: SketchPoint): [number, number] => [p.x, -p.y]; // y up → SVG y down
    const [bx, by] = P(sk.bullet);
    const k = e * X_HALF;
    this.skBullet.setAttribute("d", `M${bx - k},${by - k}L${bx + k},${by + k}M${bx - k},${by + k}L${bx + k},${by - k}`);
    this.skBullet.setAttribute("class", `sk-bullet${sk.bulletClamped ? " sk-clamped" : ""}`);

    if (sk.aim) {
      const [ax, ay] = P(sk.aim);
      const a = e * 0.13;
      this.skAim.setAttribute("d", `M${ax - a},${ay}L${ax + a},${ay}M${ax},${ay - a}L${ax},${ay + a}`);
      this.skAim.style.display = "";
    } else {
      this.skAim.style.display = "none";
    }

    if (this.cfg.impactSketchShowArrow && sk.arrowFrom && sk.arrowTo) {
      const [x1, y1] = P(sk.arrowFrom);
      const [x2, y2] = P(sk.arrowTo);
      this.skArrow.setAttribute("x1", x1.toFixed(3));
      this.skArrow.setAttribute("y1", y1.toFixed(3));
      this.skArrow.setAttribute("x2", x2.toFixed(3));
      this.skArrow.setAttribute("y2", y2.toFixed(3));
      this.skArrow.style.display = "";
    } else {
      this.skArrow.style.display = "none";
    }
  }

  private hideText(): void {
    this.clearTextTimers();
    this.text.classList.remove("on", "fading", "pop");
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
