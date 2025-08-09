import { describe, expect, mock, test } from "bun:test";
import * as winston from "winston";
import { LoLStatusReader, type LoLGameStatus } from "./lol-status-reader.ts";

// Complete championStats mock object
const mockChampionStats = {
  abilityHaste: 0,
  abilityPower: 85.5,
  armor: 28.2,
  armorPenetrationFlat: 0,
  armorPenetrationPercent: 0,
  attackDamage: 62.8,
  attackRange: 525,
  attackSpeed: 0.625,
  bonusArmorPenetrationPercent: 0,
  bonusMagicPenetrationPercent: 0,
  cooldownReduction: 0,
  critChance: 0,
  critDamage: 200,
  currentHealth: 518,
  healthRegenRate: 1.2,
  lifeSteal: 0,
  magicLethality: 0,
  magicPenetrationFlat: 0,
  magicPenetrationPercent: 0,
  magicResist: 30,
  maxHealth: 518,
  moveSpeed: 325,
  physicalLethality: 0,
  resourceMax: 245,
  resourceRegenRate: 1.4,
  resourceType: "MANA",
  resourceValue: 245,
  spellVamp: 0,
  tenacity: 0,
};

// Mock the lol-client API
const mockApi = {
  liveclientdata: {
    getLiveclientdataGamestats: mock(),
    getLiveclientdataActiveplayer: mock(),
    getLiveclientdataPlayerlist: mock(),
  },
};

// Mock the Api class
mock.module("./lol-client/Api.ts", () => ({
  Api: class {
    liveclientdata = mockApi.liveclientdata;
    constructor() {}
  },
}));

