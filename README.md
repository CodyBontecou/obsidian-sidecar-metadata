# Sidecar Metadata – Obsidian Plugin

Automatically create and manage **sidecar `.md` files** for every non-markdown asset in your vault (images, PDFs, videos, etc.). Each sidecar contains YAML frontmatter so you can tag, describe, and search your binary files just like regular notes.

## Features

| Feature | Description |
|---|---|
| **Auto-create sidecar** | When a non-`.md` file is added to a watched folder, a companion `<filename>.md` is created with a frontmatter template. |
| **Auto-open in split pane** | Opening an image/PDF/etc. automatically opens its sidecar note beside it. |
| **Rename / move tracking** | When you rename or move a source file, the sidecar follows and its `source` frontmatter is updated. |
| **Auto-delete** | Optionally delete the sidecar when its source file is deleted. |
| **Bulk-create** | One command to generate sidecars for every existing non-md file that doesn't have one yet. |
| **Customizable template** | Full control over the YAML frontmatter and body of new sidecars. |
| **Watched folders** | Scope the plugin to specific folders or let it watch the entire vault. |

## Installation

### From Community Plugins

1. Open **Settings → Community Plugins → Browse**
2. Search for "Sidecar Metadata"
3. Click **Install**, then **Enable**

### From source (manual)

```bash
# Clone / copy this folder into your vault's plugin directory:
#   <vault>/.obsidian/plugins/obsidian-sidecar-metadata/

cd <vault>/.obsidian/plugins/obsidian-sidecar-metadata
npm install
npm run build
```

Then restart Obsidian and enable **Sidecar Metadata** under *Settings → Community plugins*.

### BRAT (recommended for beta testing)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) community plugin.
2. Add this repository URL via BRAT's *Add Beta Plugin*.

## Usage

### Commands (open the Command Palette – `Ctrl/Cmd + P`)

| Command | Description |
|---|---|
| **Create sidecar for current file** | Generates a sidecar `.md` for the file active in the current pane. |
| **Bulk-create sidecars for all non-md files without one** | Scans watched folders and creates missing sidecars in one shot. |

### Settings

Open *Settings → Sidecar Metadata* to configure:

- **Sidecar naming pattern** – default `{{filename}}.md` (e.g. `photo.png` → `photo.png.md`).
- **Watched folders** – comma-separated folder paths, or leave empty for the whole vault.
- **Sidecar template** – the full content written to new sidecars. Supports variables:
  - `{{filename}}` – original file name with extension
  - `{{filepath}}` – vault-relative path of the source file
  - `{{date}}` – creation date (`YYYY-MM-DD`)
  - `{{extension}}` – file extension (e.g. `png`)
- **Auto-create on new file** – toggle on/off.
- **Auto-open sidecar** – toggle on/off.
- **Auto-delete sidecar** – toggle on/off.

### Default sidecar template

```yaml
---
tags: []
description: ""
source: "{{filepath}}"
created: "{{date}}"
---

# {{filename}}
```

## Development

```bash
npm install
npm run dev    # watch mode (development)
npm run build  # production build
```

The build produces `main.js` in the project root, which Obsidian loads directly.

## License

MIT
