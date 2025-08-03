import { spawn, type SpawnOptions } from "child_process";
import * as winston from "winston";

// Display status interface
export interface DisplayInfo {
  status: "on" | "off" | "external";
  externalDisplayCount: number;
  builtinDisplayOnline: boolean;
}

export class DisplayStatusReader {
  private logger: winston.Logger;

  constructor(logger: winston.Logger) {
    this.logger = logger;
  }

  public async getDisplayStatus(): Promise<DisplayInfo> {
    try {
      // Check external displays using system_profiler with better parsing
      const displayOutput = await this.executeCommand(
        "system_profiler SPDisplaysDataType -json"
      );
      const displayData = JSON.parse(displayOutput);

      let externalDisplayCount = 0;
      let builtinDisplayOnline = false;
      const displayDetails: any[] = [];

      if (
        displayData.SPDisplaysDataType &&
        displayData.SPDisplaysDataType.length > 0
      ) {
        for (const gpu of displayData.SPDisplaysDataType) {
          if (gpu.spdisplays_ndrvs) {
            for (const display of gpu.spdisplays_ndrvs) {
              const isInternal =
                display.spdisplays_connection_type === "spdisplays_internal";
              const isOnline = display.spdisplays_online === "spdisplays_yes";
              const isMain = display.spdisplays_main === "spdisplays_yes";

              // Collect display info for debugging with enhanced data
              displayDetails.push({
                name: display._name || "Unknown",
                internal: isInternal,
                online: isOnline,
                main: isMain,
                connection: this.parseConnectionType(
                  display.spdisplays_connection_type
                ),
                resolution:
                  display._spdisplays_resolution ||
                  display.spdisplays_pixelresolution ||
                  "Unknown",
                type: this.parseDisplayType(display.spdisplays_display_type),
              });

              if (isInternal) {
                builtinDisplayOnline = isOnline;
              } else if (isOnline) {
                // External display that's online
                externalDisplayCount++;
              }
            }
          }
        }
      }

      // Check display sleep status using multiple methods for better accuracy
      const [assertionsOutput, caffeineateOutput] = await Promise.allSettled([
        this.executeCommand("pmset -g assertions"),
        this.executeCommand("pmset -g ps").catch(() => ""), // Fallback if command fails
      ]);

      const assertions =
        assertionsOutput.status === "fulfilled" ? assertionsOutput.value : "";
      const preventDisplaySleep =
        assertions.includes("PreventUserIdleDisplaySleep    1") ||
        assertions.includes("InternalPreventDisplaySleep    1") ||
        assertions.includes("PreventSystemSleep    1");

      // Determine display status with more sophisticated logic
      let status: "on" | "off" | "external";
      if (externalDisplayCount > 0) {
        status = "external";
      } else if (builtinDisplayOnline) {
        // Built-in display is connected, check if it's actually active
        status = preventDisplaySleep ? "on" : "off";
      } else {
        status = "off";
      }

      this.logger.debug(
        `Display detection: ${displayDetails.length} displays found, external: ${externalDisplayCount}, builtin online: ${builtinDisplayOnline}, status: ${status}`
      );

      return {
        status,
        externalDisplayCount,
        builtinDisplayOnline,
      };
    } catch (error) {
      this.logger.error(`Error getting display status: ${error}`);
      return {
        status: "off",
        externalDisplayCount: 0,
        builtinDisplayOnline: false,
      };
    }
  }

  public async getDetailedDisplayInfo(): Promise<any[]> {
    try {
      const displayOutput = await this.executeCommand(
        "system_profiler SPDisplaysDataType -json"
      );
      const displayData = JSON.parse(displayOutput);
      const displayDetails: any[] = [];

      if (
        displayData.SPDisplaysDataType &&
        displayData.SPDisplaysDataType.length > 0
      ) {
        for (const gpu of displayData.SPDisplaysDataType) {
          if (gpu.spdisplays_ndrvs) {
            for (const display of gpu.spdisplays_ndrvs) {
              const isInternal =
                display.spdisplays_connection_type === "spdisplays_internal";
              const isOnline = display.spdisplays_online === "spdisplays_yes";
              const isMain = display.spdisplays_main === "spdisplays_yes";

              // Parse display type to be more human readable
              const displayType = this.parseDisplayType(
                display.spdisplays_display_type
              );

              // Parse vendor from GPU info if available
              const vendor = this.parseVendor(
                gpu.spdisplays_vendor,
                gpu.sppci_model
              );

              // Parse resolution information
              const resolution =
                display._spdisplays_resolution ||
                display.spdisplays_pixelresolution ||
                "Unknown";
              const nativePixels = display._spdisplays_pixels || "Unknown";

              displayDetails.push({
                id: display._spdisplays_displayID || "unknown",
                name: display._name || "Unknown Display",
                internal: isInternal,
                online: isOnline,
                main: isMain,
                connection_type: this.parseConnectionType(
                  display.spdisplays_connection_type
                ),
                display_type: displayType,
                vendor: vendor,
                gpu_model: gpu.sppci_model || gpu._name || "Unknown",
                resolution: resolution,
                native_pixels: nativePixels,
                pixel_resolution: this.parsePixelResolution(
                  display.spdisplays_pixelresolution || ""
                ),
                mirror_status:
                  display.spdisplays_mirror === "spdisplays_on"
                    ? "mirrored"
                    : "independent",
                product_id:
                  display["_spdisplays_display-product-id"] || "unknown",
                vendor_id:
                  display["_spdisplays_display-vendor-id"] || "unknown",
                serial_number:
                  display["_spdisplays_display-serial-number"] || "unknown",
                ambient_brightness:
                  display.spdisplays_ambient_brightness === "spdisplays_yes",
                // Enhanced readable IDs
                vendor_name: this.parseVendorId(
                  display["_spdisplays_display-vendor-id"] || ""
                ),
                product_name: this.parseProductId(
                  display["_spdisplays_display-product-id"] || "",
                  display["_spdisplays_display-vendor-id"] || ""
                ),
              });
            }
          }
        }
      }

      return displayDetails;
    } catch (error) {
      this.logger.error(`Error getting detailed display info: ${error}`);
      return [];
    }
  }

