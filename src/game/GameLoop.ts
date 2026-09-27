/** Fixed-substep game loop: gameplay stays stable across refresh rates. */
export class GameLoop {
  private raf = 0;
  private lastMs = 0;
  private acc = 0;
  private readonly step = 1 / 120;
  running = false;

  constructor(
    private readonly tick: (dt: number, nowMs: number) => void,
    private readonly render: () => void,
  ) {}

  start(): void {
    this.running = true;
    this.lastMs = performance.now();
    const frame = (nowMs: number): void => {
      if (!this.running) return;
      let dt = (nowMs - this.lastMs) / 1000;
      this.lastMs = nowMs;
      if (dt > 0.1) dt = 0.1; // tab-switch clamp
      this.acc += dt;
      let n = 0;
      while (this.acc >= this.step && n < 8) {
        this.tick(this.step, nowMs);
        this.acc -= this.step;
        n++;
      }
      if (n === 8) this.acc = 0;
      this.render();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
