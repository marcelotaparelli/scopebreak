import { describe, expect, test } from "bun:test";
import { weaponConfigs } from "../src/config/weaponConfigs";
import { WeaponController } from "../src/weapons/WeaponController";
import { computeDamage } from "../src/player/movementRules";

describe("weapon configs", () => {
  test("three snipers exist with distinct identities", () => {
    expect(weaponConfigs.viper.boltAction).toBe(true);
    expect(weaponConfigs.titan.boltAction).toBe(true);
    expect(weaponConfigs.phantom.boltAction).toBe(false);
    // Titan: heavier — slower ADS, slower cooldown, bigger recoil, less mobility
    expect(weaponConfigs.titan.adsMs).toBeGreaterThan(weaponConfigs.viper.adsMs);
    expect(weaponConfigs.titan.fireCooldownMs).toBeGreaterThan(weaponConfigs.viper.fireCooldownMs);
    expect(weaponConfigs.titan.recoilKick).toBeGreaterThan(weaponConfigs.viper.recoilKick);
    expect(weaponConfigs.titan.moveSpeedMultiplier).toBeLessThan(weaponConfigs.viper.moveSpeedMultiplier);
    // Phantom: tracking — fast cadence, fast ADS, low damage
    expect(weaponConfigs.phantom.fireCooldownMs).toBeLessThan(weaponConfigs.viper.fireCooldownMs);
    expect(weaponConfigs.phantom.bodyDamage).toBeLessThan(weaponConfigs.viper.bodyDamage);
    expect(weaponConfigs.phantom.magazineSize).toBeGreaterThan(weaponConfigs.viper.magazineSize);
  });

  test("no sniper is objectively superior: TTK tradeoffs hold", () => {
    // Titan body does not one-shot 100hp (else strictly better than Viper)
    const titanBody = computeDamage({ headshot: false, bodyDamage: 95, headDamage: 160, targetHealth: 100 });
    expect(titanBody.killed).toBe(false);
    // Titan headshot kills
    expect(computeDamage({ headshot: true, bodyDamage: 95, headDamage: 160, targetHealth: 100 }).killed).toBe(true);
    // Phantom needs 3 body shots (34x2=68 <100; third shot vs 32hp kills)
    expect(computeDamage({ headshot: false, bodyDamage: 34, headDamage: 70, targetHealth: 100 }).killed).toBe(false);
    expect(computeDamage({ headshot: false, bodyDamage: 34, headDamage: 70, targetHealth: 32 }).killed).toBe(true);
  });
});

describe("fire cooldown + ammo/reload", () => {
  test("viper cooldown gates fire", () => {
    const w = new WeaponController();
    expect(w.canFireNow(0)).toBe(true);
    w.consumeShot(0);
    expect(w.canFireNow(500)).toBe(false);
    expect(w.canFireNow(1050)).toBe(true);
  });

  test("phantom cadence is significantly faster", () => {
    const w = new WeaponController();
    w.switchTo("phantom", 0);
    w.consumeShot(0);
    expect(w.canFireNow(340)).toBe(true);
    expect(w.canFireNow(339)).toBe(false);
  });

  test("reload refills after duration, blocks fire while reloading", () => {
    const w = new WeaponController();
    w.switchTo("viper", 0);
    for (let i = 0; i < 5; i++) {
      w.lastShotMs = -10_000;
      expect(w.canFireNow(i * 2000)).toBe(true);
      w.consumeShot(i * 2000);
    }
    expect(w.ammoInMag).toBe(0);
    expect(w.canFireNow(20_000)).toBe(false);
    expect(w.startReload(20_000)).toBe(true);
    expect(w.canFireNow(20_000 + 1000)).toBe(false);
    w.update(20_000 + 2100);
    expect(w.ammoInMag).toBe(5);
    w.lastShotMs = -10_000;
    expect(w.canFireNow(20_000 + 2100)).toBe(true);
  });

  test("switching refills mag and clears ADS/reload", () => {
    const w = new WeaponController();
    w.consumeShot(0);
    w.setAds(true, 0);
    w.switchTo("titan", 100);
    expect(w.ammoInMag).toBe(4);
    expect(w.adsActive).toBe(false);
    expect(w.reloading).toBe(false);
  });
});

describe("damage / headshot", () => {
  test("viper headshot kills, body leaves 20hp", () => {
    const head = computeDamage({ headshot: true, bodyDamage: 80, headDamage: 150, targetHealth: 100 });
    expect(head.killed).toBe(true);
    expect(head.damage).toBe(150);
    const body = computeDamage({ headshot: false, bodyDamage: 80, headDamage: 150, targetHealth: 100 });
    expect(body.killed).toBe(false);
    expect(body.damage).toBe(80);
  });
});
