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

## Getting started

You do not need to create any special folder names before installing the plugin.
Choose any existing Vault folder from the plugin settings.

1. Install and enable **Content Library Dashboard**.
2. Open **Settings → Community plugins → Content Library Dashboard**.
3. Under **My folders**, click **Add folder**.
4. Choose a folder, then set its display name and category.

The display name is independent from the real Vault path. For example,
`Inbox/Podcast Notes` can be shown as `播客` without moving or renaming files.

### Images and covers

Images are optional. Without a cover, the dashboard uses its built-in glass
placeholder. Covers can come from note frontmatter (`cover`, `coverPath`,
`image`, or `thumbnail`), a content card's menu, or the banner setting.

Imported images are stored in `Content Library Assets/Banners` or
`Content Library Assets/Covers` inside the Vault. These folders are created only
when you import an image.

The default annotation folder is `Dashboard Notes`. It is created only when the
plugin first saves a reading annotation or audio note, and can be changed in
settings. The plugin does not create sample content or copy your library.

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
