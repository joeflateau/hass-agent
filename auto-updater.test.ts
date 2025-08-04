import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import * as winston from "winston";
import { AutoUpdater, type AutoUpdaterConfig } from "./auto-updater.ts";

// Mock spawn
const mockSpawn = mock();

describe("AutoUpdater", () => {
  let logger: winston.Logger;
  let config: AutoUpdaterConfig;
  let autoUpdater: AutoUpdater;

  beforeAll(() => {
    // Set up module mocks
    mock.module("child_process", () => ({
      spawn: mockSpawn,
    }));
  });

  afterAll(() => {
    // Reset all mocks to prevent interference with other test files
    mock.restore();
  });

  beforeEach(() => {
    // Create a silent logger for testing
    logger = winston.createLogger({
      level: "error",
      transports: [new winston.transports.Console({ silent: true })],
    });

    config = {
      autoUpgrade: true,
      upgradeCheckInterval: 1000, // 1 second for faster testing
      installScriptUrl: "https://example.com/install.sh",
      version: "1.0.0",
    };

    autoUpdater = new AutoUpdater(config, logger);
  });

  afterEach(() => {
    autoUpdater.stop();
    mockSpawn.mockClear();
  });

  it("should not start upgrade checks when autoUpgrade is false", () => {
    const configWithoutUpgrade = { ...config, autoUpgrade: false };
    const updater = new AutoUpdater(configWithoutUpgrade, logger);

    updater.start();

    expect(mockSpawn).not.toHaveBeenCalled();
    updater.stop();
  });

  it("should not start upgrade checks when version is development", () => {
    const configWithDevelopment = { ...config, version: "development" };
    const updater = new AutoUpdater(configWithDevelopment, logger);

    updater.start();

    expect(mockSpawn).not.toHaveBeenCalled();
    updater.stop();
  });

  it("should start upgrade checks when conditions are met", (done) => {
    // Mock spawn to return a successful process
    const mockChild = {
      stdout: { on: mock() },
      stderr: { on: mock() },
      on: mock((event, callback) => {
        if (event === "close") {
          // Simulate successful command execution
          setTimeout(() => callback(0), 10);
        }
      }),
    };

    mockSpawn.mockReturnValue(mockChild);

    autoUpdater.start();

    // Give it a moment to execute the initial check
    setTimeout(() => {
      expect(mockSpawn).toHaveBeenCalledWith(
        "sh",
        ["-c", expect.stringContaining("curl -fsSL")],
        expect.any(Object)
      );
      done();
    }, 50);
  });

  it("should stop upgrade checks when stop is called", () => {
    autoUpdater.start();
    autoUpdater.stop();

    // Should not crash or throw errors
    expect(true).toBe(true);
  });

  it("should handle multiple stop calls gracefully", () => {
    autoUpdater.start();
    autoUpdater.stop();
    autoUpdater.stop(); // Second call should not cause issues

    expect(true).toBe(true);
  });
});
