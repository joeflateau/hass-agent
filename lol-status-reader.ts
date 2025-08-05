import * as winston from "winston";
import { Api } from "./lol-client/Api.ts";

export interface LoLGameStatus {
  isInGame: boolean;
  gameTime?: number;
  gameMode?: string;
  mapName?: string;
  mapId?: number;
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
      const gameStats = gameStatsResponse.data as any;

      if (!gameStats) {
        return { isInGame: false };
      }

      // If we have game stats, we're definitely in a game
      let status: LoLGameStatus = {
        isInGame: true,
        gameTime: gameStats.gameTime,
        gameMode: gameStats.gameMode,
        mapName: gameStats.mapName,
        mapId: gameStats.mapId,
      };

      // Try to get active player info
      try {
        const activePlayerResponse =
          await this.api.liveclientdata.getLiveclientdataActiveplayer();
        const activePlayer = activePlayerResponse.data as any;

        if (activePlayer) {
          status.activePlayerName =
            activePlayer.riotIdGameName || activePlayer.summonerName;
          status.championName = activePlayer.championStats?.championName;
          status.level = activePlayer.level;
          status.currentGold = activePlayer.currentGold;

          // Extract score if available
          if (activePlayer.championStats) {
            status.score = {
              kills: activePlayer.championStats.kills || 0,
              deaths: activePlayer.championStats.deaths || 0,
              assists: activePlayer.championStats.assists || 0,
            };
          }

          status.team = activePlayer.team;
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
