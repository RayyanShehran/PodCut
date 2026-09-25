import { cp, mkdir, readFile, rm } from "node:fs/promises";
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
if (manifest.manifestVersion !== 5 || manifest.host?.app !== "premierepro" || manifest.host?.minVersion !== "25.6.0") throw new Error("Invalid Premiere UXP manifest");
console.log("Built dist/ for Premiere Pro UXP 25.6+.");
