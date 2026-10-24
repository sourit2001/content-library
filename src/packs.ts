import {
  App,
  Modal,
  Notice,
  Setting,
  normalizePath,
  requestUrl,
  setIcon,
} from "obsidian";
import type ContentLibraryDashboardPlugin from "./main";
import glassBackground from "../assets/cld-glass-green-bg.jpg";
import { THEME_LABELS, type AnnotationHighlight, type DashboardTheme } from "./types";
import { dateLocale, isEnglish, t } from "./i18n";
import { renderSupportPanel } from "./support";

/** Store previews for the built-in themes (approximations of their CSS palettes). */
const BUILTIN_PREVIEWS: Record<DashboardTheme, { swatches: string[]; description: string }> = {
  grass: { swatches: ["#eef6df", "#c7e0ae", "#a9cc8a", "#7f9c6c"], description: "清新的浅绿色，默认主题。" },
  blue: { swatches: ["#e8f3fb", "#b5d8ee", "#80b9e0", "#6aa7a6"], description: "干净的浅蓝色，像海盐一样清爽。" },
  pink: { swatches: ["#fde7ee", "#f8c2d2", "#f59bb5", "#e6789a"], description: "柔和的樱花粉。" },
  rose: { swatches: ["#f6c3cc", "#ee8aa0", "#e0436e", "#b81d4a"], description: "浓郁的玫瑰红。" },
  black: { swatches: ["#0e1311", "#1d2420", "#2a3330", "#4a4740"], description: "深色曜石黑，夜间更护眼。" },
  glass: { swatches: ["#1f3a2a", "#4f7a52", "#9cc28a", "#e8e2c8"], description: "窗边绿植与阳光，液态玻璃质感。" },
};

/**
 * Built-in themes sold in the premium series. Same Gumroad product as the premium packs:
 * free until `freeUntil`; using it once in that window keeps it for good (see `claimedThemes`).
 */
const SERIES_PREMIUM: PackPremium = {
  provider: "gumroad",
  productId: "REPLACE_WITH_GUMROAD_PRODUCT_ID",
  buyUrl: "https://gumroad.com/l/REPLACE_ME",
  price: "¥18",
  freeUntil: "2026-11-07T23:59:59+08:00",
};
/** Paid unlocking is switched off for now: every premium pack and theme is free. Flip to true to sell again. */
export const PAYMENTS_ENABLED = false;
export const PREMIUM_BUILTINS: DashboardTheme[] = ["glass"];

/** English names for store packs, used when a pack's own data has no `nameEn` (older index / installed copies). */
const PACK_EN: Record<string, [string, string]> = {
  "sakura-morning": ["Sakura Morning", "Early light by a cherry-blossom window, soft cream and pale pink."],
  "blue-morning": ["Blue Lake Morning", "A misty lake and hydrangeas — a calm, crisp blue morning."],
  "moonlit-lake": ["Moonlit Lake", "A lake and distant hills under the full moon, a night in black, silver and grey."],
  "rose-dusk": ["Rose Dusk", "Sunset over the lake beyond a rose window, in warm coral tones."],
  "city-lights": ["City Lights", "A late-night desk, candlelight and a sea of city lights outside."],
  "crimson-city": ["Crimson City", "A city skyline under a crimson sunset, seen from a cozy sofa corner."],
  "wabi-window": ["Wabi Window", "Earthen walls, a moon window and dappled shade — quiet, warm wabi-sabi."],
  "peach-ink": ["Peach Blossom Ink", "Ink-wash hills and a lone boat under a peach-pink dawn, in a soft light theme."],
  "green-landscape": ["Blue-Green Landscape", "A classical blue-green landscape painting full of flowers, elegant and bright."],
};

/**
 * Theme packs ("素材包") bundle a palette, a desktop background and an optional
 * banner. The catalog lives in the GitHub repository under `packs/` and is read
 * through jsDelivr (with raw.githubusercontent.com as a fallback). Images are
 * downloaded once into the plugin folder; palettes are stored in data.json so
 * colors keep working on synced devices before the images are re-downloaded.
 */
const REPO = "sourit2001/content-library";
export const PACK_INDEX_URLS = [
  `https://cdn.jsdelivr.net/gh/${REPO}@main/packs/index.json`,
  `https://raw.githubusercontent.com/${REPO}/main/packs/index.json`,
];
const INDEX_TIMEOUT_MS = 10_000;

/** Pack file bases for a commit: jsDelivr first (reachable in more regions), GitHub raw as fallback. */
function pinnedBases(ref: string): string[] {
  return [`https://cdn.jsdelivr.net/gh/${REPO}@${ref}/packs`, `https://raw.githubusercontent.com/${REPO}/${ref}/packs`];
}

