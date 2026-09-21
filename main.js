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
  black: "\u66DC\u77F3\u9ED1"
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
    containerEl.createEl("h2", { text: "\u5185\u5BB9\u56FE\u4E66\u9986" });
    containerEl.createEl("p", {
      text: "\u4E0D\u9700\u8981\u9884\u5148\u521B\u5EFA\u56FA\u5B9A\u6587\u4EF6\u5939\u3002\u9009\u62E9 Vault \u91CC\u5DF2\u6709\u7684\u6587\u4EF6\u5939\u5373\u53EF\uFF1B\u663E\u793A\u540D\u79F0\u53EF\u4EE5\u548C\u5B9E\u9645\u8DEF\u5F84\u4E0D\u540C\u3002"
    });
    containerEl.createEl("h3", { text: "\u5916\u89C2" });
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
    sourceHeader.createEl("h3", { text: "\u6211\u7684\u6587\u4EF6\u5939" });
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
var CONTENT_LIBRARY_VIEW_TYPE = "content-library-dashboard-view";
var ANNOTATION_SOURCE_ID = "system-dashboard-annotations";
var ContentLibraryView = class extends import_obsidian3.ItemView {
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
      if (this.app.workspace.activeLeaf === this.leaf && document.hasFocus()) {
        void this.plugin.recordUsageMinute().then(() => {
          const value = this.contentEl.querySelector('[data-metric="\u4F7F\u7528\u65F6\u95F4"] strong');
          if (value) value.textContent = formatUsage(this.plugin.todayUsageMinutes());
        });
      }
    }, 6e4));
    this.registerInterval(window.setInterval(() => this.updateTodayClock(), 1e3));
    this.registerInterval(window.setInterval(() => {
      if (this.app.workspace.activeLeaf !== this.leaf || this.detailOpen || this.activeSourceId !== "today") return;
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
    const cover = button.createDiv({ cls: "cld-card-cover" });
    const override = this.plugin.settings.coverOverrides[item.file.path] || "";
    const coverUrl = this.plugin.indexer.resolveResource(override, item.file) || item.cover;
    if (coverUrl) {
      cover.addClass("has-image");
      cover.style.backgroundImage = `url("${coverUrl.replace(/"/g, "%22")}")`;
    } else {
      cover.addClass("is-summary");
      const meta = cover.createDiv({ cls: "cld-card-cover-meta" });
      const icon = meta.createSpan({ cls: "cld-cover-icon" });
      (0, import_obsidian3.setIcon)(icon, item.source.icon || "file-text");
      meta.createEl("small", { text: this.plugin.indexer.kindLabel(item.kind) });
      const excerpt = cover.createEl("p", { cls: "cld-card-excerpt", text: this.cardExcerptFallback(item) });
      void this.hydrateCardExcerpt(excerpt, item);
    }
    if (item.kind === "podcast") {
      cover.addClass("has-podcast-badge");
      const badge = cover.createDiv({ cls: "cld-podcast-card-badge" });
      const badgeIcon = badge.createSpan();
      (0, import_obsidian3.setIcon)(badgeIcon, "play");
      badge.createSpan({ text: "\u64AD\u5BA2" });
    }
    if (item.externalUrl) {
      const host = cover.createEl("small", { cls: "cld-web-host", text: webHost(item.externalUrl) });
      (0, import_obsidian3.setIcon)(host.createSpan(), "external-link");
      void this.hydrateWebCard(cover, item.externalUrl, coverUrl);
    }
    if (item.progress > 0) {
      const progress = cover.createDiv({ cls: "cld-cover-progress" });
      progress.createSpan().style.width = `${item.progress}%`;
    }
    const copy = button.createDiv({ cls: "cld-card-copy" });
    const titleRow = copy.createDiv({ cls: "cld-card-title-row" });
    titleRow.createEl("strong", { text: item.title });
    this.renderContentStatus(titleRow, item);
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
function openExternalUrl(url, appPath = "") {
  if (import_obsidian3.Platform.isMobile) {
    window.location.href = url;
    return Promise.resolve();
  }
  try {
    const childProcess = typeof require === "function" ? require("child_process") : null;
    if (childProcess?.execFile) {
      const execFile = childProcess.execFile;
      return new Promise((resolve, reject) => {
        execFile("/usr/bin/open", [url], (error) => {
          if (error) {
            reject(error);
            return;
          }
          if (!appPath) {
            resolve();
            return;
          }
          execFile("/usr/bin/open", ["-a", appPath], (activateError) => activateError ? reject(activateError) : resolve());
        });
      });
    }
  } catch {
  }
  try {
    const electron = typeof require === "function" ? require("electron") : null;
    if (electron?.shell?.openExternal) {
      return electron.shell.openExternal(url);
    }
  } catch {
  }
  try {
    window.open(url, "_blank");
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
      id: "open-content-library-dashboard",
      name: "Open content library dashboard",
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
    this.app.workspace.detachLeavesOfType(CONTENT_LIBRARY_VIEW_TYPE);
  }
  async activateView() {
    let leaf = this.app.workspace.getLeavesOfType(CONTENT_LIBRARY_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: CONTENT_LIBRARY_VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }
  openSettingTab() {
    const host = this.app;
    host.setting?.open();
    host.setting?.openTabById(this.manifest.id);
  }
  async loadSettings() {
    const loaded = await this.loadData();
    const theme = ["grass", "blue", "pink", "rose", "black"].includes(loaded?.theme) ? loaded?.theme : DEFAULT_SETTINGS.theme;
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
      frontmatter.title = nextTitle;
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
