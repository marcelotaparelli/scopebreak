export type WeaponId = "viper" | "titan" | "phantom";

export interface WeaponConfig {
  id: WeaponId;
  displayName: string;
  style: string;
  boltAction: boolean;
  magazineSize: number;
  fireCooldownMs: number;
  reloadMs: number;
  adsMs: number;
  /** RMB → snap-precision delay: LMB buffered in this window auto-fires here. */
  snapPrecisionMs: number;
  bodyDamage: number;
  headDamage: number;
  hipSpreadDeg: number;
  moveSpeedMultiplier: number; // applied to runSpeed while ADS
  recoilKick: number; // camera pitch kick in degrees
  scopeFov: number;
}

export const weaponConfigs: Record<WeaponId, WeaponConfig> = {
  // AGGRESSIVE MOVEMENT SNIPER — flick / quickscope
  viper: {
    id: "viper",
    displayName: "VIPER",
    style: "flick / quickscope",
    boltAction: true,
    magazineSize: 5,
    fireCooldownMs: 1050,
    reloadMs: 2100,
    adsMs: 130,
    snapPrecisionMs: 45,
    bodyDamage: 80,
    headDamage: 150,
    hipSpreadDeg: 5.5,
    moveSpeedMultiplier: 0.92,
    recoilKick: 2.2,
    scopeFov: 32,
  },
  // HEAVY PRECISION SNIPER — prediction / positioning
  titan: {
    id: "titan",
    displayName: "TITAN",
    style: "prediction / positioning",
    boltAction: true,
    magazineSize: 4,
    fireCooldownMs: 1500,
    reloadMs: 2800,
    adsMs: 220,
    snapPrecisionMs: 80,
    bodyDamage: 95,
    headDamage: 160,
    hipSpreadDeg: 6.5,
    moveSpeedMultiplier: 0.78,
    recoilKick: 3.4,
    scopeFov: 24,
  },
  // FAST SEMI-AUTO / TRACKING SNIPER
  phantom: {
    id: "phantom",
    displayName: "PHANTOM",
    style: "tracking",
    boltAction: false,
    magazineSize: 10,
    fireCooldownMs: 340,
    reloadMs: 2000,
    adsMs: 140,
    snapPrecisionMs: 45,
    bodyDamage: 34,
    headDamage: 70,
    hipSpreadDeg: 4.5,
    moveSpeedMultiplier: 0.95,
    recoilKick: 1.1,
    scopeFov: 36,
  },
};

export const weaponOrder: WeaponId[] = ["viper", "titan", "phantom"];
