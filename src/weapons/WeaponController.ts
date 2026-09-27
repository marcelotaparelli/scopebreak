import type { WeaponConfig, WeaponId } from "../config/weaponConfigs.js";
import { weaponConfigs } from "../config/weaponConfigs.js";
import { canFire } from "../player/movementRules.js";

/**
 * Weapon state machine. DOM-free and score-free: it only tracks
 * ammo / cooldown / reload / ADS timing and reports facts.
 */
export class WeaponController {
  currentId: WeaponId = "viper";
  ammoInMag: number;
  reserveInfinite = true;
  lastShotMs = -10_000;
  reloading = false;
  private reloadEndMs = 0;
  adsStartMs = -10_000;
  adsActive = false;
  /** Last ADS press timestamp — persists after release so tap-quickshots still resolve. */
  lastAdsStartMs = -10_000;

  constructor() {
    this.ammoInMag = weaponConfigs["viper"].magazineSize;
  }

  get config(): WeaponConfig {
    return weaponConfigs[this.currentId];
  }

  switchTo(id: WeaponId, nowMs: number): void {
    if (id === this.currentId) return;
    this.currentId = id;
    this.ammoInMag = weaponConfigs[id].magazineSize;
    this.reloading = false;
    this.adsActive = false;
    this.adsStartMs = nowMs;
    this.lastAdsStartMs = -10_000; // no ADS gesture in flight — next LMB fires immediately
  }

  setAds(active: boolean, nowMs: number): void {
    if (active && !this.adsActive) {
      this.adsStartMs = nowMs;
      this.lastAdsStartMs = nowMs;
    }
    this.adsActive = active;
  }

  adsElapsedMs(nowMs: number): number {
    return this.adsActive ? nowMs - this.adsStartMs : 0;
  }

  startReload(nowMs: number): boolean {
    if (this.reloading) return false;
    if (this.ammoInMag >= this.config.magazineSize) return false;
    this.reloading = true;
    this.reloadEndMs = nowMs + this.config.reloadMs;
    return true;
  }

  /** Must be called every frame so non-blocking reloads finish. */
  update(nowMs: number): void {
    if (this.reloading && nowMs >= this.reloadEndMs) {
      this.reloading = false;
      this.ammoInMag = this.config.magazineSize;
    }
  }

  canFireNow(nowMs: number): boolean {
    if (this.reloading) return false;
    if (this.ammoInMag <= 0) return false;
    return canFire(nowMs, this.lastShotMs, this.config.fireCooldownMs);
  }

  consumeShot(nowMs: number): void {
    this.lastShotMs = nowMs;
    this.ammoInMag = Math.max(0, this.ammoInMag - 1);
  }
}
