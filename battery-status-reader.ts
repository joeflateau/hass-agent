import { spawn, type ChildProcess } from "child_process";
import * as readline from "readline";
import * as winston from "winston";
import { parsePmsetRawlogLine, type BatteryInfo } from "./battery-parser.ts";
import { executeCommand } from "./command-utils.ts";

export interface UptimeInfo {
  uptimeMinutes: number;
}

export class BatteryStatusReader {
  private logger: winston.Logger;
  private pmsetProcess?: ChildProcess;
  private onBatteryUpdate?: (batteryInfo: BatteryInfo) => void;

  constructor(logger: winston.Logger) {
    this.logger = logger;
  }

  public setBatteryUpdateCallback(
    callback: (batteryInfo: BatteryInfo) => void
  ): void {
    this.onBatteryUpdate = callback;
  }

  public async getUptimeInfo(): Promise<UptimeInfo> {
    try {
      const output = await executeCommand("sysctl kern.boottime");
      // sysctl kern.boottime returns something like: kern.boottime: { sec = 1722409523, usec = 0 } Thu Aug  1 15:12:03 2024
      const secMatch = output.match(/sec = (\d+)/);
      if (!secMatch || !secMatch[1]) {
        throw new Error("Could not parse boot time from sysctl output");
      }

      const bootTimeSeconds = parseInt(secMatch[1]);
      const bootTime = new Date(bootTimeSeconds * 1000);
      const now = new Date();
      const diffMs = now.getTime() - bootTime.getTime();
      const uptimeMinutes = Math.floor(diffMs / 60000); // minutes

      return { uptimeMinutes };
    } catch (error) {
      this.logger.error(`Error getting uptime: ${error}`);
      return { uptimeMinutes: -1 };
    }
  }

  public startPmsetRawlogMonitoring(): void {
    this.logger.info("Starting pmset rawlog monitoring...");

    this.pmsetProcess = spawn("pmset", ["-g", "rawlog"]);

    if (this.pmsetProcess.stdout) {
      const rl = readline.createInterface({
        input: this.pmsetProcess.stdout,
        crlfDelay: Infinity,
      });

      rl.on("line", (line: string) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return;

        // Look for battery status lines (contain semicolons and percentage)
        if (trimmedLine.includes(";") && trimmedLine.includes("%")) {
          const batteryInfo = this.parsePmsetRawlogLine(trimmedLine);
          if (batteryInfo && this.onBatteryUpdate) {
            this.logger.debug(
              `Battery update: ${batteryInfo.batteryLevel}%, Charging: ${
                batteryInfo.isCharging
              }, AC: ${batteryInfo.powerSource === "AC"}`
            );
            this.onBatteryUpdate(batteryInfo);
          }
        }
      });

      rl.on("close", () => {
        this.logger.warn("pmset rawlog readline interface closed");
      });
    }

    this.pmsetProcess.stderr?.on("data", (data: Buffer) => {
      this.logger.error(`pmset rawlog stderr: ${data.toString()}`);
    });

    this.pmsetProcess.on("close", (code: number) => {
      this.logger.warn(`pmset rawlog process closed with code ${code}`);
      // Restart the process after a delay
      setTimeout(() => {
        if (!this.pmsetProcess?.killed) {
          this.startPmsetRawlogMonitoring();
        }
      }, 5000);
    });

    this.pmsetProcess.on("error", (error: Error) => {
      this.logger.error(`pmset rawlog process error: ${error}`);
    });
  }

  public stopPmsetRawlogMonitoring(): void {
    if (this.pmsetProcess && !this.pmsetProcess.killed) {
      this.pmsetProcess.kill("SIGTERM");
      this.pmsetProcess = undefined;
    }
  }

  private parsePmsetRawlogLine(line: string): BatteryInfo | null {
    return parsePmsetRawlogLine(line);
  }
}
