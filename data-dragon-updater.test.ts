/**
 * Data Dragon Updater Tests
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmdir } from "fs/promises";
import { join } from "path";
import * as winston from "winston";
import { DataDragonUpdater } from "./data-dragon-updater.ts";

describe("DataDragonUpdater", () => {
  let updater: DataDragonUpdater;
  let testDataDir: string;
  let logger: winston.Logger;

  beforeAll(() => {
    // Create a test logger that suppresses output during tests
    logger = winston.createLogger({
      level: "error", // Only show errors during tests
      format: winston.format.simple(),
      transports: [new winston.transports.Console()],
    });

    testDataDir = join(process.cwd(), "test-data", "ddragon");
    updater = new DataDragonUpdater(testDataDir, logger);
  });

  afterAll(async () => {
    // Clean up test data
    try {
      await rmdir(join(process.cwd(), "test-data"), { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("should fetch latest version", async () => {
    const version = await updater.getLatestVersion();
    expect(version).toBeDefined();
    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);
  });

  test("should fetch champions data", async () => {
    const version = "14.1.1"; // Use a stable version for testing
    const champions = await updater.fetchChampions(version);
    expect(champions).toBeDefined();
    expect(typeof champions).toBe("object");
    expect(Object.keys(champions).length).toBeGreaterThan(0);

    // Check that champions have expected structure
    const championKeys = Object.keys(champions);
    expect(championKeys.length).toBeGreaterThan(0);
    const firstKey = championKeys[0];
    if (firstKey) {
      const firstChampion = champions[firstKey];
      expect(firstChampion?.name).toBeDefined();
      expect(firstChampion?.id).toBeDefined();
      expect(firstChampion?.title).toBeDefined();
    }
  });

  test("should fetch items data", async () => {
    const version = "14.1.1";
    const items = await updater.fetchItems(version);
    expect(items).toBeDefined();
    expect(typeof items).toBe("object");
    expect(Object.keys(items).length).toBeGreaterThan(0);

    // Check that items have expected structure
    const itemKeys = Object.keys(items);
    expect(itemKeys.length).toBeGreaterThan(0);
    const firstKey = itemKeys[0];
    if (firstKey) {
      const firstItem = items[firstKey];
      expect(firstItem?.name).toBeDefined();
      expect(firstItem?.description).toBeDefined();
    }
  });

  test("should fetch summoner spells data", async () => {
    const version = "14.1.1";
    const spells = await updater.fetchSummonerSpells(version);
    expect(spells).toBeDefined();
    expect(typeof spells).toBe("object");
    expect(Object.keys(spells).length).toBeGreaterThan(0);

    // Check that spells have expected structure
    const spellKeys = Object.keys(spells);
    expect(spellKeys.length).toBeGreaterThan(0);
    const firstKey = spellKeys[0];
    if (firstKey) {
      const firstSpell = spells[firstKey];
      expect(firstSpell?.name).toBeDefined();
      expect(firstSpell?.description).toBeDefined();
    }
  });

  test("should fetch runes data", async () => {
    const version = "14.1.1";
    const runes = await updater.fetchRunes(version);
    expect(runes).toBeDefined();
    expect(Array.isArray(runes)).toBe(true);
    expect(runes.length).toBeGreaterThan(0);

    // Check that rune trees have expected structure
    const firstTree = runes[0];
    expect(firstTree?.name).toBeDefined();
    expect(firstTree?.slots).toBeDefined();
    expect(Array.isArray(firstTree?.slots)).toBe(true);
  });

  test("should save data to file", async () => {
    const testData = { test: "data", version: "1.0.0" };
    await updater.saveData("test.json", testData);

    // File should exist and be readable
    const filePath = join(testDataDir, "test.json");
    const file = Bun.file(filePath);
    expect(await file.exists()).toBe(true);

    const savedData = await file.json();
    expect(savedData).toEqual(testData);
  });

  test("should create index file", async () => {
    const version = "14.1.1";
    await updater.createIndexFile(version);

    const indexPath = join(testDataDir, "index.json");
    const file = Bun.file(indexPath);
    expect(await file.exists()).toBe(true);

    const indexData = await file.json();
    expect(indexData.version).toBe(version);
    expect(indexData.lastUpdated).toBeDefined();
    expect(indexData.files).toBeDefined();
    expect(indexData.urls).toBeDefined();
  });
});
