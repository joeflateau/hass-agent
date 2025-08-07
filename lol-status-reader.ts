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
  rawDisplayName: z.string().optional(),
  slot: z.number(),
});

const ItemsSchema = z.array(ItemSchema);

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
  creepScore: z.number(),
  wardScore: z.number(),
});

const RuneSchema = z.object({
  displayName: z.string(),
  id: z.number(),
  rawDescription: z.string(),
  rawDisplayName: z.string(),
});

const RunesSchema = z.object({
  keystone: RuneSchema,
  primaryRuneTree: RuneSchema,
  secondaryRuneTree: RuneSchema,
});

const PlayerListPlayerSchema = z.object({
  riotIdGameName: z.string().optional(),
  riotId: z.string().optional(),
  riotIdTagLine: z.string().optional(),
  summonerName: z.string().optional(),
  championName: z.string(),
  rawChampionName: z.string().optional(),
  skinName: z.string().optional(),
  rawSkinName: z.string().optional(),
  skinID: z.number().optional(),
  team: z.string(),
  level: z.number(),
  position: z.string().optional(),
  isBot: z.boolean(),
  isDead: z.boolean(),
  respawnTimer: z.number(),
  scores: ScoresSchema,
  summonerSpells: SummonerSpellsSchema,
  items: ItemsSchema,
  runes: RunesSchema,
});

const PlayerListSchema = z.array(PlayerListPlayerSchema);

export interface PlayerInfo {
  riotIdGameName?: string;
  riotId?: string;
  riotIdTagLine?: string;
  summonerName?: string;
  championName: string;
  rawChampionName?: string;
  skinName?: string;
  rawSkinName?: string;
  skinID?: number;
  team: string;
  level: number;
  position?: string;
  isBot: boolean;
  isDead: boolean;
  respawnTimer: number;
  scores: {
    kills: number;
    deaths: number;
    assists: number;
    creepScore: number;
    wardScore: number;
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
  items?: Array<{
    canUse: boolean;
    consumable: boolean;
    count: number;
    displayName: string;
    itemID: number;
    price: number;
    rawDescription: string;
    rawDisplayName?: string;
    slot: number;
  }>;
  runes?: {
    keystone: {
      displayName: string;
      id: number;
      rawDescription: string;
      rawDisplayName: string;
    };
    primaryRuneTree: {
      displayName: string;
      id: number;
      rawDescription: string;
      rawDisplayName: string;
    };
    secondaryRuneTree: {
      displayName: string;
      id: number;
      rawDescription: string;
      rawDisplayName: string;
    };
  };
}

export interface LoLGameStatus {
  isInGame: boolean;
  gameTime?: number;
  gameMode?: string;
  mapName?: string;
  mapNumber?: number;
  activePlayerName?: string;
  riotId?: string;
  riotIdTagLine?: string;
  championName?: string;
  rawChampionName?: string;
  skinName?: string;
  rawSkinName?: string;
  skinID?: number;
  level?: number;
  position?: string;
  isBot?: boolean;
  isDead?: boolean;
  respawnTimer?: number;
  currentGold?: number;
  score?: {
    kills: number;
    deaths: number;
    assists: number;
    creepScore: number;
    wardScore: number;
  };
  team?: string;
  teammates?: PlayerInfo[];
  enemies?: PlayerInfo[];
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
    rawDisplayName?: string;
    slot: number;
  }>;
  runes?: {
    keystone: {
      displayName: string;
      id: number;
      rawDescription: string;
      rawDisplayName: string;
    };
    primaryRuneTree: {
      displayName: string;
      id: number;
      rawDescription: string;
      rawDisplayName: string;
    };
    secondaryRuneTree: {
      displayName: string;
      id: number;
      rawDescription: string;
      rawDisplayName: string;
    };
  };
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

      // Get detailed player info from player list
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

        // Get active player info for additional data like currentGold and championStats
        let activePlayer: z.infer<typeof ActivePlayerSchema> | null = null;
        try {
          const activePlayerResponse =
            await this.api.liveclientdata.getLiveclientdataActiveplayer();

          activePlayer = this.parseWithLogging(
            ActivePlayerSchema,
            activePlayerResponse.data,
            "active player"
          );

          this.logger.debug(
            `Active player data: ${JSON.stringify(activePlayer, null, 2)}`
          );
        } catch (activePlayerError) {
          this.logger.debug("Could not fetch active player info");
        }

        // Find the active player in the list - only if we can definitively match
        let activePlayerInList = null;
        if (activePlayer) {
          activePlayerInList = playerList.find((player) => {
            // First try to match by riot ID if available
            if (activePlayer.riotIdGameName && player.riotIdGameName) {
              return player.riotIdGameName === activePlayer.riotIdGameName;
            }
            // Fall back to summoner name matching
            if (activePlayer.summonerName && player.summonerName) {
              return player.summonerName === activePlayer.summonerName;
            }
            return false;
          });
        }

