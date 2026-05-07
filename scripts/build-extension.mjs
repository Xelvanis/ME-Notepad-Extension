import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const manifest = {
  name: "Local Chat Notepad",
  description:
    "Adds a compact, movable, resizable browser-local notepad to Marinara Engine chats. Tabs are grouped by scope as numbered draggable bubbles, created as global/character/chat/branch notes, only shown when relevant, and can be renamed from the active tab details. Includes Markdown preview, formatting helpers, layout reset, backup, restore, and tab deletion.",
  css: await readFile(path.join(repoRoot, "src", "style.css"), "utf8"),
  js: await readFile(path.join(repoRoot, "src", "extension.js"), "utf8"),
};

await writeFile(path.join(repoRoot, "local-chat-notepad.extension.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log("Built local-chat-notepad.extension.json");
