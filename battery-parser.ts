// Battery parsing utilities for macOS pmset rawlog output

export interface BatteryInfo {
  isCharging: boolean;
  batteryLevel: number;
  timeRemaining: number;
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
    let timeRemaining = -1;
    if (timeMatch?.[1] && timeMatch?.[2]) {
      timeRemaining = parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]);
    }

    // Extract cycle count
    const cycleMatch = line.match(/Cycles=(\d+)\/\d+/);
    const cycleCount = cycleMatch?.[1] ? parseInt(cycleMatch[1]) : 0;

    return {
      isCharging,
      batteryLevel,
      timeRemaining,
      powerSource: hasAC ? "AC" : "Battery",
      cycleCount,
      condition: "Good", // rawlog doesn't provide condition, would need separate call
    };
  } catch (error) {
    return null;
  }
}
