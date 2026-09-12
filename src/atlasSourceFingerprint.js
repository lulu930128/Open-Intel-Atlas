import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Hash UTF-8 text with LF normalization at module initialization, not on GET.
// This matches Git's text normalization across Windows and clean checkouts.
// Never include configuration
// secrets, databases, logs, dependencies, or unrelated newsroom/launcher work.
export function sourceFingerprint(rootDir) {
  const walk = (directory) => readdirSync(join(rootDir, directory), { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? walk(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]);
  const paths = [...walk("src"), "package.json", "package-lock.json",
    "public/macro.html", "public/macro.js", "public/macro.css", "public/macroModel.js"].sort();
  const hash = createHash("sha256");
  for (const path of paths) {
    const bytes = Buffer.from(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(join(rootDir, path))).replace(/\r\n/g, "\n"));
    hash.update(`${path}\0${bytes.length}\0`).update(bytes);
  }
  return { algorithm: "sha256-utf8-lf", scope: "atlas-backend-and-macro-ui-v1", file_count: paths.length, digest: hash.digest("hex") };
}
