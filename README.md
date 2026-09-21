# Content Library Dashboard

An independent Obsidian dashboard for books, podcasts, web clips, X briefs, custom news, and any folder in a Vault.

## What it does

- Three-column liquid-glass layout on desktop and a compact single-column mobile layout.
- Auto-detects common content folders without moving or duplicating notes.
- Supports five color styles: grass, blue, pink, rose, and black.
- Uses frontmatter such as `title`, `author`, `cover`, `source`, `audio`, and `progress` when available.
- Opens Markdown inside a focused reading view.
- Opens Weave EPUB Reader and VaultCast through their Obsidian commands when installed.
- Plays linked local MP3, M4A, WAV, FLAC, and AAC files.
- Writes reading annotations and podcast moments back to ordinary Markdown notes.
- Lets every source folder and content item use a local or remote custom cover.

## Development

```bash
npm install
npm run check
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` into:

```text
<Vault>/.obsidian/plugins/content-library-dashboard/
```

Enable **Content Library Dashboard** in Obsidian, then run **Open content library dashboard** from the command palette.

## Data model

Vault files remain the source of truth. Plugin preferences are stored in the plugin's `data.json`; generated annotations are stored in the configurable `Dashboard Notes` folder. The plugin never copies the user's library into a private database.

## Status

Version `0.1.0` is the first local development build. A GitHub repository and release will be created only after live Obsidian verification.
