import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = await mkdtemp(join(tmpdir(), "podcut-host-panel-"));
await cp(resolve(root, "dist"), output, { recursive: true });

const manifestPath = join(output, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.id = "com.rayyanshehran.podcut.hostpaneltest";
manifest.name = "PodCut Host Panel TEST";
manifest.entrypoints[0].label.default = "PodCut Host Panel TEST";
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

const mainPath = join(output, "src", "main.js");
let main = await readFile(mainPath, "utf8");
const locked = "const PUBLIC_APPLY_ENABLED = false; // Playback validation has not passed; keep the production action gated.";
const prepared = "      readyApply = prepared;";
assert.equal(main.split(locked).length, 2, "Expected one locked production gate");
assert.equal(main.split(prepared).length, 2, "Expected one panel preflight assignment");
main = main.replace(locked, "const PUBLIC_APPLY_ENABLED = true; // Isolated, non-shipping host-panel test build only.");
const allowedPath = "c:\\projects\\podcut-testmedia\\fixtures\\podcut service validation 2026-09-27.prproj";
main = main.replace(prepared, `      if (prepared.current.source.projectId !== "f3ef41d2-0ff3-4399-ab4c-49e224a80d60" ||
          prepared.current.source.sequenceId !== "26e7778b-770f-4bcd-936a-23a5a4332714" ||
          !prepared.current.source.projectPath?.toLowerCase().endsWith(${JSON.stringify(allowedPath)}))
        throw new Error("Host-panel test build only accepts the disposable fixture project and original sequence.");
${prepared}`);
await writeFile(mainPath, main);
console.log(output);
