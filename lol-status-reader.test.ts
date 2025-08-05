import { describe, expect, mock, test } from "bun:test";
import * as winston from "winston";
import { LoLStatusReader, type LoLGameStatus } from "./lol-status-reader.ts";

// Mock the lol-client API
const mockApi = {
  liveclientdata: {
    getLiveclientdataGamestats: mock(),
    getLiveclientdataActiveplayer: mock(),
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
        mapId: 11,
      },
    });

    // Mock successful active player response
    mockApi.liveclientdata.getLiveclientdataActiveplayer.mockResolvedValue({
      data: {
        riotIdGameName: "TestPlayer",
        championStats: {
          championName: "Jinx",
          kills: 5,
          deaths: 2,
          assists: 8,
        },
        level: 12,
        currentGold: 4500,
        team: "ORDER",
      },
    });

    const reader = new LoLStatusReader(logger);
    const status = await reader.getGameStatus();

    expect(status.isInGame).toBe(true);
    expect(status.gameTime).toBe(600.5);
    expect(status.gameMode).toBe("CLASSIC");
    expect(status.mapName).toBe("Summoner's Rift");
    expect(status.mapId).toBe(11);
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
  });

  test("should handle missing active player data gracefully", async () => {
    // Mock successful game stats response
    mockApi.liveclientdata.getLiveclientdataGamestats.mockResolvedValue({
      data: {
        gameTime: 300,
        gameMode: "ARAM",
        mapName: "Howling Abyss",
        mapId: 12,
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

    // Test that the callback can be retrieved and called
    const testStatus: LoLGameStatus = { isInGame: true, gameMode: "CLASSIC" };

    // Access the private callback to test it was set correctly
    const callbackProperty = (reader as any).updateCallback;
    expect(callbackProperty).toBeDefined();

    // Call the callback directly to verify it works
    if (callbackProperty) {
      callbackProperty(testStatus);
    }

    expect(updateCallback).toHaveBeenCalledWith(testStatus);
  });
});
