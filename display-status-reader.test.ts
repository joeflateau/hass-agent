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
import { executeCommand } from "./command-utils.ts";
import { DisplayStatusReader } from "./display-status-reader.ts";

// Mock winston logger
const mockLogger: winston.Logger = {
  debug: mock(() => {}),
  error: mock(() => {}),
  info: mock(() => {}),
  warn: mock(() => {}),
  log: mock(() => {}),
} as any;

describe("DisplayStatusReader", () => {
  let reader: DisplayStatusReader;

  beforeAll(() => {
    // Set up module mocks
    mock.module("./command-utils.ts", () => ({
      executeCommand: mock(),
    }));
  });

  afterAll(() => {
    // Reset all mocks to prevent interference with other test files
    mock.restore();
  });

  beforeEach(() => {
    reader = new DisplayStatusReader(mockLogger);
  });

  afterEach(() => {
    // Reset executeCommand mock after each test
    (executeCommand as any).mockClear();
  });

  describe("getDisplayStatus", () => {
    it("should return off status when no displays found", async () => {
      (executeCommand as any).mockImplementation(async (command: string) => {
        switch (command) {
          case "system_profiler SPDisplaysDataType -json":
            return JSON.stringify({ SPDisplaysDataType: [] });
          case "pmset -g assertions":
            return "No assertions found";
          case "pmset -g ps":
            return "";
          default:
            throw new Error(`Unexpected command: ${command}`);
        }
      });

      const result = await reader.getDisplayStatus();

      expect(result).toEqual({
        status: "off",
        externalDisplayCount: 0,
        builtinDisplayOnline: false,
      });
    });

    it("should detect built-in display online", async () => {
      (executeCommand as any).mockImplementation(async (command: string) => {
        switch (command) {
          case "system_profiler SPDisplaysDataType -json":
            return JSON.stringify({
              SPDisplaysDataType: [
                {
                  spdisplays_ndrvs: [
                    {
                      _name: "Built-in Display",
                      spdisplays_connection_type: "spdisplays_internal",
                      spdisplays_online: "spdisplays_yes",
                      spdisplays_main: "spdisplays_yes",
                    },
                  ],
                },
              ],
            });
          case "pmset -g assertions":
            return "PreventUserIdleDisplaySleep    1";
          case "pmset -g ps":
            return "";
          default:
            throw new Error(`Unexpected command: ${command}`);
        }
      });

      const result = await reader.getDisplayStatus();

      expect(result).toEqual({
        status: "on",
        externalDisplayCount: 0,
        builtinDisplayOnline: true,
      });
    });

    it("should detect external display", async () => {
      (executeCommand as any).mockImplementation(async (command: string) => {
        switch (command) {
          case "system_profiler SPDisplaysDataType -json":
            return JSON.stringify({
              SPDisplaysDataType: [
                {
                  spdisplays_ndrvs: [
                    {
                      _name: "External Monitor",
                      spdisplays_connection_type: "spdisplays_external",
                      spdisplays_online: "spdisplays_yes",
                      spdisplays_main: "spdisplays_no",
                    },
                  ],
                },
              ],
            });
          case "pmset -g assertions":
            return "No assertions found";
          case "pmset -g ps":
            return "";
          default:
            throw new Error(`Unexpected command: ${command}`);
        }
      });

      const result = await reader.getDisplayStatus();

      expect(result).toEqual({
        status: "external",
        externalDisplayCount: 1,
        builtinDisplayOnline: false,
      });
    });

    it("should handle mixed displays - both internal and external", async () => {
      (executeCommand as any).mockImplementation(async (command: string) => {
        switch (command) {
          case "system_profiler SPDisplaysDataType -json":
            return JSON.stringify({
              SPDisplaysDataType: [
                {
                  spdisplays_ndrvs: [
                    {
                      _name: "Built-in Display",
                      spdisplays_connection_type: "spdisplays_internal",
                      spdisplays_online: "spdisplays_yes",
                      spdisplays_main: "spdisplays_yes",
                    },
                    {
                      _name: "External Monitor",
                      spdisplays_connection_type: "spdisplays_external",
                      spdisplays_online: "spdisplays_yes",
                      spdisplays_main: "spdisplays_no",
                    },
                  ],
                },
              ],
            });
          case "pmset -g assertions":
            return "PreventUserIdleDisplaySleep    1";
          case "pmset -g ps":
            return "";
          default:
            throw new Error(`Unexpected command: ${command}`);
        }
      });

      const result = await reader.getDisplayStatus();

      expect(result).toEqual({
        status: "external",
        externalDisplayCount: 1,
        builtinDisplayOnline: true,
      });
    });

    it("should handle built-in display offline but external display present", async () => {
      (executeCommand as any).mockImplementation(async (command: string) => {
        switch (command) {
          case "system_profiler SPDisplaysDataType -json":
            return JSON.stringify({
              SPDisplaysDataType: [
                {
                  spdisplays_ndrvs: [
                    {
                      _name: "Built-in Display",
                      spdisplays_connection_type: "spdisplays_internal",
                      spdisplays_online: "spdisplays_no",
                      spdisplays_main: "spdisplays_no",
                    },
                    {
                      _name: "External Monitor",
                      spdisplays_connection_type: "spdisplays_external",
                      spdisplays_online: "spdisplays_yes",
                      spdisplays_main: "spdisplays_yes",
                    },
                  ],
                },
              ],
            });
          case "pmset -g assertions":
            return "No assertions found";
          case "pmset -g ps":
            return "";
          default:
            throw new Error(`Unexpected command: ${command}`);
        }
      });

      const result = await reader.getDisplayStatus();

      expect(result).toEqual({
        status: "external",
        externalDisplayCount: 1,
        builtinDisplayOnline: false,
      });
    });

    it("should return off status on command error", async () => {
      (executeCommand as any).mockImplementation(async () => {
        throw new Error("Command failed");
      });

      const result = await reader.getDisplayStatus();

      expect(result).toEqual({
        status: "off",
        externalDisplayCount: 0,
        builtinDisplayOnline: false,
      });
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("getDetailedDisplayInfo", () => {
    it("should return empty array when no displays found", async () => {
      (executeCommand as any).mockImplementation(async () => {
        return JSON.stringify({ SPDisplaysDataType: [] });
      });

      const result = await reader.getDetailedDisplayInfo();

      expect(result).toEqual([]);
    });

    it("should return detailed display information", async () => {
      (executeCommand as any).mockImplementation(async () => {
        return JSON.stringify({
          SPDisplaysDataType: [
            {
              sppci_model: "Apple M1",
              spdisplays_vendor: "sppci_vendor_Apple",
              spdisplays_ndrvs: [
                {
                  _name: "Built-in Retina Display",
                  _spdisplays_displayID: "display1",
                  spdisplays_connection_type: "spdisplays_internal",
                  spdisplays_online: "spdisplays_yes",
                  spdisplays_main: "spdisplays_yes",
                  spdisplays_display_type: "spdisplays_built-in-retina",
                  _spdisplays_resolution: "2560 x 1600",
                  spdisplays_pixelresolution: "spdisplays_2560x1600Retina",
                  "_spdisplays_display-vendor-id": "610",
                  "_spdisplays_display-product-id": "a051",
                  "_spdisplays_display-serial-number": "ABC123",
                  spdisplays_ambient_brightness: "spdisplays_yes",
                  spdisplays_mirror: "spdisplays_off",
                },
              ],
            },
          ],
        });
      });

      const result = await reader.getDetailedDisplayInfo();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "display1",
        name: "Built-in Retina Display",
        internal: true,
        online: true,
        main: true,
        connection_type: "Internal",
        display_type: "Built-in Retina",
        vendor: "Apple",
        gpu_model: "Apple M1",
        resolution: "2560 x 1600",
        pixel_resolution: "2560x1600 (Retina)",
        mirror_status: "independent",
        product_id: "a051",
        vendor_id: "610",
        serial_number: "ABC123",
        ambient_brightness: true,
        vendor_name: "Apple Inc.",
        product_name: "Built-in Retina Display",
      });
    });

    it("should return empty array on command error", async () => {
      (executeCommand as any).mockImplementation(async () => {
        throw new Error("Command failed");
      });

      const result = await reader.getDetailedDisplayInfo();

      expect(result).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});
