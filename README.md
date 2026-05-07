# ME Notes for Marinara Engine

Tiny floating notes for people whose AI relationship continuity has more moving parts than a 200-episode anime.

ME Notes adds a compact, movable notepad to Marinara Engine chats. It's for tracking character lore, branch timelines, date plans, emotional continuity, "don't forget this promise," and all the other high-priority waifu logistics that deserve their own little command center.

## What It Does

- Adds a **Notes** launcher inside Marinara chats.
- Saves notes **locally in your browser** with autosave.
- Lets you create tabs scoped to:
  - **Global**: visible in every chat.
  - **Character**: visible in chats with that character.
  - **Chat**: visible only in the current chat.
  - **Branch-wide**: shared across all branches in the current chat family.
- Supports renameable, draggable tabs grouped by scope.
- Includes simple Markdown editing and preview.
- Supports bold, italic, underline, strikethrough, bullets, and checklists.
- Can export/import a JSON backup of your notepad data.
- Does **not** automatically send your notes to the AI.

## Download

Download `ME-Notes.extension.json` from the latest GitHub Release.

Chuck that bad boy into the Import Extension section in Marinara Engine.

For fancy tech wizards - If you're looking at the source code instead of a release, run the build script first:

```bash
node scripts/build-extension.mjs
```

That creates or refreshes `ME-Notes.extension.json` in the repo root.

## Install

1. Open Marinara Engine.
2. Go to `Settings -> Extensions`.
3. Click `Import Extension`.
4. Select `ME-Notes.extension.json`.
5. Open a chat and click `Notes`.

That's it! Your continuity board is online. Canon may now be color-coded inside your brain.

## How To Use

Click `+` to create a new tab. Pick the scope based on where you want the note to appear:

- Use **Global** for personal rules, general RP preferences, or recurring reminders.
- Use **Character** for facts about one character across multiple chats.
- Use **Chat** for one specific conversation.
- Use **Branch-wide** when one timeline needs its own receipts.

Double-click the active tab title to rename it. Drag tabs within their row to reorder them. Use the edit/preview toggle to switch between writing Markdown and seeing the polished version.

The `...` menu has backup, restore, layout reset, and delete-tab actions.

## Privacy

Your notes live in browser `localStorage` under Marinara's site data. They're NOT uploaded by this extension, NOT synced by this extension, and NOT injected into the model prompt.

Translation: this is your private lore notebook. Your AI only knows what you actually put in chat.

Before clearing browser data or moving computers, use `Export backup` or you will be a very sad panda.

## Development

Edit the readable source files:

```text
src/extension.js
src/style.css
```

Then rebuild the importable extension:

```bash
node scripts/build-extension.mjs
```

The generated file is:

```text
ME-Notes.extension.json
```

## License

AGPL-3.0. See `LICENSE`.
