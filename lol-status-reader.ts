import * as winston from "winston";
import { z } from "zod";
import { Api } from "./lol-client/Api.ts";

// Zod schemas for API responses
const GameStatsSchema = z.object({
  gameTime: z.number(),
  gameMode: z.string(),
  mapName: z.string(),
  mapNumber: z.number(),
});

const SummonerSpellSchema = z.object({
  displayName: z.string(),
  rawDescription: z.string().optional().default(""),
});

const SummonerSpellsSchema = z.object({
  summonerSpellOne: SummonerSpellSchema.optional(),
  summonerSpellTwo: SummonerSpellSchema.optional(),
});

const AbilitySchema = z.object({
  abilityLevel: z.number().optional(),
  displayName: z.string(),
  rawDescription: z.string().optional().default(""),
  rawDisplayName: z.string().optional().default(""),
});

const AbilitiesSchema = z
  .record(z.enum(["Q", "W", "E", "R", "Passive"]), AbilitySchema)
  .optional();

const ItemSchema = z.object({
  canUse: z.boolean(),
  consumable: z.boolean(),
  count: z.number(),
  displayName: z.string(),
  itemID: z.number(),
  price: z.number(),
  rawDescription: z.string(),
  slot: z.number(),
});

const ChampionStatsSchema = z.object({
  abilityHaste: z.number().optional().default(0),
  abilityPower: z.number().optional().default(0),
  armor: z.number().optional().default(0),
  armorPenetrationFlat: z.number().optional().default(0),
  armorPenetrationPercent: z.number().optional().default(0),
  attackDamage: z.number().optional().default(0),
  attackRange: z.number().optional().default(0),
  attackSpeed: z.number().optional().default(0),
  bonusArmorPenetrationPercent: z.number().optional().default(0),
  bonusMagicPenetrationPercent: z.number().optional().default(0),
  cooldownReduction: z.number().optional().default(0),
  critChance: z.number().optional().default(0),
  critDamage: z.number().optional().default(0),
  currentHealth: z.number().optional().default(0),
  healthRegenRate: z.number().optional().default(0),
  lifeSteal: z.number().optional().default(0),
  magicLethality: z.number().optional().default(0),
  magicPenetrationFlat: z.number().optional().default(0),
  magicPenetrationPercent: z.number().optional().default(0),
  magicResist: z.number().optional().default(0),
  maxHealth: z.number().optional().default(0),
  moveSpeed: z.number().optional().default(0),
  physicalLethality: z.number().optional().default(0),
  resourceMax: z.number().optional().default(0),
  resourceRegenRate: z.number().optional().default(0),
  resourceType: z.string().optional().default(""),
  resourceValue: z.number().optional().default(0),
  spellVamp: z.number().optional().default(0),
  tenacity: z.number().optional().default(0),
});

const ActivePlayerSchema = z
  .object({
    riotIdGameName: z.string().optional(),
    summonerName: z.string().optional(),
    level: z.number(),
    currentGold: z.number(),
    championStats: ChampionStatsSchema,
    abilities: AbilitiesSchema,
  })
  .refine((data) => data.riotIdGameName || data.summonerName, {
    message: "Either riotIdGameName or summonerName must be present",
  });

const ScoresSchema = z.object({
  kills: z.number(),
  deaths: z.number(),
  assists: z.number(),
});

const PlayerListPlayerSchema = z.object({
  riotIdGameName: z.string().optional(),
  summonerName: z.string().optional(),
  championName: z.string(),
  team: z.string(),
  scores: ScoresSchema,
  summonerSpells: SummonerSpellsSchema,
});

const PlayerListSchema = z.array(PlayerListPlayerSchema);
const ItemsSchema = z.array(ItemSchema);

export interface LoLGameStatus {
  isInGame: boolean;
  gameTime?: number;
  gameMode?: string;
  mapName?: string;
  mapNumber?: number;
  activePlayerName?: string;
  championName?: string;
  level?: number;
  currentGold?: number;
  score?: {
    kills: number;
    deaths: number;
    assists: number;
  };
  team?: string;
  championStats?: {
    abilityHaste: number;
    abilityPower: number;
    armor: number;
    armorPenetrationFlat: number;
    armorPenetrationPercent: number;
    attackDamage: number;
    attackRange: number;
    attackSpeed: number;
    bonusArmorPenetrationPercent: number;
    bonusMagicPenetrationPercent: number;
    cooldownReduction: number;
    critChance: number;
    critDamage: number;
    currentHealth: number;
    healthRegenRate: number;
    lifeSteal: number;
    magicLethality: number;
    magicPenetrationFlat: number;
    magicPenetrationPercent: number;
    magicResist: number;
    maxHealth: number;
    moveSpeed: number;
    physicalLethality: number;
    resourceMax: number;
    resourceRegenRate: number;
    resourceType: string;
    resourceValue: number;
    spellVamp: number;
    tenacity: number;
  };
  summonerSpells?: {
    summonerSpellOne?: {
      displayName: string;
      rawDescription: string;
    };
    summonerSpellTwo?: {
      displayName: string;
      rawDescription: string;
    };
  };
  abilities?: Record<
    "Q" | "W" | "E" | "R" | "Passive",
    {
      abilityLevel?: number;
      displayName: string;
      rawDescription: string;
      rawDisplayName: string;
    }
  >;
  items?: Array<{
    canUse: boolean;
    consumable: boolean;
    count: number;
    displayName: string;
    itemID: number;
    price: number;
    rawDescription: string;
    slot: number;
  }>;
}