/** Alternative bases that serve the same files as `base` (the other mirror of the same commit). */
function mirrorsOf(base: string): string[] {
  const jsd = base.match(/^https:\/\/cdn\.jsdelivr\.net\/gh\/[^@]+@([0-9a-f]{7,40})\/packs$/);
  const raw = base.match(/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/([0-9a-f]{7,40})\/packs$/);
  const ref = jsd?.[1] ?? raw?.[1];
  return ref ? pinnedBases(ref).filter((url) => url !== base) : [];
}

export const PALETTE_KEYS = [
  "ink", "muted", "bg", "card",
  "tone-a", "tone-b", "tone-c", "tone-d",
  "glass", "glass-strong", "accent",
] as const;
export type PaletteKey = typeof PALETTE_KEYS[number];
export type PackPalette = Partial<Record<PaletteKey, string>>;

export interface PackPremium {
  provider: "gumroad";
  /** Gumroad product id; packs sharing one id are unlocked together. */
  productId: string;
  buyUrl: string;
  price?: string;
  /** ISO date; until then the premium pack can be installed for free. */
  freeUntil?: string;
}

export interface ThemePack {
  id: string;
  name: string;
  description: string;
  /** Optional English name/description shown when the UI language is English. */
  nameEn?: string;
  descriptionEn?: string;
  author: string;
  version: string;
  /** Built-in theme that provides the structural CSS (glass = translucent cards over a background). */
  base: DashboardTheme;
  preview?: string;
  background?: string;
  banner?: string;
  /** Large dashboard mockup shown in the store before download (not downloaded on install). */
  mockup?: string;
  /** Looping ambient sound (rain, birds, city) played from the dashboard. */
  ambient?: string;
  /** CSS background-size for the desktop background, e.g. "cover". */
  backgroundSize?: string;
  /** CSS gradient laid over the background image to keep text readable. */
  overlay?: string;
  annotationHighlight?: AnnotationHighlight;
  /** Native control color scheme; light packs on the glass base set "light". */
  scheme?: "light" | "dark";
  swatches?: string[];
  tags?: string[];
  palette: { light: PackPalette; dark?: PackPalette };
  premium?: PackPremium;
  /** Where the pack's files were downloaded from (set on install). */
  sourceUrl?: string;
}

interface PackIndex {
  version: number;
  /** Increases on every publish; the newest copy wins when mirrors disagree. */
  revision?: number;
  /** Commit that holds this revision's pack files; files are fetched from that immutable commit. */
  ref?: string;
  packs: ThemePack[];
}

const BASES: DashboardTheme[] = ["grass", "blue", "pink", "rose", "black", "glass"];
const HIGHLIGHTS: AnnotationHighlight[] = ["yellow", "orange", "blue", "pink"];
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FILE_RE = /^[\w-]{1,80}\.(jpe?g|png|webp)$/i;
const AUDIO_RE = /^[\w-]{1,80}\.(mp3|m4a|ogg)$/i;
const CSS_VALUE_RE = /^[^;{}<>\\]{1,400}$/;

function cssValue(value: unknown): string | undefined {
  return typeof value === "string" && CSS_VALUE_RE.test(value.trim()) ? value.trim() : undefined;
}

function fileName(value: unknown): string | undefined {
  return typeof value === "string" && FILE_RE.test(value) ? value : undefined;
}

function sanitizePalette(raw: unknown): PackPalette {
  const palette: PackPalette = {};
  if (!raw || typeof raw !== "object") return palette;
  for (const key of PALETTE_KEYS) {
    const value = cssValue((raw as Record<string, unknown>)[key]);
    if (value) palette[key] = value;
  }
  return palette;
}

