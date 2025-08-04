import { describe, expect, test } from "bun:test";
import { parsePmsetRawlogLine } from "./battery-parser.ts";

describe("MacOS Power Agent", () => {
  describe("parsePmsetRawlogLine", () => {
    test("should parse battery line with AC power", () => {
      const line =
        " AC; Charging; 85%; Cap=85: FCC=100; Design=8694; Time=1:23; 1500mA; Cycles=245/1000; Location=0;";
      const result = parsePmsetRawlogLine(line);

      expect(result).toEqual({
        isCharging: true,
        batteryLevel: 85,
        timeRemainingToEmpty: -1,
        timeRemainingToFull: 83, // 1 hour 23 minutes = 83 minutes
        powerSource: "AC",
        cycleCount: 245,
        condition: "Good",
      });
    });

    test("should parse battery line without AC power", () => {
      const line =
        " No AC; Not Charging; 97%; Cap=97: FCC=100; Design=8694; Time=5:02; -1250mA; Cycles=489/1000; Location=0;";
      const result = parsePmsetRawlogLine(line);

      expect(result).toEqual({
        isCharging: false,
        batteryLevel: 97,
        timeRemainingToEmpty: 302, // 5 hours 2 minutes = 302 minutes
        timeRemainingToFull: -1,
        powerSource: "Battery",
        cycleCount: 489,
        condition: "Good",
      });
    });

    test("should parse battery line with charging status", () => {
      const line =
        " AC; Charging; 45%; Cap=45: FCC=100; Design=8694; Time=2:15; 2000mA; Cycles=123/1000; Location=0;";
      const result = parsePmsetRawlogLine(line);

      expect(result).toEqual({
        isCharging: true,
        batteryLevel: 45,
        timeRemainingToEmpty: -1,
        timeRemainingToFull: 135, // 2 hours 15 minutes = 135 minutes
        powerSource: "AC",
        cycleCount: 123,
        condition: "Good",
      });
    });

    test("should parse battery line with charged status", () => {
      const line =
        " AC; Charged; 100%; Cap=100: FCC=100; Design=8694; Time=0:00; 0mA; Cycles=567/1000; Location=0;";
      const result = parsePmsetRawlogLine(line);

      expect(result).toEqual({
        isCharging: false, // "Charged" is not "Charging"
        batteryLevel: 100,
        timeRemainingToEmpty: -1,
        timeRemainingToFull: -1, // No time remaining when fully charged
        powerSource: "AC",
        cycleCount: 567,
        condition: "Good",
      });
    });

    test("should return null for invalid lines", () => {
      expect(parsePmsetRawlogLine("")).toBe(null);
      expect(
        parsePmsetRawlogLine(
          "pmset is in RAW logging mode now. Hit ctrl-c to exit."
        )
      ).toBe(null);
      expect(parsePmsetRawlogLine("08/02/2025 09:31:02")).toBe(null);
      expect(parsePmsetRawlogLine("* Battery matched at registry = 5931")).toBe(
        null
      );
    });

    test("should handle missing time information", () => {
      const line =
        " No AC; Not Charging; 50%; Cap=50: FCC=100; Design=8694; Cycles=300/1000; Location=0;";
      const result = parsePmsetRawlogLine(line);

      expect(result).toEqual({
        isCharging: false,
        batteryLevel: 50,
        timeRemainingToEmpty: -1, // No time info available
        timeRemainingToFull: -1,
        powerSource: "Battery",
        cycleCount: 300,
        condition: "Good",
      });
    });

    test("should handle edge cases in time parsing", () => {
      const line1 =
        " No AC; Not Charging; 25%; Cap=25: FCC=100; Design=8694; Time=0:05; -500mA; Cycles=100/1000; Location=0;";
      const result1 = parsePmsetRawlogLine(line1);
      expect(result1?.timeRemainingToEmpty).toBe(5); // 5 minutes (not charging)

      const line2 =
        " No AC; Not Charging; 75%; Cap=75: FCC=100; Design=8694; Time=10:00; -800mA; Cycles=200/1000; Location=0;";
      const result2 = parsePmsetRawlogLine(line2);
      expect(result2?.timeRemainingToEmpty).toBe(600); // 10 hours = 600 minutes (not charging)
    });

    test("should handle zero cycle count", () => {
      const line =
        " AC; Charging; 80%; Cap=80: FCC=100; Design=8694; Time=1:00; 1000mA; Cycles=0/1000; Location=0;";
      const result = parsePmsetRawlogLine(line);

      expect(result?.cycleCount).toBe(0);
    });

    test("should handle high cycle counts", () => {
      const line =
        " No AC; Not Charging; 60%; Cap=60: FCC=100; Design=8694; Time=3:30; -600mA; Cycles=999/1000; Location=0;";
      const result = parsePmsetRawlogLine(line);

      expect(result?.cycleCount).toBe(999);
    });

    test("should parse real charging example", () => {
      const line =
        " AC; Charging; 43%; Cap=43: FCC=100; Design=8694; Time=2:01; 4794mA; Cycles=490/1000; Location=0;";
      const result = parsePmsetRawlogLine(line);

      expect(result).toEqual({
        isCharging: true,
        batteryLevel: 43,
        timeRemainingToEmpty: -1,
        timeRemainingToFull: 121, // 2 hours 1 minute = 121 minutes (charging)
        powerSource: "AC",
        cycleCount: 490,
        condition: "Good",
      });
    });
  });
});
