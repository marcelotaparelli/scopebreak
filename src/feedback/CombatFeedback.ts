import * as THREE from "three";

/** Minimal hit feedback: marker, sounds (WebAudio synth), tracer, muzzle flash. */
export class CombatFeedback {
  private markerEl: HTMLElement;
  private audio: AudioContext | null = null;
  private scene: THREE.Scene | null = null;
  private flash: THREE.PointLight | null = null;
  private tracers: Array<{ line: THREE.Line; bornMs: number }> = [];

  constructor(markerEl: HTMLElement) {
    this.markerEl = markerEl;
  }

  attachScene(scene: THREE.Scene): void {
    this.scene = scene;
    this.flash = new THREE.PointLight(0xffd9a0, 0, 12);
    scene.add(this.flash);
  }

  private ctx(): AudioContext | null {
    try {
      if (!this.audio) this.audio = new AudioContext();
      if (this.audio.state === "suspended") void this.audio.resume();
      return this.audio;
    } catch {
      return null;
    }
  }

  private blip(freq: number, durMs: number, gain: number, type: OscillatorType = "square"): void {
    const ac = this.ctx();
    if (!ac) return;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + durMs / 1000);
    o.connect(g).connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + durMs / 1000);
  }

  shot(): void {
    this.blip(160, 120, 0.22, "sawtooth");
  }

  dryFire(): void {
    this.blip(900, 60, 0.08);
  }

  reload(): void {
    this.blip(520, 80, 0.1);
  }

  bodyHit(): void {
    this.showMarker(false);
    this.blip(660, 90, 0.2);
  }

  headHit(): void {
    this.showMarker(true);
    this.blip(990, 140, 0.28);
    window.setTimeout(() => this.blip(1320, 160, 0.22), 70);
  }

  precisionReady(): void {
    this.blip(1760, 45, 0.05, "sine");
  }

  private showMarker(head: boolean): void {
    this.markerEl.classList.remove("show", "head");
    void this.markerEl.offsetWidth; // restart animation
    if (head) this.markerEl.classList.add("head");
    this.markerEl.classList.add("show");
  }

  muzzle(worldPos: THREE.Vector3): void {
    if (this.flash) {
      this.flash.position.copy(worldPos);
      this.flash.intensity = 40;
      window.setTimeout(() => {
        if (this.flash) this.flash.intensity = 0;
      }, 40);
    }
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3): void {
    if (!this.scene) return;
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: 0x9df3ff, transparent: true, opacity: 0.85 }),
    );
    this.scene.add(line);
    this.tracers.push({ line, bornMs: performance.now() });
  }

  impact(point: THREE.Vector3, color = 0x8b98ad): void {
    if (!this.scene) return;
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 8, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 }),
    );
    m.position.copy(point);
    this.scene.add(m);
    const born = performance.now();
    this.tracers.push({ line: m as unknown as THREE.Line, bornMs: born });
  }

  update(nowMs: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      if (!t) continue;
      if (nowMs - t.bornMs > 120) {
        this.scene?.remove(t.line);
        const g = (t.line as unknown as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        g?.dispose();
        this.tracers.splice(i, 1);
      }
    }
  }
}
