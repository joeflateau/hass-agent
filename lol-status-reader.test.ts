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
    getLiveclientdataPlayeritems: mock(),
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

    // Mock successful player items response
    mockApi.liveclientdata.getLiveclientdataPlayeritems.mockResolvedValue({
      data: [
        {
          canUse: false,
          consumable: false,
          count: 1,
          displayName: "Doran's Blade",
          itemID: 1055,
          price: 450,
          rawDescription: "+8 Attack Damage +80 Health +3% Life Steal",
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
          slot: 1,
        },
      ],
    });

    // Mock successful player list response with scores
    mockApi.liveclientdata.getLiveclientdataPlayerlist.mockResolvedValue({
      data: [
        {
          riotIdGameName: "TestPlayer",
          championName: "Jinx",
          team: "ORDER",
          scores: {
            kills: 5,
            deaths: 2,
            assists: 8,
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
        },
        {
          riotIdGameName: "EnemyPlayer",
          championName: "Ashe",
          team: "CHAOS",
          scores: {
            kills: 3,
            deaths: 4,
            assists: 6,
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
    expect(status.level).toBe(12);
    expect(status.currentGold).toBe(4500);
    expect(status.team).toBe("ORDER");
    expect(status.score).toEqual({
      kills: 5,
      deaths: 2,
      assists: 8,
    });
    expect(status.summonerSpells).toEqual({
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
        slot: 1,
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
          championName: "Lux",
          team: "ORDER",
          scores: {
            kills: 6,
            deaths: 1,
            assists: 11,
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
        },
      ],
    });

    // Mock items response (can be empty for this test)
    mockApi.liveclientdata.getLiveclientdataPlayeritems.mockResolvedValue({
      data: [],
    });

    const reader = new LoLStatusReader(logger);
    const status = await reader.getGameStatus();

    expect(status.isInGame).toBe(true);
    expect(status.activePlayerName).toBe("TestPlayer");
    expect(status.championName).toBe("Lux");
    expect(status.score).toEqual({
      kills: 6,
      deaths: 1,
      assists: 11,
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

    // Mock items response (can be empty for this test)
    mockApi.liveclientdata.getLiveclientdataPlayeritems.mockResolvedValue({
      data: [],
    });

    const reader = new LoLStatusReader(logger);
    const status = await reader.getGameStatus();

    expect(status.isInGame).toBe(true);
    expect(status.activePlayerName).toBe("TestPlayer");
    expect(status.championName).toBeUndefined(); // Should be undefined when player list fails
    expect(status.level).toBe(15);
  });

  test("should handle items API failure gracefully", async () => {
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

    // Mock failed items API response
    mockApi.liveclientdata.getLiveclientdataPlayeritems.mockRejectedValue(
      new Error("Items API not available")
    );

    // Mock empty player list
    mockApi.liveclientdata.getLiveclientdataPlayerlist.mockResolvedValue({
      data: [],
    });

    const reader = new LoLStatusReader(logger);
    const status = await reader.getGameStatus();

    expect(status.isInGame).toBe(true);
    expect(status.items).toBeUndefined(); // Items should be undefined when items API fails and no fallback
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

    // Mock empty items
    mockApi.liveclientdata.getLiveclientdataPlayeritems.mockResolvedValue({
      data: [],
    });

    // Mock player list with summoner spells
    mockApi.liveclientdata.getLiveclientdataPlayerlist.mockResolvedValue({
      data: [
        {
          riotIdGameName: "TestPlayer",
          championName: "Graves",
          team: "ORDER",
          scores: {
            kills: 2,
            deaths: 1,
            assists: 3,
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
        },
      ],
    });

    const reader = new LoLStatusReader(logger);
    const status = await reader.getGameStatus();

    expect(status.isInGame).toBe(true);
    expect(status.activePlayerName).toBe("TestPlayer");
    expect(status.championName).toBe("Graves");
    expect(status.summonerSpells).toEqual({
      summonerSpellOne: {
        displayName: "Teleport",
        rawDescription: "Teleports your champion to target location.",
      },
      summonerSpellTwo: {
        displayName: "Smite",
        rawDescription: "Deals true damage to target monster or minion.",
      },
    });
    expect(status.score).toEqual({
      kills: 2,
      deaths: 1,
      assists: 3,
    });
  });
});
