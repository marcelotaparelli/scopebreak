import type { WeaponId } from "../config/weaponConfigs.js";

export interface CombatHitEvent {
  targetId: number;
  headshot: boolean;
  damage: number;
  killed: boolean;
  distance: number;
  weaponId: WeaponId;
  sliding: boolean;
  airborne: boolean;
  wallKickRecent: boolean;
  ads: boolean;
  precisionReady: boolean;
  timestampMs: number;
}

export interface PlayerKilledEvent {
  killerId: string;
  victimId: string;
  headshot: boolean;
  weaponId: WeaponId;
  distance: number;
  timestampMs: number;
}