/** Validates untrusted pack JSON; returns null when the entry is unusable. */
export function sanitizePack(raw: unknown): ThemePack | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const id = typeof data.id === "string" ? data.id : "";
  if (!ID_RE.test(id)) return null;
  const paletteRaw = (data.palette ?? {}) as Record<string, unknown>;
  const light = sanitizePalette(paletteRaw.light);
  if (!Object.keys(light).length) return null;
  const dark = sanitizePalette(paletteRaw.dark);
  const premiumRaw = data.premium as Record<string, unknown> | undefined;
  const premium: PackPremium | undefined = premiumRaw
    && premiumRaw.provider === "gumroad"
    && typeof premiumRaw.productId === "string"
    && typeof premiumRaw.buyUrl === "string"
    && /^https:\/\//.test(premiumRaw.buyUrl)
    ? {
      provider: "gumroad",
      productId: premiumRaw.productId.slice(0, 120),
      buyUrl: premiumRaw.buyUrl,
      price: typeof premiumRaw.price === "string" ? premiumRaw.price.slice(0, 30) : undefined,
      freeUntil: typeof premiumRaw.freeUntil === "string" && !Number.isNaN(Date.parse(premiumRaw.freeUntil))
        ? premiumRaw.freeUntil
        : undefined,
    }
    : undefined;
  const text = (value: unknown, max: number, fallback = "") => typeof value === "string" ? value.slice(0, max) : fallback;
  return {
    id,
    name: text(data.name, 40, id),
    description: text(data.description, 160),
    nameEn: text(data.nameEn, 60) || undefined,
    descriptionEn: text(data.descriptionEn, 200) || undefined,
    author: text(data.author, 40),
    version: text(data.version, 20, "1.0.0"),
    base: BASES.includes(data.base as DashboardTheme) ? data.base as DashboardTheme : "glass",
    preview: fileName(data.preview),
    background: fileName(data.background),
    banner: fileName(data.banner),
    mockup: fileName(data.mockup),
    ambient: typeof data.ambient === "string" && AUDIO_RE.test(data.ambient) ? data.ambient : undefined,
    backgroundSize: cssValue(data.backgroundSize),
    overlay: cssValue(data.overlay),
    annotationHighlight: HIGHLIGHTS.includes(data.annotationHighlight as AnnotationHighlight)
      ? data.annotationHighlight as AnnotationHighlight
      : undefined,
    scheme: data.scheme === "light" || data.scheme === "dark" ? data.scheme : undefined,
    swatches: Array.isArray(data.swatches) ? data.swatches.map(cssValue).filter((v): v is string => Boolean(v)).slice(0, 6) : undefined,
    tags: Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === "string").map((t) => t.slice(0, 12)).slice(0, 4) : undefined,
    palette: Object.keys(dark).length ? { light, dark } : { light },
    premium,
    sourceUrl: typeof data.sourceUrl === "string" && /^https:\/\//.test(data.sourceUrl) ? data.sourceUrl : undefined,
  };
}

/** Pack name in the current UI language (falls back to the original name). */
export function packName(pack: ThemePack): string {
  if (!isEnglish()) return pack.name;
  return pack.nameEn || PACK_EN[pack.id]?.[0] || pack.name;
}

export function packDescription(pack: ThemePack): string {
  if (!isEnglish()) return pack.description;
  return pack.descriptionEn || PACK_EN[pack.id]?.[1] || pack.description;
}

/** True while a premium pack is in its limited-time free window. */
export function isLimitedFree(pack: ThemePack): boolean {
  const until = pack.premium?.freeUntil ? Date.parse(pack.premium.freeUntil) : NaN;
  return !Number.isNaN(until) && Date.now() < until;
}

function freeUntilLabel(pack: { premium?: PackPremium }): string {
  const until = pack.premium?.freeUntil ? new Date(pack.premium.freeUntil) : null;
  return until ? new Intl.DateTimeFormat(dateLocale(), { month: "long", day: "numeric" }).format(until) : "";
}

function packFiles(pack: ThemePack): string[] {
  return [pack.preview, pack.background, pack.banner, pack.ambient].filter((file): file is string => Boolean(file));
}

export class ThemePackManager {
  private catalog: Promise<{ packs: ThemePack[]; baseUrl: string }> | null = null;
  private repairing = new Set<string>();

  constructor(private plugin: ContentLibraryDashboardPlugin) {}

  private get app(): App {
    return this.plugin.app;
  }