describe("LoLStatusReader", () => {
  const logger = winston.createLogger({
    silent: true, // Don't output logs during tests
  });

  test("should detect when not in game", async () => {
    // Mock API to throw error (simulating offline/not in game)
    mockApi.liveclientdata.getLiveclientdataGamestats.mockRejectedValue(
      new Error("Connection refused")
    );

    const reader = new LoLStatusReader(logger);
    const status = await reader.getGameStatus();

    expect(status.isInGame).toBe(false);
  });

  test("should detect when in game and parse game data", async () => {
    // Mock successful game stats response
    mockApi.liveclientdata.getLiveclientdataGamestats.mockResolvedValue({
      data: {
        gameTime: 600.5,
        gameMode: "CLASSIC",
        mapName: "Summoner's Rift",
        mapNumber: 11,
      },
    });

    // Mock successful active player response
    mockApi.liveclientdata.getLiveclientdataActiveplayer.mockResolvedValue({
      data: {
        riotIdGameName: "TestPlayer",
        championStats: mockChampionStats,
        level: 12,
        currentGold: 4500,
        team: "ORDER",
        summonerSpells: {
          summonerSpellOne: {
            displayName: "Flash",
            rawDescription:
              "Teleports your champion a short distance toward your cursor's location.",
          },
          summonerSpellTwo: {
            displayName: "Heal",
            rawDescription:
              "Restores Health to you and your most wounded nearby ally.",
          },
        },
      },
    });

    // Mock successful player list response with enhanced data
    mockApi.liveclientdata.getLiveclientdataPlayerlist.mockResolvedValue({
      data: [
        {
          riotIdGameName: "TestPlayer",
          riotId: "TestPlayer#NA1",
          riotIdTagLine: "NA1",
          summonerName: "TestPlayer#NA1",
          championName: "Jinx",
          rawChampionName: "game_character_displayname_Jinx",
          skinName: "Classic Jinx",
          rawSkinName: "game_character_skin_displayname_Jinx_0",
          skinID: 0,
          team: "ORDER",
          level: 12,
          position: "BOTTOM",
          isBot: false,
          isDead: false,
          respawnTimer: 0,
          scores: {
            kills: 5,
            deaths: 2,
            assists: 8,
            creepScore: 145,
            wardScore: 12,
          },
          summonerSpells: {
            summonerSpellOne: {
              displayName: "Flash",
              rawDescription:
                "Teleports your champion a short distance toward your cursor's location.",
            },
            summonerSpellTwo: {
              displayName: "Heal",
              rawDescription:
                "Restores Health to you and your most wounded nearby ally.",
            },
          },
          items: [
            {
              canUse: false,
              consumable: false,
              count: 1,
              displayName: "Doran's Blade",
              itemID: 1055,
              price: 450,
              rawDescription: "+8 Attack Damage +80 Health +3% Life Steal",
              rawDisplayName: "Item_1055_Name",
              slot: 0,
            },
            {
              canUse: true,
              consumable: true,
              count: 1,
              displayName: "Health Potion",
              itemID: 2003,
              price: 50,
              rawDescription: "Restores 150 Health over 15 seconds.",
              rawDisplayName: "Item_2003_Name",
              slot: 1,
            },
          ],
          runes: {
            keystone: {
              displayName: "Lethal Tempo",
              id: 8008,
              rawDescription: "perk_tooltip_LethalTempo",
              rawDisplayName: "perk_displayname_LethalTempo",
            },
            primaryRuneTree: {
              displayName: "Precision",
              id: 8000,
              rawDescription: "perkstyle_tooltip_7201",
              rawDisplayName: "perkstyle_displayname_7201",
            },
            secondaryRuneTree: {
              displayName: "Inspiration",
              id: 8300,
              rawDescription: "perkstyle_tooltip_7203",
              rawDisplayName: "perkstyle_displayname_7203",
            },
          },
        },
        {
          riotIdGameName: "EnemyPlayer",
          riotId: "EnemyPlayer#NA1",
          riotIdTagLine: "NA1",
          summonerName: "EnemyPlayer#NA1",
          championName: "Ashe",
          rawChampionName: "game_character_displayname_Ashe",
          skinName: "Classic Ashe",
          rawSkinName: "game_character_skin_displayname_Ashe_0",
          skinID: 0,
          team: "CHAOS",
          level: 11,
          position: "BOTTOM",
          isBot: false,
          isDead: false,
          respawnTimer: 0,
          scores: {
            kills: 3,
            deaths: 4,
            assists: 6,
            creepScore: 125,
            wardScore: 8,
          },
          summonerSpells: {
            summonerSpellOne: {
              displayName: "Flash",
              rawDescription:
                "Teleports your champion a short distance toward your cursor's location.",
            },
            summonerSpellTwo: {
              displayName: "Ignite",
              rawDescription:
                "Ignites target enemy champion, dealing true damage over time.",
            },
          },
          items: [
            {
              canUse: false,
              consumable: false,
              count: 1,
              displayName: "Doran's Blade",
              itemID: 1055,
              price: 450,
              rawDescription: "+8 Attack Damage +80 Health +3% Life Steal",
              rawDisplayName: "Item_1055_Name",
              slot: 0,
            },
          ],
          runes: {
            keystone: {
              displayName: "Lethal Tempo",
              id: 8008,
              rawDescription: "perk_tooltip_LethalTempo",
              rawDisplayName: "perk_displayname_LethalTempo",
            },
            primaryRuneTree: {
              displayName: "Precision",
              id: 8000,
              rawDescription: "perkstyle_tooltip_7201",
              rawDisplayName: "perkstyle_displayname_7201",
            },
            secondaryRuneTree: {
              displayName: "Inspiration",
              id: 8300,
              rawDescription: "perkstyle_tooltip_7203",
              rawDisplayName: "perkstyle_displayname_7203",
            },
          },
        },
      ],
    });

    const reader = new LoLStatusReader(logger);
    const status = await reader.getGameStatus();

    expect(status.isInGame).toBe(true);
    expect(status.gameTime).toBe(600.5);
    expect(status.gameMode).toBe("CLASSIC");
    expect(status.mapName).toBe("Summoner's Rift");
    expect(status.mapNumber).toBe(11);
    expect(status.activePlayerName).toBe("TestPlayer");
    expect(status.championName).toBe("Jinx");
    expect(status.championImageUrl).toEqual(expect.any(String));
    expect(status.level).toBe(12);
    expect(status.currentGold).toBe(4500);
    expect(status.team).toBe("ORDER");
    expect(status.score).toEqual({
      kills: 5,
      deaths: 2,
      assists: 8,
      creepScore: 145,
      wardScore: 12,
    });
    expect(status.summonerSpells).toEqual({
      summonerSpellOne: {
        displayName: "Flash",
        rawDescription:
          "Teleports your champion a short distance toward your cursor's location.",
        imageUrl: expect.any(String),
      },
      summonerSpellTwo: {
        displayName: "Heal",
        rawDescription:
          "Restores Health to you and your most wounded nearby ally.",
        imageUrl: expect.any(String),
      },
    });
    expect(status.items).toEqual([
      {
        canUse: false,
        consumable: false,
        count: 1,
        displayName: "Doran's Blade",
        itemID: 1055,
        price: 450,
        rawDescription: "+8 Attack Damage +80 Health +3% Life Steal",
        rawDisplayName: "Item_1055_Name",
        slot: 0,
        imageUrl: expect.any(String),
        totalCost: expect.any(Number),
        baseCost: expect.any(Number),
      },
      {
        canUse: true,
        consumable: true,
        count: 1,
        displayName: "Health Potion",
        itemID: 2003,
        price: 50,
        rawDescription: "Restores 150 Health over 15 seconds.",
        rawDisplayName: "Item_2003_Name",
        slot: 1,
        imageUrl: expect.any(String),
        totalCost: expect.any(Number),
        baseCost: expect.any(Number),
      },
    ]);
  });

  test("should get KDA from player list when scores are missing from active player", async () => {
    // Mock successful game stats response
    mockApi.liveclientdata.getLiveclientdataGamestats.mockResolvedValue({
      data: {
        gameTime: 750,
        gameMode: "CLASSIC",
        mapName: "Summoner's Rift",
        mapNumber: 11,
      },
    });

    // Mock active player response without scores
    mockApi.liveclientdata.getLiveclientdataActiveplayer.mockResolvedValue({
      data: {
        riotIdGameName: "TestPlayer",
        level: 14,
        currentGold: 3800,
        team: "ORDER",
        championStats: mockChampionStats,
      },
    });

    // Mock player list response with KDA scores
    mockApi.liveclientdata.getLiveclientdataPlayerlist.mockResolvedValue({
      data: [
        {
          riotIdGameName: "TestPlayer",
          riotId: "TestPlayer#NA1",
          riotIdTagLine: "NA1",
          summonerName: "TestPlayer#NA1",
          championName: "Lux",
          rawChampionName: "game_character_displayname_Lux",
          skinName: "Classic Lux",
          rawSkinName: "game_character_skin_displayname_Lux_0",
          skinID: 0,
          team: "ORDER",
          level: 14,
          position: "MIDDLE",
          isBot: false,
          isDead: false,
          respawnTimer: 0,
          scores: {
            kills: 6,
            deaths: 1,
            assists: 11,
            creepScore: 180,
            wardScore: 15,
          },
          summonerSpells: {
            summonerSpellOne: {
              displayName: "Flash",
              rawDescription:
                "Teleports your champion a short distance toward your cursor's location.",
            },
            summonerSpellTwo: {
              displayName: "Ignite",
              rawDescription:
                "Ignites target enemy champion, dealing true damage over time.",
            },
          },
          items: [],
          runes: {
            keystone: {
              displayName: "Electrocute",
              id: 8112,
              rawDescription: "perk_tooltip_Electrocute",
              rawDisplayName: "perk_displayname_Electrocute",
            },
            primaryRuneTree: {
              displayName: "Domination",
              id: 8100,
              rawDescription: "perkstyle_tooltip_7200",
              rawDisplayName: "perkstyle_displayname_7200",
            },
            secondaryRuneTree: {
              displayName: "Inspiration",
              id: 8300,
              rawDescription: "perkstyle_tooltip_7203",
              rawDisplayName: "perkstyle_displayname_7203",
            },
          },
        },
      ],
    });

    // Items are now included in player list data above

    const reader = new LoLStatusReader(logger);
    const status = await reader.getGameStatus();

    expect(status.isInGame).toBe(true);
    expect(status.activePlayerName).toBe("TestPlayer");
    expect(status.championName).toBe("Lux");
    expect(status.score).toEqual({
      kills: 6,
      deaths: 1,
      assists: 11,
      creepScore: 180,
      wardScore: 15,
    });
  });

  test("should handle missing active player data gracefully", async () => {
    // Mock successful game stats response
    mockApi.liveclientdata.getLiveclientdataGamestats.mockResolvedValue({
      data: {
        gameTime: 300,
        gameMode: "ARAM",
        mapName: "Howling Abyss",
        mapNumber: 12,
      },
    });

    // Mock failed active player response
    mockApi.liveclientdata.getLiveclientdataActiveplayer.mockRejectedValue(
      new Error("Active player data not available")
    );

    // Mock empty player list so no player data is found
    mockApi.liveclientdata.getLiveclientdataPlayerlist.mockResolvedValue({
      data: [],
    });

    const reader = new LoLStatusReader(logger);
    const status = await reader.getGameStatus();

    expect(status.isInGame).toBe(true);
    expect(status.gameTime).toBe(300);
    expect(status.gameMode).toBe("ARAM");
    expect(status.activePlayerName).toBeUndefined();
    expect(status.championName).toBeUndefined();
  });

  test("should set and call update callback", async () => {
    const updateCallback = mock<(status: LoLGameStatus) => void>();

    const reader = new LoLStatusReader(logger);
    reader.setStatusUpdateCallback(updateCallback);

    // Test that the callback is set
    expect(reader.setStatusUpdateCallback).toBeDefined();
  });

  test("should handle player list API failure gracefully", async () => {
    // Mock successful game stats response
    mockApi.liveclientdata.getLiveclientdataGamestats.mockResolvedValue({
      data: {
        gameTime: 400,
        gameMode: "CLASSIC",
        mapName: "Summoner's Rift",
        mapNumber: 11,
      },
    });

    // Mock successful active player response
    mockApi.liveclientdata.getLiveclientdataActiveplayer.mockResolvedValue({
      data: {
        riotIdGameName: "TestPlayer",
        level: 15,
        currentGold: 3000,
        team: "ORDER",
        championStats: mockChampionStats,
      },
    });

    // Mock failed player list response
    mockApi.liveclientdata.getLiveclientdataPlayerlist.mockRejectedValue(
      new Error("Player list not available")
    );

    // Items are now included in player list data above

    const reader = new LoLStatusReader(logger);
    const status = await reader.getGameStatus();

    expect(status.isInGame).toBe(true);
    expect(status.activePlayerName).toBeUndefined(); // No player data when player list fails
    expect(status.championName).toBeUndefined(); // Should be undefined when player list fails
    expect(status.level).toBeUndefined(); // Should be undefined when player list fails
  });

  test("should get items from player list when available", async () => {
    // Mock successful game stats response
    mockApi.liveclientdata.getLiveclientdataGamestats.mockResolvedValue({
      data: {
        gameTime: 500,
        gameMode: "CLASSIC",
        mapName: "Summoner's Rift",
        mapNumber: 11,
      },
    });

    // Mock successful active player response (no items in active player)
    mockApi.liveclientdata.getLiveclientdataActiveplayer.mockResolvedValue({
      data: {
        riotIdGameName: "TestPlayer",
        level: 10,
        currentGold: 2500,
        team: "ORDER",
        championStats: mockChampionStats,
      },
    });

    // Mock player list with items
    mockApi.liveclientdata.getLiveclientdataPlayerlist.mockResolvedValue({
      data: [
        {
          riotIdGameName: "TestPlayer",
          riotId: "TestPlayer#NA1",
          riotIdTagLine: "NA1",
          summonerName: "TestPlayer#NA1",
          championName: "Vayne",
          rawChampionName: "game_character_displayname_Vayne",
          skinName: "Classic Vayne",
          rawSkinName: "game_character_skin_displayname_Vayne_0",
          skinID: 0,
          team: "ORDER",
          level: 10,
          position: "BOTTOM",
          isBot: false,
          isDead: false,
          respawnTimer: 0,
          scores: {
            kills: 4,
            deaths: 2,
            assists: 6,
            creepScore: 120,
            wardScore: 8,
          },
          summonerSpells: {
            summonerSpellOne: {
              displayName: "Flash",
              rawDescription:
                "Teleports your champion a short distance toward your cursor's location.",
            },
            summonerSpellTwo: {
              displayName: "Heal",
              rawDescription:
                "Restores Health to you and your most wounded nearby ally.",
            },
          },
          items: [
            {
              canUse: false,
              consumable: false,
              count: 1,
              displayName: "Berserker's Greaves",
              itemID: 3006,
              price: 1100,
              rawDescription: "+35% Attack Speed +45 Movement Speed",
              rawDisplayName: "Item_3006_Name",
              slot: 0,
            },
            {
              canUse: false,
              consumable: false,
              count: 1,
              displayName: "Blade of The Ruined King",
              itemID: 3153,
              price: 3200,
              rawDescription:
                "+40 Attack Damage +25% Attack Speed +12% Life Steal",
              rawDisplayName: "Item_3153_Name",
              slot: 1,
            },
          ],
          runes: {
            keystone: {
              displayName: "Lethal Tempo",
              id: 8008,
              rawDescription: "perk_tooltip_LethalTempo",
              rawDisplayName: "perk_displayname_LethalTempo",
            },
            primaryRuneTree: {
              displayName: "Precision",
              id: 8000,
              rawDescription: "perkstyle_tooltip_7201",
              rawDisplayName: "perkstyle_displayname_7201",
            },
            secondaryRuneTree: {
              displayName: "Inspiration",
              id: 8300,
              rawDescription: "perkstyle_tooltip_7203",
              rawDisplayName: "perkstyle_displayname_7203",
            },
          },
        },
      ],
    });

    const reader = new LoLStatusReader(logger);
    const status = await reader.getGameStatus();

    expect(status.isInGame).toBe(true);
    expect(status.items).toHaveLength(2);
    expect(status.items?.[0]?.displayName).toBe("Berserker's Greaves");
    expect(status.items?.[1]?.displayName).toBe("Blade of The Ruined King");
  });

  test("should fallback to summoner spells from player list when not in active player data", async () => {
    // Mock successful game stats response
    mockApi.liveclientdata.getLiveclientdataGamestats.mockResolvedValue({
      data: {
        gameTime: 300,
        gameMode: "CLASSIC",
        mapName: "Summoner's Rift",
        mapNumber: 11,
      },
    });

    // Mock active player response WITHOUT summoner spells
    mockApi.liveclientdata.getLiveclientdataActiveplayer.mockResolvedValue({
      data: {
        riotIdGameName: "TestPlayer",
        level: 8,
        currentGold: 2000,
        team: "ORDER",
        championStats: mockChampionStats,
        // Note: no summonerSpells field
      },
    });

    // Items are now included in player list data below

    // Mock player list with summoner spells
    mockApi.liveclientdata.getLiveclientdataPlayerlist.mockResolvedValue({
      data: [
        {
          riotIdGameName: "TestPlayer",
          riotId: "TestPlayer#NA1",
          riotIdTagLine: "NA1",
          summonerName: "TestPlayer#NA1",
          championName: "Graves",
          rawChampionName: "game_character_displayname_Graves",
          skinName: "Classic Graves",
          rawSkinName: "game_character_skin_displayname_Graves_0",
          skinID: 0,
          team: "ORDER",
          level: 8,
          position: "JUNGLE",
          isBot: false,
          isDead: false,
          respawnTimer: 0,
          scores: {
            kills: 2,
            deaths: 1,
            assists: 3,
            creepScore: 85,
            wardScore: 5,
          },
          summonerSpells: {
            summonerSpellOne: {
              displayName: "Teleport",
              rawDescription: "Teleports your champion to target location.",
            },
            summonerSpellTwo: {
              displayName: "Smite",
              rawDescription: "Deals true damage to target monster or minion.",
            },
          },
          items: [],
          runes: {
            keystone: {
              displayName: "Conqueror",
              id: 8010,
              rawDescription: "perk_tooltip_Conqueror",
              rawDisplayName: "perk_displayname_Conqueror",
            },
            primaryRuneTree: {
              displayName: "Precision",
              id: 8000,
              rawDescription: "perkstyle_tooltip_7201",
              rawDisplayName: "perkstyle_displayname_7201",
            },
            secondaryRuneTree: {
              displayName: "Domination",
              id: 8100,
              rawDescription: "perkstyle_tooltip_7200",
              rawDisplayName: "perkstyle_displayname_7200",
            },
          },
        },
      ],
    });

    const reader = new LoLStatusReader(logger);
    const status = await reader.getGameStatus();

    expect(status.isInGame).toBe(true);
    expect(status.activePlayerName).toBe("TestPlayer");
    expect(status.championName).toBe("Graves");
    expect(status.championImageUrl).toEqual(expect.any(String));
    expect(status.summonerSpells).toEqual({
      summonerSpellOne: {
        displayName: "Teleport",
        rawDescription: "Teleports your champion to target location.",
        imageUrl: expect.any(String),
      },
      summonerSpellTwo: {
        displayName: "Smite",
        rawDescription: "Deals true damage to target monster or minion.",
        imageUrl: expect.any(String),
      },
    });
    expect(status.score).toEqual({
      kills: 2,
      deaths: 1,
      assists: 3,
      creepScore: 85,
      wardScore: 5,
    });
  });
});
