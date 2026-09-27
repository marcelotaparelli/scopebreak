import type { WeaponId } from "../config/weaponConfigs.js";

export interface WeaponTelemetry {
  shots: number;
  hits: number;
  kills: number;
  headshots: number;
}

/** Local-only tuning telemetry. No network, no persistence. */
export class Telemetry {
  shots = 0;
  hits = 0;
  headshots = 0;
  kills = 0;
  deaths = 0;
  maxSpeedThisLife = 0;
  perWeapon: Record<WeaponId, WeaponTelemetry> = {
    viper: { shots: 0, hits: 0, kills: 0, headshots: 0 },
    titan: { shots: 0, hits: 0, kills: 0, headshots: 0 },
    phantom: { shots: 0, hits: 0, kills: 0, headshots: 0 },
  };

  resetLife(): void {
    this.maxSpeedThisLife = 0;
  }

  observeSpeed(v: number): void {
    if (v > this.maxSpeedThisLife) this.maxSpeedThisLife = v;
  }

  registerShot(w: WeaponId): void {
    this.shots++;
    this.perWeapon[w].shots++;
  }

  registerHit(w: WeaponId, headshot: boolean): void {
    this.hits++;
    this.perWeapon[w].hits++;
    if (headshot) {
      this.headshots++;
      this.perWeapon[w].headshots++;
    }
  }

  registerKill(w: WeaponId): void {
    this.kills++;
    this.perWeapon[w].kills++;
  }

  registerDeath(): void {
    this.deaths++;
    this.resetLife();
  }

  accuracy(): number {
    return this.shots > 0 ? this.hits / this.shots : 0;
  }
}
