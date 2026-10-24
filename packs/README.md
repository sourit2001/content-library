# Theme packs

## Publishing changes

CDN mirrors cache the `main` branch unevenly, so the plugin downloads pack
files from a pinned commit and reads `index.json` from both jsDelivr and
GitHub, keeping the copy with the highest `revision`. Publish in two commits:

```bash
git add packs && git commit -m "Update packs"     # 1. pack files
python3 scripts/stamp-index.py                     # 2. sets index.json ref + revision
git commit -am "Stamp pack index" && git push      # 3. publish
```

Always bump a pack's `version` when its files change, so installed users see
「更新并使用」.

Each folder here is one theme pack. `index.json` lists every pack the plugin
store shows; the plugin reads it from
`https://cdn.jsdelivr.net/gh/sourit2001/content-library@main/packs/index.json`.

```
packs/<id>/
  pack.json        same object as its entry in index.json
  background.jpg   desktop background (2560×1600 recommended, < 600 KB)
  banner.jpg       home banner (1800×560)
  preview.jpg      store thumbnail (640×400)
```

## Fields

| field | meaning |
| --- | --- |
| `id` | lowercase letters, digits, `-`; also the folder name |
| `version` | bump it whenever files change, so installed users get "更新并使用" |
| `base` | built-in theme that supplies layout CSS; use `glass` for packs with a background |
| `scheme` | `dark` or `light` — native controls and scrollbars |
| `palette.light` / `palette.dark` | CSS values for `ink muted bg card tone-a tone-b tone-c tone-d glass glass-strong accent`; `dark` is optional and merges over `light` in dark mode |
| `overlay` | gradient over the background to keep text readable |
| `backgroundSize` | usually `cover` |
| `annotationHighlight` | `yellow` / `orange` / `blue` / `pink` |
| `swatches` | up to 6 colors shown in the store |
| `premium` | `{ "provider": "gumroad", "productId", "buyUrl", "price" }` — packs sharing a `productId` unlock together |

## Building packs from images

Packs are built from source images (the current set was made with GPT image
generation in the same style as the built-in glass background):

```bash
python3 scripts/build-packs.py "<folder with source images>" packs
```

Requires `pillow`. Edit the `PACKS` list in the script to map each pack to its
background image and optional separate banner image, set its tint hue, name,
and free/premium status. The script resizes backgrounds, crops banners and
previews, and rewrites `index.json` and each `pack.json`. When you change an
existing pack's images, bump its `version` so installed users can update.

## Premium packs

Before release, create a Gumroad product with license keys enabled, then
replace `REPLACE_WITH_GUMROAD_PRODUCT_ID` and the `buyUrl` in `scripts/build-packs.py` (or
directly in `index.json` and each `pack.json`).

Premium images hosted in this public repository can be downloaded by anyone who
finds the URL; the license only gates the in-app one-click install. To protect
them, host premium files elsewhere and check the `X-License-Key` header the
plugin sends with each premium file request.

## Ambient sounds

Premium packs may include `ambient.mp3`, a loop the dashboard plays with a
crossfade (volume control in the top bar; it pauses while a podcast plays).
Place the processed file in the pack folder and rerun the build script — it
adds `"ambient": "ambient.mp3"` automatically. Bump the pack `version` so
installed users can update.

Processing: trim, match loudness to about −24 LUFS, encode MP3 96 kbps stereo.

All current sounds are CC0 (public domain) recordings from Freesound:

| pack | sound | author |
| --- | --- | --- |
| city-lights | [Rain_Hitting_Window_9](https://freesound.org/people/SignatureSoundsOrg/sounds/869851/) | SignatureSoundsOrg |
| rose-dusk | [Ambient Birds Field Evening](https://freesound.org/people/Salom%C3%A9_Lubczanski/sounds/733667/) | Salomé_Lubczanski |
| crimson-city | [Downtown LA, Little Tokyo, late night semi distant traffic](https://freesound.org/people/janbezouska/sounds/330427/) | janbezouska (high/low-passed) |
