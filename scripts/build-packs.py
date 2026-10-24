"""Build theme packs from source images.

Usage: python3 scripts/build-packs.py <source-image-folder> packs

Each entry in PACKS names its background image (and optionally a separate
banner image) inside the source folder. The script writes background.jpg,
banner.jpg, preview.jpg and pack.json for every pack, plus packs/index.json.
"""
import json, os, sys
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
BG_MAX_W = 2400          # backgrounds are stored at most this wide
BANNER_W, BANNER_H = 1800, 560
PREVIEW_W, PREVIEW_H = 640, 400
AUTHOR = "Li Zhu"
PREMIUM = {
    "provider": "gumroad",
    "productId": "REPLACE_WITH_GUMROAD_PRODUCT_ID",
    "buyUrl": "https://gumroad.com/l/REPLACE_ME",
    "price": "¥18",
    "freeUntil": "2026-11-07T23:59:59+08:00",  # limited-time free; remove or change to end the promo
}


def glass_palette(h, chroma=0.04, ink_h=None, accent_c=0.12):
    """Light-ink glass palette tinted with hue h (same structure as the built-in glass theme)."""
    ih = h if ink_h is None else ink_h
    return {
        "ink": f"oklch(97% 0.01 {ih})",
        "bg": f"oklch(16% {chroma:.3f} {h} / 58%)",
        "card": f"oklch(30% {chroma:.3f} {h} / 44%)",
        "tone-a": f"oklch(80% {chroma * 2.2:.3f} {h})",
        "tone-b": f"oklch(86% {chroma * 1.4:.3f} {(h + 25) % 360})",
        "tone-c": f"oklch(92% {chroma * 1.1:.3f} {(h + 60) % 360})",
        "tone-d": f"oklch(72% {chroma * 1.8:.3f} {(h - 15) % 360})",
        "accent": f"oklch(80% {accent_c:.3f} {h})",
    }


def light_palette(h, chroma=0.02, accent_c=0.13):
    """Dark-ink palette with white glass cards, for bright backgrounds (scheme "light")."""
    return {
        "ink": f"oklch(24% 0.02 {h})",
        "muted": f"oklch(44% 0.02 {h})",
        "bg": f"oklch(96% {chroma:.3f} {h} / 46%)",
        "card": f"oklch(99% {chroma * 0.6:.3f} {h} / 60%)",
        "tone-a": f"oklch(84% {chroma * 3:.3f} {h})",
        "tone-b": f"oklch(90% {chroma * 2:.3f} {(h + 25) % 360})",
        "tone-c": f"oklch(88% {chroma * 2.5:.3f} {(h + 60) % 360})",
        "tone-d": f"oklch(76% {chroma * 2:.3f} {(h - 15) % 360})",
        "accent": f"oklch(58% {accent_c:.3f} {h})",
    }


PACKS = [
    dict(id="sakura-morning", name="樱花晨光", description="樱花窗边的清晨，奶白与浅粉的柔光。",
         bg="exec-ccef37bb-80d1-48a4-b5ae-d2b3033f2918.png", banner="Obsidian_Banner_cherry_blossom_pink.png",
         hue=20, chroma=0.035, highlight="pink",
         swatches=["#fae1ca", "#e4beaa", "#c9a08d", "#876443"],
         overlay="linear-gradient(135deg, rgb(48 26 20 / 52%), rgb(80 44 36 / 26%))"),
    dict(id="blue-morning", name="蓝调湖晨", description="薄雾湖面与绣球花，清爽安静的蓝色清晨。",
         bg="exec-54523090-b2e4-46d3-8715-d66275178260.png", banner="blue banner.png",
         hue=245, chroma=0.04, highlight="blue",
         swatches=["#d2dbe6", "#9aafc6", "#6b8cae", "#4c6b86"],
         overlay="linear-gradient(135deg, rgb(14 26 42 / 56%), rgb(30 52 76 / 28%))"),
    dict(id="moonlit-lake", name="月光湖畔", description="满月下的湖与远山，黑白银灰的夜。",
         bg="exec-4181be36-ee4f-4e42-89f7-269bdd7b04b9.png", banner=None,
         hue=250, chroma=0.012, highlight="blue",
         swatches=["#0b0e0a", "#2d3135", "#706a66", "#b7a89b"],
         overlay="linear-gradient(135deg, rgb(6 8 10 / 46%), rgb(30 34 40 / 22%))"),
    dict(id="rose-dusk", name="玫瑰晚霞", description="玫瑰花窗外的湖光晚霞，温暖的珊瑚色。",
         bg="exec-3c3b7c04-31a0-4ef3-8e13-790b534cd24a.png", banner=None,
         hue=30, chroma=0.05, highlight="orange", premium=True, version="1.1.0",
         swatches=["#2d1710", "#7f4b43", "#e09078", "#f9b990"],
         overlay="linear-gradient(135deg, rgb(40 16 12 / 54%), rgb(90 40 30 / 24%))"),
    dict(id="city-lights", name="城市夜灯", description="深夜书桌、烛光与窗外的城市灯海。",
         bg="exec-8850576c-7cde-4c71-9216-24b06492f282.png", banner="Obsidian_Banner_midnight_black.png", banner_zoom=1.12,
         hue=60, chroma=0.03, highlight="orange", premium=True, version="1.1.1",
         swatches=["#130904", "#452715", "#a4602f", "#dd9756"],
         overlay="linear-gradient(135deg, rgb(12 8 4 / 46%), rgb(40 24 12 / 22%))"),
    dict(id="crimson-city", name="绯红都市", description="绯红落日下的城市天际线与沙发角落。",
         bg="exec-e9e887e2-2632-474c-bb5d-c7c9bd6bb5e6.png", banner="Obsidian_Banner_magenta.png", banner_zoom=1.12,
         hue=15, chroma=0.06, highlight="pink", premium=True, version="1.1.1",
         swatches=["#250706", "#842b38", "#e03a44", "#f95645"],
         overlay="linear-gradient(135deg, rgb(36 6 10 / 54%), rgb(90 20 30 / 24%))"),
    dict(id="wabi-window", name="侘寂圆窗", description="土墙、圆窗与斑驳树影，安静温暖的侘寂风。",
         bg="侘寂风BG.png", banner="侘寂风banner.png",
         hue=65, chroma=0.035, highlight="orange", premium=True, version="1.0.0",
         swatches=["#1e1209", "#574430", "#a38665", "#caaf8f"],
         overlay="linear-gradient(135deg, rgb(30 20 10 / 50%), rgb(70 50 30 / 22%))"),
    dict(id="peach-ink", name="桃溪水墨", description="粉色晨霞下的水墨远山与孤舟，淡雅的浅色主题。",
         bg="古风BG.png", banner="古风banner.png", light=True,
         hue=30, chroma=0.02, highlight="pink", premium=True, version="1.0.0",
         swatches=["#f6c9ac", "#edcfb8", "#b29888", "#4c4238"],
         overlay="linear-gradient(180deg, rgb(255 248 240 / 26%), rgb(250 236 224 / 14%))"),
    dict(id="green-landscape", name="青绿山水", description="工笔青绿山水与繁花，古典又明快。",
         bg="古风1BG.png", banner="古风1banner.png",
         hue=175, chroma=0.04, highlight="orange", premium=True, version="1.0.0",
         swatches=["#4a4a36", "#589684", "#80a68f", "#c0b995"],
         overlay="linear-gradient(135deg, rgb(12 34 30 / 50%), rgb(30 70 60 / 22%))"),
]


