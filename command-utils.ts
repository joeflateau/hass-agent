import { spawn, type SpawnOptions } from "child_process";

/**
 * Executes a shell command and returns the output as a string.
 *
 * @param command - The shell command to execute
 * @param options - Optional spawn options for the child process
 * @returns Promise that resolves to the command output (trimmed) or rejects with an error
 */
export async function executeCommand(
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