        if (!activePlayerInList) {
          this.logger.debug(
            "Could not identify active player in player list - skipping player-specific data"
          );
          // We still have game stats, so return basic game info
          return status;
        }

        this.logger.debug(
          `Found active player in list: ${JSON.stringify(
            activePlayerInList,
            null,
            2
          )}`
        );

        // Extract all available data from player list
        status.activePlayerName =
          activePlayerInList.riotIdGameName || activePlayerInList.summonerName;
        status.riotId = activePlayerInList.riotId;
        status.riotIdTagLine = activePlayerInList.riotIdTagLine;
        status.championName = activePlayerInList.championName;
        status.rawChampionName = activePlayerInList.rawChampionName;
        status.skinName = activePlayerInList.skinName;
        status.rawSkinName = activePlayerInList.rawSkinName;
        status.skinID = activePlayerInList.skinID;
        status.level = activePlayerInList.level;
        status.position = activePlayerInList.position;
        status.isBot = activePlayerInList.isBot;
        status.isDead = activePlayerInList.isDead;
        status.respawnTimer = activePlayerInList.respawnTimer;
        status.team = activePlayerInList.team;

        // Extract enhanced score data
        status.score = {
          kills: activePlayerInList.scores.kills,
          deaths: activePlayerInList.scores.deaths,
          assists: activePlayerInList.scores.assists,
          creepScore: activePlayerInList.scores.creepScore,
          wardScore: activePlayerInList.scores.wardScore,
        };

        this.logger.debug(
          `Enhanced score from player list: ${status.score.kills}/${status.score.deaths}/${status.score.assists} | CS: ${status.score.creepScore} | Wards: ${status.score.wardScore}`
        );

        // Extract summoner spells
        status.summonerSpells = activePlayerInList.summonerSpells;
        this.logger.debug(
          `Summoner spells: ${activePlayerInList.summonerSpells.summonerSpellOne?.displayName} + ${activePlayerInList.summonerSpells.summonerSpellTwo?.displayName}`
        );

        // Extract items (filter out empty slots with itemID 0)
        status.items = activePlayerInList.items.filter(
          (item) => item.itemID !== 0
        );
        this.logger.debug(
          `Items: ${status.items.map((item) => item.displayName).join(", ")}`
        );

        // Extract runes
        status.runes = activePlayerInList.runes;
        this.logger.debug(
          `Runes: ${activePlayerInList.runes.keystone.displayName} (${activePlayerInList.runes.primaryRuneTree.displayName}/${activePlayerInList.runes.secondaryRuneTree.displayName})`
        );

        // Separate teammates and enemies based on active player's team
        const activePlayerTeam = activePlayerInList.team;
        status.teammates = [];
        status.enemies = [];

        playerList.forEach((player) => {
          const playerInfo: PlayerInfo = {
            riotIdGameName: player.riotIdGameName,
            riotId: player.riotId,
            riotIdTagLine: player.riotIdTagLine,
            summonerName: player.summonerName,
            championName: player.championName,
            rawChampionName: player.rawChampionName,
            skinName: player.skinName,
            rawSkinName: player.rawSkinName,
            skinID: player.skinID,
            team: player.team,
            level: player.level,
            position: player.position,
            isBot: player.isBot,
            isDead: player.isDead,
            respawnTimer: player.respawnTimer,
            scores: {
              kills: player.scores.kills,
              deaths: player.scores.deaths,
              assists: player.scores.assists,
              creepScore: player.scores.creepScore,
              wardScore: player.scores.wardScore,
            },
            summonerSpells: player.summonerSpells,
            items: player.items.filter((item) => item.itemID !== 0),
            runes: player.runes,
          };

          if (player.team === activePlayerTeam) {
            status.teammates!.push(playerInfo);
          } else {
            status.enemies!.push(playerInfo);
          }
        });

        this.logger.debug(
          `Found ${status.teammates!.length} teammates and ${
            status.enemies!.length
          } enemies`
        );

        // Add active player specific data if available
        if (activePlayer) {
          status.currentGold = activePlayer.currentGold;
          status.championStats = activePlayer.championStats;
          status.abilities = activePlayer.abilities;

          this.logger.debug(
            `Active player stats - Gold: ${activePlayer.currentGold}, Level: ${activePlayer.level}`
          );

          if (activePlayer.championStats) {
            this.logger.debug(
              `Champion stats: ${JSON.stringify(
                activePlayer.championStats,
                null,
                2
              )}`
            );
          }

          if (activePlayer.abilities) {
            this.logger.debug(
              `Abilities: ${JSON.stringify(activePlayer.abilities, null, 2)}`
            );
          }
        }
      } catch (playerListError) {
        this.logger.debug(
          "Could not fetch player list for detailed player info"
        );
      }

      return status;
    } catch (error) {
      // API is offline - not an error, just means not in game
      return { isInGame: false };
    }
  }
}
