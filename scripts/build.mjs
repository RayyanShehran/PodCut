import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await Promise.all([
  cp(resolve(root, "manifest.json"), resolve(dist, "manifest.json")),
  cp(resolve(root, "index.html"), resolve(dist, "index.html")),
  cp(resolve(root, "src"), resolve(dist, "src"), { recursive: true })
]);
const manifest = JSON.parse(await readFile(resolve(dist, "manifest.json"), "utf8"));
if (manifest.manifestVersion !== 5 || manifest.host?.app !== "premierepro" || manifest.host?.minVersion !== "26.5.0") throw new Error("Invalid Premiere UXP manifest");
const html = await readFile(resolve(root, "index.html"), "utf8");
const files = ["index.html", "manifest.json", ...Array.from(html.matchAll(/(?:src|href)="(src\/[^\"]+)"/g), m => m[1])].sort();
const hash = createHash("sha256");
for (const file of files) hash.update(file).update(await readFile(resolve(root, file)));
const identity = `Build ${hash.digest("hex").slice(0, 12)}`;
await writeFile(resolve(dist, "src/build-info.js"), `globalThis.PodCutBuild = ${JSON.stringify(identity)};\n`);
console.log(`Built dist/ for Premiere Pro UXP 26.5+. ${identity}`);