  private async executeCommand(
    command: string,
    options?: SpawnOptions
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("sh", ["-c", command], { ...options });
      let output = "";
      let error = "";

      child.stdout?.on("data", (data) => {
        output += data.toString();
      });

      child.stderr?.on("data", (data) => {
        error += data.toString();
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(`Command failed with code ${code}: ${error}`));
        }
      });

      child.on("error", (err) => {
        reject(err);
      });
    });
  }

  private parseDisplayType(type: string): string {
    if (!type) return "Unknown";

    const typeMap: { [key: string]: string } = {
      "spdisplays_built-in-liquid-retina-xdr": "Built-in Liquid Retina XDR",
      "spdisplays_built-in-retina": "Built-in Retina",
      "spdisplays_built-in-liquid-retina": "Built-in Liquid Retina",
      spdisplays_lcd: "LCD",
      spdisplays_external: "External Display",
      spdisplays_projector: "Projector",
    };

    return (
      typeMap[type] ||
      type
        .replace("spdisplays_", "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase())
    );
  }

  private parseVendor(vendorField: string, modelField: string): string {
    if (modelField && modelField.includes("Apple")) return "Apple";
    if (vendorField) {
      const vendorMap: { [key: string]: string } = {
        sppci_vendor_Apple: "Apple",
        sppci_vendor_AMD: "AMD",
        sppci_vendor_NVIDIA: "NVIDIA",
        sppci_vendor_Intel: "Intel",
      };
      if (vendorMap[vendorField]) return vendorMap[vendorField];
      // Extract vendor name from field
      const match = vendorField.match(/sppci_vendor_(.+)/);
      if (match && match[1]) return match[1];
    }
    return "Unknown";
  }

  private parseConnectionType(connectionType: string): string {
    if (!connectionType) return "Unknown";

    const connectionMap: { [key: string]: string } = {
      spdisplays_internal: "Internal",
      spdisplays_external: "External",
      spdisplays_thunderbolt: "Thunderbolt",
      spdisplays_usb: "USB",
      spdisplays_hdmi: "HDMI",
      spdisplays_displayport: "DisplayPort",
      spdisplays_dvi: "DVI",
      spdisplays_vga: "VGA",
    };

    return (
      connectionMap[connectionType] ||
      connectionType
        .replace("spdisplays_", "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase())
    );
  }

  private parsePixelResolution(pixelRes: string): string {
    if (!pixelRes) return "Unknown";

    // Handle formats like "spdisplays_3456x2234Retina"
    const match = pixelRes.match(/spdisplays_(\d+x\d+)(.*)/);
    if (match && match[1]) {
      const resolution = match[1];
      const extra = match[2] || "";
      if (extra.toLowerCase().includes("retina")) {
        return `${resolution} (Retina)`;
      }
      return resolution;
    }

    return pixelRes.replace("spdisplays_", "");
  }

  private parseVendorId(vendorId: string): string {
    if (!vendorId || vendorId === "unknown") return vendorId;

    // Convert hex to decimal and look up known vendor IDs
    const vendorMap: { [key: string]: string } = {
      "610": "Apple Inc.",
      "1002": "AMD",
      "10de": "NVIDIA Corporation",
      "8086": "Intel Corporation",
      "5e3": "Samsung",
      "4dd": "LG Display",
      "6b3": "BOE Technology",
    };

    // Also try the hex value
    const hexValue = parseInt(vendorId, 16).toString(16);

    return (
      vendorMap[vendorId] || vendorMap[hexValue] || `Vendor ID: ${vendorId}`
    );
  }

  private parseProductId(productId: string, vendorId: string): string {
    if (!productId || productId === "unknown") return productId;

    // Known Apple product IDs
    if (vendorId === "610") {
      const appleProducts: { [key: string]: string } = {
        a050: "Built-in Liquid Retina XDR Display",
        a051: "Built-in Retina Display",
        a052: "Built-in Display",
        a030: "MacBook Pro Display",
        a028: "MacBook Air Display",
      };

      if (appleProducts[productId]) {
        return appleProducts[productId];
      }
    }

    return `Product ID: ${productId}`;
  }
}
