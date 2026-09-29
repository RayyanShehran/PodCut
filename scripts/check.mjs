import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
const html = await readFile(resolve(root, manifest.main), "utf8");
for (const file of ["src/build-info.js", "src/audio.js", "src/core.js", "src/premiere.js", "src/apply.js", "src/assisted.js", "src/assisted-state.js", "src/main.js", "src/styles.css"]) {
  if (!html.includes(file)) throw new Error(`${file} is not referenced by ${manifest.main}`);
}
if (!(await readFile(resolve(root, "src/apply.js"), "utf8")).includes("const MUTATION_ENABLED = false;"))
  throw new Error("Automatic Apply service lock missing.");
if (!(await readFile(resolve(root, "src/main.js"), "utf8")).includes("const PUBLIC_APPLY_ENABLED = false;"))
  throw new Error("Automatic Apply panel lock missing.");
if (!manifest.entrypoints.some((entry) => entry.type === "panel" && entry.id === "podcutPanel")) throw new Error("PodCut panel entrypoint is missing");
console.log("Manifest and panel references are valid.");
