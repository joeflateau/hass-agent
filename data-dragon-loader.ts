/**
 * Data Dragon Data Loader
 *
 * Utility for loading and accessing cached Data Dragon data.
 * Provides type-safe access to champions, items, summoner spells, and runes.
 */

import { readFile } from "fs/promises";
import { join } from "path";

interface DataDragonIndex {
  version: string;
  lastUpdated: string;
  files: {
    champions: string;
    items: string;
    summonerSpells: string;
    runes: string;
  };
  urls: {
    championImages: string;
    itemImages: string;
    summonerSpellImages: string;
    runeImages: string;
  };
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

export class DataDragonLoader {
  private readonly dataDir = join(process.cwd(), "data", "ddragon");
  private index: DataDragonIndex | null = null;
  private champions: Record<string, Champion> | null = null;
  private items: Record<string, Item> | null = null;
  private summonerSpells: Record<string, SummonerSpell> | null = null;
  private runes: RuneTree[] | null = null;

  /**
   * Check if Data Dragon data is available
   */
  async isDataAvailable(): Promise<boolean> {
    try {
      await this.loadIndex();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get Data Dragon metadata
   */
  async getIndex(): Promise<DataDragonIndex> {
    if (!this.index) {
      await this.loadIndex();
    }
    return this.index!;
  }

  /**
   * Get champion data by ID or name
   */
  async getChampion(identifier: string): Promise<Champion | null> {
    await this.loadChampions();

    // Try exact match first (by ID)
    if (this.champions![identifier]) {
      return this.champions![identifier];
    }

    // Try by name (case insensitive)
    const championByName = Object.values(this.champions!).find(
      (champ) => champ.name.toLowerCase() === identifier.toLowerCase()
    );

    return championByName || null;
  }

  /**
   * Get all champions
   */
  async getChampions(): Promise<Record<string, Champion>> {
    await this.loadChampions();
    return this.champions!;
  }

  /**
   * Get item data by ID
   */
  async getItem(itemId: string | number): Promise<Item | null> {
    await this.loadItems();
    return this.items![itemId.toString()] || null;
  }

  /**
   * Get all items
   */
  async getItems(): Promise<Record<string, Item>> {
    await this.loadItems();
    return this.items!;
  }

  /**
   * Get summoner spell data by ID or name
   */
  async getSummonerSpell(identifier: string): Promise<SummonerSpell | null> {
    await this.loadSummonerSpells();

    // Try exact match first (by ID)
    if (this.summonerSpells![identifier]) {
      return this.summonerSpells![identifier];
    }

    // Try by name (case insensitive)
    const spellByName = Object.values(this.summonerSpells!).find(
      (spell) => spell.name.toLowerCase() === identifier.toLowerCase()
    );

    return spellByName || null;
  }

  /**
   * Get all summoner spells
   */
  async getSummonerSpells(): Promise<Record<string, SummonerSpell>> {
    await this.loadSummonerSpells();
    return this.summonerSpells!;
  }

  /**
   * Get rune data by ID
   */
  async getRune(runeId: number): Promise<any | null> {
    await this.loadRunes();

    for (const tree of this.runes!) {
      for (const slot of tree.slots) {
        const rune = slot.runes.find((r) => r.id === runeId);
        if (rune) {
          return rune;
        }
      }
    }

    return null;
  }

  /**
   * Get all rune trees
   */
  async getRunes(): Promise<RuneTree[]> {
    await this.loadRunes();
    return this.runes!;
  }

  /**
   * Get champion image URL
   */
  async getChampionImageUrl(championId: string): Promise<string | null> {
    const index = await this.getIndex();
    const champion = await this.getChampion(championId);

    if (!champion) return null;

    return `${index.urls.championImages}${champion.image.full}`;
  }

  /**
   * Get item image URL
   */
  async getItemImageUrl(itemId: string | number): Promise<string | null> {
    const index = await this.getIndex();
    const item = await this.getItem(itemId);

    if (!item) return null;

    return `${index.urls.itemImages}${item.image.full}`;
  }

  /**
   * Get summoner spell image URL
   */
  async getSummonerSpellImageUrl(spellId: string): Promise<string | null> {
    const index = await this.getIndex();
    const spell = await this.getSummonerSpell(spellId);

    if (!spell) return null;

    return `${index.urls.summonerSpellImages}${spell.image.full}`;
  }

  /**
   * Get rune image URL
   */
  async getRuneImageUrl(runeId: number): Promise<string | null> {
    const index = await this.getIndex();
    const rune = await this.getRune(runeId);

    if (!rune) return null;

    return `${index.urls.runeImages}${rune.icon}`;
  }

  private async loadIndex(): Promise<void> {
    if (this.index) return;

    const indexPath = join(this.dataDir, "index.json");
    const data = await readFile(indexPath, "utf-8");
    this.index = JSON.parse(data);
  }

  private async loadChampions(): Promise<void> {
    if (this.champions) return;

    const championsPath = join(this.dataDir, "champions.json");
    const data = await readFile(championsPath, "utf-8");
    this.champions = JSON.parse(data);
  }

  private async loadItems(): Promise<void> {
    if (this.items) return;

    const itemsPath = join(this.dataDir, "items.json");
    const data = await readFile(itemsPath, "utf-8");
    this.items = JSON.parse(data);
  }

  private async loadSummonerSpells(): Promise<void> {
    if (this.summonerSpells) return;

    const spellsPath = join(this.dataDir, "summoner-spells.json");
    const data = await readFile(spellsPath, "utf-8");
    this.summonerSpells = JSON.parse(data);
  }

  private async loadRunes(): Promise<void> {
    if (this.runes) return;

    const runesPath = join(this.dataDir, "runes.json");
    const data = await readFile(runesPath, "utf-8");
    this.runes = JSON.parse(data);
  }
}

// Singleton instance for easy access
export const dataDragon = new DataDragonLoader();
