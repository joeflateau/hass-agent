import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, posix } from "node:path";
import { getAsset, isSea } from "node:sea";
import { runBounded } from "./process.ts";

export type RuntimeEntry = { path: string } & (
  { type: "file"; sha256: string; executable: boolean } |
  { type: "link"; target: string } | { type: "directory" });
declare const MEDIA_MANIFEST: RuntimeEntry[];
const digest = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

export async function verifyRuntime(root: string, entries: RuntimeEntry[]): Promise<void> {
  const paths: string[] = [];
  const resolvedRoot = await realpath(root);
  async function walk(directory: string) {
    for (const name of await readdir(join(root, directory))) {
      const path = posix.join(directory, name);
      paths.push(path);
      if ((await lstat(join(root, path))).isDirectory()) await walk(path);
    }
  }
  if (!(await lstat(root)).isDirectory()) throw new Error("Invalid media runtime root");
  await walk("");
  if (JSON.stringify(paths.sort()) !== JSON.stringify(entries.map(e => e.path).sort())) throw new Error("Incomplete media runtime inventory");
  for (const entry of entries) {
    if (!entry.path || entry.path.startsWith("/") || entry.path.split("/").some(p => p === ".." || p === "." || !p)) throw new Error("Unsafe media runtime path");
    const path = join(root, entry.path);
    const stat = await lstat(path);
    if (stat.uid !== process.getuid?.() || (!stat.isSymbolicLink() && (stat.mode & 0o077) !== 0)) throw new Error("Media runtime must be private and user-owned");
    if (entry.type === "directory") {
      if (!stat.isDirectory()) throw new Error("Invalid media directory");
    } else if (entry.type === "link") {
      const resolved = posix.normalize(posix.join(posix.dirname(entry.path), entry.target));
      if (posix.isAbsolute(entry.target) || resolved.startsWith("../") || resolved === ".." || !stat.isSymbolicLink() || await readlink(path) !== entry.target) throw new Error("Invalid media link");
      if (!(await realpath(path)).startsWith(resolvedRoot + "/")) throw new Error("Escaping media link");
    } else if (!stat.isFile() || digest(await readFile(path)) !== entry.sha256 || Boolean(stat.mode & 0o111) !== entry.executable) throw new Error("Media runtime integrity check failed");
  }
}

/** SEA carries every runtime byte. Immutable content-addressed cache; never trust an old install. */
export async function prepareRuntime(): Promise<string> {
  if (process.platform !== "darwin") throw new Error("Now Playing requires macOS");
  const entries = typeof MEDIA_MANIFEST !== "undefined" ? MEDIA_MANIFEST : JSON.parse(await readFile("dist/media-manifest.json", "utf8")) as RuntimeEntry[];
  if (entries.length < 5) throw new Error("Media runtime was not packaged");
  const root = join(homedir(), "Library", "Caches", "hass-agent");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.uid !== process.getuid?.() || (rootStat.mode & 0o077) !== 0) throw new Error("Media cache must be private and owned by current user");
  const destination = join(root, `media-0.7.7-${digest(JSON.stringify(entries))}`);
  try { await lstat(destination); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const staging = await mkdtemp(join(root, ".media-"));
    try {
      for (const entry of entries) {
        const path = join(staging, entry.path);
        if (entry.type === "directory") await mkdir(path, { recursive: true, mode: 0o700 });
        else if (entry.type === "link") await symlink(entry.target, path);
        else {
          await mkdir(dirname(path), { recursive: true, mode: 0o700 });
          const data = isSea() ? Buffer.from(getAsset(`media/${entry.path}`)) : await readFile(join("dist/media-runtime", entry.path));
          await writeFile(path, data, { mode: entry.executable ? 0o700 : 0o600, flag: "wx" });
        }
      }
      await verifyRuntime(staging, entries);
      await runBounded("/usr/bin/codesign", ["--verify", "--deep", "--strict", join(staging, "Frameworks/MediaRemoteAdapter.framework")]);
      await runBounded("/usr/bin/codesign", ["--verify", "--strict", join(staging, "lib/media-control/MediaRemoteAdapterTestClient")]);
      try { await rename(staging, destination); }
      catch (error) { if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
  await verifyRuntime(destination, entries);
  await runBounded("/usr/bin/codesign", ["--verify", "--deep", "--strict", join(destination, "Frameworks/MediaRemoteAdapter.framework")]);
  await runBounded("/usr/bin/codesign", ["--verify", "--strict", join(destination, "lib/media-control/MediaRemoteAdapterTestClient")]);
  return join(destination, "bin/media-control");
}

/** A null result in an unrelated SSH account is NOT a healthy-empty Joe session. */
export async function verifyGuiLogin(signal?: AbortSignal): Promise<void> {
  if (process.platform !== "darwin" || (await lstat("/dev/console")).uid !== process.getuid?.() ||
      (await runBounded("/bin/launchctl", ["managername"], signal)).trim() !== "Aqua") {
    throw new Error("Run music support in the active user's GUI LaunchAgent login");
  }
}
