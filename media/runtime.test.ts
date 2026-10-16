import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyRuntime, type RuntimeEntry } from "./runtime.ts";
const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
describe("complete pinned runtime inventory", () => {
  it("retains internal framework links but detects missing/extra/changed files and escaping links", async () => {
    const root = await mkdtemp(join(tmpdir(), "hass-media-test-")); directories.push(root);
    await mkdir(join(root, "lib"), { mode: 0o700 });
    await writeFile(join(root, "lib/helper"), "pinned", { mode: 0o700 });
    await symlink("lib/helper", join(root, "helper"));
    const entries: RuntimeEntry[] = [{ path: "lib", type: "directory" },
      { path: "lib/helper", type: "file", executable: true, sha256: createHash("sha256").update("pinned").digest("hex") },
      { path: "helper", type: "link", target: "lib/helper" }];
    await expect(verifyRuntime(root, entries)).resolves.toBeUndefined();
    await expect(verifyRuntime(root, entries.slice(1))).rejects.toThrow("inventory");
    await expect(verifyRuntime(root, [...entries, { path: "missing", type: "directory" }])).rejects.toThrow("inventory");
    await writeFile(join(root, "lib/helper"), "tampered");
    await expect(verifyRuntime(root, entries)).rejects.toThrow("integrity");
    await rm(join(root, "helper")); await symlink("../escape", join(root, "helper"));
    await expect(verifyRuntime(root, [{ ...entries[2]!, type: "link", target: "../escape" }, ...entries.slice(0, 2)])).rejects.toThrow("link");
  });
});
