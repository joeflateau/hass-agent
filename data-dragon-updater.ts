/**
 * Data Dragon Updater Module
 *
 * Fetches the latest champion, item, summoner spell, and rune data from Riot's Data Dragon API.
 * This static data can be used to enrich the live game data with additional metadata.
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import * as winston from "winston";

interface DataDragonVersion {
  version: string;
}

interface Champion {
  id: string;
  key: string;
  name: string;
  title: string;
  blurb: string;
  info: {
    attack: number;
    defense: number;
    magic: number;
    difficulty: number;
  };
  image: {
    full: string;
    sprite: string;
    group: string;
    x: number;
    y: number;
    w: number;
    h: number;
  };
  tags: string[];
  partype: string;
  stats: Record<string, number>;
}

interface Item {
  name: string;
  description: string;
  colloq: string;
  plaintext: string;
  into?: string[];
  image: {
    full: string;
    sprite: string;
    group: string;
    x: number;
    y: number;
    w: number;
    h: number;
  };
  gold: {
    base: number;
    purchasable: boolean;
    total: number;
    sell: number;
  };
  tags: string[];
  maps: Record<string, boolean>;
  stats: Record<string, number>;
}

interface SummonerSpell {
  id: string;
  name: string;
  description: string;
  tooltip: string;
  maxrank: number;
  cooldown: number[];
  cooldownBurn: string;
  cost: number[];
  costBurn: string;
  costType: string;
  maxammo: string;
  range: number[];
  rangeBurn: string;
  image: {
    full: string;
    sprite: string;
    group: string;
    x: number;
    y: number;
    w: number;
    h: number;
  };
  resource: string;
  summonerLevel: number;
  modes: string[];
}

interface RuneTree {
  id: number;
  key: string;
  icon: string;
  name: string;
  slots: Array<{
    runes: Array<{
      id: number;
      key: string;
      icon: string;
      name: string;
      shortDesc: string;
      longDesc: string;
    }>;
  }>;
}

export class DataDragonUpdater {
  private readonly baseUrl = "https://ddragon.leagueoflegends.com";
  private readonly dataDir: string;
  private readonly logger: winston.Logger;

  constructor(dataDir?: string, logger?: winston.Logger) {
    this.dataDir = dataDir || join(process.cwd(), "data", "ddragon");
    this.logger =
      logger ||
      winston.createLogger({
        level: "info",
        format: winston.format.simple(),
        transports: [new winston.transports.Console()],
      });
  }

  async getLatestVersion(): Promise<string> {
    this.logger.info("🔍 Fetching latest version...");
    const response = await fetch(`${this.baseUrl}/api/versions.json`);
    if (!response.ok) {
      throw new Error(`Failed to fetch versions: ${response.statusText}`);
    }
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("Invalid versions response format");
    }
    const versions = data as string[];
    const latestVersion = versions[0];
    if (!latestVersion) {
      throw new Error("No version found in response");
    }
    this.logger.info(`📋 Latest version: ${latestVersion}`);
    return latestVersion;
  }

  async fetchChampions(version: string): Promise<Record<string, Champion>> {
    this.logger.info("🏆 Fetching champions data...");
    const response = await fetch(
      `${this.baseUrl}/cdn/${version}/data/en_US/champion.json`
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch champions: ${response.statusText}`);
    }
    const responseData = await response.json();
    if (
      !responseData ||
      typeof responseData !== "object" ||
      !("data" in responseData)
    ) {
      throw new Error("Invalid champions response format");
    }
    const data = responseData as { data: Record<string, Champion> };
    this.logger.info(`✅ Fetched ${Object.keys(data.data).length} champions`);
    return data.data;
  }

  async fetchItems(version: string): Promise<Record<string, Item>> {
    this.logger.info("🛡️ Fetching items data...");
    const response = await fetch(
      `${this.baseUrl}/cdn/${version}/data/en_US/item.json`
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch items: ${response.statusText}`);
    }
    const responseData = await response.json();
    if (
      !responseData ||
      typeof responseData !== "object" ||
      !("data" in responseData)
    ) {
      throw new Error("Invalid items response format");
    }
    const data = responseData as { data: Record<string, Item> };
    this.logger.info(`✅ Fetched ${Object.keys(data.data).length} items`);
    return data.data;
  }

  async fetchSummonerSpells(
    version: string
  ): Promise<Record<string, SummonerSpell>> {
    this.logger.info("✨ Fetching summoner spells data...");
    const response = await fetch(
      `${this.baseUrl}/cdn/${version}/data/en_US/summoner.json`
    );
    if (!response.ok) {
      throw new Error(
        `Failed to fetch summoner spells: ${response.statusText}`
      );
    }
    const responseData = await response.json();
    if (
      !responseData ||
      typeof responseData !== "object" ||
      !("data" in responseData)
    ) {
      throw new Error("Invalid summoner spells response format");
    }
    const data = responseData as { data: Record<string, SummonerSpell> };
    this.logger.info(
      `✅ Fetched ${Object.keys(data.data).length} summoner spells`
    );
    return data.data;
  }

  async fetchRunes(version: string): Promise<RuneTree[]> {
    this.logger.info("🔮 Fetching runes data...");
    const response = await fetch(
      `${this.baseUrl}/cdn/${version}/data/en_US/runesReforged.json`
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch runes: ${response.statusText}`);
    }
    const responseData = await response.json();
    if (!Array.isArray(responseData)) {
      throw new Error("Invalid runes response format");
    }
    const runes = responseData as RuneTree[];
    const totalRunes = runes.reduce(
      (total, tree) =>
        total +
        tree.slots.reduce(
          (slotTotal, slot) => slotTotal + slot.runes.length,
          0
        ),
      0
    );
    this.logger.info(
      `✅ Fetched ${runes.length} rune trees with ${totalRunes} total runes`
    );
    return runes;
  }

  async saveData(filename: string, data: any): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const filePath = join(this.dataDir, filename);
    await writeFile(filePath, JSON.stringify(data, null, 2));
    this.logger.info(`💾 Saved ${filename}`);
  }

  async createIndexFile(version: string): Promise<void> {
    const indexData = {
      version,
      lastUpdated: new Date().toISOString(),
      files: {
        champions: "champions.json",
        items: "items.json",
        summonerSpells: "summoner-spells.json",
        runes: "runes.json",
      },
      urls: {
        championImages: `${this.baseUrl}/cdn/${version}/img/champion/`,
        itemImages: `${this.baseUrl}/cdn/${version}/img/item/`,
        summonerSpellImages: `${this.baseUrl}/cdn/${version}/img/spell/`,
        runeImages: `${this.baseUrl}/cdn/img/`,
      },
    };

    await this.saveData("index.json", indexData);
  }

  async updateAll(): Promise<void> {
    try {
      this.logger.info("🚀 Starting Data Dragon update...\n");

      const version = await this.getLatestVersion();

      // Fetch all data in parallel
      const [champions, items, summonerSpells, runes] = await Promise.all([
        this.fetchChampions(version),
        this.fetchItems(version),
        this.fetchSummonerSpells(version),
        this.fetchRunes(version),
      ]);

      this.logger.info("\n💾 Saving data files...");

      // Save all data files
      await Promise.all([
        this.saveData("champions.json", champions),
        this.saveData("items.json", items),
        this.saveData("summoner-spells.json", summonerSpells),
        this.saveData("runes.json", runes),
        this.createIndexFile(version),
      ]);

      this.logger.info(
        `\n🎉 Successfully updated Data Dragon data to version ${version}`
      );
      this.logger.info(`📁 Data saved to: ${this.dataDir}`);

      // Print summary
      this.logger.info("\n📊 Summary:");
      this.logger.info(`   Champions: ${Object.keys(champions).length}`);
      this.logger.info(`   Items: ${Object.keys(items).length}`);
      this.logger.info(
        `   Summoner Spells: ${Object.keys(summonerSpells).length}`
      );
      this.logger.info(`   Rune Trees: ${runes.length}`);
    } catch (error) {
      this.logger.error("❌ Error updating Data Dragon data:", error);
      throw error;
    }
  }
}

/**
 * Convenience function to update Data Dragon data with default settings
 */
export async function updateDataDragon(
  dataDir?: string,
  logger?: winston.Logger
): Promise<void> {
  const updater = new DataDragonUpdater(dataDir, logger);
  await updater.updateAll();
}