  private packDir(id: string): string {
    return normalizePath(`${this.plugin.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}`}/packs/${id}`);
  }

  active(): ThemePack | null {
    const id = this.plugin.settings.activePackId;
    return id ? this.plugin.settings.installedPacks[id] ?? null : null;
  }

  installed(): ThemePack[] {
    return Object.values(this.plugin.settings.installedPacks);
  }

  isUnlocked(pack: ThemePack): boolean {
    return !PAYMENTS_ENABLED
      || !pack.premium
      || Boolean(this.plugin.settings.licenses[pack.premium.productId])
      || isLimitedFree(pack);
  }

  /** Premium info for a built-in theme, or undefined when the theme is always free. */
  builtinPremium(theme: DashboardTheme): PackPremium | undefined {
    return PREMIUM_BUILTINS.includes(theme) ? SERIES_PREMIUM : undefined;
  }

  isBuiltinClaimed(theme: DashboardTheme): boolean {
    return this.plugin.settings.claimedThemes.includes(theme);
  }

  isBuiltinUnlocked(theme: DashboardTheme): boolean {
    const premium = this.builtinPremium(theme);
    return !PAYMENTS_ENABLED
      || !premium
      || this.isBuiltinClaimed(theme)
      || Boolean(this.plugin.settings.licenses[premium.productId])
      || isLimitedFree({ premium } as ThemePack);
  }

  /** Switch to a built-in theme; returns false (and changes nothing) when it is locked. */
  async useBuiltin(theme: DashboardTheme): Promise<boolean> {
    if (!this.isBuiltinUnlocked(theme)) return false;
    if (this.builtinPremium(theme) && !this.isBuiltinClaimed(theme)) this.plugin.settings.claimedThemes.push(theme);
    this.plugin.settings.theme = theme;
    this.plugin.settings.activePackId = "";
    await this.plugin.saveSettings();
    return true;
  }

  /** Remote catalog, cached for the session. */
  fetchCatalog(force = false): Promise<{ packs: ThemePack[]; baseUrl: string }> {
    if (force || !this.catalog) {
      this.catalog = this.loadCatalog(force);
      this.catalog.catch(() => { this.catalog = null; });
    }
    return this.catalog;
  }

  private async loadCatalog(force: boolean): Promise<{ packs: ThemePack[]; baseUrl: string }> {
    // A changing query string sidesteps stale HTTP caches; normal loads share a 10-minute bucket
    // so the CDN can still cache, while a manual refresh always gets a fresh copy.
    const stamp = force ? Date.now() : Math.floor(Date.now() / 600_000);
    // CDN mirrors can lag behind each other, so ask every mirror and keep the newest revision.
    const results = await Promise.allSettled(PACK_INDEX_URLS.map(async (url) => {
      const response = await Promise.race([
        requestUrl({ url: `${url}?t=${stamp}`, headers: { "Cache-Control": "no-cache" }, throw: false }),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("timeout")), INDEX_TIMEOUT_MS)),
      ]);
      if (response.status >= 400) throw new Error(`HTTP ${response.status}`);
      return { url, index: response.json as PackIndex };
    }));
    const loaded = results
      .filter((result): result is PromiseFulfilledResult<{ url: string; index: PackIndex }> => result.status === "fulfilled")
      .map((result) => result.value)
      .filter(({ index }) => Array.isArray(index?.packs));
    if (!loaded.length) {
      const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      throw failure?.reason instanceof Error ? failure.reason : new Error(t("无法读取素材包列表"));
    }
    // Keep the newest revision; on a tie the earlier (preferred) mirror wins.
    const best = loaded.reduce((a, b) => ((b.index.revision ?? 0) > (a.index.revision ?? 0) ? b : a));
    const ref = typeof best.index.ref === "string" && /^[0-9a-f]{7,40}$/.test(best.index.ref) ? best.index.ref : "";
    const packs = best.index.packs.map(sanitizePack).filter((pack): pack is ThemePack => Boolean(pack));
    return { packs, baseUrl: ref ? pinnedBases(ref)[0] : best.url.replace(/\/index\.json$/, "") };
  }

  remotePreview(pack: ThemePack, baseUrl: string): string {
    return pack.preview ? `${baseUrl}/${pack.id}/${pack.preview}` : "";
  }

  remoteMockup(pack: ThemePack, baseUrl: string): string {
    return pack.mockup ? `${baseUrl}/${pack.id}/${pack.mockup}` : this.remotePreview(pack, baseUrl);
  }

  localResource(pack: ThemePack, file: string | undefined): string {
    if (!file) return "";
    return this.app.vault.adapter.getResourcePath(`${this.packDir(pack.id)}/${file}`);
  }

  async install(pack: ThemePack, baseUrl: string): Promise<void> {
    if (!this.isUnlocked(pack)) throw new Error(t("请先解锁这个精品素材包。"));
    const sourceUrl = `${baseUrl}/${pack.id}`;
    await this.downloadFiles(pack, sourceUrl);
    this.plugin.settings.installedPacks[pack.id] = { ...pack, sourceUrl };
    await this.plugin.saveSettings(false);
  }

  private async downloadFiles(pack: ThemePack, sourceUrl: string): Promise<void> {
    const adapter = this.app.vault.adapter;
    const dir = this.packDir(pack.id);
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
    const license = pack.premium ? this.plugin.settings.licenses[pack.premium.productId] : "";
    const bases = [sourceUrl, ...mirrorsOf(sourceUrl)];
    for (const file of packFiles(pack)) {
      let lastStatus = 0;
      let data: ArrayBuffer | null = null;
      for (const base of bases) {
        try {
          const response = await requestUrl({
            url: `${base}/${file}`,
            headers: license ? { "X-License-Key": license } : undefined,
            throw: false,
          });
          lastStatus = response.status;
          if (response.status < 400) {
            data = response.arrayBuffer;
            break;
          }
        } catch (error) {
          console.warn(`[Content Library] Download failed from ${base}`, error);
        }
      }
      if (!data) throw new Error(lastStatus ? t("下载 {file} 失败（HTTP {status}）", { file, status: lastStatus }) : t("下载 {file} 失败，请检查网络", { file }));
      await adapter.writeBinary(`${dir}/${file}`, data);
    }
  }

  /** Re-downloads images that are missing locally, e.g. on a newly synced device. */
  async ensureFiles(pack: ThemePack): Promise<void> {
    if (!pack.sourceUrl || this.repairing.has(pack.id)) return;
    const adapter = this.app.vault.adapter;
    const dir = this.packDir(pack.id);
    const missing: string[] = [];
    for (const file of packFiles(pack)) if (!(await adapter.exists(`${dir}/${file}`))) missing.push(file);
    if (!missing.length) return;
    this.repairing.add(pack.id);
    try {
      await this.downloadFiles(pack, pack.sourceUrl);
      this.plugin.refreshViews();
    } catch (error) {
      console.warn("[Content Library] Theme pack repair failed", error);
    } finally {
      this.repairing.delete(pack.id);
    }
  }

  async apply(id: string | null): Promise<void> {
    const pack = id ? this.plugin.settings.installedPacks[id] : null;
    this.plugin.settings.activePackId = pack ? pack.id : "";
    if (pack?.annotationHighlight) this.plugin.settings.annotationHighlight = pack.annotationHighlight;
    await this.plugin.saveSettings();
    this.plugin.ambient.syncWithPack(pack ?? null);
  }

  async installAndApply(pack: ThemePack, baseUrl: string): Promise<void> {
    await this.install(pack, baseUrl);
    await this.apply(pack.id);
  }

  async uninstall(id: string): Promise<void> {
    const dir = this.packDir(id);
    if (await this.app.vault.adapter.exists(dir)) await this.app.vault.adapter.rmdir(dir, true);
    delete this.plugin.settings.installedPacks[id];
    if (this.plugin.settings.activePackId === id) {
      this.plugin.settings.activePackId = "";
      this.plugin.ambient.stop();
    }
    await this.plugin.saveSettings();
  }

  async verifyLicense(premium: PackPremium, key: string): Promise<boolean> {
    const body = new URLSearchParams({
      product_id: premium.productId,
      license_key: key.trim(),
      increment_uses_count: "false",
    }).toString();
    const response = await requestUrl({
      url: "https://api.gumroad.com/v2/licenses/verify",
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      body,
      throw: false,
    });
    const data = response.json as { success?: boolean; purchase?: { refunded?: boolean; chargebacked?: boolean; subscription_cancelled_at?: string | null } } | undefined;
    const ok = Boolean(data?.success && !data.purchase?.refunded && !data.purchase?.chargebacked && !data.purchase?.subscription_cancelled_at);
    if (ok) {
      this.plugin.settings.licenses[premium.productId] = key.trim();
      await this.plugin.saveSettings(false);
    }
    return ok;
  }

  /** Writes the pack palette and images onto the dashboard root as CSS variables. */
  applyToElement(el: HTMLElement, pack: ThemePack): void {
    const mode = this.plugin.settings.themeMode;
    const dark = mode === "dark" || (mode === "system" && document.body.hasClass("theme-dark"));
    const palette = { ...pack.palette.light, ...(dark ? pack.palette.dark ?? {} : {}) };
    const props: Record<string, string> = {};
    for (const [key, value] of Object.entries(palette)) props[`--cld-${key}`] = value;
    const background = this.localResource(pack, pack.background);
    if (background) props["--cld-glass-background"] = `url("${background.replace(/"/g, "%22")}")`;
    if (pack.overlay) props["--cld-bg-overlay"] = pack.overlay;
    if (pack.backgroundSize) {
      props["--cld-bg-size"] = pack.backgroundSize;
      props["--cld-bg-size-mobile"] = pack.backgroundSize;
    }
    if (pack.scheme) props["color-scheme"] = pack.scheme;
    el.setCssProps(props);
    void this.ensureFiles(pack);
  }

  bannerFor(pack: ThemePack | null): string {
    return pack?.banner ? this.localResource(pack, pack.banner) : "";
  }
}

