// Battery parsing utilities for macOS pmset rawlog output

export interface BatteryInfo {
  isCharging: boolean;
  batteryLevel: number;
  timeRemainingToEmpty: number; // Time remaining until battery depletes (when discharging)
  timeRemainingToFull: number; // Time remaining until fully charged (when charging)
  powerSource: string;
  cycleCount: number;
  condition: string;
}

export function parsePmsetRawlogLine(line: string): BatteryInfo | null {
  try {
    // Parse lines like: " No AC; Not Charging; 97%; Cap=97: FCC=100; Design=8694; Time=5:02; -1250mA; Cycles=489/1000; Location=0;"
    if (!line.includes(";") || !line.includes("%")) {
      return null;
    }

    // Extract AC power status
    const hasAC = !line.includes("No AC");

    // Extract charging status
    const chargingMatch = line.match(/(Not Charging|Charging|Charged)/);
    const chargingStatus = chargingMatch ? chargingMatch[1] : "Unknown";
    const isCharging = chargingStatus === "Charging";

    // Extract battery percentage
    const percentMatch = line.match(/(\d+)%/);
    const batteryLevel = percentMatch?.[1] ? parseInt(percentMatch[1]) : 0;

    // Extract time remaining
    const timeMatch = line.match(/Time=(\d+):(\d+)/);
    let timeRemainingMinutes = -1;
    if (timeMatch?.[1] && timeMatch?.[2]) {
      timeRemainingMinutes =
        parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]);
    }

    // Determine which time field to populate based on charging state
    let timeRemainingToEmpty = -1;
    let timeRemainingToFull = -1;

    if (timeRemainingMinutes > 0) {
      // Changed from >= 0 to > 0
      if (isCharging) {
        timeRemainingToFull = timeRemainingMinutes;
      } else {
        timeRemainingToEmpty = timeRemainingMinutes;
      }
    }

    // Extract cycle count
    const cycleMatch = line.match(/Cycles=(\d+)\/\d+/);
    const cycleCount = cycleMatch?.[1] ? parseInt(cycleMatch[1]) : 0;

    return {
      isCharging,
      batteryLevel,
      timeRemainingToEmpty,
      timeRemainingToFull,
      powerSource: hasAC ? "AC" : "Battery",
      cycleCount,
      condition: "Good", // rawlog doesn't provide condition, would need separate call
    };
  } catch (error) {
    return null;
  }
}
