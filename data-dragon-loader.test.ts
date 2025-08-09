/**
 * Data Dragon Loader Tests
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { DataDragonLoader } from "./data-dragon-loader.ts";

describe("DataDragonLoader", () => {
  let loader: DataDragonLoader;

  beforeAll(() => {
    loader = new DataDragonLoader();
  });

  test("should check if data is available", async () => {
    const isAvailable = await loader.isDataAvailable();
    expect(isAvailable).toBe(true);
  });

  test("should load index metadata", async () => {
    const index = await loader.getIndex();
    expect(index).toBeDefined();
    expect(index.version).toBeDefined();
    expect(index.lastUpdated).toBeDefined();
    expect(index.files).toBeDefined();
    expect(index.urls).toBeDefined();
  });

  test("should load champion data", async () => {
    const champions = await loader.getChampions();
    expect(champions).toBeDefined();
    expect(Object.keys(champions).length).toBeGreaterThan(0);

    // Test specific champion
    const jinx = await loader.getChampion("Jinx");
    expect(jinx).toBeDefined();
    expect(jinx!.name).toBe("Jinx");
    expect(jinx!.title).toBeDefined();
  });

  test("should load item data", async () => {
    const items = await loader.getItems();
    expect(items).toBeDefined();
    expect(Object.keys(items).length).toBeGreaterThan(0);

    // Test specific item (Doran's Blade)
    const doransBlade = await loader.getItem("1055");
    expect(doransBlade).toBeDefined();
    expect(doransBlade!.name).toBe("Doran's Blade");
  });

  test("should load summoner spells", async () => {
    const spells = await loader.getSummonerSpells();
    expect(spells).toBeDefined();
    expect(Object.keys(spells).length).toBeGreaterThan(0);

    // Test specific spell
    const flash = await loader.getSummonerSpell("Flash");
    expect(flash).toBeDefined();
    expect(flash!.name).toBe("Flash");
  });

  test("should load runes", async () => {
    const runes = await loader.getRunes();
    expect(runes).toBeDefined();
    expect(runes.length).toBeGreaterThan(0);

    // Each tree should have slots with runes
    for (const tree of runes) {
      expect(tree.name).toBeDefined();
      expect(tree.slots).toBeDefined();
      expect(tree.slots.length).toBeGreaterThan(0);
    }
  });

  test("should generate image URLs", async () => {
    const championImageUrl = await loader.getChampionImageUrl("Jinx");
    expect(championImageUrl).toBeDefined();
    expect(championImageUrl).toContain("https://ddragon.leagueoflegends.com");
    expect(championImageUrl).toContain("/img/champion/");

    const itemImageUrl = await loader.getItemImageUrl("1055");
    expect(itemImageUrl).toBeDefined();
    expect(itemImageUrl).toContain("https://ddragon.leagueoflegends.com");
    expect(itemImageUrl).toContain("/img/item/");
  });

  test("should handle missing data gracefully", async () => {
    const missingChampion = await loader.getChampion("NonExistentChampion");
    expect(missingChampion).toBeNull();

    const missingItem = await loader.getItem("99999");
    expect(missingItem).toBeNull();

    const missingSpell = await loader.getSummonerSpell("NonExistentSpell");
    expect(missingSpell).toBeNull();
  });
});
