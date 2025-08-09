#!/usr/bin/env bun

/**
 * Script to ensure Data Dragon data is available for development and CI
 * This runs the data dragon updater directly without requiring the compiled binary
 */

import { DataDragonLoader } from "../data-dragon-loader.js";
import { DataDragonUpdater } from "../data-dragon-updater.js";

async function ensureDataDragon() {
  console.log("🐉 Checking Data Dragon data availability...");

  const loader = new DataDragonLoader();
  const isAvailable = await loader.isDataAvailable();

  if (isAvailable) {
    console.log("✅ Data Dragon data is already available");
    try {
      const index = await loader.getIndex();
      console.log(`📊 Current version: ${index.version}`);
      console.log(
        `📅 Last updated: ${new Date(index.lastUpdated).toLocaleString()}`
      );
    } catch (error) {
      console.log("⚠️  Data exists but may be corrupted, will update...");
    }
    return;
  }

  console.log("📥 Data Dragon data not found, downloading...");

  const updater = new DataDragonUpdater();

  try {
    console.log("🔍 Fetching latest version...");
    const version = await updater.getLatestVersion();
    console.log(`📦 Latest version: ${version}`);

    console.log("🏆 Downloading champions data...");
    const champions = await updater.fetchChampions(version);

    console.log("⚔️  Downloading items data...");
    const items = await updater.fetchItems(version);

    console.log("✨ Downloading summoner spells data...");
    const summonerSpells = await updater.fetchSummonerSpells(version);

    console.log("🔮 Downloading runes data...");
    const runes = await updater.fetchRunes(version);

    console.log("💾 Saving data to files...");
    await Promise.all([
      updater.saveData("champions.json", champions),
      updater.saveData("items.json", items),
      updater.saveData("summoner-spells.json", summonerSpells),
      updater.saveData("runes.json", runes),
    ]);

    console.log("📋 Creating index file...");
    await updater.createIndexFile(version);

    console.log("✅ Data Dragon data successfully downloaded and saved!");
  } catch (error) {
    console.error("❌ Failed to download Data Dragon data:", error);
    console.error("⚠️  Tests may fail without this data");
    console.error(
      "💡 You can try running this script again or check your internet connection"
    );
    process.exit(1);
  }
}

// Run if this file is executed directly
if (import.meta.main) {
  ensureDataDragon().catch((error) => {
    console.error("💥 Script failed:", error);
    process.exit(1);
  });
}