export class LoLStatusReader {
  private logger: winston.Logger;
  private api: Api<unknown>;
  private isApiOnline = false;
  private pollingTimer?: NodeJS.Timeout;
  private updateCallback?: (status: LoLGameStatus) => void;
  private inGamePollingInterval = 2000; // 2 seconds when in game
  private offlinePollingInterval = 30000; // 30 seconds when offline
  private currentPollingInterval = this.offlinePollingInterval;

  constructor(logger: winston.Logger) {
    this.logger = logger;

    // Create custom fetch that ignores SSL certificate errors for the LoL client's self-signed cert
    const customFetch = async (
      url: string | URL | Request,
      init?: RequestInit
    ) => {
      const options: RequestInit = {
        ...init,
        // In Bun, we can set the tls option to ignore certificate errors
        // @ts-ignore - Bun-specific TLS option
        tls: {
          rejectUnauthorized: false,
        },
      };
      return fetch(url, options);
    };

    this.api = new Api({
      baseUrl: "https://127.0.0.1:2999",
      customFetch: customFetch as typeof fetch,
    });
  }

  /**
   * Safely parse data with a Zod schema and log detailed error information on failure
   */
  private parseWithLogging<T>(
    schema: z.ZodSchema<T>,
    data: unknown,
    dataType: string
  ): T {
    try {
      return schema.parse(data);
    } catch (parseError) {
      this.logger.error(
        `Failed to parse '${dataType}' response: ${parseError}`,
        {
          dataType,
          rawData: data,
          error: parseError,
          rawDataString: JSON.stringify(data, null, 2),
        }
      );
      throw parseError;
    }
  }

  public setStatusUpdateCallback(
    callback: (status: LoLGameStatus) => void
  ): void {
    this.updateCallback = callback;
  }

  public startMonitoring(): void {
    this.logger.info("Starting League of Legends status monitoring");
    this.pollGameStatus();
    this.scheduleNextPoll();
  }