export class ThemePackStoreModal extends Modal {
  private packs: ThemePack[] = [];
  private baseUrl = "";
  private busy = new Set<string>();

  constructor(app: App, private plugin: ContentLibraryDashboardPlugin) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("cld-pack-store-modal");
    this.titleEl.setText(t("素材包"));
    void this.load(false);
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private async load(force: boolean): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createDiv({ cls: "cld-pack-store-status", text: t("正在加载素材包…") });
    try {
      const catalog = await this.plugin.packs.fetchCatalog(force);
      this.packs = catalog.packs;
      this.baseUrl = catalog.baseUrl;
      this.render();
    } catch (error) {
      console.warn("[Content Library] Pack catalog failed", error);
      this.packs = [];
      this.render(t("暂时无法连接素材包商店，请检查网络后点右上角刷新重试。已下载的素材包仍可使用。"));
    }
  }

  private render(error = ""): void {
    const { contentEl } = this;
    contentEl.empty();
    const intro = contentEl.createDiv({ cls: "cld-pack-store-intro" });
    intro.createEl("p", { text: t("一键更换仪表盘的配色、桌面背景和横幅。素材下载后保存在插件目录里，不会写入你的笔记。") });
    const refresh = intro.createEl("button", { cls: "clickable-icon", attr: { "aria-label": t("刷新素材包列表") } });
    setIcon(refresh, "refresh-cw");
    refresh.addEventListener("click", () => void this.load(true));
    renderSupportPanel(contentEl);

    if (error) contentEl.createDiv({ cls: "cld-pack-store-status is-inline", text: error });
    const premium: Array<DashboardTheme | ThemePack> = [...PREMIUM_BUILTINS, ...this.packs.filter((pack) => pack.premium)];
    const free = this.packs.filter((pack) => !pack.premium);
    this.renderSection(t("精品素材包"), premium, (grid, item) => (typeof item === "string" ? this.renderBuiltinCard(grid, item) : this.renderCard(grid, item)));
    if (!error) {
      this.renderSection(t("免费素材包"), free, (grid, pack) => this.renderCard(grid, pack));
      if (!this.packs.length) contentEl.createDiv({ cls: "cld-pack-store-status is-inline", text: t("商店里还没有素材包。") });
    }
    const builtins = (Object.keys(THEME_LABELS) as DashboardTheme[]).filter((theme) => !PREMIUM_BUILTINS.includes(theme));
    this.renderSection(t("内置主题"), builtins, (grid, theme) => this.renderBuiltinCard(grid, theme));
  }

  mockupUrl(pack: ThemePack): string {
    return this.plugin.packs.remoteMockup(pack, this.baseUrl);
  }

  private renderSection<T>(title: string, items: T[], renderItem: (grid: HTMLElement, item: T) => void): void {
    if (!items.length) return;
    this.contentEl.createEl("h4", { cls: "cld-pack-section-title", text: title });
    const grid = this.contentEl.createDiv({ cls: "cld-pack-grid" });
    for (const item of items) renderItem(grid, item);
  }

  private renderBuiltinCard(grid: HTMLElement, theme: DashboardTheme): void {
    const info = BUILTIN_PREVIEWS[theme];
    const isActive = !this.plugin.settings.activePackId && this.plugin.settings.theme === theme;
    const card = grid.createDiv({ cls: `cld-pack-card${isActive ? " is-active" : ""}` });
    const preview = card.createDiv({ cls: `cld-pack-preview cld-builtin-preview cld-builtin-${theme}` });
    if (theme === "glass") {
      preview.createEl("img", { attr: { src: glassBackground, alt: t(THEME_LABELS[theme]) } });
    } else {
      const [a, b, c, d] = info.swatches;
      preview.setCssProps({ "--cld-p1": a, "--cld-p2": b, "--cld-p3": c, "--cld-p4": d });
    }
    const premium = this.plugin.packs.builtinPremium(theme);
    const unlocked = this.plugin.packs.isBuiltinUnlocked(theme);
    const owned = Boolean(premium) && (this.plugin.packs.isBuiltinClaimed(theme) || Boolean(this.plugin.settings.licenses[premium?.productId ?? ""]));
    const limitedFree = PAYMENTS_ENABLED && Boolean(premium) && !owned && unlocked;
    if (!premium) {
      preview.createSpan({ cls: "cld-pack-badge is-builtin", text: t("内置 · 免费") });
    } else {
      const badge = preview.createSpan({ cls: `cld-pack-badge is-premium${limitedFree ? " is-limited" : ""}` });
      badge.setText(!PAYMENTS_ENABLED ? t("精品 · 免费") : limitedFree ? t("限时免费") : owned ? t("已解锁") : t("精品 {price}", { price: premium.price ?? "" }).trim());
    }
    const body = card.createDiv({ cls: "cld-pack-body" });
    body.createEl("strong", { text: t(THEME_LABELS[theme]) });
    body.createEl("small", { text: t(info.description) });
    if (premium && limitedFree) {
      body.createEl("small", {
        cls: "cld-pack-limited",
        text: t("精品主题限时免费，{date}前使用过即可永久保留", { date: freeUntilLabel({ premium }) })
          + (premium.price ? t("（原价 {price}）", { price: premium.price }) : ""),
      });
    }
    const swatches = body.createDiv({ cls: "cld-pack-swatches" });
    for (const color of info.swatches) swatches.createSpan().setCssProps({ "--cld-swatch": color });
    const actions = body.createDiv({ cls: "cld-pack-actions" });
    const button = actions.createEl("button", { text: isActive ? t("使用中") : unlocked ? t("使用") : t("解锁") });
    if (isActive) {
      button.addClass("mod-muted");
      button.disabled = true;
    } else if (!unlocked && premium) {
      button.addClass("mod-cta");
      button.addEventListener("click", () => {
        new LicenseModal(this.app, this.plugin, premium, t(THEME_LABELS[theme]), () => this.render()).open();
      });
    } else {
      button.addClass("mod-cta");
      button.addEventListener("click", async () => {
        if (!(await this.plugin.packs.useBuiltin(theme))) return;
        new Notice(t("已切换到「{name}」", { name: t(THEME_LABELS[theme]) }));
        this.render();
      });
    }
  }

  private renderCard(grid: HTMLElement, pack: ThemePack): void {
    const installed = this.plugin.settings.installedPacks[pack.id];
    const isActive = this.plugin.settings.activePackId === pack.id;
    const unlocked = this.plugin.packs.isUnlocked(pack);
    const limitedFree = PAYMENTS_ENABLED && Boolean(pack.premium) && isLimitedFree(pack)
      && !this.plugin.settings.licenses[pack.premium?.productId ?? ""];
    const card = grid.createDiv({ cls: `cld-pack-card${isActive ? " is-active" : ""}` });
    const preview = card.createDiv({ cls: "cld-pack-preview is-clickable", attr: { role: "button", tabindex: "0", "aria-label": t("预览效果") } });
    // The store thumbnail is a dashboard mockup; prefer the current remote copy, fall back to the installed one offline.
    const remote = this.plugin.packs.remotePreview(pack, this.baseUrl);
    const local = installed?.preview ? this.plugin.packs.localResource(installed, installed.preview) : "";
    const src = remote || local;
    if (src) {
      const img = preview.createEl("img", { attr: { src, alt: packName(pack), loading: "lazy" } });
      if (local && src !== local) img.addEventListener("error", () => { img.src = local; }, { once: true });
    }
    const zoom = preview.createSpan({ cls: "cld-pack-zoom" });
    setIcon(zoom, "maximize-2");
    const openPreview = () => new PackPreviewModal(this.app, this, pack).open();
    preview.addEventListener("click", openPreview);
    preview.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openPreview();
      }
    });
    const badge = preview.createSpan({ cls: `cld-pack-badge${pack.premium ? " is-premium" : ""}${limitedFree ? " is-limited" : ""}` });
    badge.setText(!pack.premium ? t("免费") : !PAYMENTS_ENABLED ? t("精品 · 免费") : limitedFree ? t("限时免费") : unlocked ? t("已解锁") : t("精品 {price}", { price: pack.premium.price ?? "" }).trim());
    const body = card.createDiv({ cls: "cld-pack-body" });
    body.createEl("strong", { text: packName(pack) });
    if (pack.description) body.createEl("small", { text: packDescription(pack) });
    if (limitedFree) {
      body.createEl("small", {
        cls: "cld-pack-limited",
        text: t("精品包限时免费，{date}前下载可永久使用", { date: freeUntilLabel(pack) })
          + (pack.premium?.price ? t("（原价 {price}）", { price: pack.premium.price }) : ""),
      });
    }
    if (pack.ambient) {
      const chip = body.createDiv({ cls: "cld-pack-ambient-chip" });
      setIcon(chip.createSpan(), "audio-lines");
      chip.createSpan({ text: t("含环境音") });
    }
    if (pack.swatches?.length) {
      const swatches = body.createDiv({ cls: "cld-pack-swatches" });
      for (const color of pack.swatches) swatches.createSpan().setCssProps({ "--cld-swatch": color });
    }
    const actions = body.createDiv({ cls: "cld-pack-actions" });
    const previewButton = actions.createEl("button", { cls: "cld-pack-preview-button", text: t("预览") });
    previewButton.addEventListener("click", openPreview);
    this.renderPackAction(actions, pack, () => undefined);
  }

  /** The primary pack button (download / use / unlock); shared by the card and the preview window. */
  renderPackAction(actions: HTMLElement, pack: ThemePack, afterAction: () => void): void {
    const installed = this.plugin.settings.installedPacks[pack.id];
    const isActive = this.plugin.settings.activePackId === pack.id;
    const unlocked = this.plugin.packs.isUnlocked(pack);
    const button = actions.createEl("button", { cls: "cld-pack-action" });
    const outdated = installed && installed.version !== pack.version;
    if (this.busy.has(pack.id)) {
      button.setText(t("下载中…"));
      button.disabled = true;
    } else if (isActive && !outdated) {
      button.setText(t("使用中"));
      button.addClass("mod-muted");
      button.disabled = true;
    } else if (!unlocked) {
      button.setText(t("解锁"));
      button.addClass("mod-cta");
      button.addEventListener("click", () => {
        if (!pack.premium) return;
        afterAction();
        new LicenseModal(this.app, this.plugin, pack.premium, packName(pack), () => this.render()).open();
      });
    } else {
      button.setText(outdated ? t("更新并使用") : installed ? t("使用") : t("下载并使用"));
      button.addClass("mod-cta");
      button.addEventListener("click", async () => {
        afterAction();
        try {
          if (installed && !outdated) {
            await this.plugin.packs.apply(pack.id);
          } else {
            this.busy.add(pack.id);
            this.render();
            await this.plugin.packs.installAndApply(pack, this.baseUrl);
          }
          new Notice(t("已应用素材包「{name}」", { name: packName(pack) }));
        } catch (error) {
          console.error("[Content Library] Pack install failed", error);
          new Notice(error instanceof Error ? error.message : t("素材包下载失败，请稍后重试。"));
        } finally {
          this.busy.delete(pack.id);
          this.render();
        }
      });
    }
  }
}

