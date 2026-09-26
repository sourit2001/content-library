var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ContentLibraryDashboardPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian4 = require("obsidian");

// src/indexer.ts
var import_obsidian = require("obsidian");
var AUDIO_EXTENSIONS = /* @__PURE__ */ new Set(["mp3", "m4a", "wav", "flac", "aac", "ogg", "opus"]);
function cleanLink(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^!\[\[/, "").replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0];
}
function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const found = value.find((entry) => typeof entry === "string" && entry.trim());
      if (typeof found === "string") return found.trim();
    }
  }
  return "";
}
function parseProgress(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, value <= 1 ? value * 100 : value));
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace("%", ""));
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(100, parsed <= 1 ? parsed * 100 : parsed));
  }
  return 0;
}
function cleanAudioTitle(value) {
  return value.replace(/-20\d{2}-\d{2}-\d{2}T\d{2}[-:]\d{2}[-:]\d{2}(?:\.\d+Z?)?$/i, "").replace(/[-_]+$/, "").trim();
}
var VaultContentIndexer = class {
  constructor(app) {
    this.app = app;
  }
  sourceStats(folderPath) {
    const prefix = (0, import_obsidian.normalizePath)(folderPath).replace(/\/$/, "");
    if (!prefix) return { audio: 0, playlists: 0, notes: 0, total: 0 };
    let audio = 0;
    let playlists = 0;
    let notes = 0;
    for (const file of this.app.vault.getFiles()) {
      if (file.path !== prefix && !file.path.startsWith(`${prefix}/`)) continue;
      if (AUDIO_EXTENSIONS.has(file.extension.toLowerCase())) audio += 1;
      else if (file.extension.toLowerCase() === "md") {
        notes += 1;
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
        if (firstString(frontmatter?.playlist_url, frontmatter?.playlistUrl, frontmatter?.music_playlist)) playlists += 1;
      }
    }
    return { audio, playlists, notes, total: audio + notes };
  }
  inferSourceKind(folderPath, current = "generic") {
    const stats = this.sourceStats(folderPath);
    if (stats.playlists > 0) return "music";
    return stats.audio > 0 ? "podcast" : current === "podcast" ? "generic" : current;
  }
  list(source, limit = 80) {
    const prefix = (0, import_obsidian.normalizePath)(source.folder).replace(/\/$/, "");
    const notesByTitle = new Map(
      this.app.vault.getMarkdownFiles().map((file) => [file.basename, file.path])
    );
    return this.app.vault.getFiles().filter((file) => file.extension === "md" || AUDIO_EXTENSIONS.has(file.extension.toLowerCase())).filter((file) => !prefix || file.path === prefix || file.path.startsWith(`${prefix}/`)).sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, limit).map((file) => this.toItem(file, source, notesByTitle));
  }
  all(sources, limitPerSource = 40) {
    return sources.filter((source) => source.enabled).flatMap((source) => this.list(source, limitPerSource)).sort((a, b) => b.modified - a.modified);
  }
  itemForFile(file, source) {
    const notesByTitle = new Map(
      this.app.vault.getMarkdownFiles().map((note) => [note.basename, note.path])
    );
    return this.toItem(file, source, notesByTitle);
  }
  toItem(file, source, notesByTitle) {
    const isAudioFile = AUDIO_EXTENSIONS.has(file.extension.toLowerCase());
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter ?? {};
    const rawTitle = firstString(frontmatter.displayTitle, frontmatter.bookTitle, frontmatter.title, file.basename);
    const title = isAudioFile ? cleanAudioTitle(rawTitle) || file.basename : rawTitle;
    const author = firstString(frontmatter.bookAuthor, frontmatter.author, frontmatter.user);
    const podcast = firstString(frontmatter.podcast, frontmatter.channel, frontmatter.show);
    const subtitle = author || podcast || source.name;
    const excerpt = firstString(frontmatter.description, frontmatter.summary, frontmatter.excerpt, source.name);
    const rawCover = firstString(
      frontmatter.coverPath,
      frontmatter.cover,
      frontmatter.image,
      frontmatter.thumbnail,
      source.coverPath
    );
    const rawAudio = firstString(
      frontmatter.audio,
      frontmatter.audioPath,
      frontmatter.audio_url,
      frontmatter.media,
      frontmatter["\u97F3\u9891"],
      frontmatter["\u64AD\u5BA2\u97F3\u9891"]
    );
    const playlistUrl = firstString(
      frontmatter.playlist_url,
      frontmatter.playlistUrl,
      frontmatter.music_playlist,
      frontmatter.musicPlaylist
    );
    const embedAudio = cache?.embeds?.find((embed) => /\.(mp3|m4a|wav|flac|aac)$/i.test(embed.link))?.link ?? "";
    const linkedAudio = cache?.links?.find((link) => /\.(mp3|m4a|wav|flac|aac|ogg|opus)$/i.test(link.link))?.link ?? "";
    const bodyUrl = cache?.links?.find((link) => /^https?:\/\//i.test(link.link))?.link ?? "";
    const externalUrl = firstString(playlistUrl, frontmatter.source, frontmatter.url, frontmatter.link, bodyUrl);
    const progress = parseProgress(frontmatter["reading-progress"] ?? frontmatter.progress);
    const notePath = isAudioFile ? notesByTitle.get(title) ?? "" : file.path;
    return {
      id: file.path,
      file,
      source,
      kind: isAudioFile ? "podcast" : source.kind,
      title,
      subtitle,
      excerpt,
      cover: this.resolveResource(cleanLink(rawCover), file),
      externalUrl,
      audioPath: isAudioFile ? file.path : cleanLink(rawAudio || embedAudio || linkedAudio),
      playlistUrl,
      notePath,
      progress,
      created: file.stat.ctime,
      modified: file.stat.mtime
    };
  }
  resolveResource(path, origin) {
    if (!path) return "";
    if (/^(https?:|data:|app:)/i.test(path)) return path;
    const normalized = (0, import_obsidian.normalizePath)(path.replace(/^\/+/, ""));
    const direct = this.app.vault.getAbstractFileByPath(normalized);
    if (direct instanceof import_obsidian.TFile) return this.app.vault.getResourcePath(direct);
    const linked = this.app.metadataCache.getFirstLinkpathDest(normalized, origin?.path ?? "");
    return linked instanceof import_obsidian.TFile ? this.app.vault.getResourcePath(linked) : "";
  }
  kindLabel(kind) {
    return { book: "\u4E66\u7C4D", podcast: "\u64AD\u5BA2", music: "\u97F3\u4E50", x: "X \u63A8\u6587", news: "\u65B0\u95FB", clip: "\u7F51\u9875\u6536\u85CF", generic: "\u7B14\u8BB0" }[kind];
  }
};

// src/settings.ts
var import_obsidian2 = require("obsidian");

// src/types.ts
var THEME_LABELS = {
  grass: "\u6D45\u8349\u7EFF",
  blue: "\u6D77\u76D0\u84DD",
  pink: "\u6A31\u82B1\u7C89",
  rose: "\u73AB\u7470\u7EA2",
  black: "\u66DC\u77F3\u9ED1",
  glass: "\u900F\u660E\u73BB\u7483"
};
var SOURCE_KIND_LABELS = {
  book: "\u9605\u8BFB",
  podcast: "\u6536\u542C",
  music: "\u97F3\u4E50",
  x: "\u63A8\u6587",
  news: "\u65B0\u95FB",
  clip: "\u6536\u85CF",
  generic: "\u6587\u4EF6\u5939"
};
var SOURCE_GROUP_LABELS = {
  information: "\u4FE1\u606F",
  skills: "\u6280\u80FD\u50A8\u5907",
  bookshelf: "\u4E66\u67B6",
  ideas: "\u60F3\u6CD5\u6536\u85CF",
  needs: "\u9700\u6C42\u6536\u96C6",
  podcast: "\u64AD\u5BA2\u9875\u9762",
  music: "\u97F3\u4E50\u6536\u85CF"
};
var DEFAULT_SETTINGS = {
  theme: "grass",
  themeMode: "system",
  annotationHighlight: "yellow",
  bannerPath: "",
  annotationFolder: "Dashboard Notes",
  dashboardTitle: "\u5185\u5BB9\u56FE\u4E66\u9986",
  sourceGroupOrder: ["podcast", "music", "information", "skills", "bookshelf", "ideas", "needs"],
  sources: [],
  coverOverrides: {},
  playbackMode: "sequential",
  usageByDate: {},
  viewHistory: {},
  contentProgress: {},
  musicCollectionSnapshots: {}
};