  public stopMonitoring(): void {
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = undefined;
    }
    this.logger.info("Stopped League of Legends status monitoring");
  }

  private scheduleNextPoll(): void {
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
    }

    this.pollingTimer = setTimeout(() => {
      this.pollGameStatus();
      this.scheduleNextPoll();
    }, this.currentPollingInterval);
  }

  private async pollGameStatus(): Promise<void> {
    try {
      const gameStatus = await this.getGameStatus();

      // Adjust polling frequency based on game state
      const wasInGame =
        this.currentPollingInterval === this.inGamePollingInterval;
      const isInGame = gameStatus.isInGame;

      if (isInGame && !wasInGame) {
        this.currentPollingInterval = this.inGamePollingInterval;
        this.logger.info("Player entered game - increasing polling frequency");
      } else if (!isInGame && wasInGame) {
        this.currentPollingInterval = this.offlinePollingInterval;
        this.logger.info("Player left game - reducing polling frequency");
      }

      // Update API online status
      if (!this.isApiOnline && isInGame) {
        this.isApiOnline = true;
        this.logger.info("League of Legends Game Client API is now online");
      } else if (this.isApiOnline && !isInGame) {
        this.isApiOnline = false;
        this.logger.info("League of Legends Game Client API is now offline");
      }

      if (this.updateCallback) {
        this.updateCallback(gameStatus);
      }
    } catch (error) {
      // API being offline is expected when not in game
      if (this.isApiOnline) {
        this.logger.debug(
          "League of Legends Game Client API connection failed (expected when not in game)"
        );
        this.isApiOnline = false;

        // Publish offline status
        if (this.updateCallback) {
          this.updateCallback({ isInGame: false });
        }
      }

      // Ensure we're using offline polling interval
      if (this.currentPollingInterval !== this.offlinePollingInterval) {
        this.currentPollingInterval = this.offlinePollingInterval;
      }
    }
  }

  public async getGameStatus(): Promise<LoLGameStatus> {
    try {
      // Try to get game stats first - this is the lightest endpoint
      const gameStatsResponse =
        await this.api.liveclientdata.getLiveclientdataGamestats();

      const gameStats = this.parseWithLogging(
        GameStatsSchema,
        gameStatsResponse.data,
        "game stats"
      );

      // If we have game stats, we're definitely in a game
      let status: LoLGameStatus = {
        isInGame: true,
        gameTime: gameStats.gameTime,
        gameMode: gameStats.gameMode,
        mapName: gameStats.mapName,
        mapNumber: gameStats.mapNumber,
      };

      // Try to get active player info
      try {
        const activePlayerResponse =
          await this.api.liveclientdata.getLiveclientdataActiveplayer();

        const activePlayer = this.parseWithLogging(
          ActivePlayerSchema,
          activePlayerResponse.data,
          "active player"
        );

        this.logger.debug(
          `Active player data: ${JSON.stringify(activePlayer, null, 2)}`
        );

        // Log specific stats-related properties if they exist
        if (activePlayer.championStats) {
          this.logger.debug(
            `Champion stats: ${JSON.stringify(
              activePlayer.championStats,
              null,
              2
            )}`
          );
        }

        status.activePlayerName =
          activePlayer.riotIdGameName || activePlayer.summonerName;
        status.level = activePlayer.level;
        status.currentGold = activePlayer.currentGold;
        status.championStats = activePlayer.championStats;
        status.abilities = activePlayer.abilities;

        this.logger.debug(
          `Abilities: ${JSON.stringify(activePlayer.abilities, null, 2)}`
        );

        // Extract items
        try {
          if (status.activePlayerName) {
            // Try to get items from the dedicated items endpoint
            const itemsResponse =
              await this.api.liveclientdata.getLiveclientdataPlayeritems({
                riotId: status.activePlayerName,
              });

            this.logger.debug(
              `Items from items endpoint before parse: ${JSON.stringify(
                itemsResponse.data,
                null,
                2
              )}`
            );

            const itemsData = this.parseWithLogging(
              ItemsSchema,
              itemsResponse.data,
              "items"
            );

            status.items = itemsData.filter((item) => item.itemID !== 0);
            this.logger.debug(
              `Items from items endpoint: ${status.items
                ?.map((item) => item.displayName)
                .join(", ")}`
            );
          }
        } catch (itemsError) {
          this.logger.debug("Items endpoint failed, no items available");
        }

        // Get champion name, scores, and summoner spells from player list
        try {
          const playerListResponse =
            await this.api.liveclientdata.getLiveclientdataPlayerlist();

          this.logger.debug(
            `Player list response: ${JSON.stringify(
              playerListResponse.data,
              null,
              2
            )}`
          );

          const playerList = this.parseWithLogging(
            PlayerListSchema,
            playerListResponse.data,
            "player list"
          );

          this.logger.debug(
            `Player list data: ${JSON.stringify(playerList, null, 2)}`
          );

          // Find the active player in the list
          const activePlayerInList = playerList.find(
            (player) =>
              player.riotIdGameName === status.activePlayerName ||
              player.summonerName === status.activePlayerName
          );

          if (!activePlayerInList) {
            throw new Error(
              `Active player ${status.activePlayerName} not found in player list`
            );
          }

          this.logger.debug(
            `Found active player in list: ${JSON.stringify(
              activePlayerInList,
              null,
              2
            )}`
          );

          // Extract champion name and team
          status.championName = activePlayerInList.championName;
          status.team = activePlayerInList.team;
          this.logger.debug(
            `Champion name from player list: ${activePlayerInList.championName}, Team: ${activePlayerInList.team}`
          );

          // Extract KDA from player list scores
          status.score = {
            kills: activePlayerInList.scores.kills,
            deaths: activePlayerInList.scores.deaths,
            assists: activePlayerInList.scores.assists,
          };
          this.logger.debug(
            `KDA from player list: ${status.score.kills}/${status.score.deaths}/${status.score.assists}`
          );

          // Extract summoner spells from player list
          const summonerSpells = activePlayerInList.summonerSpells;
          this.logger.debug(
            `Summoner spells from player list: ${JSON.stringify(
              summonerSpells,
              null,
              2
            )}`
          );

          status.summonerSpells = summonerSpells;

          this.logger.debug(
            `Summoner spells: ${summonerSpells.summonerSpellOne?.displayName} + ${summonerSpells.summonerSpellTwo?.displayName}`
          );
        } catch (playerListError) {
          this.logger.debug(
            "Could not fetch player list for champion name and summoner spells"
          );
        }
      } catch (playerError) {
        // Active player info might not be available in all game modes
        this.logger.debug("Could not fetch active player info");
      }

      return status;
    } catch (error) {
      // API is offline - not an error, just means not in game
      return { isInGame: false };
    }
  }
}