/** Large dashboard mockup of a pack, with the same download / unlock button as its store card. */
class PackPreviewModal extends Modal {
  constructor(app: App, private store: ThemePackStoreModal, private pack: ThemePack) {
    super(app);
  }

  override onOpen(): void {
    const { pack } = this;
    this.modalEl.addClass("cld-pack-preview-modal");
    this.titleEl.setText(packName(pack));
    const frame = this.contentEl.createDiv({ cls: "cld-pack-preview-frame" });
    const src = this.store.mockupUrl(pack);
    if (src) frame.createEl("img", { attr: { src, alt: packName(pack) } });
    const info = this.contentEl.createDiv({ cls: "cld-pack-preview-info" });
    const copy = info.createDiv();
    if (pack.description) copy.createEl("p", { text: packDescription(pack) });
    if (pack.ambient) {
      const chip = copy.createDiv({ cls: "cld-pack-ambient-chip" });
      setIcon(chip.createSpan(), "audio-lines");
      chip.createSpan({ text: t("含环境音") });
    }
    copy.createEl("small", { cls: "cld-pack-preview-note", text: t("预览图为示意效果，实际内容以你的笔记为准。") });
    const actions = info.createDiv({ cls: "cld-pack-actions" });
    this.store.renderPackAction(actions, pack, () => this.close());
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

class LicenseModal extends Modal {
  constructor(
    app: App,
    private plugin: ContentLibraryDashboardPlugin,
    private premium: PackPremium,
    private packName: string,
    private onUnlocked: () => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText(t("解锁「{name}」", { name: this.packName }));
    this.contentEl.addClass("cld-note-modal");
    this.contentEl.createEl("p", { text: t("购买后会收到一个激活码，粘贴到下面即可解锁。同一个激活码可解锁同一系列的所有精品素材包。") });
    let key = "";
    new Setting(this.contentEl).setName(t("激活码")).addText((text) => {
      text.setPlaceholder("XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX").onChange((value) => { key = value; });
      text.inputEl.addClass("cld-license-input");
    });
    const actions = this.contentEl.createDiv({ cls: "cld-note-modal-actions" });
    const buy = actions.createEl("button", { text: this.premium.price ? t("购买 {price}", { price: this.premium.price }) : t("去购买") });
    buy.addEventListener("click", () => window.open(this.premium.buyUrl));
    const activate = actions.createEl("button", { text: t("激活"), cls: "mod-cta" });
    activate.addEventListener("click", async () => {
      if (!key.trim()) return;
      activate.disabled = true;
      activate.setText(t("验证中…"));
      try {
        if (await this.plugin.packs.verifyLicense(this.premium, key)) {
          new Notice(t("激活成功，精品素材包已解锁。"));
          this.close();
          this.onUnlocked();
          return;
        }
        new Notice(t("激活码无效或已退款，请检查后重试。"));
      } catch (error) {
        console.error("[Content Library] License verify failed", error);
        new Notice(t("暂时无法验证激活码，请检查网络后重试。"));
      }
      activate.disabled = false;
      activate.setText(t("激活"));
    });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