def fit_crop(im, w, h, focus_y=0.5):
    """Scale to cover w×h and crop, keeping the vertical focus point."""
    scale = max(w / im.width, h / im.height)
    nw, nh = round(im.width * scale), round(im.height * scale)
    im = im.resize((nw, nh), Image.LANCZOS)
    x = (nw - w) // 2
    y = min(max(round(nh * focus_y - h / 2), 0), nh - h)
    return im.crop((x, y, x + w, y + h))


def zoom(im, factor):
    """Crop the centre 1/factor of the image (removes edge artifacts such as white rows)."""
    if factor <= 1:
        return im
    w, h = round(im.width / factor), round(im.height / factor)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def save_jpg(im, path, q=86):
    im.convert("RGB").save(path, quality=q, optimize=True, progressive=True)


index = []
for p in PACKS:
    d = os.path.join(OUT, p["id"])
    os.makedirs(d, exist_ok=True)
    bg = Image.open(os.path.join(SRC, p["bg"])).convert("RGB")
    if bg.width > BG_MAX_W:
        bg = bg.resize((BG_MAX_W, round(bg.height * BG_MAX_W / bg.width)), Image.LANCZOS)
    save_jpg(bg, os.path.join(d, "background.jpg"))
    banner_src = Image.open(os.path.join(SRC, p["banner"])).convert("RGB") if p["banner"] else bg
    banner_src = zoom(banner_src, p.get("banner_zoom", 1.0))
    save_jpg(fit_crop(banner_src, BANNER_W, BANNER_H, 0.5 if p["banner"] else 0.42), os.path.join(d, "banner.jpg"))
    save_jpg(fit_crop(bg, PREVIEW_W, PREVIEW_H), os.path.join(d, "preview.jpg"), 82)
    entry = {
        "id": p["id"], "name": p["name"], "description": p["description"], "author": AUTHOR, "version": p.get("version", "1.0.0"),
        "base": "glass", "scheme": "light" if p.get("light") else "dark",
        "preview": "preview.jpg", "background": "background.jpg", "banner": "banner.jpg",
        "backgroundSize": "cover", "overlay": p["overlay"], "annotationHighlight": p["highlight"],
        "swatches": p["swatches"], "tags": ["精品"] if p.get("premium") else ["免费"],
        "palette": {"light": (light_palette if p.get("light") else glass_palette)(p["hue"], p["chroma"])},
    }
    # Ambient sound: an ambient.mp3 already placed in the pack folder (see packs/README.md for sources).
    if os.path.exists(os.path.join(d, "ambient.mp3")):
        entry["ambient"] = "ambient.mp3"
    if p.get("premium"):
        entry["premium"] = PREMIUM
    with open(os.path.join(d, "pack.json"), "w") as f:
        json.dump(entry, f, ensure_ascii=False, indent=2)
    index.append(entry)

with open(os.path.join(OUT, "index.json"), "w") as f:
    json.dump({"version": 1, "packs": index}, f, ensure_ascii=False, indent=2)
print("built", [p["id"] for p in PACKS])
