import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { executeCommand } from "./command-utils.ts";

// Integration tests for executeCommand utility
// These tests run actual commands to verify the utility works correctly
describe("executeCommand", () => {
  beforeEach(() => {
    // Ensure no mocks are active for these integration tests
    // These tests need to run actual commands
    mock.restore();
  });

  afterEach(() => {
    // Restore mocks after each test to not interfere with other tests
    mock.restore();
  });
  test("should execute a simple echo command", async () => {
    const result = await executeCommand("echo 'test'");
    expect(result).toBe("test");
  });

  test("should handle command failures", async () => {
    await expect(executeCommand("exit 1")).rejects.toThrow(
      "Command failed with code 1"
    );
  });

  test("should trim output correctly", async () => {
    const result = await executeCommand("printf '  hello  '");
    expect(result).toBe("hello");
  });

  test("should work with spawn options", async () => {
    const result = await executeCommand("basename $(pwd)", { cwd: "/tmp" });
    expect(result).toBe("tmp");
  });

  test("should handle stderr output in error messages", async () => {
    await expect(
      executeCommand("echo 'error message' >&2; exit 1")
    ).rejects.toThrow("error message");
  });
});
