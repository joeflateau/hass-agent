import { createHash } from "node:crypto";
import { readdir, lstat, readFile, readlink, writeFile } from "node:fs/promises";
import { join, posix, resolve } from "node:path";

export async function inventory(root, directory = "") {
  const entries = [];
  for (const name of (await readdir(join(root, directory))).sort()) {
    const path = posix.join(directory, name);
    const absolute = join(root, path);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) {
      const target = await readlink(absolute);
      const resolved = posix.normalize(posix.join(posix.dirname(path), target));
      if (posix.isAbsolute(target) || resolved.startsWith("../") || resolved === "..") throw new Error("Escaping media runtime link");
      entries.push({ path, type: "link", target });
    } else if (stat.isDirectory()) {
      entries.push({ path, type: "directory" });
      entries.push(...await inventory(root, path));
    } else if (stat.isFile()) {
      entries.push({ path, type: "file", executable: Boolean(stat.mode & 0o111), sha256: createHash("sha256").update(await readFile(absolute)).digest("hex") });
    } else throw new Error("Unexpected media runtime entry");
  }
  return entries;
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const root = resolve(process.argv[2] ?? "dist/media-runtime");
  await writeFile(resolve(root, "../media-manifest.json"), JSON.stringify(await inventory(root), null, 2) + "\n");
}