// src/settings.ts
var ContentLibrarySettingsTab = class extends import_obsidian2.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("cld-settings");
    new import_obsidian2.Setting(containerEl).setName("\u5185\u5BB9\u56FE\u4E66\u9986").setHeading();
    containerEl.createEl("p", {
      text: "\u4E0D\u9700\u8981\u9884\u5148\u521B\u5EFA\u56FA\u5B9A\u6587\u4EF6\u5939\u3002\u9009\u62E9 Vault \u91CC\u5DF2\u6709\u7684\u6587\u4EF6\u5939\u5373\u53EF\uFF1B\u663E\u793A\u540D\u79F0\u53EF\u4EE5\u548C\u5B9E\u9645\u8DEF\u5F84\u4E0D\u540C\u3002"
    });
    new import_obsidian2.Setting(containerEl).setName("\u5916\u89C2").setHeading();
    new import_obsidian2.Setting(containerEl).setName("\u6807\u9898").addText((text) => text.setValue(this.plugin.settings.dashboardTitle).onChange(async (value) => {
      this.plugin.settings.dashboardTitle = value.trim() || "\u5185\u5BB9\u56FE\u4E66\u9986";
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("\u989C\u8272").addDropdown((dropdown) => {
      for (const [value, label] of Object.entries(THEME_LABELS)) dropdown.addOption(value, label);
      dropdown.setValue(this.plugin.settings.theme).onChange(async (value) => {
        this.plugin.settings.theme = value;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian2.Setting(containerEl).setName("\u660E\u6697\u6A21\u5F0F").setDesc("\u9009\u62E9\u8DDF\u968F\u7CFB\u7EDF\uFF0C\u6216\u56FA\u5B9A\u4F7F\u7528\u767D\u5929 / \u591C\u95F4\u6A21\u5F0F\u3002").addDropdown((dropdown) => {
      dropdown.addOption("system", "\u8DDF\u968F\u7CFB\u7EDF");
      dropdown.addOption("light", "\u767D\u5929\u6A21\u5F0F");
      dropdown.addOption("dark", "\u591C\u95F4\u6A21\u5F0F");
      dropdown.setValue(this.plugin.settings.themeMode).onChange(async (value) => {
        this.plugin.settings.themeMode = value;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian2.Setting(containerEl).setName("\u6279\u6CE8\u9AD8\u4EAE\u989C\u8272").setDesc("\u6587\u7AE0\u5185\u5DF2\u4FDD\u5B58\u6458\u5F55\u7684\u9AD8\u4EAE\u989C\u8272\u3002").addDropdown((dropdown) => {
      dropdown.addOption("yellow", "\u4EAE\u9EC4\u8272");
      dropdown.addOption("orange", "\u6A59\u8272");
      dropdown.addOption("blue", "\u84DD\u8272");
      dropdown.addOption("pink", "\u7C89\u8272");
      dropdown.setValue(this.plugin.settings.annotationHighlight).onChange(async (value) => {
        this.plugin.settings.annotationHighlight = value;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian2.Setting(containerEl).setName("\u6A2A\u5E45\u56FE\u7247").setDesc("\u53EF\u586B\u5199 Vault \u5185\u56FE\u7247\u8DEF\u5F84\u6216\u7F51\u7EDC\u56FE\u7247\u5730\u5740\uFF0C\u4E5F\u53EF\u4EE5\u76F4\u63A5\u5BFC\u5165\u3002\u6CA1\u6709\u56FE\u7247\u65F6\u4F7F\u7528\u5185\u7F6E\u73BB\u7483\u5360\u4F4D\u56FE\u3002").addText((text) => text.setPlaceholder("Card Dashboard Assets/banner.jpg").setValue(this.plugin.settings.bannerPath).onChange(async (value) => {
      this.plugin.settings.bannerPath = value.trim();
      await this.plugin.saveSettings();
    })).addButton((button) => button.setButtonText("\u5BFC\u5165\u56FE\u7247").onClick(() => {
      chooseImage(async (file) => {
        try {
          this.plugin.settings.bannerPath = await this.plugin.importImage(file, "Banners");
          await this.plugin.saveSettings();
          this.display();
        } catch (error) {
          console.error("[Content Library] Banner import failed", error);
        }
      });
    }));
    new import_obsidian2.Setting(containerEl).setName("\u6279\u6CE8\u4FDD\u5B58\u4F4D\u7F6E").setDesc("\u9605\u8BFB\u6279\u6CE8\u548C\u97F3\u9891\u7B14\u8BB0\u4F1A\u4FDD\u5B58\u5230\u8FD9\u91CC\uFF1B\u6587\u4EF6\u5939\u4F1A\u5728\u7B2C\u4E00\u6B21\u4FDD\u5B58\u65F6\u521B\u5EFA\uFF0C\u4E5F\u53EF\u4EE5\u6539\u6210\u4F60\u81EA\u5DF1\u7684\u8DEF\u5F84\u3002").addText((text) => text.setValue(this.plugin.settings.annotationFolder).onChange(async (value) => {
      this.plugin.settings.annotationFolder = value.trim() || "Dashboard Notes";
      await this.plugin.saveSettings(false);
    }));
    const sourceHeader = containerEl.createDiv({ cls: "cld-settings-heading" });
    new import_obsidian2.Setting(sourceHeader).setName("\u6211\u7684\u6587\u4EF6\u5939").setHeading();
    new import_obsidian2.ButtonComponent(sourceHeader).setButtonText("\u6DFB\u52A0\u6587\u4EF6\u5939").setIcon("folder-plus").onClick(async () => {
      this.plugin.settings.sources.push({
        id: `source-${Date.now()}`,
        name: "\u65B0\u6587\u4EF6\u5939",
        folder: "",
        kind: "generic",
        group: "ideas",
        icon: "folder",
        coverPath: "",
        enabled: true
      });
      await this.plugin.saveSettings(false);
      this.display();
    });
    sourceHeader.createEl("p", {
      cls: "setting-item-description",
      text: "\u8FD9\u91CC\u53EA\u7BA1\u7406\u4F60\u9009\u62E9\u7684\u6587\u4EF6\u5939\uFF0C\u4E0D\u518D\u81EA\u52A8\u6DFB\u52A0\u9ED8\u8BA4\u680F\u76EE\u3002"
    });
    for (const source of this.plugin.settings.sources) this.renderSource(containerEl, source);
    if (!this.plugin.settings.sources.length) {
      containerEl.createDiv({
        cls: "cld-settings-empty",
        text: "\u8FD8\u6CA1\u6709\u6587\u4EF6\u5939\u3002\u70B9\u51FB\u4E0A\u9762\u7684\u201C\u6DFB\u52A0\u6587\u4EF6\u5939\u201D\u5F00\u59CB\u3002"
      });
    }
  }
  renderSource(container, source) {
    const stats = this.plugin.indexer.sourceStats(source.folder);
    const detectedLabel = stats.playlists > 0 ? `${stats.playlists} \u4E2A\u6B4C\u5355${stats.notes > stats.playlists ? ` \xB7 ${stats.notes - stats.playlists} \u7BC7\u7B14\u8BB0` : ""}` : stats.audio > 0 ? `${stats.audio} \u4E2A\u97F3\u9891${stats.notes ? ` \xB7 ${stats.notes} \u7BC7\u7B14\u8BB0` : ""}` : `${stats.notes} \u7BC7\u7B14\u8BB0 \xB7 ${SOURCE_KIND_LABELS[source.kind]}`;
    const card = container.createDiv({ cls: "cld-source-setting" });
    const title = card.createDiv({ cls: "cld-source-setting-title" });
    const copy = title.createDiv({ cls: "cld-source-setting-copy" });
    copy.createEl("strong", { text: source.name || "\u672A\u547D\u540D\u6587\u4EF6\u5939" });
    copy.createEl("small", {
      text: source.folder ? `${source.folder} \xB7 ${detectedLabel}` : "\u8BF7\u9009\u62E9\u4E00\u4E2A\u6587\u4EF6\u5939"
    });
    const controls = title.createDiv({ cls: "cld-source-setting-controls" });
    const visible = controls.createEl("input", {
      attr: { type: "checkbox", "aria-label": "\u663E\u793A\u5728 Dashboard" }
    });
    visible.checked = source.enabled;
    visible.addEventListener("change", async () => {
      source.enabled = visible.checked;
      await this.plugin.saveSettings();
    });
    const body = card.createDiv({ cls: "cld-source-setting-body" });
    body.hidden = true;
    new import_obsidian2.ButtonComponent(controls).setButtonText("\u7F16\u8F91").onClick(() => {
      body.hidden = !body.hidden;
    });
    new import_obsidian2.ButtonComponent(controls).setIcon("trash-2").setTooltip("\u5220\u9664").onClick(async () => {
      this.plugin.settings.sources = this.plugin.settings.sources.filter((entry) => entry.id !== source.id);
      await this.plugin.saveSettings(false);
      this.display();
    });
    new import_obsidian2.Setting(body).setName("\u663E\u793A\u540D\u79F0").setDesc("\u8FD9\u662F Dashboard \u4E0A\u663E\u793A\u7684\u540D\u79F0\uFF0C\u4E0D\u4F1A\u4FEE\u6539 Vault \u4E2D\u7684\u5B9E\u9645\u6587\u4EF6\u5939\u540D\u79F0\u3002").addText((text) => text.setValue(source.name).onChange(async (value) => {
      source.name = value.trim() || "\u6587\u4EF6\u5939";
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(body).setName("\u6240\u5C5E\u5206\u7C7B").addDropdown((dropdown) => {
      for (const [value, label] of Object.entries(SOURCE_GROUP_LABELS)) dropdown.addOption(value, label);
      dropdown.setValue(source.group).onChange(async (value) => {
        source.group = value;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian2.Setting(body).setName("\u9009\u62E9\u6587\u4EF6\u5939").setDesc("\u9009\u62E9 Vault \u4E2D\u5DF2\u6709\u7684\u4EFB\u610F\u6587\u4EF6\u5939\uFF1B\u63D2\u4EF6\u4E0D\u4F1A\u79FB\u52A8\u6216\u590D\u5236\u5176\u4E2D\u7684\u7B14\u8BB0\u3002").addDropdown((dropdown) => {
      const folders = this.app.vault.getAllLoadedFiles().filter((file) => file instanceof import_obsidian2.TFolder && Boolean(file.path)).sort((a, b) => a.path.localeCompare(b.path));
      if (source.folder && !folders.some((folder) => folder.path === source.folder)) dropdown.addOption(source.folder, source.folder);
      dropdown.addOption("", "\u8BF7\u9009\u62E9");
      for (const folder of folders) dropdown.addOption(folder.path, folder.path);
      dropdown.setValue(source.folder).onChange(async (value) => {
        source.folder = value;
        source.kind = this.plugin.indexer.inferSourceKind(value, source.kind);
        source.icon = source.kind === "podcast" ? "headphones" : "folder";
        if ((!source.name || source.name === "\u65B0\u6587\u4EF6\u5939") && value) {
          source.name = value.split("/").pop() || "\u6587\u4EF6\u5939";
        }
        await this.plugin.saveSettings(false);
        this.display();
      });
    });
    body.createEl("p", {
      cls: "setting-item-description",
      text: stats.playlists > 0 ? "\u5DF2\u8BC6\u522B\u4E3A\u97F3\u4E50\u6B4C\u5355\u6587\u4EF6\u5939\u3002Markdown \u6587\u4EF6\u7684 playlist_url \u4F1A\u540C\u6B65\u7F51\u6613\u4E91\u6B4C\u5355\u3002" : stats.audio > 0 ? "\u5DF2\u81EA\u52A8\u8BC6\u522B\u4E3A\u97F3\u9891\u64AD\u653E\u5217\u8868\u3002" : "\u5DF2\u81EA\u52A8\u8BC6\u522B\u4E3A\u7B14\u8BB0\u6587\u4EF6\u5939\u3002"
    });
  }
};
function chooseImage(callback) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp,image/gif";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void callback(file);
  }, { once: true });
  input.click();
}

// src/view.ts
var import_obsidian3 = require("obsidian");

// assets/cld-glass-green-bg.jpg
var cld_glass_green_bg_default = "data:image/jpeg;base64,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";

// src/view.ts
var CONTENT_LIBRARY_VIEW_TYPE = "content-library-dashboard-view";
var ANNOTATION_SOURCE_ID = "system-dashboard-annotations";
var ContentLibraryView = class _ContentLibraryView extends import_obsidian3.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  activeSourceId = "today";
  selected = null;
  detailOpen = false;
  audio = null;
  audioItemId = null;
  playing = false;
  autoplayItemId = null;
  searchQuery = "";
  durationCache = /* @__PURE__ */ new Map();
  expandedMusicPlaylists = /* @__PURE__ */ new Set();
  musicDetailItemPath = null;
  inspirationOffset = 0;
  inspirationHourKey = "";
  readingScrollCleanup = null;
  sidebarScrollTop = 0;
  navScrollLeft = 0;
  articleReturnItem = null;
  draggedNavItem = null;
  getViewType() {
    return CONTENT_LIBRARY_VIEW_TYPE;
  }
  getDisplayText() {
    return "Content Library";
  }
  getIcon() {
    return "layout-dashboard";
  }
  async onOpen() {
    this.inspirationOffset = Math.floor(Math.random() * 1e6);
    this.inspirationHourKey = this.currentInspirationHour();
    this.registerInterval(window.setInterval(() => {
      if (this.app.workspace.getActiveViewOfType(_ContentLibraryView)?.leaf === this.leaf && document.hasFocus()) {
        void this.plugin.recordUsageMinute().then(() => {
          const value = this.contentEl.querySelector('[data-metric="\u4F7F\u7528\u65F6\u95F4"] strong');
          if (value) value.textContent = formatUsage(this.plugin.todayUsageMinutes());
        });
      }
    }, 6e4));
    this.registerInterval(window.setInterval(() => this.updateTodayClock(), 1e3));
    this.registerInterval(window.setInterval(() => {
      if (this.app.workspace.getActiveViewOfType(_ContentLibraryView)?.leaf !== this.leaf || this.detailOpen || this.activeSourceId !== "today") return;
      const hour = this.currentInspirationHour();
      if (hour === this.inspirationHourKey) return;
      this.inspirationHourKey = hour;
      this.inspirationOffset += 1;
      void this.refresh();
    }, 6e4));
    await this.refresh();
  }
  async onClose() {
    this.readingScrollCleanup?.();
    this.destroyAudio();
  }
  async refresh() {
    this.readingScrollCleanup?.();
    this.readingScrollCleanup = null;
    const root = this.contentEl;
    root.empty();
    root.addClass("cld-view-content");
    const shell = root.createDiv({ cls: `cld-root cld-theme-${this.plugin.settings.theme} cld-mode-${this.plugin.settings.themeMode} cld-annotation-${this.plugin.settings.annotationHighlight}` });
    if (this.plugin.settings.theme === "glass") {
      shell.style.setProperty("--cld-glass-background", `url("${cld_glass_green_bg_default}")`);
    }
    const podcastHome = !this.detailOpen && this.isPodcastMode();
    const musicHome = !this.detailOpen && this.isMusicMode();
    const layout = shell.createDiv({ cls: `cld-layout${this.detailOpen ? " is-detail" : ""}${podcastHome ? " is-podcast" : ""}${musicHome ? " is-music" : ""}` });
    this.renderSidebar(layout);
    const main = layout.createEl("main", { cls: "cld-main" });
    if (this.detailOpen && this.selected) await this.renderDetail(main, this.selected);
    else {
      this.renderTopbar(main);
      await this.renderHome(main);
      if (this.isPodcastMode()) await this.renderPodcastInspector(layout);
      else if (!this.isMusicMode()) this.renderInspector(layout);
    }
  }
  enabledSources() {
    const sources = this.plugin.settings.sources.filter((source) => source.enabled && source.folder);
    const folder = this.plugin.settings.annotationFolder.trim() || "Dashboard Notes";
    if (sources.some((source) => source.folder.replace(/\/$/, "") === folder.replace(/\/$/, ""))) return sources;
    return [...sources, {
      id: ANNOTATION_SOURCE_ID,
      name: "\u6211\u7684\u6279\u6CE8",
      folder,
      kind: "generic",
      group: "ideas",
      icon: "notebook-pen",
      coverPath: "",
      enabled: true
    }];
  }
  activeSource() {
    return this.enabledSources().find((entry) => entry.id === this.activeSourceId);
  }
  isPodcastMode() {
    const source = this.activeSource();
    return Boolean(source && (source.kind === "podcast" || this.plugin.indexer.sourceStats(source.folder).audio > 0));
  }
  isMusicMode() {
    const source = this.activeSource();
    return Boolean(source && (source.kind === "music" || this.currentItems().some((item) => Boolean(item.playlistUrl))));
  }
  currentItems() {
    const sources = this.enabledSources();
    if (this.activeSourceId === "today") {
      const all = this.plugin.indexer.all(sources, 240);
      const viewed = all.filter((item) => this.plugin.viewedAt(item.file) > 0).sort((a, b) => this.plugin.viewedAt(b.file) - this.plugin.viewedAt(a.file));
      if (viewed.length) return viewed.slice(0, 36);
      return all.filter((item) => item.kind !== "book").slice(0, 36);
    }
    const source = sources.find((entry) => entry.id === this.activeSourceId);
    return source ? this.plugin.indexer.list(source) : [];
  }
  renderSidebar(layout) {
    const aside = layout.createEl("aside", { cls: "cld-sidebar cld-glass", attr: { "aria-label": "\u5185\u5BB9\u5BFC\u822A" } });
    const brand = aside.createDiv({ cls: "cld-brand" });
    brand.createSpan({ cls: "cld-brand-name", text: "Mori" });
    const nav = aside.createEl("nav", { cls: "cld-nav" });
    aside.addEventListener("scroll", () => {
      this.sidebarScrollTop = aside.scrollTop;
    });
    nav.addEventListener("scroll", () => {
      this.navScrollLeft = nav.scrollLeft;
    });
    nav.addEventListener("wheel", (event) => {
      if (nav.scrollWidth <= nav.clientWidth) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta) return;
      const previous = nav.scrollLeft;
      nav.scrollLeft += delta;
      if (nav.scrollLeft !== previous) event.preventDefault();
    }, { passive: false });
    this.bindNavDragAndDrop(nav);
    nav.createEl("p", { cls: "cld-nav-section-label", text: "\u4E3B\u9875" });
    this.renderNavButton(nav, "today", "\u4ECA\u5929", "home", this.plugin.indexer.all(this.enabledSources(), 8).length);
    const groupOrder = this.plugin.settings.sourceGroupOrder;
    for (const group of groupOrder) {
      const sources = this.enabledSources().filter((source) => source.group === group);
      if (!sources.length) continue;
      nav.createEl("p", {
        cls: "cld-nav-section-label cld-draggable-nav-group",
        text: SOURCE_GROUP_LABELS[group],
        attr: { draggable: "true", "data-nav-group": group }
      });
      for (const source of sources) this.renderFolderButton(nav, source);
    }
    const add = aside.createEl("button", { cls: "cld-add-source", attr: { type: "button" } });
    const icon = add.createSpan();
    (0, import_obsidian3.setIcon)(icon, "folder-plus");
    add.createSpan({ text: "\u6DFB\u52A0\u6587\u4EF6\u5939" });
    add.addEventListener("click", () => this.plugin.openSettingTab());
    window.requestAnimationFrame(() => {
      if (!aside.isConnected) return;
      aside.scrollTop = this.sidebarScrollTop;
      nav.scrollLeft = this.navScrollLeft;
    });
  }
  renderFolderButton(parent, source) {
    const count = this.plugin.indexer.list(source, 99).length;
    const button = parent.createEl("button", {
      cls: `cld-folder-nav${this.activeSourceId === source.id ? " is-active" : ""}`,
      attr: {
        type: "button",
        "aria-pressed": String(this.activeSourceId === source.id),
        draggable: "true",
        "data-nav-source": source.id
      }
    });
    button.createSpan({ text: source.name });
    button.createEl("small", { text: `${count} \u9879` });
    button.addEventListener("click", () => {
      this.activeSourceId = source.id;
      this.selected = null;
      this.detailOpen = false;
      this.searchQuery = "";
      void this.refresh();
    });
  }
  bindNavDragAndDrop(nav) {
    nav.addEventListener("dragstart", (event) => {
      const target = event.target.closest("[data-nav-group], [data-nav-source]");
      if (!target) return;
      const group = target.dataset.navGroup;
      const source = target.dataset.navSource;
      this.draggedNavItem = group ? { kind: "group", id: group } : source ? { kind: "source", id: source } : null;
      if (!this.draggedNavItem) return;
      target.addClass("is-dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", this.draggedNavItem.id);
      }
    });
    nav.addEventListener("dragover", (event) => {
      if (!this.draggedNavItem) return;
      const selector = this.draggedNavItem.kind === "group" ? "[data-nav-group]" : "[data-nav-source]";
      const target = event.target.closest(selector);
      if (!target || this.draggedNavItem.kind === "group" && target.dataset.navGroup === this.draggedNavItem.id || this.draggedNavItem.kind === "source" && target.dataset.navSource === this.draggedNavItem.id) return;
      event.preventDefault();
      target.addClass("is-drag-over");
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });
    nav.addEventListener("dragleave", (event) => {
      const target = event.target.closest(".is-drag-over");
      target?.removeClass("is-drag-over");
    });
    nav.addEventListener("drop", (event) => {
      event.preventDefault();
      const dragged = this.draggedNavItem;
      if (!dragged) return;
      const selector = dragged.kind === "group" ? "[data-nav-group]" : "[data-nav-source]";
      const target = event.target.closest(selector);
      target?.removeClass("is-drag-over");
      this.draggedNavItem = null;
      if (!target) return;
      if (dragged.kind === "group") void this.moveGroupByDrop(dragged.id, target.dataset.navGroup || "");
      else void this.moveSourceByDrop(dragged.id, target.dataset.navSource || "");
    });
    nav.addEventListener("dragend", () => {
      nav.querySelectorAll(".is-dragging, .is-drag-over").forEach((element) => element.removeClass("is-dragging", "is-drag-over"));
      this.draggedNavItem = null;
    });
  }
  async moveGroupByDrop(draggedId, targetId) {
    const order = this.plugin.settings.sourceGroupOrder;
    const from = order.indexOf(draggedId);
    const to = order.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return;
    [order[from], order[to]] = [order[to], order[from]];
    await this.plugin.saveSettings(false);
    await this.refresh();
  }
  async moveSourceByDrop(draggedId, targetId) {
    const sources = this.plugin.settings.sources;
    const from = sources.findIndex((source) => source.id === draggedId);
    const to = sources.findIndex((source) => source.id === targetId);
    if (from < 0 || to < 0 || from === to || sources[from].group !== sources[to].group) return;
    [sources[from], sources[to]] = [sources[to], sources[from]];
    await this.plugin.saveSettings(false);
    await this.refresh();
  }
  updateTodayClock() {
    const now = /* @__PURE__ */ new Date();
    const clock = this.contentEl.querySelector(".cld-live-clock");
    if (clock) clock.textContent = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now);
    const greeting = this.contentEl.querySelector(".cld-live-greeting");
    if (greeting) greeting.textContent = greetingForHour(now.getHours());
  }
  renderNavButton(parent, id, label, iconName, count) {
    const button = parent.createEl("button", {
      cls: `cld-nav-item${this.activeSourceId === id ? " is-active" : ""}`,
      attr: { type: "button", "aria-pressed": String(this.activeSourceId === id) }
    });
    const icon = button.createSpan({ cls: "cld-nav-icon" });
    (0, import_obsidian3.setIcon)(icon, iconName);
    button.createSpan({ cls: "cld-nav-label", text: label });
    button.createSpan({ cls: "cld-nav-count", text: String(count) });
    button.addEventListener("click", () => {
      this.activeSourceId = id;
      this.selected = null;
      this.detailOpen = false;
      this.searchQuery = "";
      void this.refresh();
    });
  }
  renderTopbar(main) {
    const header = main.createEl("header", { cls: "cld-topbar" });
    const greeting = header.createDiv();
    const source = this.activeSource();
    const podcastMode = this.isPodcastMode();
    if (this.activeSourceId === "today" && !podcastMode) {
      const today = /* @__PURE__ */ new Date();
      greeting.createEl("div", { cls: "cld-live-date", text: new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(today) });
    } else {
      greeting.createEl("small", { text: podcastMode ? "\u6536\u542C\u7A7A\u95F4" : new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(/* @__PURE__ */ new Date()) });
    }
    greeting.createEl("h1", { cls: podcastMode ? "" : "cld-live-greeting", text: podcastMode ? "Podcast" : greetingForHour((/* @__PURE__ */ new Date()).getHours()) });
    const actions = header.createDiv({ cls: "cld-topbar-actions" });
    const select = actions.createEl("select", { cls: "dropdown cld-theme-select", attr: { "aria-label": "\u4E3B\u4F53\u914D\u8272" } });
    for (const [value, label] of Object.entries(THEME_LABELS)) {
      select.createEl("option", { value, text: label });
    }
    select.value = this.plugin.settings.theme;
    select.addEventListener("change", async () => {
      this.plugin.settings.theme = select.value;
      await this.plugin.saveSettings();
    });
    if (podcastMode) {
      const search = this.iconButton(actions, "search", "\u641C\u7D22\u8282\u76EE");
      search.addEventListener("click", () => {
        const next = window.prompt("\u641C\u7D22\u8282\u76EE", this.searchQuery);
        if (next === null) return;
        this.searchQuery = next.trim();
        void this.refresh();
      });
    }
    if (!podcastMode) {
      if (source && source.id !== ANNOTATION_SOURCE_ID) {
        const create = actions.createEl("button", { cls: "cld-topbar-text-button", attr: { type: "button" } });
        const createIcon = create.createSpan();
        (0, import_obsidian3.setIcon)(createIcon, "file-plus-2");
        create.createSpan({ text: "\u65B0\u5EFA\u7B14\u8BB0" });
        create.addEventListener("click", () => {
          new NoteTitleModal(this.app, source.name, async (title) => {
            const file = await this.plugin.createNoteInSource(source, title);
            new import_obsidian3.Notice(`\u5DF2\u521B\u5EFA ${file.path}`);
          }).open();
        });
      }
      const settings = this.iconButton(actions, "settings-2", "Dashboard settings");
      settings.addEventListener("click", () => this.plugin.openSettingTab());
    }
  }
  async renderHome(main) {
    const items = this.currentItems();
    const source = this.activeSource();
    if (this.isMusicMode()) {
      this.renderHomeBanner(main, source, items.length, false);
      await this.renderMusicLibrary(main, items);
      return;
    }
    if (this.isPodcastMode()) {
      this.renderHomeBanner(main, source, items.length, true);
      this.renderPodcastLibrary(main, "Podcast", items);
      return;
    }
    this.renderHomeBanner(main, source, items.length, false);
    const isDashboardHome = this.activeSourceId === "today";
    const metricItems = isDashboardHome ? this.plugin.indexer.all(this.enabledSources(), 120) : items;
    const metrics = main.createEl("section", { cls: "cld-metrics", attr: { "aria-label": "\u5185\u5BB9\u6982\u89C8" } });
    const today = metricItems.filter((item) => Date.now() - item.modified < 24 * 60 * 60 * 1e3).length;
    const books = metricItems.filter((item) => item.kind === "book").length;
    const audio = metricItems.filter((item) => item.kind === "podcast").length;
    this.metric(metrics, "\u4ECA\u65E5", String(today), Math.min(100, today * 12));
    if (isDashboardHome) this.metric(metrics, "\u4F7F\u7528\u65F6\u95F4", formatUsage(this.plugin.todayUsageMinutes()), Math.min(100, this.plugin.todayUsageMinutes() / 1.2));
    this.metric(metrics, "\u9605\u8BFB", String(books), Math.min(100, books * 9));
    this.metric(metrics, "\u6536\u542C", String(audio), Math.min(100, audio * 13));
    if (!items.length) {
      const empty = main.createDiv({ cls: "cld-empty cld-glass" });
      empty.createEl("h3", { text: "\u8FD9\u4E2A\u680F\u76EE\u8FD8\u6CA1\u6709\u5185\u5BB9" });
      empty.createEl("p", { text: "\u5728\u8BBE\u7F6E\u4E2D\u9009\u62E9\u4E00\u4E2A\u5305\u542B\u7B14\u8BB0\u6216\u97F3\u9891\u7684 Vault \u6587\u4EF6\u5939\u3002" });
      return;
    }
    if (isDashboardHome) {
      await this.renderDailyInspiration(main);
      this.renderActivity(main, metricItems);
    }
    const sectionHead = main.createDiv({ cls: "cld-section-head cld-recent-head" });
    sectionHead.createEl("strong", { text: isDashboardHome ? "\u6700\u8FD1\u67E5\u770B" : source?.name || "\u5185\u5BB9" });
    const hasViewedItems = isDashboardHome && items.some((item) => this.plugin.viewedAt(item.file) > 0);
    sectionHead.createEl("small", {
      text: isDashboardHome && !hasViewedItems ? "\u6682\u65E0\u67E5\u770B\u8BB0\u5F55 \xB7 \u5148\u5C55\u793A\u6700\u65B0\u6587\u7AE0" : `${items.length} \u9879`
    });
    const grid = main.createDiv({ cls: "cld-library-grid cld-recent-grid" });
    for (const item of items.slice(0, 20)) this.renderContentCard(grid, item);
  }
  async renderMusicLibrary(main, items) {
    const playlists = items.filter((item) => Boolean(item.playlistUrl));
    const sectionHead = main.createDiv({ cls: "cld-section-head cld-music-section-head" });
    const heading = sectionHead.createDiv();
    heading.createEl("strong", { text: "\u97F3\u4E50\u6536\u85CF" });
    heading.createEl("p", { text: "\u6B4C\u5355\u5185\u5BB9\u6765\u81EA\u7F51\u6613\u4E91\uFF0C\u70B9\u51FB\u6B4C\u66F2\u540E\u5728\u5B98\u65B9\u9875\u9762\u64AD\u653E" });
    const actions = sectionHead.createDiv({ cls: "cld-music-section-actions" });
    actions.createEl("small", { text: `${playlists.length} \u4E2A\u6B4C\u5355` });
    const add = actions.createEl("button", { cls: "cld-text-button", text: "\u6DFB\u52A0\u6B4C\u5355", attr: { type: "button" } });
    add.addEventListener("click", () => {
      const source = this.activeSource();
      if (!source) return;
      new MusicPlaylistModal(this.app, source.name, async (url, customTitle) => {
        const playlist = await this.plugin.getNetEasePlaylist(url);
        const file = await this.plugin.createMusicPlaylistNote(source, url, customTitle || playlist?.title || (isQqMusicUrl(url) ? "QQ\u97F3\u4E50\u6B4C\u5355" : "\u7F51\u6613\u4E91\u6B4C\u5355"));
        new import_obsidian3.Notice(`\u5DF2\u6DFB\u52A0\u6B4C\u5355\uFF1A${file.basename}`);
        await this.refresh();
      }).open();
    });
    if (!playlists.length) {
      const empty = main.createDiv({ cls: "cld-empty cld-glass" });
      empty.createEl("h3", { text: "\u8FD8\u6CA1\u6709\u6B4C\u5355" });
      empty.createEl("p", { text: "\u5728\u97F3\u4E50\u6536\u85CF\u6587\u4EF6\u5939\u91CC\u65B0\u5EFA Markdown \u6587\u4EF6\uFF0C\u5E76\u586B\u5199 playlist_url\u3002" });
      return;
    }
    const detailItem = playlists.find((item) => item.file.path === this.musicDetailItemPath);
    if (detailItem) {
      const playlist = isQqMusicUrl(detailItem.playlistUrl) ? await this.plugin.getQqMusicCollection(detailItem.playlistUrl) : await this.plugin.getNetEasePlaylist(detailItem.playlistUrl);
      const preview = playlist?.cover ? null : await this.plugin.getWebPreview(detailItem.playlistUrl);
      await this.renderMusicPlaylist(main, detailItem, playlist, preview);
      return;
    }
    const grid = main.createDiv({ cls: "cld-music-card-grid" });
    for (const item of playlists) {
      const playlist = isQqMusicUrl(item.playlistUrl) ? await this.plugin.getQqMusicCollection(item.playlistUrl) : await this.plugin.getNetEasePlaylist(item.playlistUrl);
      const preview = playlist?.cover ? null : await this.plugin.getWebPreview(item.playlistUrl);
      this.renderMusicPlaylistCard(grid, item, playlist, preview);
    }
  }
  renderMusicPlaylistCard(parent, item, playlist, preview) {
    const card = parent.createEl("button", { cls: "cld-music-card cld-glass", attr: { type: "button", "aria-label": `\u6253\u5F00${item.title}` } });
    const cover = card.createDiv({ cls: "cld-music-card-cover" });
    const coverUrl = playlist?.cover || item.cover || preview?.image || "";
    if (coverUrl) cover.style.backgroundImage = `url("${coverUrl.replace(/"/g, "%22")}")`;
    else {
      (0, import_obsidian3.setIcon)(cover.createSpan(), "music-2");
      cover.createEl("small", { text: "\u97F3\u4E50" });
    }
    const copy = card.createDiv({ cls: "cld-music-card-copy" });
    const platform = isQqMusicUrl(item.playlistUrl) ? "QQ\u97F3\u4E50" : "\u7F51\u6613\u4E91\u97F3\u4E50";
    const contentType = playlist?.collectionType === "song" ? "\u5355\u66F2" : playlist?.collectionType === "album" ? "\u4E13\u8F91" : isNetEaseProgramUrl(item.playlistUrl) ? "\u8282\u76EE" : "\u6B4C\u5355";
    copy.createEl("small", { text: `${platform} \xB7 ${contentType}` });
    copy.createEl("h3", { text: item.title });
    copy.createEl("p", { text: playlist ? `${playlist.trackCount} \u6761\u5185\u5BB9 \xB7 \u70B9\u51FB\u67E5\u770B` : "\u70B9\u51FB\u67E5\u770B\u8BE6\u60C5" });
    card.addEventListener("click", () => {
      this.musicDetailItemPath = item.file.path;
      void this.refresh();
    });
  }
  async renderMusicPlaylist(parent, item, playlist, preview) {
    const back = parent.createEl("button", { cls: "cld-text-button cld-music-back", text: "\u2039 \u8FD4\u56DE\u97F3\u4E50\u6536\u85CF", attr: { type: "button" } });
    back.addEventListener("click", () => {
      this.musicDetailItemPath = null;
      void this.refresh();
    });
    const card = parent.createDiv({ cls: "cld-music-playlist cld-glass" });
    const head = card.createDiv({ cls: "cld-music-playlist-head" });
    const cover = head.createDiv({ cls: "cld-music-playlist-cover" });
    const coverUrl = playlist?.cover || item.cover || preview?.image || "";
    if (coverUrl) cover.style.backgroundImage = `url("${coverUrl.replace(/"/g, "%22")}")`;
    else {
      (0, import_obsidian3.setIcon)(cover.createSpan(), "music-2");
      cover.createEl("small", { text: "\u7F51\u6613\u4E91\u6B4C\u5355" });
    }
    const expanded = this.expandedMusicPlaylists.has(item.file.path);
    cover.setAttr("role", "button");
    cover.setAttr("tabindex", "0");
    cover.setAttr("aria-label", expanded ? "\u6536\u8D77\u5217\u8868" : "\u5C55\u5F00\u5217\u8868");
    cover.addEventListener("click", () => {
      if (expanded) this.expandedMusicPlaylists.delete(item.file.path);
      else this.expandedMusicPlaylists.add(item.file.path);
      void this.refresh();
    });
    cover.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      cover.click();
    });
    const copy = head.createDiv({ cls: "cld-music-playlist-copy" });
    const platform = isQqMusicUrl(item.playlistUrl) ? "QQ\u97F3\u4E50" : "\u7F51\u6613\u4E91\u97F3\u4E50";
    const contentType = playlist?.collectionType === "song" ? "\u5355\u66F2" : playlist?.collectionType === "album" ? "\u4E13\u8F91" : isNetEaseProgramUrl(item.playlistUrl) ? "\u8282\u76EE" : "\u6B4C\u5355";
    copy.createEl("small", { text: `${platform} \xB7 ${contentType}` });
    const title = copy.createEl("h3", { text: item.title, attr: { title: "\u70B9\u51FB\u7F16\u8F91\u540D\u79F0" } });
    title.addEventListener("click", () => this.openMusicPlaylistNameEditor(item));
    const fallbackText = isNetEaseProgramUrl(item.playlistUrl) ? "\u8FD9\u662F\u7F51\u6613\u4E91\u8282\u76EE\u94FE\u63A5\uFF0C\u4E0D\u662F\u6807\u51C6\u6B4C\u5355\uFF1B\u70B9\u51FB\u540E\u6253\u5F00\u5BF9\u5E94\u9875\u9762" : isQqMusicUrl(item.playlistUrl) ? "QQ \u97F3\u4E50\u6B4C\u5355 \xB7 \u70B9\u51FB\u540E\u5728 QQ \u97F3\u4E50 App \u6253\u5F00" : "\u6B4C\u5355\u6682\u65F6\u65E0\u6CD5\u540C\u6B65\uFF0C\u4ECD\u53EF\u6253\u5F00\u539F\u59CB\u94FE\u63A5";
    copy.createEl("p", { text: playlist ? `${playlist.creator} \xB7 ${playlist.trackCount} \u9996\u6B4C\u66F2` : fallbackText });
    const actions = head.createDiv({ cls: "cld-music-playlist-actions" });
    const edit = actions.createEl("button", { cls: "cld-text-button", text: "\u7F16\u8F91\u540D\u79F0", attr: { type: "button" } });
    edit.addEventListener("click", (event) => {
      event.stopPropagation();
      this.openMusicPlaylistNameEditor(item);
    });
    if (!playlist?.tracks.length) {
      card.createEl("small", { cls: "cld-music-track-more", text: isQqMusicUrl(item.playlistUrl) ? "QQ \u97F3\u4E50\u6B4C\u5355\u7684\u6B4C\u66F2\u5217\u8868\u6682\u672A\u540C\u6B65\uFF0C\u70B9\u51FB\u4E0A\u65B9\u6309\u94AE\u5728 App \u4E2D\u67E5\u770B\u3002" : "\u8FD9\u4E2A\u94FE\u63A5\u6CA1\u6709\u53EF\u540C\u6B65\u7684\u6B4C\u66F2\u5217\u8868\uFF0C\u8BF7\u786E\u8BA4\u5B83\u662F music.163.com/playlist?id=... \u6B4C\u5355\u94FE\u63A5\u3002" });
      return;
    }
    const visibleTracks = expanded ? playlist.tracks : playlist.tracks.slice(0, 30);
    const list = card.createDiv({ cls: "cld-music-track-list", attr: { role: "list" } });
    for (const [index, track] of visibleTracks.entries()) {
      const row = list.createEl("button", { cls: "cld-music-track", attr: { type: "button", role: "listitem" } });
      row.createSpan({ cls: "cld-music-track-number", text: String(index + 1).padStart(2, "0") });
      const trackCover = row.createSpan({ cls: "cld-music-track-cover" });
      if (track.cover) trackCover.style.backgroundImage = `url("${track.cover.replace(/"/g, "%22")}")`;
      else (0, import_obsidian3.setIcon)(trackCover, "music-2");
      const trackCopy = row.createSpan({ cls: "cld-music-track-copy" });
      trackCopy.createEl("strong", { text: track.title });
      trackCopy.createEl("small", { text: `${track.artist}${track.album ? ` \xB7 ${track.album}` : ""}` });
      row.createSpan({ cls: "cld-music-track-open", text: "App \u64AD\u653E \u2197" });
      row.addEventListener("click", () => openMusicApp(track.url || item.playlistUrl));
    }
    const count = card.createDiv({ cls: "cld-music-track-count" });
    count.createEl("small", { text: `\u5DF2\u663E\u793A ${visibleTracks.length} / \u5171 ${playlist.trackCount} \u6761` });
    if (playlist.tracks.length > 30) {
      const toggle = count.createEl("button", { cls: "cld-text-button", text: expanded ? "\u6536\u8D77" : `\u663E\u793A\u5168\u90E8\uFF08${playlist.tracks.length} \u6761\uFF09`, attr: { type: "button" } });
      toggle.addEventListener("click", () => {
        if (expanded) this.expandedMusicPlaylists.delete(item.file.path);
        else this.expandedMusicPlaylists.add(item.file.path);
        void this.refresh();
      });
    }
    if (playlist.tracks.length < playlist.trackCount) card.createEl("small", { cls: "cld-music-track-more", text: `\u5DF2\u540C\u6B65 ${playlist.tracks.length} \u6761\uFF0C\u5B8C\u6574\u5217\u8868\u8BF7\u5728\u5E73\u53F0 App \u67E5\u770B` });
  }
  openMusicPlaylistNameEditor(item) {
    new MusicPlaylistNameModal(this.app, item.title, async (title) => {
      await this.plugin.renameMusicPlaylistNote(item.file, title);
      new import_obsidian3.Notice("\u6B4C\u5355\u540D\u79F0\u5DF2\u66F4\u65B0\u3002");
      await this.refresh();
    }).open();
  }
  renderHomeBanner(main, source, itemCount, podcast) {
    const hero = main.createEl("section", { cls: "cld-hero cld-glass" });
    const banner = this.plugin.indexer.resolveResource(this.plugin.settings.bannerPath);
    if (banner) {
      hero.addClass("has-image");
      hero.style.backgroundImage = `url("${banner.replace(/"/g, "%22")}")`;
    } else {
      hero.addClass("is-placeholder");
      const libraryArt = hero.createDiv({ cls: "cld-hero-library-art", attr: { "aria-hidden": "true" } });
      for (const className of ["cld-book-one", "cld-book-two", "cld-book-three", "cld-book-four"]) {
        libraryArt.createSpan({ cls: `cld-hero-book ${className}` });
      }
    }
    const heroCopy = hero.createDiv({ cls: "cld-hero-copy" });
    heroCopy.createEl("small", { text: podcast ? `\u64AD\u5BA2 \xB7 ${itemCount} \u9879` : source ? `${SOURCE_KIND_LABELS[source.kind]} \xB7 ${itemCount} \u9879` : "\u7EE7\u7EED\u9605\u8BFB \xB7 \u4ECA\u5929" });
    heroCopy.createEl("h2", { text: podcast ? source?.name || "Podcast" : source?.name || this.plugin.settings.dashboardTitle });
    heroCopy.createEl("p", { text: source ? source.folder : "\u4E66\u3001\u64AD\u5BA2\u3001\u65B0\u95FB\u548C\u7075\u611F\uFF0C\u90FD\u5728\u4E00\u4E2A\u5730\u65B9\u3002" });
  }
  async renderDailyInspiration(main) {
    const sources = this.enabledSources().filter((source) => source.id === ANNOTATION_SOURCE_ID || source.folder.replace(/\/$/, "") === "\u81EA\u5DF1\u7684\u601D\u8003" || source.folder.replace(/\/$/, "") === "\u521B\u610F\u5E93");
    const items = this.plugin.indexer.all(sources, 120).filter((item2) => item2.file.extension === "md");
    const groups = await Promise.all(items.map(async (item2) => {
      const content = await this.app.vault.cachedRead(item2.file);
      return extractInspirationSentences(content, item2.source.id === ANNOTATION_SOURCE_ID).map((text2) => ({ text: text2, item: item2, annotation: item2.source.id === ANNOTATION_SOURCE_ID }));
    }));
    const candidates = groups.flat();
    if (!candidates.length) return;
    const annotationCandidates = candidates.filter((entry) => entry.annotation);
    const weighted = annotationCandidates.length ? [...annotationCandidates, ...annotationCandidates, ...candidates] : candidates;
    const today = /* @__PURE__ */ new Date();
    const dateKey = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
    const seed = [...dateKey].reduce((total, character) => total * 31 + character.charCodeAt(0), 7);
    const candidate = weighted[Math.abs(seed + this.inspirationOffset * 7919) % weighted.length];
    const { item, text } = candidate;
    const card = main.createEl("section", { cls: "cld-inspiration cld-glass" });
    const copy = card.createDiv({ cls: "cld-inspiration-copy" });
    copy.createEl("small", { text: `\u4ECA\u65E5\u542F\u53D1 \xB7 ${item.source.name}` });
    copy.createEl("strong", { text: `\u201C${text}\u201D` });
    copy.createEl("p", { text: `\u6765\u81EA\u300A${item.title.replace(/-笔记$/, "")}\u300B` });
    const actions = card.createDiv({ cls: "cld-inspiration-actions" });
    const open = actions.createEl("button", { cls: "cld-text-button", text: "\u6253\u5F00", attr: { type: "button" } });
    open.addEventListener("click", () => {
      void this.plugin.recordView(item.file);
      this.selected = item;
      this.detailOpen = true;
      void this.refresh();
    });
    const next = actions.createEl("button", { cls: "cld-icon-button", attr: { type: "button", "aria-label": "\u6362\u4E00\u6761\u542F\u53D1" } });
    (0, import_obsidian3.setIcon)(next, "refresh-cw");
    next.addEventListener("click", () => {
      this.inspirationOffset += 1;
      void this.refresh();
    });
  }
  currentInspirationHour() {
    const now = /* @__PURE__ */ new Date();
    return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
  }
  renderActivity(main, items) {
    const counts = /* @__PURE__ */ new Map();
    const updatedDays = [];
    for (const item of items) {
      const key = formatDate(item.modified);
      counts.set(key, (counts.get(key) || 0) + 1);
      const day = new Date(item.modified);
      day.setHours(0, 0, 0, 0);
      updatedDays.push(day.getTime());
    }
    if (!updatedDays.length) return;
    const activity = main.createEl("section", { cls: "cld-activity cld-glass" });
    const activityHead = activity.createDiv({ cls: "cld-section-head" });
    activityHead.createEl("strong", { text: "\u5185\u5BB9\u66F4\u65B0" });
    const maxCount = Math.max(0, ...counts.values());
    const today = /* @__PURE__ */ new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(Math.min(...updatedDays));
    if (start.getTime() > today.getTime()) start.setTime(today.getTime());
    const dayMs = 24 * 60 * 60 * 1e3;
    let totalDays = Math.floor((today.getTime() - start.getTime()) / dayMs) + 1;
    let weeks = Math.ceil(totalDays / 7);
    const availableWidth = Math.max(main.clientWidth, this.contentEl.clientWidth) - 74;
    const maxWeeks = Math.max(1, Math.floor(availableWidth / 18));
    if (weeks > maxWeeks) {
      weeks = maxWeeks;
      totalDays = weeks * 7;
      start.setTime(today.getTime() - (totalDays - 1) * dayMs);
    }
    const body = activity.createDiv({ cls: "cld-activity-grid-wrap" });
    const weekdays = body.createDiv({ cls: "cld-activity-weekdays" });
    for (let day = 0; day < 7; day += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + day);
      weekdays.createSpan({ text: new Intl.DateTimeFormat("zh-CN", { weekday: "narrow" }).format(date) });
    }
    const grid = body.createDiv({ cls: "cld-activity-grid" });
    grid.style.setProperty("--cld-activity-columns", String(weeks));
    for (let week = 0; week < weeks; week += 1) {
      const column = grid.createDiv({ cls: "cld-activity-week" });
      for (let day = 0; day < 7; day += 1) {
        if (week * 7 + day >= totalDays) break;
        const date = new Date(start);
        date.setDate(start.getDate() + week * 7 + day);
        const key = formatDate(date.getTime());
        const count = counts.get(key) || 0;
        const level = count && maxCount ? Math.max(1, Math.ceil(count / maxCount * 4)) : 0;
        column.createSpan({
          cls: `cld-activity-cell cld-activity-level-${level}`,
          attr: { title: `${key} \xB7 ${count} \u6B21\u66F4\u65B0`, "aria-label": `${key}\uFF0C${count} \u6B21\u66F4\u65B0` }
        });
      }
    }
  }
  renderPodcastLibrary(main, title, items) {
    const visibleItems = this.searchQuery ? items.filter((item) => `${item.title} ${item.subtitle} ${item.excerpt}`.toLowerCase().includes(this.searchQuery.toLowerCase())) : items;
    const sectionHead = main.createDiv({ cls: "cld-section-head cld-podcast-section-head" });
    const heading = sectionHead.createDiv();
    heading.createEl("strong", { text: title });
    heading.createEl("p", { text: "\u9009\u62E9\u8282\u76EE\uFF0C\u53F3\u4FA7\u7ACB\u5373\u64AD\u653E" });
    const tools = sectionHead.createDiv({ cls: "cld-podcast-list-tools" });
    tools.createEl("span", { text: this.searchQuery ? `${visibleItems.length} \u4E2A\u7ED3\u679C` : `${items.length} \u96C6\u672A\u542C` });
    if (!visibleItems.length) {
      const empty = main.createDiv({ cls: "cld-empty cld-glass" });
      empty.createEl("h3", { text: "\u8FD9\u4E2A\u680F\u76EE\u8FD8\u6CA1\u6709\u8282\u76EE" });
      empty.createEl("p", { text: "\u53EF\u4EE5\u9009\u62E9\u5305\u542B Markdown \u8282\u76EE\u7B14\u8BB0\u6216\u97F3\u9891\u6587\u4EF6\u7684 Vault \u6587\u4EF6\u5939\u3002" });
      return;
    }
    const list = main.createDiv({ cls: "cld-episode-list cld-density-compact" });
    const active = this.selected && visibleItems.some((item) => item.id === this.selected?.id) ? this.selected : visibleItems[0];
    if (!this.selected || !visibleItems.some((item) => item.id === this.selected?.id)) this.selected = active;
    const currentPodcastId = this.autoplayItemId || this.audioItemId || active?.id || "";
    for (const item of visibleItems) {
      const isCurrent = currentPodcastId === item.id;
      const row = list.createEl("button", {
        cls: `cld-episode-row cld-glass${isCurrent ? " is-current" : ""}`,
        attr: { type: "button", "aria-pressed": String(isCurrent) }
      });
      const thumb = row.createSpan({ cls: "cld-episode-thumb" });
      const override = this.plugin.settings.coverOverrides[item.file.path] || "";
      const cover = this.plugin.indexer.resolveResource(override, item.file) || item.cover;
      if (cover) {
        thumb.addClass("has-image");
        thumb.style.backgroundImage = `url("${cover.replace(/"/g, "%22")}")`;
      } else thumb.createSpan({ text: initials(item.title) });
      const copy = row.createSpan({ cls: "cld-episode-copy" });
      copy.createEl("strong", { text: item.title });
      copy.createEl("small", { text: item.excerpt || item.subtitle });
      const tail = row.createSpan({ cls: "cld-episode-tail" });
      this.renderContentStatus(tail, item);
      const duration = tail.createSpan({ cls: "cld-episode-type", text: this.durationCache.get(item.id) || "--m" });
      if (!this.durationCache.has(item.id)) void this.hydrateDuration(duration, item);
      row.addEventListener("click", () => {
        void this.plugin.recordView(item.file);
        this.selected = item;
        this.autoplayItemId = item.id;
        this.detailOpen = import_obsidian3.Platform.isMobile || this.contentEl.clientWidth <= 760;
        void this.refresh();
      });
      row.addEventListener("contextmenu", (event) => this.showItemMenu(event, item));
    }
  }
  async hydrateDuration(element, item) {
    const url = await this.resolveAudio(item);
    if (!url || !element.isConnected) return;
    const probe = new Audio();
    probe.preload = "metadata";
    probe.addEventListener("loadedmetadata", () => {
      const label = formatCompactDuration(probe.duration);
      this.durationCache.set(item.id, label);
      if (element.isConnected) element.textContent = label;
      probe.src = "";
    }, { once: true });
    probe.addEventListener("error", () => {
      probe.src = "";
    }, { once: true });
    probe.src = url;
  }
  metric(parent, label, value, progress) {
    const card = parent.createDiv({ cls: "cld-metric cld-glass", attr: { "data-metric": label } });
    const head = card.createDiv();
    head.createSpan({ text: label });
    head.createEl("strong", { text: value });
    const track = card.createDiv({ cls: "cld-track" });
    track.createSpan().style.width = `${progress}%`;
  }
  renderContentCard(parent, item) {
    const button = parent.createEl("button", {
      cls: `cld-content-card cld-glass cld-kind-${item.kind}${this.selected?.id === item.id ? " is-selected" : ""}`,
      attr: { type: "button", "aria-label": `${item.title}\uFF0C${this.plugin.indexer.kindLabel(item.kind)}` }
    });
    const titleRow = button.createDiv({ cls: "cld-card-title-row cld-card-title-top" });
    titleRow.createEl("strong", { text: item.title });
    this.renderContentStatus(titleRow, item);
    const override = this.plugin.settings.coverOverrides[item.file.path] || "";
    const coverUrl = this.plugin.indexer.resolveResource(override, item.file) || item.cover;
    if (coverUrl) {
      const cover = button.createDiv({ cls: "cld-card-cover" });
      cover.addClass("has-image");
      cover.style.backgroundImage = `url("${coverUrl.replace(/"/g, "%22")}")`;
    }
    if (item.kind === "podcast" && coverUrl) {
      const cover = button.querySelector(".cld-card-cover");
      if (!cover) return;
      cover.addClass("has-podcast-badge");
      const badge = cover.createDiv({ cls: "cld-podcast-card-badge" });
      const badgeIcon = badge.createSpan();
      (0, import_obsidian3.setIcon)(badgeIcon, "play");
      badge.createSpan({ text: "\u64AD\u5BA2" });
    }
    if (item.externalUrl && coverUrl) {
      const cover = button.querySelector(".cld-card-cover");
      if (!cover) return;
      const host = cover.createEl("small", { cls: "cld-web-host", text: webHost(item.externalUrl) });
      (0, import_obsidian3.setIcon)(host.createSpan(), "external-link");
      void this.hydrateWebCard(cover, item.externalUrl, coverUrl);
    }
    if (item.progress > 0 && coverUrl) {
      const cover = button.querySelector(".cld-card-cover");
      if (!cover) return;
      const progress = cover.createDiv({ cls: "cld-cover-progress" });
      progress.createSpan().style.width = `${item.progress}%`;
    }
    const copy = button.createDiv({ cls: "cld-card-copy" });
    if (!coverUrl) {
      const excerpt = copy.createEl("p", { cls: "cld-card-excerpt cld-card-excerpt-inline", text: this.cardExcerptFallback(item) });
      void this.hydrateCardExcerpt(excerpt, item);
    }
    copy.createEl("small", { text: this.contentMeta(item) });
    button.addEventListener("click", () => {
      void this.plugin.recordView(item.file);
      this.selected = item;
      this.detailOpen = true;
      void this.refresh();
    });
    button.addEventListener("contextmenu", (event) => this.showItemMenu(event, item));
  }
  cardExcerptFallback(item) {
    const excerpt = item.excerpt.trim();
    if (excerpt && excerpt !== item.source.name && excerpt !== item.subtitle) return excerpt;
    return item.title;
  }
  contentMeta(item) {
    const date = this.youtubeGeneratedDate(item);
    if (date) return `\u751F\u6210\u4E8E ${date}`;
    const details = item.progress ? `${Math.round(item.progress)}% \xB7 ${item.subtitle}` : item.subtitle;
    return item.file.extension === "md" ? `${formatDate(item.created)} \xB7 ${details}` : details;
  }
  youtubeGeneratedDate(item) {
    return item.source.folder.split("/").pop()?.trim().toLowerCase() === "youtube podcast" ? formatDate(item.created) : "";
  }
  async hydrateCardExcerpt(element, item) {
    const note = item.file.extension === "md" ? item.file : this.getMatchedNote(item);
    if (!note) return;
    try {
      const content = await this.app.vault.cachedRead(note);
      const excerpt = this.cardExcerptFromContent(content, item);
      if (excerpt && element.isConnected) element.textContent = excerpt;
    } catch {
    }
  }
  cardExcerptFromContent(content, item) {
    const isGithubBrief = item.source.folder.toLowerCase().includes("github trending");
    if (isGithubBrief) {
      const match = content.match(/\*\*中文简介：\*\*\s*([^<\n]+)(?:<br>)?\s*\*\*适用场景：\*\*\s*([^<\n]+)/);
      if (match) return `${match[1].trim()} \u9002\u7528\uFF1A${match[2].trim()}`.slice(0, 180);
    }
    return extractInspirationSentences(content, false)[0] || "";
  }
  renderContentStatus(parent, item) {
    const status = parent.createSpan({ cls: "cld-content-status" });
    status.dataset.contentPath = item.file.path;
    this.paintContentStatus(status, item);
    return status;
  }
  paintContentStatus(element, item, liveProgress) {
    element.empty();
    for (const className of ["is-unread", "is-in-progress", "is-complete"]) element.removeClass(className);
    const saved = this.plugin.contentProgress(item.file);
    const progress = liveProgress ?? saved?.progress ?? 0;
    const state = progress >= 90 || saved?.state === "complete" ? "complete" : progress > 0 || saved?.state === "in-progress" ? "in-progress" : "unread";
    element.addClass(`is-${state}`);
    const noun = item.kind === "podcast" ? "\u542C" : "\u8BFB";
    if (state === "complete") {
      element.setAttr("aria-label", `\u5DF2${noun}\u5B8C`);
      element.setAttr("title", `\u5DF2${noun}\u5B8C`);
      (0, import_obsidian3.setIcon)(element, "check");
      return;
    }
    element.createSpan({ cls: "cld-status-dot" });
    if (state === "in-progress" && item.kind === "podcast") {
      element.createSpan({ cls: "cld-status-progress", text: `${Math.max(1, Math.round(progress))}%` });
    }
    const label = state === "in-progress" ? item.kind === "podcast" ? "\u6536\u542C\u4E2D" : "\u9605\u8BFB\u4E2D" : `\u672A${noun}`;
    element.setAttr("aria-label", label);
    element.setAttr("title", label);
  }
  updateRenderedStatus(item, liveProgress) {
    const elements = this.contentEl.querySelectorAll(".cld-content-status");
    elements.forEach((element) => {
      if (element.dataset.contentPath === item.file.path) this.paintContentStatus(element, item, liveProgress);
    });
  }
  showItemMenu(event, item) {
    event.preventDefault();
    const menu = new import_obsidian3.Menu();
    const progress = this.plugin.contentProgress(item.file);
    const completeLabel = item.kind === "podcast" ? "\u6807\u8BB0\u4E3A\u5DF2\u542C\u5B8C" : "\u6807\u8BB0\u4E3A\u5DF2\u8BFB";
    const resetLabel = item.kind === "podcast" ? "\u91CD\u65B0\u8BBE\u4E3A\u672A\u542C" : "\u91CD\u65B0\u8BBE\u4E3A\u672A\u8BFB";
    if (progress?.state !== "complete") {
      menu.addItem((entry) => entry.setTitle(completeLabel).setIcon("check").onClick(async () => {
        await this.plugin.markContentComplete(item.file);
        this.updateRenderedStatus(item);
      }));
    }
    if (progress) {
      menu.addItem((entry) => entry.setTitle(resetLabel).setIcon("rotate-ccw").onClick(async () => {
        await this.plugin.resetContentProgress(item.file);
        this.updateRenderedStatus(item, 0);
      }));
    }
    menu.addItem((entry) => entry.setTitle("Open source note").setIcon("file-text").onClick(() => void this.openFile(item.file)));
    if (item.externalUrl) menu.addItem((entry) => entry.setTitle("Open original link").setIcon("external-link").onClick(() => window.open(item.externalUrl, "_blank")));
    menu.addItem((entry) => entry.setTitle("Set cover path").setIcon("image-plus").onClick(() => {
      const next = window.prompt("Vault image path or https URL", this.plugin.settings.coverOverrides[item.file.path] || "");
      if (next !== null) void this.plugin.setCoverOverride(item, next);
    }));
    menu.addItem((entry) => entry.setTitle("Import cover image").setIcon("upload").onClick(() => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/png,image/jpeg,image/webp,image/gif";
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const path = await this.plugin.importImage(file, "Covers");
          await this.plugin.setCoverOverride(item, path);
        } catch (error) {
          new import_obsidian3.Notice(error instanceof Error ? error.message : "\u56FE\u7247\u5BFC\u5165\u5931\u8D25\u3002");
        }
      }, { once: true });
      input.click();
    }));
    menu.showAtMouseEvent(event);
  }
  async renderDetail(main, item) {
    this.contentEl.scrollTop = 0;
    const detail = main.createEl("section", { cls: "cld-detail cld-glass" });
    const toolbar = detail.createDiv({ cls: "cld-detail-toolbar" });
    const back = toolbar.createEl("button", { cls: "cld-text-button", attr: { type: "button" } });
    const backIcon = back.createSpan();
    (0, import_obsidian3.setIcon)(backIcon, "arrow-left");
    back.createSpan({ text: this.articleReturnItem ? "\u8FD4\u56DE\u64AD\u5BA2\u5217\u8868" : "\u8FD4\u56DE" });
    back.addEventListener("click", () => {
      if (this.articleReturnItem) {
        this.returnToPodcastList();
        return;
      }
      this.detailOpen = false;
      this.destroyAudio();
      void this.refresh();
    });
    toolbar.createSpan({ cls: "cld-kind-badge", text: this.plugin.indexer.kindLabel(item.kind) });
    if (item.kind === "podcast" || item.file.extension !== "md") await this.renderPodcastDetail(detail, item);
    else await this.renderReadingDetail(detail, item);
  }
  async renderReadingDetail(parent, item) {
    const content = await this.app.vault.cachedRead(item.file);
    await this.plugin.startContent(item.file);
    const isAnnotation = item.source.id === ANNOTATION_SOURCE_ID;
    const originalPath = isAnnotation ? annotationOriginalPath(content) : "";
    const audioUrl = await this.resolveAudio(item);
    const continuingPodcast = Boolean(this.articleReturnItem && this.audio);
    if (continuingPodcast) this.renderContinuedPodcastPlayer(parent, this.articleReturnItem);
    else if (audioUrl) this.renderReadingAudioPlayer(parent, item, audioUrl);
    const grid = parent.createDiv({ cls: "cld-reader-grid" });
    const header = grid.createEl("header", { cls: "cld-reader-header" });
    const headerCopy = header.createDiv();
    const generatedDate = this.youtubeGeneratedDate(item);
    headerCopy.createEl("small", { text: generatedDate ? `${item.source.name} \xB7 \u751F\u6210\u4E8E ${generatedDate}` : `${item.source.name} \xB7 \u521B\u5EFA\u4E8E ${formatDate(item.created)}` });
    headerCopy.createEl("h1", { text: item.title });
    const headerActions = header.createDiv({ cls: "cld-reader-header-actions" });
    const readState = headerActions.createEl("button", { cls: "cld-text-button cld-read-state-button", attr: { type: "button" } });
    this.updateReadStateButton(readState, item);
    readState.addEventListener("click", async () => {
      if (this.plugin.contentProgress(item.file)?.state === "complete") {
        await this.plugin.resetContentProgress(item.file);
        readState.dataset.suppressAutoComplete = "true";
      } else {
        await this.plugin.markContentComplete(item.file);
        readState.dataset.suppressAutoComplete = "false";
      }
      this.updateReadStateButton(readState, item);
      this.updateRenderedStatus(item);
    });
    const open = headerActions.createEl("button", { cls: "cld-text-button", text: "\u5728 Obsidian \u4E2D\u6253\u5F00", attr: { type: "button" } });
    open.addEventListener("click", () => void this.openFile(item.file));
    const edit = headerActions.createEl("button", { cls: "cld-text-button cld-edit-note-button", text: "\u7F16\u8F91\u7B14\u8BB0", attr: { type: "button" } });
    edit.addEventListener("click", () => this.startInlineNoteEdit(grid, item, content));
    if (originalPath) {
      const originalArticle = headerActions.createEl("button", { cls: "cld-text-button", text: "\u9605\u8BFB\u539F\u6587\u7AE0", attr: { type: "button" } });
      originalArticle.addEventListener("click", () => this.openArticlePath(originalPath));
    }
    if (item.kind === "book") {
      const weave = headerActions.createEl("button", { cls: "cld-text-button", text: "\u6253\u5F00 Weave \u9605\u8BFB\u5668", attr: { type: "button" } });
      weave.addEventListener("click", () => this.executeCommand("weave-epub-reader:open-active-epub-reader"));
    }
    if (item.externalUrl) {
      const original = headerActions.createEl("button", { cls: "cld-text-button", text: "\u6253\u5F00\u539F\u59CB\u7F51\u9875", attr: { type: "button" } });
      original.addEventListener("click", () => window.open(item.externalUrl, "_blank"));
    }
    if (!this.articleReturnItem) this.renderReadingNavigation(headerActions, item);
    const article = grid.createEl("article", { cls: "cld-reading-page markdown-rendered" });
    await import_obsidian3.MarkdownRenderer.render(this.app, content, article, item.file.path, this);
    await this.applyAnnotationHighlights(article, item);
    article.setAttr("tabindex", "0");
    this.setupReadingCompletion(item, readState);
    if (!this.articleReturnItem) {
      const bottomNavigation = grid.createDiv({ cls: "cld-reading-navigation-bottom" });
      this.renderReadingNavigation(bottomNavigation, item);
    }
    this.renderRelatedLinks(grid, content, item);
    const notes = grid.createEl("aside", { cls: "cld-note-panel" });
    if (isAnnotation) {
      notes.createEl("small", { text: "\u6279\u6CE8\u6765\u6E90" });
      notes.createEl("p", { text: originalPath || "\u8FD9\u6761\u6279\u6CE8\u6CA1\u6709\u8BB0\u5F55\u6765\u6E90\u6587\u7AE0\u3002" });
      if (originalPath) {
        const originalArticle = notes.createEl("button", { cls: "cld-primary-button", text: "\u9605\u8BFB\u539F\u6587\u7AE0", attr: { type: "button" } });
        originalArticle.addEventListener("click", () => this.openArticlePath(originalPath));
      }
      return;
    }
    notes.createEl("small", { text: "\u9605\u8BFB\u6279\u6CE8" });
    notes.createEl("p", { text: "\u9009\u4E2D\u6587\u5B57\u540E\u53EF\u76F4\u63A5\u6536\u85CF\u6458\u5F55\uFF0C\u6216\u5E26\u5165\u8FD9\u91CC\u7EE7\u7EED\u5199\u7B14\u8BB0\u3002" });
    const quote = notes.createEl("textarea", { cls: "cld-textarea", attr: { rows: "3", placeholder: "\u7C98\u8D34\u6458\u5F55\u6216\u539F\u6587\u2026", "aria-label": "\u6458\u5F55\u539F\u6587" } });
    const thought = notes.createEl("textarea", { cls: "cld-textarea", attr: { rows: "5", placeholder: "\u5199\u4E0B\u4F60\u7684\u6279\u6CE8\u2026", "aria-label": "\u9605\u8BFB\u6279\u6CE8" } });
    const save = notes.createEl("button", { cls: "cld-primary-button", text: "\u4FDD\u5B58\u5230\u6279\u6CE8\u7B14\u8BB0", attr: { type: "button" } });
    const saved = notes.createDiv({ cls: "cld-saved-notes" });
    await this.renderSavedAnnotations(saved, item, article);
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        const file = await this.plugin.appendAnnotation(item, thought.value, quote.value);
        if (!file) {
          new import_obsidian3.Notice("\u8BF7\u5148\u5199\u4E0B\u6279\u6CE8\u6216\u6458\u5F55\u3002");
          return;
        }
        thought.value = "";
        quote.value = "";
        await this.renderSavedAnnotations(saved, item, article);
        await this.applyAnnotationHighlights(article, item);
        new import_obsidian3.Notice(`\u5DF2\u4FDD\u5B58\u5230 ${file.path}`);
      } catch (error) {
        new import_obsidian3.Notice(error instanceof Error ? `\u4FDD\u5B58\u5931\u8D25\uFF1A${error.message}` : "\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002");
      } finally {
        save.disabled = false;
      }
    });
    const selectionToolbar = this.contentEl.createDiv({ cls: "cld-selection-toolbar cld-glass" });
    selectionToolbar.hidden = true;
    let selectedQuote = "";
    const collect = selectionToolbar.createEl("button", { cls: "cld-selection-action", attr: { type: "button" } });
    const collectIcon = collect.createSpan();
    (0, import_obsidian3.setIcon)(collectIcon, "star");
    collect.createSpan({ text: "\u6536\u85CF\u6458\u5F55" });
    const annotate = selectionToolbar.createEl("button", { cls: "cld-selection-action", attr: { type: "button" } });
    const annotateIcon = annotate.createSpan();
    (0, import_obsidian3.setIcon)(annotateIcon, "notebook-pen");
    annotate.createSpan({ text: "\u5199\u7B14\u8BB0" });
    for (const button of [collect, annotate]) {
      button.addEventListener("mousedown", (event) => event.preventDefault());
    }
    const clearSelection = () => {
      selectionToolbar.hidden = true;
      article.ownerDocument.getSelection()?.removeAllRanges();
    };
    collect.addEventListener("click", async () => {
      if (!selectedQuote) return;
      const file = await this.plugin.appendAnnotation(item, "", selectedQuote);
      if (file) {
        await this.renderSavedAnnotations(saved, item, article);
        await this.applyAnnotationHighlights(article, item);
        new import_obsidian3.Notice(`\u6458\u5F55\u5DF2\u6536\u85CF\u5230 ${file.path}`);
      }
      clearSelection();
    });
    annotate.addEventListener("click", () => {
      quote.value = selectedQuote;
      selectionToolbar.hidden = true;
      thought.focus();
      thought.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const updateSelectionToolbar = () => {
      const selection = article.ownerDocument.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) {
        selectionToolbar.hidden = true;
        return;
      }
      const range = selection.getRangeAt(0);
      if (!article.contains(range.commonAncestorContainer)) {
        selectionToolbar.hidden = true;
        return;
      }
      selectedQuote = selection.toString().trim();
      if (!selectedQuote) {
        selectionToolbar.hidden = true;
        return;
      }
      const rect = range.getBoundingClientRect();
      const width = 210;
      const left = Math.max(12, Math.min(article.ownerDocument.defaultView.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2));
      selectionToolbar.style.left = `${left}px`;
      selectionToolbar.style.top = `${Math.min(article.ownerDocument.defaultView.innerHeight - 58, rect.bottom + 10)}px`;
      selectionToolbar.hidden = false;
    };
    const selectionDocument = article.ownerDocument;
    const onSelectionChange = () => window.requestAnimationFrame(updateSelectionToolbar);
    selectionDocument.addEventListener("selectionchange", onSelectionChange);
    article.addEventListener("pointerup", onSelectionChange);
    article.addEventListener("keyup", onSelectionChange);
    const previousCleanup = this.readingScrollCleanup;
    this.readingScrollCleanup = () => {
      previousCleanup?.();
      selectionDocument.removeEventListener("selectionchange", onSelectionChange);
      article.removeEventListener("pointerup", onSelectionChange);
      article.removeEventListener("keyup", onSelectionChange);
    };
  }
  startInlineNoteEdit(grid, item, content) {
    const article = grid.querySelector(".cld-reading-page");
    if (!article) return;
    const editor = grid.ownerDocument.createElement("section");
    editor.className = "cld-inline-note-editor cld-glass";
    const heading = editor.createEl("div", { cls: "cld-inline-note-editor-heading" });
    heading.createEl("strong", { text: "\u7F16\u8F91\u7B14\u8BB0" });
    heading.createEl("small", { text: item.file.path });
    const textarea = editor.createEl("textarea", {
      cls: "cld-note-source-editor",
      attr: { "aria-label": "Markdown \u7B14\u8BB0\u5185\u5BB9", spellcheck: "false" }
    });
    textarea.value = content;
    const actions = editor.createDiv({ cls: "cld-inline-note-editor-actions" });
    const cancel = actions.createEl("button", { cls: "cld-text-button", text: "\u53D6\u6D88", attr: { type: "button" } });
    const save = actions.createEl("button", { cls: "cld-primary-button", text: "\u4FDD\u5B58\u7B14\u8BB0", attr: { type: "button" } });
    article.replaceWith(editor);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    cancel.addEventListener("click", () => {
      editor.replaceWith(article);
    });
    save.addEventListener("click", async () => {
      save.disabled = true;
      cancel.disabled = true;
      try {
        await this.app.vault.modify(item.file, textarea.value);
        new import_obsidian3.Notice("\u7B14\u8BB0\u5DF2\u4FDD\u5B58\u3002");
        this.detailOpen = true;
        this.selected = this.plugin.indexer.itemForFile(item.file, item.source);
        await this.refresh();
      } catch (error) {
        new import_obsidian3.Notice(error instanceof Error ? `\u4FDD\u5B58\u5931\u8D25\uFF1A${error.message}` : "\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002");
        save.disabled = false;
        cancel.disabled = false;
      }
    });
  }
  renderReadingNavigation(parent, item) {
    const queue = this.plugin.indexer.list(item.source, 240).filter((entry) => entry.file.extension === "md" && entry.kind !== "podcast").sort((a, b) => b.created - a.created);
    const index = queue.findIndex((entry) => entry.id === item.id);
    if (index < 0 || queue.length < 2) return;
    const previous = parent.createEl("button", { cls: "cld-text-button", text: "\u2190 \u4E0A\u4E00\u7BC7", attr: { type: "button" } });
    const next = parent.createEl("button", { cls: "cld-text-button", text: "\u4E0B\u4E00\u7BC7 \u2192", attr: { type: "button" } });
    previous.disabled = index === 0;
    next.disabled = index === queue.length - 1;
    previous.addEventListener("click", () => this.openReadingItem(queue[index - 1]));
    next.addEventListener("click", () => this.openReadingItem(queue[index + 1]));
  }
  openReadingItem(item) {
    if (!item) return;
    void this.plugin.recordView(item.file);
    this.selected = item;
    this.detailOpen = true;
    void this.refresh();
  }
  updateReadStateButton(button, item) {
    const complete = this.plugin.contentProgress(item.file)?.state === "complete";
    button.empty();
    const icon = button.createSpan();
    (0, import_obsidian3.setIcon)(icon, complete ? "check" : "circle-check");
    button.createSpan({ text: complete ? "\u5DF2\u8BFB \xB7 \u8BBE\u4E3A\u672A\u8BFB" : "\u6807\u8BB0\u5DF2\u8BFB" });
  }
  setupReadingCompletion(item, button) {
    const scroller = this.contentEl;
    let userScrolled = false;
    let completed = this.plugin.contentProgress(item.file)?.state === "complete";
    const onScroll = () => {
      if (completed) return;
      if (button.dataset.suppressAutoComplete === "true") return;
      if (scroller.scrollTop > 24) userScrolled = true;
      const remaining = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      if (!userScrolled || remaining > 120) return;
      completed = true;
      void this.plugin.markContentComplete(item.file).then(() => {
        this.updateReadStateButton(button, item);
        this.updateRenderedStatus(item);
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    this.readingScrollCleanup = () => scroller.removeEventListener("scroll", onScroll);
  }
  async hydrateWebCard(cover, url, hasCover) {
    const preview = await this.plugin.getWebPreview(url);
    if (!cover.isConnected) return;
    if (!hasCover && preview.image) {
      cover.addClass("has-image");
      cover.addClass("cld-web-preview-image");
      cover.style.backgroundImage = `linear-gradient(180deg, transparent 36%, color-mix(in srgb, #000 68%, transparent)), url("${preview.image.replace(/"/g, "%22")}")`;
    }
    const fallbackTitle = cover.querySelector(":scope > strong");
    if (fallbackTitle && preview.title && preview.title !== preview.host) fallbackTitle.textContent = preview.title.slice(0, 80);
  }
  renderRelatedLinks(parent, content, item) {
    const links = extractWebLinks(content);
    if (item.externalUrl && !links.some((entry) => entry.url === item.externalUrl)) links.unshift({ label: item.title, url: item.externalUrl });
    if (!links.length) return;
    const section = parent.createEl("section", { cls: "cld-related-links" });
    section.createEl("strong", { text: "\u76F8\u5173\u94FE\u63A5" });
    const list = section.createDiv({ cls: "cld-related-link-list" });
    for (const entry of links.slice(0, 3)) {
      const card = list.createEl("button", { cls: "cld-related-link-card cld-glass", attr: { type: "button" } });
      const image = card.createDiv({ cls: "cld-related-link-image" });
      const copy = card.createDiv({ cls: "cld-related-link-copy" });
      copy.createEl("small", { text: webHost(entry.url) });
      const title = copy.createEl("strong", { text: entry.label || webHost(entry.url) });
      const description = copy.createEl("p", { text: "\u6253\u5F00\u539F\u59CB\u7F51\u9875" });
      card.addEventListener("click", () => window.open(entry.url, "_blank"));
      void this.plugin.getWebPreview(entry.url).then((preview) => {
        if (!card.isConnected) return;
        if (preview.image) image.style.backgroundImage = `url("${preview.image.replace(/"/g, "%22")}")`;
        else (0, import_obsidian3.setIcon)(image.createSpan(), "globe-2");
        if (preview.title && preview.title !== preview.host) title.textContent = preview.title;
        if (preview.description) description.textContent = preview.description;
      });
    }
  }
  async renderSavedAnnotations(parent, item, article) {
    parent.empty();
    const file = this.plugin.annotationFile(item);
    if (!file) {
      parent.createEl("small", { text: "\u4FDD\u5B58\u540E\u4F1A\u5728\u8FD9\u91CC\u663E\u793A\uFF0C\u91CD\u65B0\u6253\u5F00\u6587\u7AE0\u4E5F\u4E0D\u4F1A\u6D88\u5931\u3002" });
      return;
    }
    const head = parent.createDiv({ cls: "cld-saved-notes-head" });
    head.createEl("strong", { text: "\u5DF2\u4FDD\u5B58\u7B14\u8BB0" });
    const open = head.createEl("button", { cls: "cld-text-button", text: "\u5728 Obsidian \u4E2D\u6253\u5F00", attr: { type: "button" } });
    open.addEventListener("click", () => void this.openFile(file));
    const annotations = storedAnnotationsFor(await this.app.vault.cachedRead(file), item.file.path);
    if (!annotations.length) {
      parent.createEl("small", { text: "\u4FDD\u5B58\u540E\u4F1A\u5728\u8FD9\u91CC\u663E\u793A\uFF0C\u91CD\u65B0\u6253\u5F00\u6587\u7AE0\u4E5F\u4E0D\u4F1A\u6D88\u5931\u3002" });
      return;
    }
    const list = parent.createDiv({ cls: "cld-saved-annotation-list" });
    for (const annotation of annotations) {
      const card = list.createDiv({ cls: "cld-saved-annotation" });
      if (annotation.quote && article) {
        card.addClass("is-locatable");
        card.setAttr("role", "button");
        card.setAttr("tabindex", "0");
        card.setAttr("aria-label", "\u5B9A\u4F4D\u5230\u6587\u7AE0\u539F\u6587");
        const locate = () => this.scrollToAnnotation(article, annotation);
        card.addEventListener("click", locate);
        card.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            locate();
          }
        });
      }
      card.createEl("small", { text: annotation.heading.replace(/^##\s*/, "") });
      if (annotation.quote) card.createEl("blockquote", { text: annotation.quote });
      if (annotation.note) card.createEl("p", { text: annotation.note });
      if (!annotation.note && !annotation.quote) card.createEl("p", { text: "\u7A7A\u767D\u6279\u6CE8" });
      const actions = card.createDiv({ cls: "cld-saved-annotation-actions" });
      const edit = actions.createEl("button", { cls: "cld-text-button", text: "\u7F16\u8F91", attr: { type: "button" } });
      edit.addEventListener("click", (event) => {
        event.stopPropagation();
        new AnnotationEditModal(this.app, annotation, async (quote, note) => {
          await this.updateStoredAnnotation(item, annotation, quote, note);
          await this.refresh();
        }).open();
      });
      const remove = actions.createEl("button", { cls: "cld-text-button cld-annotation-delete", text: "\u5220\u9664", attr: { type: "button" } });
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        new AnnotationDeleteModal(this.app, async () => {
          await this.deleteStoredAnnotation(item, annotation);
          await this.refresh();
        }).open();
      });
    }
  }
  scrollToAnnotation(article, annotation) {
    const selector = `.cld-annotation-highlight[data-cld-annotation-key="${annotation.start}"]`;
    const highlights = Array.from(article.querySelectorAll(selector));
    const target = highlights[0];
    if (!target) {
      new import_obsidian3.Notice("\u8FD9\u6761\u6458\u5F55\u6682\u65F6\u6CA1\u6709\u5339\u914D\u5230\u6587\u7AE0\u539F\u6587\u3002", 3200);
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    for (const highlight of highlights) highlight.addClass("is-locating");
    window.setTimeout(() => {
      for (const highlight of highlights) highlight.removeClass("is-locating");
    }, 1600);
  }
  async updateStoredAnnotation(item, annotation, quote, note) {
    if (!quote.trim() && !note.trim()) throw new Error("\u6279\u6CE8\u548C\u6458\u5F55\u4E0D\u80FD\u540C\u65F6\u4E3A\u7A7A\u3002");
    const file = this.plugin.annotationFile(item);
    if (!file) throw new Error("\u6CA1\u6709\u627E\u5230\u6279\u6CE8\u7B14\u8BB0\u3002");
    await this.app.vault.process(file, (content) => {
      const replacement = annotationBlock(annotation, quote, note);
      return `${content.slice(0, annotation.start)}${replacement}${content.slice(annotation.end)}`;
    });
  }
  async deleteStoredAnnotation(item, annotation) {
    const file = this.plugin.annotationFile(item);
    if (!file) throw new Error("\u6CA1\u6709\u627E\u5230\u6279\u6CE8\u7B14\u8BB0\u3002");
    await this.app.vault.process(file, (content) => `${content.slice(0, annotation.start)}${content.slice(annotation.end)}`.replace(/\n{3,}/g, "\n\n"));
  }
  async applyAnnotationHighlights(article, item) {
    const file = this.plugin.annotationFile(item);
    if (!file) return;
    const annotations = storedAnnotationsFor(await this.app.vault.cachedRead(file), item.file.path);
    const merged = /* @__PURE__ */ new Map();
    for (const annotation of annotations) {
      const current = merged.get(annotation.quote);
      if (!current) merged.set(annotation.quote, { ...annotation });
      else if (annotation.note && !current.note.includes(annotation.note)) current.note = [current.note, annotation.note].filter(Boolean).join("\n\n");
    }
    for (const annotation of merged.values()) this.highlightQuote(article, annotation);
  }
  highlightQuote(article, annotation) {
    const quote = annotation.quote.trim();
    if (!quote) return;
    const target = normalizedTextOffsets(quote);
    if (!target.text) return;
    const indexed = indexedArticleText(article);
    const index = indexed.text.indexOf(target.text);
    if (index < 0) return;
    const segments = /* @__PURE__ */ new Map();
    for (const position of indexed.positions.slice(index, index + target.text.length)) {
      const existing = segments.get(position.node);
      if (existing) {
        existing.start = Math.min(existing.start, position.offset);
        existing.end = Math.max(existing.end, position.offset + 1);
      } else {
        segments.set(position.node, { start: position.offset, end: position.offset + 1 });
      }
    }
    const ranges = [...segments.entries()];
    for (let segmentIndex = ranges.length - 1; segmentIndex >= 0; segmentIndex -= 1) {
      const [node, segment] = ranges[segmentIndex];
      if (!node.isConnected || node.parentElement?.closest(".cld-annotation-highlight")) continue;
      const range = article.ownerDocument.createRange();
      range.setStart(node, segment.start);
      range.setEnd(node, segment.end);
      const highlight = article.ownerDocument.createElement("span");
      highlight.className = "cld-annotation-highlight";
      highlight.dataset.cldAnnotation = annotation.note || "\u5DF2\u6536\u85CF\u6458\u5F55";
      highlight.dataset.cldAnnotationKey = String(annotation.start);
      highlight.setAttribute("tabindex", "0");
      highlight.setAttribute("aria-label", `\u6279\u6CE8\uFF1A${annotation.note || "\u5DF2\u6536\u85CF\u6458\u5F55"}`);
      range.surroundContents(highlight);
    }
  }
  renderReadingAudioPlayer(parent, item, audioUrl) {
    const player = parent.createDiv({ cls: "cld-reading-audio cld-glass" });
    const label = player.createDiv();
    label.createEl("small", { text: "\u5173\u8054\u97F3\u9891" });
    label.createEl("strong", { text: item.title });
    const controls = player.createDiv({ cls: "cld-reading-audio-controls", attr: { "aria-label": "\u6587\u7AE0\u5173\u8054\u97F3\u9891\u64AD\u653E\u5668" } });
    const play = controls.createEl("button", {
      cls: "cld-reading-audio-play",
      attr: { type: "button", "aria-label": "\u64AD\u653E" }
    });
    (0, import_obsidian3.setIcon)(play, "play");
    const timeline = controls.createEl("input", {
      cls: "cld-audio-range",
      attr: { type: "range", min: "0", max: "1000", value: "0", "aria-label": "\u64AD\u653E\u8FDB\u5EA6" }
    });
    const time = controls.createEl("time", { cls: "cld-reading-audio-time", text: "0:00 / 0:00" });
    const audio = new Audio(audioUrl);
    audio.preload = "metadata";
    const updateTimeline = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      const progress = duration > 0 ? Math.round(audio.currentTime / duration * 1e3) : 0;
      timeline.value = String(progress);
      timeline.style.setProperty("--cld-audio-progress", `${progress / 10}%`);
      time.textContent = `${formatTime(audio.currentTime)} / ${formatTime(duration)}`;
    };
    const updatePlayButton = () => {
      (0, import_obsidian3.setIcon)(play, audio.paused ? "play" : "pause");
      play.setAttr("aria-label", audio.paused ? "\u64AD\u653E" : "\u6682\u505C");
    };
    audio.addEventListener("play", () => {
      if (this.audio && this.audio !== audio) this.audio.pause();
      this.audio = audio;
      this.audioItemId = item.id;
      this.playing = true;
      this.beginAudioProgress(item);
      updatePlayButton();
    });
    audio.addEventListener("loadedmetadata", updateTimeline);
    audio.addEventListener("timeupdate", () => {
      updateTimeline();
      this.trackAudioProgress(item, audio);
    });
    audio.addEventListener("ended", () => {
      this.completeAudioProgress(item);
      updateTimeline();
      updatePlayButton();
    });
    audio.addEventListener("pause", () => {
      if (this.audio === audio) this.playing = false;
      updatePlayButton();
    });
    play.addEventListener("click", async () => {
      if (audio.paused) {
        try {
          await audio.play();
        } catch {
          new import_obsidian3.Notice("\u7CFB\u7EDF\u963B\u6B62\u4E86\u64AD\u653E\uFF0C\u8BF7\u518D\u70B9\u51FB\u4E00\u6B21\u64AD\u653E\u952E\u3002", 3500);
        }
      } else {
        audio.pause();
      }
    });
    timeline.addEventListener("input", () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        audio.currentTime = Number(timeline.value) / 1e3 * audio.duration;
        updateTimeline();
      }
    });
  }
  renderContinuedPodcastPlayer(parent, item) {
    const audio = this.audio;
    if (!audio || this.audioItemId !== item.id) {
      this.articleReturnItem = null;
      return;
    }
    const shouldAutoplay = this.autoplayItemId === item.id;
    this.autoplayItemId = null;
    const player = parent.createEl("section", {
      cls: "cld-continued-podcast cld-glass",
      attr: { "aria-label": "\u7EE7\u7EED\u64AD\u653E\u64AD\u5BA2" }
    });
    const copy = player.createDiv({ cls: "cld-continued-podcast-copy" });
    copy.createEl("small", { text: "\u6B63\u5728\u9605\u8BFB\u539F\u6587 \xB7 \u64AD\u5BA2\u7EE7\u7EED\u64AD\u653E" });
    copy.createEl("strong", { text: item.title });
    const transport = player.createDiv({ cls: "cld-continued-podcast-transport" });
    const timeline = transport.createEl("input", {
      cls: "cld-audio-range",
      attr: { type: "range", min: "0", max: "1000", value: "0", "aria-label": "\u64AD\u5BA2\u64AD\u653E\u8FDB\u5EA6" }
    });
    const timecodes = transport.createDiv({ cls: "cld-player-timecodes" });
    const currentTime = timecodes.createEl("time", { text: formatTime(audio.currentTime) });
    const duration = timecodes.createEl("time", { text: formatTime(audio.duration) });
    const actions = player.createDiv({ cls: "cld-continued-podcast-actions" });
    const controls = actions.createDiv({ cls: "cld-continued-podcast-controls" });
    const previous = this.iconButton(controls, "skip-back", "\u4E0A\u4E00\u6761");
    const play = controls.createEl("button", {
      cls: "cld-play-button",
      attr: { type: "button", "aria-label": audio.paused ? "\u7EE7\u7EED\u64AD\u653E" : "\u6682\u505C" }
    });
    (0, import_obsidian3.setIcon)(play, audio.paused ? "play" : "pause");
    const next = this.iconButton(controls, "skip-forward", "\u4E0B\u4E00\u6761");
    const speed = actions.createEl("button", {
      cls: "cld-speed-control",
      text: `${audio.playbackRate}\xD7`,
      attr: { type: "button", "aria-label": "\u64AD\u653E\u901F\u5EA6" }
    });
    const updateTimeline = () => {
      const total = Number.isFinite(audio.duration) ? audio.duration : 0;
      timeline.value = total > 0 ? String(Math.round(audio.currentTime / total * 1e3)) : "0";
      currentTime.textContent = formatTime(audio.currentTime);
      duration.textContent = formatTime(total);
    };
    updateTimeline();
    audio.onloadedmetadata = updateTimeline;
    audio.ontimeupdate = () => {
      updateTimeline();
      this.trackAudioProgress(item, audio);
    };
    audio.onended = () => {
      this.completeAudioProgress(item);
      if (!this.playAfterEnd(item)) {
        this.playing = false;
        (0, import_obsidian3.setIcon)(play, "play");
        play.setAttr("aria-label", "\u7EE7\u7EED\u64AD\u653E");
      }
    };
    previous.addEventListener("click", () => void this.playAdjacentArticle(item, -1));
    next.addEventListener("click", () => void this.playAdjacentArticle(item, 1));
    play.addEventListener("click", async () => {
      if (audio.paused) {
        try {
          await audio.play();
          this.beginAudioProgress(item);
          this.playing = true;
          (0, import_obsidian3.setIcon)(play, "pause");
          play.setAttr("aria-label", "\u6682\u505C");
        } catch {
          new import_obsidian3.Notice("\u7CFB\u7EDF\u963B\u6B62\u4E86\u81EA\u52A8\u64AD\u653E\uFF0C\u8BF7\u518D\u70B9\u51FB\u4E00\u6B21\u64AD\u653E\u952E\u3002", 3500);
        }
      } else {
        audio.pause();
        this.playing = false;
        (0, import_obsidian3.setIcon)(play, "play");
        play.setAttr("aria-label", "\u7EE7\u7EED\u64AD\u653E");
      }
    });
    timeline.addEventListener("input", () => {
      if (audio.duration) audio.currentTime = Number(timeline.value) / 1e3 * audio.duration;
    });
    const speeds = [1, 1.25, 1.5, 2];
    speed.addEventListener("click", () => {
      const currentIndex = Math.max(0, speeds.findIndex((value) => value === audio.playbackRate));
      const nextSpeed = speeds[(currentIndex + 1) % speeds.length];
      audio.playbackRate = nextSpeed;
      speed.textContent = `${nextSpeed}\xD7`;
    });
    if (shouldAutoplay) {
      void audio.play().then(() => {
        this.beginAudioProgress(item);
        this.playing = true;
        (0, import_obsidian3.setIcon)(play, "pause");
        play.setAttr("aria-label", "\u6682\u505C");
      }).catch(() => {
        this.playing = false;
        (0, import_obsidian3.setIcon)(play, "play");
      });
    }
  }
  beginAudioProgress(item) {
    const saved = this.plugin.contentProgress(item.file);
    if (!saved) void this.plugin.startContent(item.file);
    this.updateRenderedStatus(item, saved?.progress || 1);
  }
  trackAudioProgress(item, audio) {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const progress = Math.max(1, Math.min(100, audio.currentTime / audio.duration * 100));
    void this.plugin.setContentProgress(item.file, progress, progress >= 90);
    this.updateRenderedStatus(item, progress);
    const button = this.contentEl.querySelector(".cld-listen-state-button");
    if (button && progress >= 90) this.updateListenStateButton(button, item);
  }
  completeAudioProgress(item) {
    void this.plugin.markContentComplete(item.file);
    this.updateRenderedStatus(item, 100);
    const button = this.contentEl.querySelector(".cld-listen-state-button");
    if (button) this.updateListenStateButton(button, item);
  }
  updateListenStateButton(button, item) {
    const complete = this.plugin.contentProgress(item.file)?.state === "complete";
    button.empty();
    const icon = button.createSpan();
    (0, import_obsidian3.setIcon)(icon, complete ? "check" : "circle-check");
    button.createSpan({ text: complete ? "\u5DF2\u542C\u5B8C \xB7 \u8BBE\u4E3A\u672A\u542C" : "\u6807\u8BB0\u5DF2\u542C\u5B8C" });
  }
  async renderPodcastDetail(parent, item) {
    const playerCard = parent.createDiv({ cls: "cld-podcast-player" });
    const header = playerCard.createDiv({ cls: "cld-podcast-header" });
    const visual = header.createDiv({ cls: "cld-podcast-artwork" });
    const override = this.plugin.settings.coverOverrides[item.file.path] || "";
    const cover = this.plugin.indexer.resolveResource(override, item.file) || item.cover;
    if (cover) {
      visual.addClass("has-image");
      visual.style.backgroundImage = `url("${cover.replace(/"/g, "%22")}")`;
    } else {
      const wave = visual.createDiv({ cls: "cld-podcast-wave", attr: { "aria-hidden": "true" } });
      for (const height of [24, 48, 72, 44, 64, 32, 54]) {
        wave.createSpan().style.height = `${height}%`;
      }
    }
    const copy = header.createDiv({ cls: "cld-podcast-copy" });
    copy.createEl("small", { text: `${item.subtitle} \xB7 ${this.plugin.indexer.kindLabel(item.kind)} \xB7 ${formatDate(item.created)}` });
    copy.createEl("h2", { text: item.title });
    if (item.excerpt && item.excerpt !== item.subtitle) copy.createEl("p", { text: item.excerpt });
    const audioUrl = await this.resolveAudio(item);
    const consoleEl = playerCard.createDiv({ cls: "cld-player-console" });
    const timeline = consoleEl.createEl("input", { cls: "cld-audio-range", attr: { type: "range", min: "0", max: "1000", value: "0", "aria-label": "\u64AD\u653E\u8FDB\u5EA6" } });
    const timelineRow = consoleEl.createDiv({ cls: "cld-player-timecodes" });
    const currentTime = timelineRow.createEl("time", { text: "00:00" });
    const duration = timelineRow.createEl("time", { text: "00:00" });
    const controls = consoleEl.createDiv({ cls: "cld-player-controls" });
    const previous = this.iconButton(controls, "skip-back", "\u4E0A\u4E00\u6761");
    const play = controls.createEl("button", { cls: "cld-play-button", attr: { type: "button", "aria-label": "\u64AD\u653E" } });
    (0, import_obsidian3.setIcon)(play, "play");
    const next = this.iconButton(controls, "skip-forward", "\u4E0B\u4E00\u6761");
    const options = consoleEl.createDiv({ cls: "cld-player-options" });
    this.createPlaybackModeSelect(options);
    const speed = options.createEl("button", { cls: "cld-speed-control", text: "1\xD7", attr: { type: "button", "aria-label": "\u64AD\u653E\u901F\u5EA6" } });
    if (audioUrl) {
      const shouldAutoplay = this.autoplayItemId === item.id;
      this.autoplayItemId = null;
      const wasPlaying = this.audioItemId === item.id && Boolean(this.audio && !this.audio.paused);
      this.audio = this.prepareAudio(item, audioUrl, shouldAutoplay);
      this.audio.onloadedmetadata = () => {
        duration.textContent = formatTime(this.audio?.duration ?? 0);
      };
      this.audio.ontimeupdate = () => {
        if (!this.audio?.duration) return;
        timeline.value = String(Math.round(this.audio.currentTime / this.audio.duration * 1e3));
        currentTime.textContent = formatTime(this.audio.currentTime);
        this.trackAudioProgress(item, this.audio);
        this.renderMiniPlayer(item);
      };
      this.audio.onended = () => {
        this.completeAudioProgress(item);
        if (!this.playAfterEnd(item)) {
          this.playing = false;
          (0, import_obsidian3.setIcon)(play, "play");
        }
      };
      previous.addEventListener("click", () => this.playAdjacent(item, -1, true));
      next.addEventListener("click", () => this.playAdjacent(item, 1, true));
      play.addEventListener("click", async () => {
        if (!this.audio) return;
        if (this.audio.paused) {
          await this.audio.play();
          this.beginAudioProgress(item);
          this.playing = true;
          (0, import_obsidian3.setIcon)(play, "pause");
        } else {
          this.audio.pause();
          this.playing = false;
          (0, import_obsidian3.setIcon)(play, "play");
        }
      });
      timeline.addEventListener("input", () => {
        if (this.audio?.duration) this.audio.currentTime = Number(timeline.value) / 1e3 * this.audio.duration;
      });
      const speeds = [1, 1.25, 1.5, 2];
      let speedIndex = 0;
      speed.addEventListener("click", () => {
        speedIndex = (speedIndex + 1) % speeds.length;
        if (this.audio) this.audio.playbackRate = speeds[speedIndex];
        speed.textContent = `${speeds[speedIndex]}\xD7`;
      });
      if (shouldAutoplay) {
        void this.audio.play().then(() => {
          this.beginAudioProgress(item);
          this.playing = true;
          (0, import_obsidian3.setIcon)(play, "pause");
        }).catch(() => {
          this.playing = false;
          (0, import_obsidian3.setIcon)(play, "play");
        });
      } else if (wasPlaying) {
        this.playing = true;
        (0, import_obsidian3.setIcon)(play, "pause");
      }
    } else {
      this.destroyAudio();
      this.autoplayItemId = null;
      play.addEventListener("click", () => this.executeCommand("vaultcast:open-player"));
      timeline.disabled = true;
      consoleEl.createEl("small", { cls: "cld-player-status", text: "\u6CA1\u6709\u68C0\u6D4B\u5230\u672C\u5730\u97F3\u9891\uFF1B\u64AD\u653E\u6309\u94AE\u5C06\u6253\u5F00 VaultCast\u3002" });
    }
    const actions = playerCard.createDiv({ cls: "cld-detail-actions" });
    const listened = actions.createEl("button", { cls: "cld-text-button cld-listen-state-button", attr: { type: "button" } });
    this.updateListenStateButton(listened, item);
    listened.addEventListener("click", async () => {
      if (this.plugin.contentProgress(item.file)?.state === "complete") {
        await this.plugin.resetContentProgress(item.file);
      } else {
        await this.plugin.markContentComplete(item.file);
      }
      this.updateListenStateButton(listened, item);
      this.updateRenderedStatus(item);
    });
    const source = actions.createEl("button", { cls: "cld-text-button", text: item.file.extension === "md" ? "\u6253\u5F00\u8282\u76EE\u7B14\u8BB0" : "\u6253\u5F00\u97F3\u9891\u6587\u4EF6", attr: { type: "button" } });
    source.addEventListener("click", () => void this.openFile(item.file));
    if (item.externalUrl) {
      const link = actions.createEl("button", { cls: "cld-text-button", text: "\u6253\u5F00\u539F\u59CB\u94FE\u63A5", attr: { type: "button" } });
      link.addEventListener("click", () => window.open(item.externalUrl, "_blank"));
    }
    if (this.getMatchedNote(item)) {
      const article = actions.createEl("button", { cls: "cld-text-button", text: "\u9605\u8BFB\u5BF9\u5E94\u6587\u7AE0", attr: { type: "button" } });
      article.addEventListener("click", () => this.openMatchedArticle(item));
    }
    const moment = parent.createDiv({ cls: "cld-moment cld-glass" });
    moment.createEl("strong", { text: "\u8BB0\u5F55\u6B64\u523B" });
    const thought = moment.createEl("textarea", { cls: "cld-textarea", attr: { rows: "4", placeholder: "\u8BB0\u5F55\u73B0\u5728\u60F3\u5230\u7684\u5185\u5BB9\u2026", "aria-label": "\u6B64\u523B\u7684\u60F3\u6CD5" } });
    const save = moment.createEl("button", { cls: "cld-primary-button", text: "\u4FDD\u5B58\u60F3\u6CD5", attr: { type: "button" } });
    save.addEventListener("click", async () => {
      const time = formatTime(this.audio?.currentTime ?? 0);
      const file = await this.plugin.appendAnnotation(item, thought.value, "", time);
      if (!file) {
        new import_obsidian3.Notice("\u8BF7\u5148\u5199\u4E0B\u60F3\u6CD5\u3002");
        return;
      }
      thought.value = "";
      new import_obsidian3.Notice(`\u5DF2\u4FDD\u5B58\u5230 ${file.path}`);
    });
  }
  async renderPodcastInspector(layout) {
    const aside = layout.createEl("aside", { cls: "cld-inspector cld-side-player cld-glass", attr: { "aria-label": "\u5F53\u524D\u64AD\u653E\u8282\u76EE" } });
    const item = this.selected || this.currentItems()[0];
    if (!item) {
      aside.createEl("small", { text: "\u5F53\u524D\u64AD\u653E" });
      aside.createEl("h3", { text: "\u9009\u62E9\u4E00\u96C6\u8282\u76EE" });
      return;
    }
    const artwork = aside.createDiv({ cls: "cld-side-player-cover" });
    const override = this.plugin.settings.coverOverrides[item.file.path] || "";
    const cover = this.plugin.indexer.resolveResource(override, item.file) || item.cover;
    if (cover) {
      artwork.addClass("has-image");
      artwork.style.backgroundImage = `url("${cover.replace(/"/g, "%22")}")`;
    } else {
      artwork.createSpan({ cls: "cld-side-player-initials", text: initials(item.title) });
    }
    const copy = aside.createDiv({ cls: "cld-side-player-copy" });
    copy.createEl("small", { text: `${item.subtitle} \xB7 \u5F53\u524D\u8282\u76EE` });
    copy.createEl("h3", { text: item.title });
    this.renderContentStatus(copy, item);
    if (item.excerpt && item.excerpt !== item.subtitle) copy.createEl("p", { text: item.excerpt });
    const timeline = aside.createEl("input", { cls: "cld-audio-range", attr: { type: "range", min: "0", max: "1000", value: "0", "aria-label": "\u64AD\u653E\u8FDB\u5EA6" } });
    const timelineRow = aside.createDiv({ cls: "cld-player-timecodes" });
    const current = timelineRow.createEl("time", { text: "00:00" });
    const total = timelineRow.createEl("time", { text: "00:00" });
    const controls = aside.createDiv({ cls: "cld-side-player-controls" });
    const previous = this.iconButton(controls, "skip-back", "\u4E0A\u4E00\u6761");
    const play = controls.createEl("button", { cls: "cld-play-button", attr: { type: "button", "aria-label": "\u64AD\u653E" } });
    (0, import_obsidian3.setIcon)(play, "play");
    const next = this.iconButton(controls, "skip-forward", "\u4E0B\u4E00\u6761");
    const options = aside.createDiv({ cls: "cld-player-options" });
    this.createPlaybackModeSelect(options);
    const speed = options.createEl("button", { cls: "cld-speed-control", text: "1\xD7", attr: { type: "button", "aria-label": "\u64AD\u653E\u901F\u5EA6" } });
    const audioUrl = await this.resolveAudio(item);
    if (audioUrl) {
      const shouldAutoplay = this.autoplayItemId === item.id;
      this.autoplayItemId = null;
      const wasPlaying = this.audioItemId === item.id && Boolean(this.audio && !this.audio.paused);
      this.audio = this.prepareAudio(item, audioUrl, shouldAutoplay);
      this.audio.onloadedmetadata = () => {
        total.textContent = formatTime(this.audio?.duration ?? 0);
      };
      this.audio.ontimeupdate = () => {
        if (!this.audio?.duration) return;
        current.textContent = formatTime(this.audio.currentTime);
        timeline.value = String(Math.round(this.audio.currentTime / this.audio.duration * 1e3));
        this.trackAudioProgress(item, this.audio);
        this.renderMiniPlayer(item);
      };
      this.audio.onended = () => {
        this.completeAudioProgress(item);
        if (!this.playAfterEnd(item)) {
          this.playing = false;
          (0, import_obsidian3.setIcon)(play, "play");
        }
      };
      previous.addEventListener("click", () => this.playAdjacent(item, -1, true));
      next.addEventListener("click", () => this.playAdjacent(item, 1, true));
      play.addEventListener("click", async () => {
        if (!this.audio) return;
        if (this.audio.paused) {
          await this.audio.play();
          this.beginAudioProgress(item);
          this.playing = true;
          (0, import_obsidian3.setIcon)(play, "pause");
        } else {
          this.audio.pause();
          this.playing = false;
          (0, import_obsidian3.setIcon)(play, "play");
        }
      });
      timeline.addEventListener("input", () => {
        if (this.audio?.duration) this.audio.currentTime = Number(timeline.value) / 1e3 * this.audio.duration;
      });
      const speeds = [1, 1.25, 1.5, 2];
      let speedIndex = 0;
      speed.addEventListener("click", () => {
        speedIndex = (speedIndex + 1) % speeds.length;
        if (this.audio) this.audio.playbackRate = speeds[speedIndex];
        speed.textContent = `${speeds[speedIndex]}\xD7`;
      });
      if (shouldAutoplay) {
        void this.audio.play().then(() => {
          this.beginAudioProgress(item);
          this.playing = true;
          (0, import_obsidian3.setIcon)(play, "pause");
        }).catch(() => {
          this.playing = false;
          (0, import_obsidian3.setIcon)(play, "play");
          new import_obsidian3.Notice("\u7CFB\u7EDF\u963B\u6B62\u4E86\u81EA\u52A8\u64AD\u653E\uFF0C\u8BF7\u70B9\u51FB\u4E00\u6B21\u53F3\u4FA7\u64AD\u653E\u952E\u3002", 3500);
        });
      } else if (wasPlaying) {
        this.playing = true;
        (0, import_obsidian3.setIcon)(play, "pause");
        this.renderMiniPlayer(item);
      }
    } else {
      this.destroyAudio();
      const shouldOpenFallback = this.autoplayItemId === item.id;
      this.autoplayItemId = null;
      timeline.disabled = true;
      play.addEventListener("click", () => this.executeCommand("vaultcast:open-player"));
      aside.createEl("small", { cls: "cld-player-status", text: "\u672A\u68C0\u6D4B\u5230\u672C\u5730\u97F3\u9891" });
      if (shouldOpenFallback) this.executeCommand("vaultcast:open-player");
    }
    const matchedNote = this.getMatchedNote(item);
    if (matchedNote) {
      const article = aside.createEl("button", { cls: "cld-primary-button cld-open-article", text: "\u9605\u8BFB\u5BF9\u5E94\u6587\u7AE0", attr: { type: "button" } });
      article.addEventListener("click", () => this.openMatchedArticle(item));
    }
  }
  renderInspector(layout) {
    const aside = layout.createEl("aside", { cls: "cld-inspector cld-glass", attr: { "aria-label": "\u5185\u5BB9\u8BE6\u60C5" } });
    const item = this.selected || this.currentItems()[0];
    if (!item) {
      aside.createEl("small", { text: "\u5185\u5BB9\u8BE6\u60C5" });
      aside.createEl("h3", { text: "\u9009\u62E9\u4E00\u9879\u5185\u5BB9" });
      aside.createEl("p", { text: "\u5C01\u9762\u3001\u8FDB\u5EA6\u548C\u4E0B\u4E00\u6B65\u64CD\u4F5C\u4F1A\u663E\u793A\u5728\u8FD9\u91CC\u3002" });
      return;
    }
    const preview = aside.createDiv({ cls: `cld-inspector-cover cld-kind-${item.kind}` });
    const cover = this.plugin.indexer.resolveResource(this.plugin.settings.coverOverrides[item.file.path] || "", item.file) || item.cover;
    if (cover) preview.style.backgroundImage = `url("${cover.replace(/"/g, "%22")}")`;
    else {
      const icon = preview.createSpan();
      (0, import_obsidian3.setIcon)(icon, item.source.icon || "file-text");
    }
    aside.createEl("small", { text: this.plugin.indexer.kindLabel(item.kind) });
    aside.createEl("h3", { text: item.title });
    aside.createEl("p", { text: item.subtitle });
    const savedProgress = this.plugin.contentProgress(item.file)?.progress ?? item.progress;
    const head = aside.createDiv({ cls: "cld-progress-head" });
    head.createSpan({ text: "\u8FDB\u5EA6" });
    head.createEl("strong", { text: `${Math.round(savedProgress)}%` });
    const track = aside.createDiv({ cls: "cld-track" });
    track.createSpan().style.width = `${savedProgress}%`;
    const open = aside.createEl("button", { cls: "cld-primary-button", text: item.kind === "podcast" ? "\u6253\u5F00\u64AD\u653E\u5668" : "\u7EE7\u7EED\u9605\u8BFB", attr: { type: "button" } });
    open.addEventListener("click", () => {
      this.selected = item;
      this.detailOpen = true;
      void this.refresh();
    });
  }
  renderMiniPlayer(item) {
    const host = this.contentEl.querySelector(".cld-root");
    const existing = host?.querySelector(".cld-mini-player");
    if (!host || this.detailOpen) {
      existing?.remove();
      return;
    }
    if (!this.audio || !this.playing) {
      existing?.remove();
      return;
    }
    const dock = existing || host.createDiv({ cls: "cld-mini-player cld-glass" });
    dock.empty();
    const copy = dock.createDiv();
    copy.createEl("small", { text: `\u6B63\u5728\u64AD\u653E \xB7 ${formatTime(this.audio.currentTime)}` });
    copy.createEl("strong", { text: item.title });
    const button = dock.createEl("button", { cls: "cld-play-button", attr: { type: "button", "aria-label": "\u6682\u505C" } });
    (0, import_obsidian3.setIcon)(button, "pause");
    button.addEventListener("click", () => {
      this.audio?.pause();
      this.playing = false;
      dock.remove();
    });
  }
  async resolveAudio(item) {
    const direct = this.plugin.indexer.resolveResource(item.audioPath, item.file);
    if (direct) return direct;
    if (item.file.extension !== "md") return this.app.vault.getResourcePath(item.file);
    const content = await this.app.vault.cachedRead(item.file);
    const wikiLink = content.match(/!?\[\[([^\]]+\.(?:mp3|m4a|wav|flac|aac|ogg|opus))(?:\|[^\]]+)?\]\]/i);
    if (wikiLink) return this.plugin.indexer.resolveResource(wikiLink[1], item.file);
    const markdownLink = content.match(/\[[^\]]*\]\(([^)]+\.(?:mp3|m4a|wav|flac|aac|ogg|opus)(?:\?[^)]*)?)\)/i);
    return markdownLink ? this.plugin.indexer.resolveResource(markdownLink[1], item.file) : "";
  }
  executeCommand(id) {
    const host = this.app;
    if (!host.commands?.executeCommandById(id)) new import_obsidian3.Notice("\u5BF9\u5E94\u63D2\u4EF6\u6216\u547D\u4EE4\u5F53\u524D\u4E0D\u53EF\u7528\u3002");
  }
  async openFile(file) {
    void this.plugin.recordView(file);
    await this.app.workspace.getLeaf(import_obsidian3.Platform.isMobile ? false : "tab").openFile(file);
  }
  iconButton(parent, iconName, label) {
    const button = parent.createEl("button", { cls: "cld-icon-button", attr: { type: "button", "aria-label": label } });
    (0, import_obsidian3.setIcon)(button, iconName);
    return button;
  }
  createPlaybackModeSelect(parent) {
    const select = parent.createEl("select", {
      cls: "cld-playback-mode",
      attr: { "aria-label": "\u64AD\u653E\u6A21\u5F0F" }
    });
    for (const [value, label] of [
      ["sequential", "\u987A\u5E8F\u64AD\u653E"],
      ["list-loop", "\u5217\u8868\u5FAA\u73AF"],
      ["single-loop", "\u5355\u66F2\u5FAA\u73AF"],
      ["shuffle", "\u968F\u673A\u64AD\u653E"]
    ]) select.createEl("option", { value, text: label });
    select.value = this.plugin.settings.playbackMode;
    select.addEventListener("change", async () => {
      this.plugin.settings.playbackMode = select.value;
      await this.plugin.saveSettings(false);
    });
    return select;
  }
  playAfterEnd(item) {
    if (this.plugin.settings.playbackMode === "single-loop") {
      if (!this.audio) return false;
      this.audio.currentTime = 0;
      void this.audio.play();
      this.playing = true;
      return true;
    }
    if (this.plugin.settings.playbackMode === "shuffle") return this.playRandom(item);
    return this.playAdjacent(item, 1, this.plugin.settings.playbackMode === "list-loop");
  }
  playRandom(item) {
    const queue = this.currentItems().filter((entry) => entry.kind === "podcast");
    const choices = queue.filter((entry) => entry.id !== item.id);
    const target = choices[Math.floor(Math.random() * choices.length)];
    if (!target) return false;
    this.articleReturnItem = null;
    this.selected = target;
    void this.plugin.recordView(target.file);
    this.autoplayItemId = target.id;
    void this.refresh();
    return true;
  }
  getMatchedNote(item) {
    if (!item.notePath) return null;
    const file = this.app.vault.getAbstractFileByPath(item.notePath);
    return file instanceof import_obsidian3.TFile ? file : null;
  }
  openMatchedArticle(item) {
    const note = this.getMatchedNote(item);
    if (!note) {
      new import_obsidian3.Notice("\u6CA1\u6709\u627E\u5230\u4E0E\u8FD9\u6761\u97F3\u9891\u5BF9\u5E94\u7684\u6587\u7AE0\u3002");
      return;
    }
    this.openArticleFile(note, item);
  }
  openArticlePath(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof import_obsidian3.TFile) this.openArticleFile(file);
    else new import_obsidian3.Notice("\u539F\u6587\u7AE0\u5DF2\u7ECF\u79FB\u52A8\u6216\u4E0D\u5B58\u5728\u3002");
  }
  openArticleFile(note, returnPodcast = null) {
    void this.plugin.recordView(note);
    const source = this.sourceForNote(note);
    if (!source) {
      void this.openFile(note);
      return;
    }
    if (returnPodcast && this.audio && this.audioItemId === returnPodcast.id) {
      this.articleReturnItem = returnPodcast;
    } else {
      this.destroyAudio();
    }
    this.selected = this.plugin.indexer.itemForFile(note, source);
    this.autoplayItemId = null;
    this.detailOpen = true;
    void this.refresh();
  }
  sourceForNote(note) {
    return this.enabledSources().filter((entry) => entry.id !== ANNOTATION_SOURCE_ID).filter((entry) => entry.kind !== "podcast").filter((entry) => note.path === entry.folder || note.path.startsWith(`${entry.folder.replace(/\/$/, "")}/`)).sort((a, b) => b.folder.length - a.folder.length)[0];
  }
  returnToPodcastList() {
    const podcast = this.articleReturnItem;
    if (!podcast) return;
    this.articleReturnItem = null;
    this.selected = podcast;
    this.activeSourceId = podcast.source.id;
    this.detailOpen = false;
    void this.refresh();
  }
  playAdjacent(item, direction, wrap) {
    const queue = this.currentItems().filter((entry) => entry.kind === "podcast");
    if (!queue.length) return false;
    const currentIndex = queue.findIndex((entry) => entry.id === item.id);
    if (currentIndex < 0) return false;
    let nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= queue.length) {
      if (!wrap) return false;
      nextIndex = nextIndex < 0 ? queue.length - 1 : 0;
    }
    const target = queue[nextIndex];
    if (!target || target.id === item.id && queue.length === 1 && !wrap) return false;
    this.articleReturnItem = null;
    this.selected = target;
    void this.plugin.recordView(target.file);
    this.autoplayItemId = target.id;
    void this.refresh();
    return true;
  }
  async playAdjacentArticle(item, direction) {
    const queue = this.currentItems().filter((entry) => entry.kind === "podcast");
    const currentIndex = queue.findIndex((entry) => entry.id === item.id);
    if (currentIndex < 0) return;
    for (let offset = 1; offset < queue.length; offset += 1) {
      const index = (currentIndex + direction * offset + queue.length) % queue.length;
      const target = queue[index];
      const note = this.getMatchedNote(target);
      const source = note ? this.sourceForNote(note) : void 0;
      const audioUrl = await this.resolveAudio(target);
      if (!note || !source || !audioUrl) continue;
      this.audio = this.prepareAudio(target, audioUrl, true);
      this.articleReturnItem = target;
      this.selected = this.plugin.indexer.itemForFile(note, source);
      this.autoplayItemId = target.id;
      this.detailOpen = true;
      void this.plugin.recordView(target.file);
      void this.plugin.recordView(note);
      void this.refresh();
      return;
    }
    new import_obsidian3.Notice("\u6CA1\u6709\u627E\u5230\u5E26\u5BF9\u5E94\u539F\u6587\u7684\u4E0A\u4E00\u6761\u6216\u4E0B\u4E00\u6761\u8282\u76EE\u3002");
  }
  destroyAudio() {
    if (!this.audio) return;
    this.audio.pause();
    this.audio.onloadedmetadata = null;
    this.audio.ontimeupdate = null;
    this.audio.onended = null;
    this.audio.src = "";
    this.audio = null;
    this.audioItemId = null;
    this.articleReturnItem = null;
    this.playing = false;
    this.contentEl.querySelector(".cld-mini-player")?.remove();
  }
  prepareAudio(item, url, continuePlayback) {
    const sameItem = this.audioItemId === item.id;
    const canReuse = Boolean(this.audio && (sameItem || continuePlayback));
    if (!canReuse) {
      this.destroyAudio();
      this.audio = new Audio(url);
    } else if (!sameItem && this.audio) {
      this.audio.onloadedmetadata = null;
      this.audio.ontimeupdate = null;
      this.audio.onended = null;
      this.audio.src = url;
      this.audio.load();
    }
    this.audioItemId = item.id;
    return this.audio;
  }
};
async function openMusicApp(url) {
  let resolvedUrl = url;
  if (isQqMusicUrl(url) && !/(?:playlist|gedan)[/:]\d+|[?&]id=\d+/i.test(url)) {
    try {
      const response = await (0, import_obsidian3.requestUrl)({
        url,
        method: "GET",
        headers: {
          Accept: "text/html",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15"
        }
      });
      const canonical = response.text.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)/i)?.[1] || response.text.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)?.[1] || "";
      if (canonical) resolvedUrl = canonical.replace(/&amp;/g, "&");
    } catch {
    }
  }
  const songId = resolvedUrl.match(/[#/?&]song[/?&]?id=(\d+)/i)?.[1] || (resolvedUrl.includes("#/song") ? resolvedUrl.match(/[?&]id=(\d+)/i)?.[1] : "");
  let qqSongMid = isQqMusicUrl(resolvedUrl) ? resolvedUrl.match(/songDetail[/:]([0-9A-Za-z]+)/i)?.[1] || resolvedUrl.match(/[?&]songmid=([0-9A-Za-z]+)/i)?.[1] : "";
  if (qqSongMid && /^\d+$/.test(qqSongMid)) {
    try {
      const songResponse = await (0, import_obsidian3.requestUrl)({
        url: `https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg?songid=${qqSongMid}&format=json`,
        headers: { Accept: "application/json", Referer: "https://y.qq.com/", "User-Agent": "Mozilla/5.0" }
      });
      const songPayload = JSON.parse(songResponse.text);
      qqSongMid = songPayload.data?.[0]?.mid || qqSongMid;
    } catch {
    }
  }
  const programId = resolvedUrl.match(/[#/?&]program[/?&]?id=(\d+)/i)?.[1];
  const radioId = resolvedUrl.match(/[#/?&](?:djradio|dj)[/?&]?id=(\d+)/i)?.[1];
  const netEasePlaylistId = !songId ? resolvedUrl.match(/[#/?&]playlist[/?&]?id=(\d+)/i)?.[1] || resolvedUrl.match(/playlist[/:](\d+)/i)?.[1] : "";
  const qqPlaylistId = !songId && isQqMusicUrl(resolvedUrl) ? resolvedUrl.match(/(?:playlist|gedan)[/:](\d+)/i)?.[1] || resolvedUrl.match(/[?&](?:id|playlistid|dissid)=(\d+)/i)?.[1] : "";
  const qqAlbumId = !songId && isQqMusicUrl(resolvedUrl) ? resolvedUrl.match(/albumDetail[/:](\d+)/i)?.[1] || resolvedUrl.match(/[?&]albumId=(\d+)/i)?.[1] : "";
  const qqScheme = import_obsidian3.Platform.isMobile ? "qqmusic" : "qqmusicmac";
  const deepLink = songId ? `orpheus://song/${songId}` : qqSongMid ? `${qqScheme}://qq.com/media/playSonglist?p=${encodeURIComponent(JSON.stringify({ action: "play", song: [{ songmid: qqSongMid }] }))}` : programId ? `orpheus://program/${programId}` : radioId ? `orpheus://radio/${radioId}` : netEasePlaylistId ? `orpheus://playlist/${netEasePlaylistId}` : qqAlbumId ? `${qqScheme}://qq.com/ui/album?p=${encodeURIComponent(JSON.stringify({ id: qqAlbumId }))}` : qqPlaylistId ? `${qqScheme}://qq.com/ui/gedan?p=${encodeURIComponent(JSON.stringify({ id: qqPlaylistId }))}` : "";
  const appPath = import_obsidian3.Platform.isMobile ? "" : isQqMusicUrl(resolvedUrl) ? "/Applications/QQMusic.app" : "/Applications/NeteaseMusic.app";
  if (deepLink) {
    try {
      await openExternalUrl(deepLink, appPath);
      return;
    } catch {
    }
  }
  await openExternalUrl(url);
}
function openExternalUrl(url, _appPath = "") {
  if (import_obsidian3.Platform.isMobile) {
    window.location.href = url;
    return Promise.resolve();
  }
  try {
    window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    return Promise.reject(new Error("\u65E0\u6CD5\u6253\u5F00\u5916\u90E8\u94FE\u63A5"));
  }
  return Promise.resolve();
}
function isQqMusicUrl(url) {
  return /(?:^|\/)(?:y\.qq\.com|i\.y\.qq\.com|c6\.y\.qq\.com)\//i.test(url);
}
function isNetEaseProgramUrl(url) {
  return /music\.163\.com\/(?:dj|djradio)(?:[/?#]|$)/i.test(url);
}
var NoteTitleModal = class extends import_obsidian3.Modal {
  constructor(app, sourceName, onSubmitTitle) {
    super(app);
    this.sourceName = sourceName;
    this.onSubmitTitle = onSubmitTitle;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cld-note-modal");
    contentEl.createEl("h2", { text: "\u65B0\u5EFA\u7B14\u8BB0" });
    contentEl.createEl("p", { text: `\u4FDD\u5B58\u5230\uFF1A${this.sourceName}` });
    const form = contentEl.createEl("form", { cls: "cld-note-modal-form" });
    const input = form.createEl("input", {
      cls: "cld-note-title-input",
      attr: { type: "text", placeholder: "\u8F93\u5165\u7B14\u8BB0\u6807\u9898", autocomplete: "off", "aria-label": "\u7B14\u8BB0\u6807\u9898" }
    });
    const actions = form.createDiv({ cls: "cld-note-modal-actions" });
    const cancel = actions.createEl("button", { text: "\u53D6\u6D88", attr: { type: "button" } });
    const create = actions.createEl("button", { cls: "mod-cta", text: "\u521B\u5EFA", attr: { type: "submit" } });
    cancel.addEventListener("click", () => this.close());
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const title = input.value.trim();
      if (!title) {
        new import_obsidian3.Notice("\u8BF7\u8F93\u5165\u7B14\u8BB0\u6807\u9898\u3002");
        input.focus();
        return;
      }
      create.disabled = true;
      try {
        await this.onSubmitTitle(title);
        this.close();
      } catch (error) {
        new import_obsidian3.Notice(error instanceof Error ? `\u521B\u5EFA\u5931\u8D25\uFF1A${error.message}` : "\u521B\u5EFA\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002");
        create.disabled = false;
      }
    });
    window.setTimeout(() => input.focus(), 0);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var AnnotationEditModal = class extends import_obsidian3.Modal {
  constructor(app, annotation, onSubmit) {
    super(app);
    this.annotation = annotation;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cld-note-modal");
    contentEl.createEl("h2", { text: "\u7F16\u8F91\u6279\u6CE8" });
    const form = contentEl.createEl("form", { cls: "cld-note-modal-form" });
    form.createEl("label", { text: "\u6458\u5F55\u539F\u6587" });
    const quote = form.createEl("textarea", { cls: "cld-textarea", attr: { rows: "4", "aria-label": "\u6458\u5F55\u539F\u6587" } });
    quote.value = this.annotation.quote;
    form.createEl("label", { text: "\u6279\u6CE8\u5185\u5BB9" });
    const note = form.createEl("textarea", { cls: "cld-textarea", attr: { rows: "6", "aria-label": "\u6279\u6CE8\u5185\u5BB9" } });
    note.value = this.annotation.note;
    const actions = form.createDiv({ cls: "cld-note-modal-actions" });
    const cancel = actions.createEl("button", { text: "\u53D6\u6D88", attr: { type: "button" } });
    const save = actions.createEl("button", { cls: "mod-cta", text: "\u4FDD\u5B58\u4FEE\u6539", attr: { type: "submit" } });
    cancel.addEventListener("click", () => this.close());
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      save.disabled = true;
      try {
        await this.onSubmit(quote.value, note.value);
        this.close();
      } catch (error) {
        new import_obsidian3.Notice(error instanceof Error ? `\u4FDD\u5B58\u5931\u8D25\uFF1A${error.message}` : "\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002");
        save.disabled = false;
      }
    });
    window.setTimeout(() => note.focus(), 0);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var AnnotationDeleteModal = class extends import_obsidian3.Modal {
  constructor(app, onConfirm) {
    super(app);
    this.onConfirm = onConfirm;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cld-note-modal");
    contentEl.createEl("h2", { text: "\u5220\u9664\u8FD9\u6761\u6279\u6CE8\uFF1F" });
    contentEl.createEl("p", { text: "\u5220\u9664\u540E\u6587\u7AE0\u9AD8\u4EAE\u548C\u8FD9\u6761\u6279\u6CE8\u4F1A\u4E00\u5E76\u79FB\u9664\u3002" });
    const actions = contentEl.createDiv({ cls: "cld-note-modal-actions" });
    const cancel = actions.createEl("button", { text: "\u53D6\u6D88", attr: { type: "button" } });
    const remove = actions.createEl("button", { cls: "mod-warning", text: "\u5220\u9664", attr: { type: "button" } });
    cancel.addEventListener("click", () => this.close());
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      try {
        await this.onConfirm();
        this.close();
      } catch (error) {
        new import_obsidian3.Notice(error instanceof Error ? `\u5220\u9664\u5931\u8D25\uFF1A${error.message}` : "\u5220\u9664\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002");
        remove.disabled = false;
      }
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};
var MusicPlaylistModal = class extends import_obsidian3.Modal {
  constructor(app, sourceName, onSubmitUrl) {
    super(app);
    this.sourceName = sourceName;
    this.onSubmitUrl = onSubmitUrl;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cld-note-modal");
    contentEl.createEl("h2", { text: "\u6DFB\u52A0\u7F51\u6613\u4E91\u6B4C\u5355" });
    contentEl.createEl("p", { text: `\u4FDD\u5B58\u5230\uFF1A${this.sourceName} \xB7 \u7C98\u8D34\u5206\u4EAB\u94FE\u63A5\u5373\u53EF` });
    const form = contentEl.createEl("form", { cls: "cld-note-modal-form" });
    const input = form.createEl("input", {
      cls: "cld-note-title-input",
      attr: { type: "url", placeholder: "https://music.163.com/#/playlist?id=...", autocomplete: "off", "aria-label": "\u7F51\u6613\u4E91\u6B4C\u5355\u94FE\u63A5" }
    });
    const titleInput = form.createEl("input", {
      cls: "cld-note-title-input",
      attr: { type: "text", placeholder: "\u81EA\u5B9A\u4E49\u540D\u79F0\uFF08\u53EF\u9009\uFF09", autocomplete: "off", "aria-label": "\u6B4C\u5355\u540D\u79F0" }
    });
    const actions = form.createDiv({ cls: "cld-note-modal-actions" });
    const cancel = actions.createEl("button", { text: "\u53D6\u6D88", attr: { type: "button" } });
    const create = actions.createEl("button", { cls: "mod-cta", text: "\u6DFB\u52A0", attr: { type: "submit" } });
    cancel.addEventListener("click", () => this.close());
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const url = input.value.trim();
      if (!/^https?:\/\/(?:www\.)?(?:music\.163\.com|y\.qq\.com|i\.y\.qq\.com|c6\.y\.qq\.com)\//i.test(url)) {
        new import_obsidian3.Notice("\u8BF7\u7C98\u8D34\u7F51\u6613\u4E91\u6216 QQ \u97F3\u4E50\u7684\u6B4C\u5355\u5206\u4EAB\u94FE\u63A5\u3002");
        input.focus();
        return;
      }
      create.disabled = true;
      try {
        await this.onSubmitUrl(url, titleInput.value.trim());
        this.close();
      } catch (error) {
        new import_obsidian3.Notice(error instanceof Error ? `\u6DFB\u52A0\u5931\u8D25\uFF1A${error.message}` : "\u6DFB\u52A0\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002");
        create.disabled = false;
      }
    });
    window.setTimeout(() => input.focus(), 0);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var MusicPlaylistNameModal = class extends import_obsidian3.Modal {
  constructor(app, currentTitle, onSubmitTitle) {
    super(app);
    this.currentTitle = currentTitle;
    this.onSubmitTitle = onSubmitTitle;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cld-note-modal");
    contentEl.createEl("h2", { text: "\u7F16\u8F91\u6B4C\u5355\u540D\u79F0" });
    const form = contentEl.createEl("form", { cls: "cld-note-modal-form" });
    const input = form.createEl("input", {
      cls: "cld-note-title-input",
      attr: { type: "text", value: this.currentTitle, autocomplete: "off", "aria-label": "\u6B4C\u5355\u540D\u79F0" }
    });
    const actions = form.createDiv({ cls: "cld-note-modal-actions" });
    const cancel = actions.createEl("button", { text: "\u53D6\u6D88", attr: { type: "button" } });
    const save = actions.createEl("button", { cls: "mod-cta", text: "\u4FDD\u5B58", attr: { type: "submit" } });
    cancel.addEventListener("click", () => this.close());
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const title = input.value.trim();
      if (!title) {
        new import_obsidian3.Notice("\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A\u3002");
        input.focus();
        return;
      }
      save.disabled = true;
      try {
        await this.onSubmitTitle(title);
        this.close();
      } catch (error) {
        new import_obsidian3.Notice(error instanceof Error ? `\u4FDD\u5B58\u5931\u8D25\uFF1A${error.message}` : "\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002");
        save.disabled = false;
      }
    });
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }
  onClose() {
    this.contentEl.empty();
  }
};
function storedAnnotationsFor(content, sourcePath) {
  const source = `\u6765\u6E90\uFF1A[[${sourcePath}]]`;
  const annotations = [];
  const headings = [...content.matchAll(/^##\s[^\n]*$/gm)];
  for (let index = 0; index < headings.length; index += 1) {
    const match = headings[index];
    if (match.index === void 0) continue;
    const start = match.index;
    const end = headings[index + 1]?.index ?? content.length;
    const block = content.slice(start, end);
    if (!block.includes(source)) continue;
    const lines = block.trimEnd().split(/\r?\n/);
    const heading = lines.shift() || "## \u6279\u6CE8";
    const sourceLine = lines.find((line) => line.startsWith("\u6765\u6E90\uFF1A")) || `\u6765\u6E90\uFF1A[[${sourcePath}]]`;
    const timeLine = lines.find((line) => line.startsWith("\u65F6\u95F4\uFF1A")) || "";
    const quoteStart = lines.findIndex((line) => /^>\s?/.test(line));
    let quoteEnd = quoteStart;
    while (quoteStart >= 0 && quoteEnd < lines.length && /^>\s?/.test(lines[quoteEnd])) quoteEnd += 1;
    const quote = quoteStart >= 0 ? lines.slice(quoteStart, quoteEnd).map((line) => line.replace(/^>\s?/, "")).join("\n").trim() : "";
    const noteStart = quoteStart >= 0 ? quoteEnd : 0;
    const note = lines.slice(noteStart).filter((line) => !/^\s*(来源|时间)：/.test(line)).join("\n").trim();
    annotations.push({
      quote,
      note,
      heading,
      sourceLine,
      timeLine,
      start,
      end
    });
  }
  return annotations;
}
function annotationBlock(annotation, quote, note) {
  const quotation = quote.trim() ? `

> ${quote.trim().replace(/\n+/g, "\n> ")}` : "";
  const text = note.trim() ? `

${note.trim()}` : "";
  return `${annotation.heading}

${annotation.sourceLine}${annotation.timeLine ? `
${annotation.timeLine}` : ""}${quotation}${text}

`;
}
function normalizedTextOffsets(value) {
  let text = "";
  const offsets = [];
  let previousWasWhitespace = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (/\s/.test(character)) {
      if (!previousWasWhitespace) {
        text += " ";
        offsets.push(index);
      }
      previousWasWhitespace = true;
    } else {
      text += character;
      offsets.push(index);
      previousWasWhitespace = false;
    }
  }
  const leading = text.match(/^\s+/)?.[0].length || 0;
  const trailing = text.match(/\s+$/)?.[0].length || 0;
  return {
    text: text.slice(leading, trailing ? -trailing : void 0),
    offsets: offsets.slice(leading, trailing ? -trailing : void 0)
  };
}
function indexedArticleText(article) {
  let text = "";
  const positions = [];
  let previousWasWhitespace = false;
  const walker = article.ownerDocument.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  let node;
  while (node = walker.nextNode()) {
    if (node.parentElement?.closest(".cld-annotation-highlight")) continue;
    for (let offset = 0; offset < node.data.length; offset += 1) {
      const character = node.data[offset];
      if (/\s/.test(character)) {
        if (!previousWasWhitespace) {
          text += " ";
          positions.push({ node, offset });
        }
        previousWasWhitespace = true;
      } else {
        text += character;
        positions.push({ node, offset });
        previousWasWhitespace = false;
      }
    }
  }
  const leading = text.match(/^\s+/)?.[0].length || 0;
  const trailing = text.match(/\s+$/)?.[0].length || 0;
  return {
    text: text.slice(leading, trailing ? -trailing : void 0),
    positions: positions.slice(leading, trailing ? -trailing : void 0)
  };
}
function annotationOriginalPath(content) {
  const match = content.match(/来源：\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
  return match?.[1]?.trim() || "";
}
function extractInspirationSentences(content, annotation) {
  const body = content.replace(/^---\s*[\s\S]*?\n---\s*/m, "").replace(/```[\s\S]*?```/g, "");
  const sentences = [];
  const seen = /* @__PURE__ */ new Set();
  for (const rawLine of body.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || /^#{1,6}\s/.test(trimmed) || /^[-*_]{3,}$/.test(trimmed) || /^\|/.test(trimmed)) continue;
    if (annotation && /^>/.test(trimmed)) continue;
    if (/^(来源|时间|日期|原文链接|音频|播客音频)\s*[：:]/.test(trimmed)) continue;
    const clean = trimmed.replace(/^\s*(?:[-*+] |\d+[.)]\s+)/, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/!\[\[[^\]]+\]\]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, path, alias) => alias || path.split("/").pop() || path).replace(/https?:\/\/\S+/g, "").replace(/<[^>]+>/g, "").replace(/[*_`~]/g, "").replace(/\s+/g, " ").trim();
    if (!clean) continue;
    const chunks = clean.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [];
    for (const chunk of chunks) {
      const sentence = chunk.trim();
      const length = [...sentence].length;
      if (length < 12 || length > 140 || !/[\p{L}\p{N}]/u.test(sentence) || seen.has(sentence)) continue;
      seen.add(sentence);
      sentences.push(sentence);
    }
  }
  return sentences;
}
function formatTime(value) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function formatDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function initials(value) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "\u266A";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
}
function formatCompactDuration(value) {
  if (!Number.isFinite(value) || value <= 0) return "--m";
  const minutes = Math.round(value / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
function formatUsage(minutes) {
  if (minutes < 60) return `${minutes} \u5206\u949F`;
  return `${Math.floor(minutes / 60)}\u5C0F\u65F6${minutes % 60 ? `${minutes % 60}\u5206` : ""}`;
}
function greetingForHour(hour) {
  if (hour < 6) return "\u51CC\u6668\u597D";
  if (hour < 12) return "\u65E9\u4E0A\u597D";
  if (hour < 14) return "\u4E2D\u5348\u597D";
  if (hour < 18) return "\u4E0B\u5348\u597D";
  return "\u665A\u4E0A\u597D";
}
function webHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "\u7F51\u9875\u94FE\u63A5";
  }
}
function extractWebLinks(content) {
  const entries = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (label, rawUrl) => {
    const url = rawUrl.replace(/[)>\],，。；;]+$/, "");
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    entries.push({ label: label.trim().replace(/[*_`]/g, "").slice(0, 100), url });
  };
  for (const match of content.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g)) add(match[1], match[2]);
  for (const match of content.matchAll(/https?:\/\/[^\s<]+/g)) add("", match[0]);
  return entries;
}

// src/main.ts
var ContentLibraryDashboardPlugin = class extends import_obsidian4.Plugin {
  settings = { ...DEFAULT_SETTINGS };
  indexer;
  refreshTimer = null;
  webPreviewCache = /* @__PURE__ */ new Map();
  playlistCache = /* @__PURE__ */ new Map();
  async onload() {
    await this.loadSettings();
    await this.saveData(this.settings);
    this.indexer = new VaultContentIndexer(this.app);
    this.registerView(
      CONTENT_LIBRARY_VIEW_TYPE,
      (leaf) => new ContentLibraryView(leaf, this)
    );
    this.addRibbonIcon("layout-dashboard", "Open Content Library", () => {
      void this.activateView();
    });
    this.addCommand({
      id: "open-dashboard",
      name: "Open dashboard",
      callback: () => void this.activateView()
    });
    this.addSettingTab(new ContentLibrarySettingsTab(this.app, this));
    const onChange = (file) => {
      if (file instanceof import_obsidian4.TFile && file.extension !== "md" && !/\.(png|jpe?g|webp|gif|mp3|m4a|wav|flac|aac)$/i.test(file.path)) return;
      this.scheduleRefresh();
    };
    this.registerEvent(this.app.vault.on("create", onChange));
    this.registerEvent(this.app.vault.on("modify", onChange));
    this.registerEvent(this.app.vault.on("delete", onChange));
    this.registerEvent(this.app.vault.on("rename", onChange));
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      const file = leaf?.view?.file;
      if (file instanceof import_obsidian4.TFile) void this.recordView(file);
      if (file instanceof import_obsidian4.TFile && this.isReadingFile(file)) void this.startContent(file);
    }));
  }
  onunload() {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
  }
  async activateView() {
    let leaf = this.app.workspace.getLeavesOfType(CONTENT_LIBRARY_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: CONTENT_LIBRARY_VIEW_TYPE, active: true });
    }
    void this.app.workspace.revealLeaf(leaf);
  }
  openSettingTab() {
    const host = this.app;
    host.setting?.open();
    host.setting?.openTabById(this.manifest.id);
  }
  async loadSettings() {
    const loaded = await this.loadData();
    const theme = ["grass", "blue", "pink", "rose", "black", "glass"].includes(loaded?.theme) ? loaded?.theme : DEFAULT_SETTINGS.theme;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      theme,
      themeMode: ["system", "light", "dark"].includes(loaded?.themeMode) ? loaded?.themeMode : DEFAULT_SETTINGS.themeMode,
      annotationHighlight: ["yellow", "orange", "blue", "pink"].includes(loaded?.annotationHighlight) ? loaded?.annotationHighlight : DEFAULT_SETTINGS.annotationHighlight,
      sources: Array.isArray(loaded?.sources) ? loaded.sources.map((source) => this.normalizeSource(source)) : [],
      sourceGroupOrder: this.normalizeSourceGroupOrder(loaded?.sourceGroupOrder),
      coverOverrides: loaded?.coverOverrides && typeof loaded.coverOverrides === "object" ? loaded.coverOverrides : {},
      usageByDate: loaded?.usageByDate && typeof loaded.usageByDate === "object" ? loaded.usageByDate : {},
      viewHistory: loaded?.viewHistory && typeof loaded.viewHistory === "object" ? loaded.viewHistory : {},
      contentProgress: loaded?.contentProgress && typeof loaded.contentProgress === "object" ? loaded.contentProgress : {},
      musicCollectionSnapshots: loaded?.musicCollectionSnapshots && typeof loaded.musicCollectionSnapshots === "object" ? loaded.musicCollectionSnapshots : {},
      playbackMode: ["sequential", "list-loop", "single-loop", "shuffle"].includes(
        loaded?.playbackMode
      ) ? loaded?.playbackMode : "sequential"
    };
    const musicFolder = (0, import_obsidian4.normalizePath)("\u97F3\u4E50\u6536\u85CF");
    const hasMusicFolder = Boolean(this.app.vault.getAbstractFileByPath(musicFolder));
    const hasMusicSource = this.settings.sources.some((source) => (0, import_obsidian4.normalizePath)(source.folder).replace(/\/$/, "") === musicFolder);
    if (hasMusicFolder && !hasMusicSource) {
      this.settings.sources.push({
        id: "source-music-collection",
        name: "\u97F3\u4E50\u6536\u85CF",
        folder: musicFolder,
        kind: "music",
        group: "music",
        icon: "music-2",
        coverPath: "",
        enabled: true
      });
    }
  }
  normalizeSourceGroupOrder(value) {
    const defaults = ["podcast", "music", "information", "skills", "bookshelf", "ideas", "needs"];
    const requested = Array.isArray(value) ? value : [];
    return [...requested.filter((entry) => defaults.includes(entry)), ...defaults].filter((entry, index, array) => array.indexOf(entry) === index).slice(0, defaults.length);
  }
  normalizeSource(source) {
    const folder = source.folder || "";
    const requestedKind = ["book", "podcast", "music", "x", "news", "clip", "generic"].includes(source.kind) ? source.kind : "generic";
    const isYouTubeArticleFolder = folder.split("/").pop()?.trim().toLowerCase() === "youtube podcast";
    return {
      id: source.id || `source-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: source.name || "New source",
      folder,
      kind: isYouTubeArticleFolder ? "generic" : requestedKind,
      group: ["information", "skills", "bookshelf", "ideas", "needs", "podcast", "music"].includes(source.group) ? source.group : this.inferSourceGroup(source),
      icon: source.icon || "folder",
      coverPath: source.coverPath || "",
      enabled: source.enabled !== false
    };
  }
  async getNetEasePlaylist(url) {
    const programRadioId = url.match(/(?:djradio|dj)[^#?]*[?#]?(?:[^#]*&)?id=(\d+)/i)?.[1] || url.match(/#\/(?:djradio|dj)\?id=(\d+)/i)?.[1] || "";
    const playlistId = !programRadioId ? url.match(/[?&]id=(\d+)/i)?.[1] || url.match(/playlist[/:](\d+)/i)?.[1] || "" : "";
    const cacheKey = programRadioId ? `dj:${programRadioId}` : `playlist:${playlistId}`;
    if (!programRadioId && !playlistId) return null;
    const cached = this.playlistCache.get(cacheKey);
    if (cached) return cached;
    if (programRadioId) {
      const request2 = (0, import_obsidian4.requestUrl)({
        url: `https://music.163.com/api/dj/program/byradio?asc=false&limit=1000&radioId=${programRadioId}&offset=0`,
        headers: { Accept: "application/json", Referer: "https://music.163.com/" }
      }).then((response) => {
        const payload = JSON.parse(response.text);
        const programs = payload.programs || [];
        if (!programs.length) return null;
        const radio = programs[0].radio;
        return {
          id: programRadioId,
          title: radio?.name || "\u7F51\u6613\u4E91\u64AD\u5BA2",
          cover: radio?.picUrl || programs[0].coverUrl || "",
          creator: radio?.name || "\u7F51\u6613\u4E91\u64AD\u5BA2",
          trackCount: programs.length,
          tracks: programs.map((program) => ({
            id: String(program.id || ""),
            title: program.name || "\u672A\u547D\u540D\u8282\u76EE",
            artist: program.dj?.nickname || radio?.name || "\u7F51\u6613\u4E91\u64AD\u5BA2",
            album: program.description || "",
            cover: program.coverUrl || radio?.picUrl || "",
            url: program.id ? `https://music.163.com/#/program?id=${program.id}` : ""
          })),
          collectionType: "program"
        };
      }).catch((error) => {
        console.warn("[Content Library] NetEase podcast sync failed", error);
        return null;
      });
      this.playlistCache.set(cacheKey, request2);
      return request2;
    }
    const request = (0, import_obsidian4.requestUrl)({
      url: `https://music.163.com/api/v6/playlist/detail?id=${playlistId}&s=0`,
      headers: { Accept: "application/json" }
    }).then((response) => {
      const payload = JSON.parse(response.text);
      const playlist = payload.playlist;
      if (!playlist?.id || !playlist.name) return null;
      return {
        id: String(playlist.id),
        title: playlist.name,
        cover: playlist.coverImgUrl || "",
        creator: playlist.creator?.nickname || "\u7F51\u6613\u4E91\u6B4C\u5355",
        trackCount: playlist.trackCount || playlist.tracks?.length || 0,
        tracks: (playlist.tracks || []).map((track) => ({
          id: String(track.id || ""),
          title: track.name || "\u672A\u547D\u540D\u6B4C\u66F2",
          artist: (track.ar || []).map((artist) => artist.name).filter(Boolean).join(" / ") || "\u672A\u77E5\u6B4C\u624B",
          album: track.al?.name || "",
          cover: track.al?.picUrl || "",
          url: track.id ? `https://music.163.com/#/song?id=${track.id}` : ""
        })),
        collectionType: "playlist"
      };
    }).catch((error) => {
      console.warn("[Content Library] NetEase playlist sync failed", error);
      return null;
    });
    this.playlistCache.set(cacheKey, request);
    return request;
  }
  async getQqPlaylist(url) {
    const playlistId = url.match(/[?&](?:id|disstid|playlistid)=(\d+)/i)?.[1] || url.match(/(?:playlist|gedan)[/:](\d+)/i)?.[1] || "";
    if (!playlistId) return null;
    const cacheKey = `qq:${playlistId}`;
    const cached = this.playlistCache.get(cacheKey);
    if (cached) return cached;
    const request = (0, import_obsidian4.requestUrl)({
      url: `https://i.y.qq.com/qzone-music/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&disstid=${playlistId}&format=json`,
      headers: {
        Accept: "application/json",
        Referer: "https://y.qq.com/",
        "User-Agent": "Mozilla/5.0"
      }
    }).then((response) => {
      const payload = JSON.parse(response.text);
      const playlist = payload.cdlist?.[0];
      if (!playlist) return null;
      const tracks = playlist.songlist || [];
      return {
        id: playlist.disstid || playlistId,
        title: playlist.dissname || "QQ\u97F3\u4E50\u6B4C\u5355",
        cover: (playlist.logo || "").replace(/^http:/i, "https:"),
        creator: playlist.nickname || playlist.nick || "QQ\u97F3\u4E50",
        trackCount: playlist.total_song_num || playlist.songnum || tracks.length,
        tracks: tracks.map((track) => ({
          id: track.songmid || String(track.songid || ""),
          title: track.songname || "\u672A\u547D\u540D\u6B4C\u66F2",
          artist: (track.singer || []).map((singer) => singer.name).filter(Boolean).join(" / ") || "\u672A\u77E5\u6B4C\u624B",
          album: track.albumname || "",
          cover: track.albummid ? `https://y.qq.com/music/photo_new/T002R300x300M000${track.albummid}.jpg` : "",
          url: track.songmid ? `https://y.qq.com/n/ryqq/songDetail/${track.songmid}` : url
        })),
        collectionType: "playlist"
      };
    }).catch((error) => {
      console.warn("[Content Library] QQ playlist sync failed", error);
      return null;
    });
    this.playlistCache.set(cacheKey, request);
    return request;
  }
  async getQqAlbum(url) {
    let albumId = url.match(/albumDetail[/:](\d+)/i)?.[1] || url.match(/[?&]albumId=(\d+)/i)?.[1] || "";
    if (!albumId) {
      try {
        const response = await (0, import_obsidian4.requestUrl)({
          url,
          method: "GET",
          headers: {
            Accept: "text/html",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15"
          }
        });
        const canonical = response.text.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)/i)?.[1] || response.text.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)?.[1] || "";
        albumId = canonical.match(/albumDetail[/:](\d+)/i)?.[1] || canonical.match(/[?&]albumId=(\d+)/i)?.[1] || "";
      } catch {
        return null;
      }
    }
    if (!albumId) return null;
    const cacheKey = `qq-album:${albumId}`;
    const cached = this.playlistCache.get(cacheKey);
    if (cached) return cached;
    const request = (0, import_obsidian4.requestUrl)({
      url: `https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg?albumid=${albumId}&format=json`,
      headers: {
        Accept: "application/json",
        Referer: "https://y.qq.com/",
        "User-Agent": "Mozilla/5.0"
      }
    }).then((response) => {
      const payload = JSON.parse(response.text);
      const album = payload.data;
      const tracks = album?.list || [];
      if (!album || !tracks.length) return null;
      const albumMid = tracks[0].albummid || "";
      const albumTitle = tracks[0].albumname || "QQ\u97F3\u4E50\u4E13\u8F91";
      const creator = (tracks[0].singer || []).map((singer) => singer.name).filter(Boolean).join(" / ") || album.company || "QQ\u97F3\u4E50";
      return {
        id: String(album.id || albumId),
        title: albumTitle,
        cover: albumMid ? `https://y.qq.com/music/photo_new/T002R300x300M000${albumMid}.jpg` : "",
        creator,
        trackCount: album.cur_song_num || tracks.length,
        tracks: tracks.map((track) => ({
          id: track.songmid || String(track.songid || ""),
          title: track.songname || "\u672A\u547D\u540D\u6B4C\u66F2",
          artist: (track.singer || []).map((singer) => singer.name).filter(Boolean).join(" / ") || "\u672A\u77E5\u6B4C\u624B",
          album: track.albumname || albumTitle,
          cover: track.albummid ? `https://y.qq.com/music/photo_new/T002R300x300M000${track.albummid}.jpg` : "",
          url: track.songmid ? `https://y.qq.com/n/ryqq/songDetail/${track.songmid}` : url
        })),
        collectionType: "album"
      };
    }).catch((error) => {
      console.warn("[Content Library] QQ album sync failed", error);
      return null;
    });
    this.playlistCache.set(cacheKey, request);
    return request;
  }
  async getQqMusicCollection(url) {
    const snapshot = this.settings.musicCollectionSnapshots[url];
    if (snapshot) {
      if (snapshot.cover.startsWith("data:image/")) return snapshot;
      return this.rememberMusicCollection(url, snapshot);
    }
    const collection = await this.getQqPlaylist(url) || await this.getQqAlbum(url) || await this.getQqSong(url);
    return collection ? this.rememberMusicCollection(url, collection) : null;
  }
  async rememberMusicCollection(url, collection) {
    const remembered = {
      ...collection,
      cover: await this.cacheMusicCover(collection.cover),
      tracks: collection.tracks.map((track) => ({ ...track }))
    };
    this.settings.musicCollectionSnapshots[url] = remembered;
    const entries = Object.entries(this.settings.musicCollectionSnapshots);
    for (const [staleUrl] of entries.slice(0, Math.max(0, entries.length - 50))) {
      delete this.settings.musicCollectionSnapshots[staleUrl];
    }
    await this.saveSettings(false);
    return remembered;
  }
  async cacheMusicCover(url) {
    if (!url || url.startsWith("data:image/")) return url;
    try {
      const response = await (0, import_obsidian4.requestUrl)({
        url,
        headers: {
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          Referer: "https://y.qq.com/",
          "User-Agent": "Mozilla/5.0"
        }
      });
      if (!response.arrayBuffer.byteLength || response.arrayBuffer.byteLength > 2e6) return url;
      const contentType = response.headers["content-type"]?.split(";")[0] || "image/jpeg";
      if (!contentType.startsWith("image/")) return url;
      return `data:${contentType};base64,${(0, import_obsidian4.arrayBufferToBase64)(response.arrayBuffer)}`;
    } catch (error) {
      console.warn("[Content Library] Music cover cache failed", error);
      return url;
    }
  }
  async getQqSong(url) {
    let songId = url.match(/songDetail[/:](\d+)/i)?.[1] || url.match(/[?&]songid=(\d+)/i)?.[1] || "";
    if (!songId) {
      try {
        const response = await (0, import_obsidian4.requestUrl)({
          url,
          method: "GET",
          headers: {
            Accept: "text/html",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15"
          }
        });
        const canonical = response.text.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)/i)?.[1] || response.text.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)?.[1] || "";
        songId = canonical.match(/songDetail[/:](\d+)/i)?.[1] || canonical.match(/[?&]songid=(\d+)/i)?.[1] || "";
      } catch {
        return null;
      }
    }
    if (!songId) return null;
    const cacheKey = `qq-song:${songId}`;
    const cached = this.playlistCache.get(cacheKey);
    if (cached) return cached;
    const request = (0, import_obsidian4.requestUrl)({
      url: `https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg?songid=${songId}&format=json`,
      headers: {
        Accept: "application/json",
        Referer: "https://y.qq.com/",
        "User-Agent": "Mozilla/5.0"
      }
    }).then((response) => {
      const payload = JSON.parse(response.text);
      const song = payload.data?.[0];
      if (!song) return null;
      const songMid = song.mid || "";
      const albumMid = song.album?.mid || "";
      const artist = (song.singer || []).map((singer) => singer.name).filter(Boolean).join(" / ") || "\u672A\u77E5\u6B4C\u624B";
      const cover = albumMid ? `https://y.qq.com/music/photo_new/T002R300x300M000${albumMid}.jpg` : "";
      const title = song.title || song.name || "QQ\u97F3\u4E50\u5355\u66F2";
      return {
        id: songMid || String(song.id || songId),
        title,
        cover,
        creator: artist,
        trackCount: 1,
        tracks: [{
          id: songMid || String(song.id || songId),
          title,
          artist,
          album: song.album?.name || "",
          cover,
          url: songMid ? `https://y.qq.com/n/ryqq/songDetail/${songMid}` : url
        }],
        collectionType: "song"
      };
    }).catch((error) => {
      console.warn("[Content Library] QQ song sync failed", error);
      return null;
    });
    this.playlistCache.set(cacheKey, request);
    return request;
  }
  inferSourceGroup(source) {
    const value = `${source.name || ""} ${source.folder || ""}`.toLowerCase();
    if (value.includes("tts audio") || source.kind === "podcast") return "podcast";
    if (value.includes("\u97F3\u4E50") || value.includes("music") || source.kind === "music") return "music";
    if (value.includes("weave epub") || source.kind === "book") return "bookshelf";
    if (value.includes("github")) return "skills";
    if (value.includes("reddit") || value.includes("money radar")) return "needs";
    if (value.includes("x\u63A8\u9001") || value.includes("youtube")) return "information";
    return "ideas";
  }
  todayUsageMinutes() {
    return this.settings.usageByDate[this.dateKey()] || 0;
  }
  async recordUsageMinute() {
    const key = this.dateKey();
    this.settings.usageByDate[key] = (this.settings.usageByDate[key] || 0) + 1;
    const keys = Object.keys(this.settings.usageByDate).sort().reverse();
    for (const stale of keys.slice(31)) delete this.settings.usageByDate[stale];
    await this.saveSettings(false);
  }
  viewedAt(file) {
    const path = typeof file === "string" ? file : file.path;
    return this.settings.viewHistory[path] || 0;
  }
  async recordView(file) {
    const path = typeof file === "string" ? file : file.path;
    const previous = this.settings.viewHistory[path] || 0;
    const now = Date.now();
    if (now - previous < 5e3) return;
    this.settings.viewHistory[path] = now;
    const paths = Object.keys(this.settings.viewHistory).sort((a, b) => this.settings.viewHistory[b] - this.settings.viewHistory[a]);
    for (const stale of paths.slice(200)) delete this.settings.viewHistory[stale];
    await this.saveSettings(false);
  }
  contentProgress(file) {
    const path = typeof file === "string" ? file : file.path;
    return this.settings.contentProgress[path] || null;
  }
  async startContent(file) {
    if (this.contentProgress(file)) return;
    await this.setContentProgress(file, 1, false, true);
  }
  async setContentProgress(file, progress, complete = false, force = false) {
    const path = typeof file === "string" ? file : file.path;
    const previous = this.settings.contentProgress[path];
    if (previous?.state === "complete" && !force) return;
    const normalized = complete || progress >= 90 ? 100 : Math.max(1, Math.min(89, progress));
    const state = normalized >= 90 ? "complete" : "in-progress";
    const now = Date.now();
    if (!force && previous && previous.state === state && Math.abs(previous.progress - normalized) < 2 && now - previous.updated < 15e3) return;
    this.settings.contentProgress[path] = { state, progress: normalized, updated: now };
    const paths = Object.keys(this.settings.contentProgress).sort((a, b) => this.settings.contentProgress[b].updated - this.settings.contentProgress[a].updated);
    for (const stale of paths.slice(500)) delete this.settings.contentProgress[stale];
    await this.saveSettings(false);
  }
  async markContentComplete(file) {
    await this.setContentProgress(file, 100, true, true);
  }
  async resetContentProgress(file) {
    const path = typeof file === "string" ? file : file.path;
    delete this.settings.contentProgress[path];
    await this.saveSettings(false);
  }
  isReadingFile(file) {
    if (file.extension !== "md") return false;
    return this.settings.sources.some((source) => {
      if (!source.enabled || source.kind === "podcast") return false;
      const folder = (0, import_obsidian4.normalizePath)(source.folder).replace(/\/$/, "");
      return Boolean(folder && (file.path === folder || file.path.startsWith(`${folder}/`)));
    });
  }
  async getWebPreview(url) {
    const normalized = url.trim();
    const existing = this.webPreviewCache.get(normalized);
    if (existing) return existing;
    const pending = this.fetchWebPreview(normalized);
    this.webPreviewCache.set(normalized, pending);
    return pending;
  }
  annotationFile(item) {
    const folder = (0, import_obsidian4.normalizePath)(this.settings.annotationFolder || DEFAULT_SETTINGS.annotationFolder);
    const safeTitle = item.title.replace(/[\\/:*?"<>|#^[\]]/g, "-").slice(0, 80) || "Untitled";
    const file = this.app.vault.getAbstractFileByPath((0, import_obsidian4.normalizePath)(`${folder}/${safeTitle}-\u7B14\u8BB0.md`));
    return file instanceof import_obsidian4.TFile ? file : null;
  }
  async fetchWebPreview(url) {
    const fallback = this.fallbackPreview(url);
    const youtubeId = this.youtubeId(url);
    if (youtubeId) return { ...fallback, image: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`, host: "YouTube" };
    try {
      const response = await (0, import_obsidian4.requestUrl)({
        url,
        method: "GET",
        headers: {
          Accept: "text/html",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15"
        }
      });
      const document2 = new DOMParser().parseFromString(response.text, "text/html");
      const meta = (selector) => document2.querySelector(selector)?.getAttribute("content")?.trim() || "";
      const title = meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]') || document2.title.trim();
      const description = meta('meta[property="og:description"]') || meta('meta[name="description"]') || meta('meta[name="twitter:description"]');
      const image = meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]');
      const canonical = meta('meta[property="og:url"]') || document2.querySelector('link[rel="canonical"]')?.href || "";
      const favicon = document2.querySelector('link[rel~="icon"]')?.href || "";
      return {
        ...fallback,
        title: title || fallback.title,
        description,
        image: this.absoluteUrl(image, url) || this.qqMusicCoverUrl(url, canonical),
        favicon: this.absoluteUrl(favicon, url)
      };
    } catch {
      return fallback;
    }
  }
  fallbackPreview(url) {
    try {
      const parsed = new URL(url);
      return { url, title: parsed.hostname.replace(/^www\./, ""), description: "", host: parsed.hostname.replace(/^www\./, ""), image: "", favicon: `${parsed.origin}/favicon.ico` };
    } catch {
      return { url, title: "\u7F51\u9875\u94FE\u63A5", description: "", host: "\u7F51\u9875", image: "", favicon: "" };
    }
  }
  absoluteUrl(value, origin) {
    if (!value) return "";
    try {
      return new URL(value, origin).href;
    } catch {
      return "";
    }
  }
  qqMusicCoverUrl(sourceUrl, canonicalUrl) {
    if (!/(?:y\.qq\.com|c6\.y\.qq\.com|i\.y\.qq\.com)/i.test(`${sourceUrl} ${canonicalUrl}`)) return "";
    const albumId = `${canonicalUrl} ${sourceUrl}`.match(/(?:albumDetail\/|albumId=|album\/)(\d+)/i)?.[1] || "";
    if (!albumId) return "";
    const bucket = String(Number(albumId) % 100);
    return `https://imgcache.qq.com/music/photo/album/${bucket}/albumpic_${albumId}_0.jpg`;
  }
  youtubeId(url) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes("youtu.be")) return parsed.pathname.split("/").filter(Boolean)[0] || "";
      if (parsed.hostname.includes("youtube.com")) return parsed.searchParams.get("v") || parsed.pathname.match(/\/(?:shorts|embed)\/([^/?]+)/)?.[1] || "";
    } catch {
      return "";
    }
    return "";
  }
  dateKey() {
    const now = /* @__PURE__ */ new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }
  async saveSettings(refresh = true) {
    await this.saveData(this.settings);
    if (refresh) this.refreshViews();
  }
  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(CONTENT_LIBRARY_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof ContentLibraryView) void view.refresh();
    }
  }
  scheduleRefresh() {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      this.refreshViews();
    }, 220);
  }
  async appendAnnotation(item, text, quote = "", time = "") {
    const cleanText = text.trim();
    if (!cleanText && !quote.trim()) return null;
    const folder = (0, import_obsidian4.normalizePath)(this.settings.annotationFolder || DEFAULT_SETTINGS.annotationFolder);
    await this.ensureFolder(folder);
    const safeTitle = item.title.replace(/[\\/:*?"<>|#^[\]]/g, "-").slice(0, 80) || "Untitled";
    const path = (0, import_obsidian4.normalizePath)(`${folder}/${safeTitle}-\u7B14\u8BB0.md`);
    const existing = this.app.vault.getAbstractFileByPath(path);
    const heading = `## ${(/* @__PURE__ */ new Date()).toLocaleString()}`;
    const source = `\u6765\u6E90\uFF1A[[${item.file.path}]]${item.externalUrl ? ` \xB7 ${item.externalUrl}` : ""}`;
    const timestamp = time ? `
\u65F6\u95F4\uFF1A${time}` : "";
    const quotation = quote.trim() ? `

> ${quote.trim().replace(/\n+/g, "\n> ")}` : "";
    const block = `${heading}

${source}${timestamp}${quotation}${cleanText ? `

${cleanText}` : ""}

`;
    if (existing instanceof import_obsidian4.TFile) {
      await this.app.vault.append(existing, `
${block}`);
      return existing;
    }
    return this.app.vault.create(path, `# ${item.title} \xB7 \u7B14\u8BB0

${block}`);
  }
  async createNoteInSource(source, title) {
    const folder = (0, import_obsidian4.normalizePath)(source.folder);
    await this.ensureFolder(folder);
    const safeTitle = title.trim().replace(/[\\/:*?"<>|#^[\]]/g, "-").slice(0, 100) || "\u672A\u547D\u540D\u7B14\u8BB0";
    let path = (0, import_obsidian4.normalizePath)(`${folder}/${safeTitle}.md`);
    let counter = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = (0, import_obsidian4.normalizePath)(`${folder}/${safeTitle}-${counter}.md`);
      counter += 1;
    }
    const file = await this.app.vault.create(path, `# ${title.trim()}

`);
    await this.app.workspace.getLeaf("tab").openFile(file, { state: { mode: "source" } });
    return file;
  }
  async createMusicPlaylistNote(source, url, title) {
    const folder = (0, import_obsidian4.normalizePath)(source.folder);
    await this.ensureFolder(folder);
    const safeTitle = title.trim().replace(/[\\/:*?"<>|#^[\]]/g, "-").slice(0, 100) || "\u7F51\u6613\u4E91\u6B4C\u5355";
    let path = (0, import_obsidian4.normalizePath)(`${folder}/${safeTitle}.md`);
    let counter = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = (0, import_obsidian4.normalizePath)(`${folder}/${safeTitle}-${counter}.md`);
      counter += 1;
    }
    const content = `---
title: ${JSON.stringify(title.trim() || "\u7F51\u6613\u4E91\u6B4C\u5355")}
playlist_url: ${url.trim()}
---
`;
    return this.app.vault.create(path, content);
  }
  async renameMusicPlaylistNote(file, title) {
    const nextTitle = title.trim();
    if (!nextTitle) throw new Error("\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A\u3002");
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      Object.assign(frontmatter, { title: nextTitle });
    });
  }
  async setCoverOverride(item, path) {
    if (path.trim()) this.settings.coverOverrides[item.file.path] = path.trim();
    else delete this.settings.coverOverrides[item.file.path];
    await this.saveSettings();
  }
  async importImage(file, group = "Covers") {
    if (!/^image\/(png|jpeg|webp|gif)$/i.test(file.type) && !/\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
      throw new Error("\u8BF7\u9009\u62E9 PNG\u3001JPG\u3001WEBP \u6216 GIF \u56FE\u7247\u3002");
    }
    const folder = (0, import_obsidian4.normalizePath)(`Content Library Assets/${group}`);
    await this.ensureFolder(folder);
    const extension = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || "jpg").toLowerCase();
    const stem = file.name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9\u4e00-\u9fff_-]+/gi, "-").slice(0, 60) || "image";
    let path = (0, import_obsidian4.normalizePath)(`${folder}/${stem}.${extension}`);
    let counter = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = (0, import_obsidian4.normalizePath)(`${folder}/${stem}-${counter}.${extension}`);
      counter += 1;
    }
    await this.app.vault.createBinary(path, await file.arrayBuffer());
    return path;
  }
  async ensureFolder(path) {
    if (!path || this.app.vault.getAbstractFileByPath(path)) return;
    const segments = path.split("/").filter(Boolean);
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }
};
