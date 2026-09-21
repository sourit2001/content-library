/* eslint-disable @typescript-eslint/no-misused-promises, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, obsidianmd/prefer-create-el, no-alert */

import {
  App,
  ItemView,
  MarkdownRenderer,
  Menu,
  Modal,
  Notice,
  Platform,
  requestUrl,
  TFile,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";
import type ContentLibraryDashboardPlugin from "./main";
import {
  SOURCE_KIND_LABELS,
  SOURCE_GROUP_LABELS,
  THEME_LABELS,
  type ContentItem,
  type ContentSource,
  type DashboardTheme,
  type SourceGroup,
  type WebPreview,
} from "./types";
import type { NetEasePlaylist } from "./main";

export const CONTENT_LIBRARY_VIEW_TYPE = "content-library-dashboard-view";
const ANNOTATION_SOURCE_ID = "system-dashboard-annotations";

type StoredAnnotation = {
  quote: string;
  note: string;
  heading: string;
  sourceLine: string;
  timeLine: string;
  start: number;
  end: number;
};

type CommandHost = { commands?: { executeCommandById(id: string): boolean } };

export class ContentLibraryView extends ItemView {
  private activeSourceId = "today";
  private selected: ContentItem | null = null;
  private detailOpen = false;
  private audio: HTMLAudioElement | null = null;
  private audioItemId: string | null = null;
  private playing = false;
  private autoplayItemId: string | null = null;
  private searchQuery = "";
  private durationCache = new Map<string, string>();
  private expandedMusicPlaylists = new Set<string>();
  private musicDetailItemPath: string | null = null;
  private inspirationOffset = 0;
  private inspirationHourKey = "";
  private readingScrollCleanup: (() => void) | null = null;
  private sidebarScrollTop = 0;
  private navScrollLeft = 0;
  private articleReturnItem: ContentItem | null = null;
  private draggedNavItem: { kind: "group" | "source"; id: string } | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: ContentLibraryDashboardPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return CONTENT_LIBRARY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Content Library";
  }

  override getIcon(): string {
    return "layout-dashboard";
  }

  override async onOpen(): Promise<void> {
    this.inspirationOffset = Math.floor(Math.random() * 1_000_000);
    this.inspirationHourKey = this.currentInspirationHour();
    this.registerInterval(window.setInterval(() => {
      if (this.app.workspace.getActiveViewOfType(ContentLibraryView)?.leaf === this.leaf && document.hasFocus()) {
        void this.plugin.recordUsageMinute().then(() => {
          const value = this.contentEl.querySelector<HTMLElement>('[data-metric="使用时间"] strong');
          if (value) value.textContent = formatUsage(this.plugin.todayUsageMinutes());
        });
      }
    }, 60_000));
    this.registerInterval(window.setInterval(() => this.updateTodayClock(), 1_000));
    this.registerInterval(window.setInterval(() => {
      if (this.app.workspace.getActiveViewOfType(ContentLibraryView)?.leaf !== this.leaf || this.detailOpen || this.activeSourceId !== "today") return;
      const hour = this.currentInspirationHour();
      if (hour === this.inspirationHourKey) return;
      this.inspirationHourKey = hour;
      this.inspirationOffset += 1;
      void this.refresh();
    }, 60_000));
    await this.refresh();
  }

  override async onClose(): Promise<void> {
    this.readingScrollCleanup?.();
    this.destroyAudio();
  }

  async refresh(): Promise<void> {
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

  private enabledSources(): ContentSource[] {
    const sources = this.plugin.settings.sources.filter((source) => source.enabled && source.folder);
    const folder = this.plugin.settings.annotationFolder.trim() || "Dashboard Notes";
    if (sources.some((source) => source.folder.replace(/\/$/, "") === folder.replace(/\/$/, ""))) return sources;
    return [...sources, {
      id: ANNOTATION_SOURCE_ID,
      name: "我的批注",
      folder,
      kind: "generic",
      group: "ideas",
      icon: "notebook-pen",
      coverPath: "",
      enabled: true,
    }];
  }

  private activeSource(): ContentSource | undefined {
    return this.enabledSources().find((entry) => entry.id === this.activeSourceId);
  }

  private isPodcastMode(): boolean {
    const source = this.activeSource();
    return Boolean(source && (
      source.kind === "podcast" || this.plugin.indexer.sourceStats(source.folder).audio > 0
    ));
  }

  private isMusicMode(): boolean {
    const source = this.activeSource();
    return Boolean(source && (source.kind === "music" || this.currentItems().some((item) => Boolean(item.playlistUrl))));
  }

  private currentItems(): ContentItem[] {
    const sources = this.enabledSources();
    if (this.activeSourceId === "today") {
      const all = this.plugin.indexer.all(sources, 240);
      const viewed = all
        .filter((item) => this.plugin.viewedAt(item.file) > 0)
        .sort((a, b) => this.plugin.viewedAt(b.file) - this.plugin.viewedAt(a.file));
      if (viewed.length) return viewed.slice(0, 36);
      return all.filter((item) => item.kind !== "book").slice(0, 36);
    }
    const source = sources.find((entry) => entry.id === this.activeSourceId);
    return source ? this.plugin.indexer.list(source) : [];
  }

  private renderSidebar(layout: HTMLElement): void {
    const aside = layout.createEl("aside", { cls: "cld-sidebar cld-glass", attr: { "aria-label": "内容导航" } });
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
    nav.createEl("p", { cls: "cld-nav-section-label", text: "主页" });
    this.renderNavButton(nav, "today", "今天", "home", this.plugin.indexer.all(this.enabledSources(), 8).length);
    const groupOrder = this.plugin.settings.sourceGroupOrder;
    for (const group of groupOrder) {
      const sources = this.enabledSources().filter((source) => source.group === group);
      if (!sources.length) continue;
      nav.createEl("p", {
        cls: "cld-nav-section-label cld-draggable-nav-group",
        text: SOURCE_GROUP_LABELS[group],
        attr: { draggable: "true", "data-nav-group": group },
      });
      for (const source of sources) this.renderFolderButton(nav, source);
    }
    const add = aside.createEl("button", { cls: "cld-add-source", attr: { type: "button" } });
    const icon = add.createSpan();
    setIcon(icon, "folder-plus");
    add.createSpan({ text: "添加文件夹" });
    add.addEventListener("click", () => this.plugin.openSettingTab());
    window.requestAnimationFrame(() => {
      if (!aside.isConnected) return;
      aside.scrollTop = this.sidebarScrollTop;
      nav.scrollLeft = this.navScrollLeft;
    });
  }

  private renderFolderButton(parent: HTMLElement, source: ContentSource): void {
    const count = this.plugin.indexer.list(source, 99).length;
    const button = parent.createEl("button", {
      cls: `cld-folder-nav${this.activeSourceId === source.id ? " is-active" : ""}`,
      attr: {
        type: "button",
        "aria-pressed": String(this.activeSourceId === source.id),
        draggable: "true",
        "data-nav-source": source.id,
      },
    });
    button.createSpan({ text: source.name });
    button.createEl("small", { text: `${count} 项` });
    button.addEventListener("click", () => {
      this.activeSourceId = source.id;
      this.selected = null;
      this.detailOpen = false;
      this.searchQuery = "";
      void this.refresh();
    });
  }

  private bindNavDragAndDrop(nav: HTMLElement): void {
    nav.addEventListener("dragstart", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-nav-group], [data-nav-source]");
      if (!target) return;
      const group = target.dataset.navGroup;
      const source = target.dataset.navSource;
      this.draggedNavItem = group
        ? { kind: "group", id: group }
        : source
          ? { kind: "source", id: source }
          : null;
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
      const target = (event.target as HTMLElement).closest<HTMLElement>(selector);
      if (!target || (this.draggedNavItem.kind === "group" && target.dataset.navGroup === this.draggedNavItem.id) || (this.draggedNavItem.kind === "source" && target.dataset.navSource === this.draggedNavItem.id)) return;
      event.preventDefault();
      target.addClass("is-drag-over");
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });
    nav.addEventListener("dragleave", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>(".is-drag-over");
      target?.removeClass("is-drag-over");
    });
    nav.addEventListener("drop", (event) => {
      event.preventDefault();
      const dragged = this.draggedNavItem;
      if (!dragged) return;
      const selector = dragged.kind === "group" ? "[data-nav-group]" : "[data-nav-source]";
      const target = (event.target as HTMLElement).closest<HTMLElement>(selector);
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

  private async moveGroupByDrop(draggedId: string, targetId: string): Promise<void> {
    const order = this.plugin.settings.sourceGroupOrder;
    const from = order.indexOf(draggedId as SourceGroup);
    const to = order.indexOf(targetId as SourceGroup);
    if (from < 0 || to < 0 || from === to) return;
    [order[from], order[to]] = [order[to], order[from]];
    await this.plugin.saveSettings(false);
    await this.refresh();
  }

  private async moveSourceByDrop(draggedId: string, targetId: string): Promise<void> {
    const sources = this.plugin.settings.sources;
    const from = sources.findIndex((source) => source.id === draggedId);
    const to = sources.findIndex((source) => source.id === targetId);
    if (from < 0 || to < 0 || from === to || sources[from].group !== sources[to].group) return;
    [sources[from], sources[to]] = [sources[to], sources[from]];
    await this.plugin.saveSettings(false);
    await this.refresh();
  }

  private updateTodayClock(): void {
    const now = new Date();
    const clock = this.contentEl.querySelector<HTMLElement>(".cld-live-clock");
    if (clock) clock.textContent = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now);
    const greeting = this.contentEl.querySelector<HTMLElement>(".cld-live-greeting");
    if (greeting) greeting.textContent = greetingForHour(now.getHours());
  }

  private renderNavButton(parent: HTMLElement, id: string, label: string, iconName: string, count: number): void {
    const button = parent.createEl("button", {
      cls: `cld-nav-item${this.activeSourceId === id ? " is-active" : ""}`,
      attr: { type: "button", "aria-pressed": String(this.activeSourceId === id) },
    });
    const icon = button.createSpan({ cls: "cld-nav-icon" });
    setIcon(icon, iconName);
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

  private renderTopbar(main: HTMLElement): void {
    const header = main.createEl("header", { cls: "cld-topbar" });
    const greeting = header.createDiv();
    const source = this.activeSource();
    const podcastMode = this.isPodcastMode();
    if (this.activeSourceId === "today" && !podcastMode) {
      const today = new Date();
      greeting.createEl("div", { cls: "cld-live-date", text: new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(today) });
    } else {
      greeting.createEl("small", { text: podcastMode ? "收听空间" : new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date()) });
    }
    greeting.createEl("h1", { cls: podcastMode ? "" : "cld-live-greeting", text: podcastMode ? "Podcast" : greetingForHour(new Date().getHours()) });
    const actions = header.createDiv({ cls: "cld-topbar-actions" });
    const select = actions.createEl("select", { cls: "dropdown cld-theme-select", attr: { "aria-label": "主体配色" } });
    for (const [value, label] of Object.entries(THEME_LABELS)) {
      select.createEl("option", { value, text: label });
    }
    select.value = this.plugin.settings.theme;
    select.addEventListener("change", async () => {
      this.plugin.settings.theme = select.value as DashboardTheme;
      await this.plugin.saveSettings();
    });
    if (podcastMode) {
      const search = this.iconButton(actions, "search", "搜索节目");
      search.addEventListener("click", () => {
        const next = window.prompt("搜索节目", this.searchQuery);
        if (next === null) return;
        this.searchQuery = next.trim();
        void this.refresh();
      });
    }
    if (!podcastMode) {
      if (source && source.id !== ANNOTATION_SOURCE_ID) {
        const create = actions.createEl("button", { cls: "cld-topbar-text-button", attr: { type: "button" } });
        const createIcon = create.createSpan();
        setIcon(createIcon, "file-plus-2");
        create.createSpan({ text: "新建笔记" });
        create.addEventListener("click", () => {
          new NoteTitleModal(this.app, source.name, async (title) => {
            const file = await this.plugin.createNoteInSource(source, title);
            new Notice(`已创建 ${file.path}`);
          }).open();
        });
      }
      const settings = this.iconButton(actions, "settings-2", "Dashboard settings");
      settings.addEventListener("click", () => this.plugin.openSettingTab());
    }
  }

  private async renderHome(main: HTMLElement): Promise<void> {
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
    const metrics = main.createEl("section", { cls: "cld-metrics", attr: { "aria-label": "内容概览" } });
    const today = metricItems.filter((item) => Date.now() - item.modified < 24 * 60 * 60 * 1000).length;
    const books = metricItems.filter((item) => item.kind === "book").length;
    const audio = metricItems.filter((item) => item.kind === "podcast").length;
    this.metric(metrics, "今日", String(today), Math.min(100, today * 12));
    if (isDashboardHome) this.metric(metrics, "使用时间", formatUsage(this.plugin.todayUsageMinutes()), Math.min(100, this.plugin.todayUsageMinutes() / 1.2));
    this.metric(metrics, "阅读", String(books), Math.min(100, books * 9));
    this.metric(metrics, "收听", String(audio), Math.min(100, audio * 13));

    if (!items.length) {
      const empty = main.createDiv({ cls: "cld-empty cld-glass" });
      empty.createEl("h3", { text: "这个栏目还没有内容" });
      empty.createEl("p", { text: "在设置中选择一个包含笔记或音频的 Vault 文件夹。" });
      return;
    }
    if (isDashboardHome) {
      await this.renderDailyInspiration(main);
      this.renderActivity(main, metricItems);
    }

    const sectionHead = main.createDiv({ cls: "cld-section-head cld-recent-head" });
    sectionHead.createEl("strong", { text: isDashboardHome ? "最近查看" : source?.name || "内容" });
    const hasViewedItems = isDashboardHome && items.some((item) => this.plugin.viewedAt(item.file) > 0);
    sectionHead.createEl("small", {
      text: isDashboardHome && !hasViewedItems ? "暂无查看记录 · 先展示最新文章" : `${items.length} 项`,
    });
    const grid = main.createDiv({ cls: "cld-library-grid cld-recent-grid" });
    for (const item of items.slice(0, 20)) this.renderContentCard(grid, item);
  }

  private async renderMusicLibrary(main: HTMLElement, items: ContentItem[]): Promise<void> {
    const playlists = items.filter((item) => Boolean(item.playlistUrl));
    const sectionHead = main.createDiv({ cls: "cld-section-head cld-music-section-head" });
    const heading = sectionHead.createDiv();
    heading.createEl("strong", { text: "音乐收藏" });
    heading.createEl("p", { text: "歌单内容来自网易云，点击歌曲后在官方页面播放" });
    const actions = sectionHead.createDiv({ cls: "cld-music-section-actions" });
    actions.createEl("small", { text: `${playlists.length} 个歌单` });
    const add = actions.createEl("button", { cls: "cld-text-button", text: "添加歌单", attr: { type: "button" } });
    add.addEventListener("click", () => {
      const source = this.activeSource();
      if (!source) return;
      new MusicPlaylistModal(this.app, source.name, async (url, customTitle) => {
        const playlist = await this.plugin.getNetEasePlaylist(url);
        const file = await this.plugin.createMusicPlaylistNote(source, url, customTitle || playlist?.title || (isQqMusicUrl(url) ? "QQ音乐歌单" : "网易云歌单"));
        new Notice(`已添加歌单：${file.basename}`);
        await this.refresh();
      }).open();
    });
    if (!playlists.length) {
      const empty = main.createDiv({ cls: "cld-empty cld-glass" });
      empty.createEl("h3", { text: "还没有歌单" });
      empty.createEl("p", { text: "在音乐收藏文件夹里新建 Markdown 文件，并填写 playlist_url。" });
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

  private renderMusicPlaylistCard(parent: HTMLElement, item: ContentItem, playlist: NetEasePlaylist | null, preview: WebPreview | null): void {
    const card = parent.createEl("button", { cls: "cld-music-card cld-glass", attr: { type: "button", "aria-label": `打开${item.title}` } });
    const cover = card.createDiv({ cls: "cld-music-card-cover" });
    const coverUrl = playlist?.cover || item.cover || preview?.image || "";
    if (coverUrl) cover.style.backgroundImage = `url("${coverUrl.replace(/"/g, "%22")}")`;
    else {
      setIcon(cover.createSpan(), "music-2");
      cover.createEl("small", { text: "音乐" });
    }
    const copy = card.createDiv({ cls: "cld-music-card-copy" });
    const platform = isQqMusicUrl(item.playlistUrl) ? "QQ音乐" : "网易云音乐";
    const contentType = playlist?.collectionType === "song" ? "单曲" : playlist?.collectionType === "album" ? "专辑" : isNetEaseProgramUrl(item.playlistUrl) ? "节目" : "歌单";
    copy.createEl("small", { text: `${platform} · ${contentType}` });
    copy.createEl("h3", { text: item.title });
    copy.createEl("p", { text: playlist ? `${playlist.trackCount} 条内容 · 点击查看` : "点击查看详情" });
    card.addEventListener("click", () => {
      this.musicDetailItemPath = item.file.path;
      void this.refresh();
    });
  }

  private async renderMusicPlaylist(parent: HTMLElement, item: ContentItem, playlist: NetEasePlaylist | null, preview: WebPreview | null): Promise<void> {
    const back = parent.createEl("button", { cls: "cld-text-button cld-music-back", text: "‹ 返回音乐收藏", attr: { type: "button" } });
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
      setIcon(cover.createSpan(), "music-2");
      cover.createEl("small", { text: "网易云歌单" });
    }
    const expanded = this.expandedMusicPlaylists.has(item.file.path);
    cover.setAttr("role", "button");
    cover.setAttr("tabindex", "0");
    cover.setAttr("aria-label", expanded ? "收起列表" : "展开列表");
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
    const platform = isQqMusicUrl(item.playlistUrl) ? "QQ音乐" : "网易云音乐";
    const contentType = playlist?.collectionType === "song" ? "单曲" : playlist?.collectionType === "album" ? "专辑" : isNetEaseProgramUrl(item.playlistUrl) ? "节目" : "歌单";
    copy.createEl("small", { text: `${platform} · ${contentType}` });
    const title = copy.createEl("h3", { text: item.title, attr: { title: "点击编辑名称" } });
    title.addEventListener("click", () => this.openMusicPlaylistNameEditor(item));
    const fallbackText = isNetEaseProgramUrl(item.playlistUrl)
      ? "这是网易云节目链接，不是标准歌单；点击后打开对应页面"
      : isQqMusicUrl(item.playlistUrl)
        ? "QQ 音乐歌单 · 点击后在 QQ 音乐 App 打开"
        : "歌单暂时无法同步，仍可打开原始链接";
    copy.createEl("p", { text: playlist ? `${playlist.creator} · ${playlist.trackCount} 首歌曲` : fallbackText });
    const actions = head.createDiv({ cls: "cld-music-playlist-actions" });
    const edit = actions.createEl("button", { cls: "cld-text-button", text: "编辑名称", attr: { type: "button" } });
    edit.addEventListener("click", (event) => {
      event.stopPropagation();
      this.openMusicPlaylistNameEditor(item);
    });
    if (!playlist?.tracks.length) {
      card.createEl("small", { cls: "cld-music-track-more", text: isQqMusicUrl(item.playlistUrl) ? "QQ 音乐歌单的歌曲列表暂未同步，点击上方按钮在 App 中查看。" : "这个链接没有可同步的歌曲列表，请确认它是 music.163.com/playlist?id=... 歌单链接。" });
      return;
    }
    const visibleTracks = expanded ? playlist.tracks : playlist.tracks.slice(0, 30);
    const list = card.createDiv({ cls: "cld-music-track-list", attr: { role: "list" } });
    for (const [index, track] of visibleTracks.entries()) {
      const row = list.createEl("button", { cls: "cld-music-track", attr: { type: "button", role: "listitem" } });
      row.createSpan({ cls: "cld-music-track-number", text: String(index + 1).padStart(2, "0") });
      const trackCover = row.createSpan({ cls: "cld-music-track-cover" });
      if (track.cover) trackCover.style.backgroundImage = `url("${track.cover.replace(/"/g, "%22")}")`;
      else setIcon(trackCover, "music-2");
      const trackCopy = row.createSpan({ cls: "cld-music-track-copy" });
      trackCopy.createEl("strong", { text: track.title });
      trackCopy.createEl("small", { text: `${track.artist}${track.album ? ` · ${track.album}` : ""}` });
      row.createSpan({ cls: "cld-music-track-open", text: "App 播放 ↗" });
      row.addEventListener("click", () => openMusicApp(track.url || item.playlistUrl));
    }
    const count = card.createDiv({ cls: "cld-music-track-count" });
    count.createEl("small", { text: `已显示 ${visibleTracks.length} / 共 ${playlist.trackCount} 条` });
    if (playlist.tracks.length > 30) {
      const toggle = count.createEl("button", { cls: "cld-text-button", text: expanded ? "收起" : `显示全部（${playlist.tracks.length} 条）`, attr: { type: "button" } });
      toggle.addEventListener("click", () => {
        if (expanded) this.expandedMusicPlaylists.delete(item.file.path);
        else this.expandedMusicPlaylists.add(item.file.path);
        void this.refresh();
      });
    }
    if (playlist.tracks.length < playlist.trackCount) card.createEl("small", { cls: "cld-music-track-more", text: `已同步 ${playlist.tracks.length} 条，完整列表请在平台 App 查看` });
  }

  private openMusicPlaylistNameEditor(item: ContentItem): void {
    new MusicPlaylistNameModal(this.app, item.title, async (title) => {
      await this.plugin.renameMusicPlaylistNote(item.file, title);
      new Notice("歌单名称已更新。");
      await this.refresh();
    }).open();
  }

  private renderHomeBanner(main: HTMLElement, source: ContentSource | undefined, itemCount: number, podcast: boolean): void {
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
    heroCopy.createEl("small", { text: podcast ? `播客 · ${itemCount} 项` : source ? `${SOURCE_KIND_LABELS[source.kind]} · ${itemCount} 项` : "继续阅读 · 今天" });
    heroCopy.createEl("h2", { text: podcast ? source?.name || "Podcast" : source?.name || this.plugin.settings.dashboardTitle });
    heroCopy.createEl("p", { text: source ? source.folder : "书、播客、新闻和灵感，都在一个地方。" });
  }

  private async renderDailyInspiration(main: HTMLElement): Promise<void> {
    const sources = this.enabledSources().filter((source) => (
      source.id === ANNOTATION_SOURCE_ID
      || source.folder.replace(/\/$/, "") === "自己的思考"
      || source.folder.replace(/\/$/, "") === "创意库"
    ));
    const items = this.plugin.indexer.all(sources, 120).filter((item) => item.file.extension === "md");
    const groups = await Promise.all(items.map(async (item) => {
      const content = await this.app.vault.cachedRead(item.file);
      return extractInspirationSentences(content, item.source.id === ANNOTATION_SOURCE_ID)
        .map((text) => ({ text, item, annotation: item.source.id === ANNOTATION_SOURCE_ID }));
    }));
    const candidates = groups.flat();
    if (!candidates.length) return;
    const annotationCandidates = candidates.filter((entry) => entry.annotation);
    const weighted = annotationCandidates.length ? [...annotationCandidates, ...annotationCandidates, ...candidates] : candidates;
    const today = new Date();
    const dateKey = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
    const seed = [...dateKey].reduce((total, character) => total * 31 + character.charCodeAt(0), 7);
    const candidate = weighted[Math.abs(seed + this.inspirationOffset * 7919) % weighted.length];
    const { item, text } = candidate;
    const card = main.createEl("section", { cls: "cld-inspiration cld-glass" });
    const copy = card.createDiv({ cls: "cld-inspiration-copy" });
    copy.createEl("small", { text: `今日启发 · ${item.source.name}` });
    copy.createEl("strong", { text: `“${text}”` });
    copy.createEl("p", { text: `来自《${item.title.replace(/-笔记$/, "")}》` });
    const actions = card.createDiv({ cls: "cld-inspiration-actions" });
    const open = actions.createEl("button", { cls: "cld-text-button", text: "打开", attr: { type: "button" } });
    open.addEventListener("click", () => {
      void this.plugin.recordView(item.file);
      this.selected = item;
      this.detailOpen = true;
      void this.refresh();
    });
    const next = actions.createEl("button", { cls: "cld-icon-button", attr: { type: "button", "aria-label": "换一条启发" } });
    setIcon(next, "refresh-cw");
    next.addEventListener("click", () => { this.inspirationOffset += 1; void this.refresh(); });
  }

  private currentInspirationHour(): string {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
  }

  private renderActivity(main: HTMLElement, items: ContentItem[]): void {
    const counts = new Map<string, number>();
    const updatedDays: number[] = [];
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
    activityHead.createEl("strong", { text: "内容更新" });
    const maxCount = Math.max(0, ...counts.values());
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(Math.min(...updatedDays));
    if (start.getTime() > today.getTime()) start.setTime(today.getTime());
    const dayMs = 24 * 60 * 60 * 1000;
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
        const level = count && maxCount ? Math.max(1, Math.ceil((count / maxCount) * 4)) : 0;
        column.createSpan({
          cls: `cld-activity-cell cld-activity-level-${level}`,
          attr: { title: `${key} · ${count} 次更新`, "aria-label": `${key}，${count} 次更新` },
        });
      }
    }
  }

  private renderPodcastLibrary(main: HTMLElement, title: string, items: ContentItem[]): void {
    const visibleItems = this.searchQuery
      ? items.filter((item) => `${item.title} ${item.subtitle} ${item.excerpt}`.toLowerCase().includes(this.searchQuery.toLowerCase()))
      : items;
    const sectionHead = main.createDiv({ cls: "cld-section-head cld-podcast-section-head" });
    const heading = sectionHead.createDiv();
    heading.createEl("strong", { text: title });
    heading.createEl("p", { text: "选择节目，右侧立即播放" });
    const tools = sectionHead.createDiv({ cls: "cld-podcast-list-tools" });
    tools.createEl("span", { text: this.searchQuery ? `${visibleItems.length} 个结果` : `${items.length} 集未听` });

    if (!visibleItems.length) {
      const empty = main.createDiv({ cls: "cld-empty cld-glass" });
      empty.createEl("h3", { text: "这个栏目还没有节目" });
      empty.createEl("p", { text: "可以选择包含 Markdown 节目笔记或音频文件的 Vault 文件夹。" });
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
        attr: { type: "button", "aria-pressed": String(isCurrent) },
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
        this.detailOpen = Platform.isMobile || this.contentEl.clientWidth <= 760;
        void this.refresh();
      });
      row.addEventListener("contextmenu", (event) => this.showItemMenu(event, item));
    }
  }

  private async hydrateDuration(element: HTMLElement, item: ContentItem): Promise<void> {
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
    probe.addEventListener("error", () => { probe.src = ""; }, { once: true });
    probe.src = url;
  }

  private metric(parent: HTMLElement, label: string, value: string, progress: number): void {
    const card = parent.createDiv({ cls: "cld-metric cld-glass", attr: { "data-metric": label } });
    const head = card.createDiv();
    head.createSpan({ text: label });
    head.createEl("strong", { text: value });
    const track = card.createDiv({ cls: "cld-track" });
    track.createSpan().style.width = `${progress}%`;
  }

  private renderContentCard(parent: HTMLElement, item: ContentItem): void {
    const button = parent.createEl("button", {
      cls: `cld-content-card cld-glass cld-kind-${item.kind}${this.selected?.id === item.id ? " is-selected" : ""}`,
      attr: { type: "button", "aria-label": `${item.title}，${this.plugin.indexer.kindLabel(item.kind)}` },
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
      setIcon(icon, item.source.icon || "file-text");
      meta.createEl("small", { text: this.plugin.indexer.kindLabel(item.kind) });
      const excerpt = cover.createEl("p", { cls: "cld-card-excerpt", text: this.cardExcerptFallback(item) });
      void this.hydrateCardExcerpt(excerpt, item);
    }
    if (item.kind === "podcast") {
      cover.addClass("has-podcast-badge");
      const badge = cover.createDiv({ cls: "cld-podcast-card-badge" });
      const badgeIcon = badge.createSpan();
      setIcon(badgeIcon, "play");
      badge.createSpan({ text: "播客" });
    }
    if (item.externalUrl) {
      const host = cover.createEl("small", { cls: "cld-web-host", text: webHost(item.externalUrl) });
      setIcon(host.createSpan(), "external-link");
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

  private cardExcerptFallback(item: ContentItem): string {
    const excerpt = item.excerpt.trim();
    if (excerpt && excerpt !== item.source.name && excerpt !== item.subtitle) return excerpt;
    return item.title;
  }

  private contentMeta(item: ContentItem): string {
    const date = this.youtubeGeneratedDate(item);
    if (date) return `生成于 ${date}`;
    const details = item.progress ? `${Math.round(item.progress)}% · ${item.subtitle}` : item.subtitle;
    return item.file.extension === "md" ? `${formatDate(item.created)} · ${details}` : details;
  }

  private youtubeGeneratedDate(item: ContentItem): string {
    return item.source.folder.split("/").pop()?.trim().toLowerCase() === "youtube podcast"
      ? formatDate(item.created)
      : "";
  }

  private async hydrateCardExcerpt(element: HTMLElement, item: ContentItem): Promise<void> {
    const note = item.file.extension === "md" ? item.file : this.getMatchedNote(item);
    if (!note) return;
    try {
      const content = await this.app.vault.cachedRead(note);
      const excerpt = this.cardExcerptFromContent(content, item);
      if (excerpt && element.isConnected) element.textContent = excerpt;
    } catch {
      // Keep the frontmatter/title fallback when an iCloud file is temporarily unavailable.
    }
  }

  private cardExcerptFromContent(content: string, item: ContentItem): string {
    const isGithubBrief = item.source.folder.toLowerCase().includes("github trending");
    if (isGithubBrief) {
      const match = content.match(/\*\*中文简介：\*\*\s*([^<\n]+)(?:<br>)?\s*\*\*适用场景：\*\*\s*([^<\n]+)/);
      if (match) return `${match[1].trim()} 适用：${match[2].trim()}`.slice(0, 180);
    }
    return extractInspirationSentences(content, false)[0] || "";
  }

  private renderContentStatus(parent: HTMLElement, item: ContentItem): HTMLElement {
    const status = parent.createSpan({ cls: "cld-content-status" });
    status.dataset.contentPath = item.file.path;
    this.paintContentStatus(status, item);
    return status;
  }

  private paintContentStatus(element: HTMLElement, item: ContentItem, liveProgress?: number): void {
    element.empty();
    for (const className of ["is-unread", "is-in-progress", "is-complete"]) element.removeClass(className);
    const saved = this.plugin.contentProgress(item.file);
    const progress = liveProgress ?? saved?.progress ?? 0;
    const state = progress >= 90 || saved?.state === "complete"
      ? "complete"
      : progress > 0 || saved?.state === "in-progress" ? "in-progress" : "unread";
    element.addClass(`is-${state}`);
    const noun = item.kind === "podcast" ? "听" : "读";
    if (state === "complete") {
      element.setAttr("aria-label", `已${noun}完`);
      element.setAttr("title", `已${noun}完`);
      setIcon(element, "check");
      return;
    }
    element.createSpan({ cls: "cld-status-dot" });
    if (state === "in-progress" && item.kind === "podcast") {
      element.createSpan({ cls: "cld-status-progress", text: `${Math.max(1, Math.round(progress))}%` });
    }
    const label = state === "in-progress"
      ? item.kind === "podcast" ? "收听中" : "阅读中"
      : `未${noun}`;
    element.setAttr("aria-label", label);
    element.setAttr("title", label);
  }

  private updateRenderedStatus(item: ContentItem, liveProgress?: number): void {
    const elements = this.contentEl.querySelectorAll<HTMLElement>(".cld-content-status");
    elements.forEach((element) => {
      if (element.dataset.contentPath === item.file.path) this.paintContentStatus(element, item, liveProgress);
    });
  }

  private showItemMenu(event: MouseEvent, item: ContentItem): void {
    event.preventDefault();
    const menu = new Menu();
    const progress = this.plugin.contentProgress(item.file);
    const completeLabel = item.kind === "podcast" ? "标记为已听完" : "标记为已读";
    const resetLabel = item.kind === "podcast" ? "重新设为未听" : "重新设为未读";
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
          new Notice(error instanceof Error ? error.message : "图片导入失败。");
        }
      }, { once: true });
      input.click();
    }));
    menu.showAtMouseEvent(event);
  }

  private async renderDetail(main: HTMLElement, item: ContentItem): Promise<void> {
    this.contentEl.scrollTop = 0;
    const detail = main.createEl("section", { cls: "cld-detail cld-glass" });
    const toolbar = detail.createDiv({ cls: "cld-detail-toolbar" });
    const back = toolbar.createEl("button", { cls: "cld-text-button", attr: { type: "button" } });
    const backIcon = back.createSpan();
    setIcon(backIcon, "arrow-left");
    back.createSpan({ text: this.articleReturnItem ? "返回播客列表" : "返回" });
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

  private async renderReadingDetail(parent: HTMLElement, item: ContentItem): Promise<void> {
    const content = await this.app.vault.cachedRead(item.file);
    await this.plugin.startContent(item.file);
    const isAnnotation = item.source.id === ANNOTATION_SOURCE_ID;
    const originalPath = isAnnotation ? annotationOriginalPath(content) : "";
    const audioUrl = await this.resolveAudio(item);
    const continuingPodcast = Boolean(this.articleReturnItem && this.audio);
    if (continuingPodcast) this.renderContinuedPodcastPlayer(parent, this.articleReturnItem!);
    else if (audioUrl) this.renderReadingAudioPlayer(parent, item, audioUrl);
    const grid = parent.createDiv({ cls: "cld-reader-grid" });
    const header = grid.createEl("header", { cls: "cld-reader-header" });
    const headerCopy = header.createDiv();
    const generatedDate = this.youtubeGeneratedDate(item);
    headerCopy.createEl("small", { text: generatedDate ? `${item.source.name} · 生成于 ${generatedDate}` : `${item.source.name} · 创建于 ${formatDate(item.created)}` });
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
    const open = headerActions.createEl("button", { cls: "cld-text-button", text: "在 Obsidian 中打开", attr: { type: "button" } });
    open.addEventListener("click", () => void this.openFile(item.file));
    const edit = headerActions.createEl("button", { cls: "cld-text-button cld-edit-note-button", text: "编辑笔记", attr: { type: "button" } });
    edit.addEventListener("click", () => this.startInlineNoteEdit(grid, item, content));
    if (originalPath) {
      const originalArticle = headerActions.createEl("button", { cls: "cld-text-button", text: "阅读原文章", attr: { type: "button" } });
      originalArticle.addEventListener("click", () => this.openArticlePath(originalPath));
    }
    if (item.kind === "book") {
      const weave = headerActions.createEl("button", { cls: "cld-text-button", text: "打开 Weave 阅读器", attr: { type: "button" } });
      weave.addEventListener("click", () => this.executeCommand("weave-epub-reader:open-active-epub-reader"));
    }
    if (item.externalUrl) {
      const original = headerActions.createEl("button", { cls: "cld-text-button", text: "打开原始网页", attr: { type: "button" } });
      original.addEventListener("click", () => window.open(item.externalUrl, "_blank"));
    }
    if (!this.articleReturnItem) this.renderReadingNavigation(headerActions, item);
    const article = grid.createEl("article", { cls: "cld-reading-page markdown-rendered" });
    await MarkdownRenderer.render(this.app, content, article, item.file.path, this);
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
      notes.createEl("small", { text: "批注来源" });
      notes.createEl("p", { text: originalPath || "这条批注没有记录来源文章。" });
      if (originalPath) {
        const originalArticle = notes.createEl("button", { cls: "cld-primary-button", text: "阅读原文章", attr: { type: "button" } });
        originalArticle.addEventListener("click", () => this.openArticlePath(originalPath));
      }
      return;
    }
    notes.createEl("small", { text: "阅读批注" });
    notes.createEl("p", { text: "选中文字后可直接收藏摘录，或带入这里继续写笔记。" });
    const quote = notes.createEl("textarea", { cls: "cld-textarea", attr: { rows: "3", placeholder: "粘贴摘录或原文…", "aria-label": "摘录原文" } });
    const thought = notes.createEl("textarea", { cls: "cld-textarea", attr: { rows: "5", placeholder: "写下你的批注…", "aria-label": "阅读批注" } });
    const save = notes.createEl("button", { cls: "cld-primary-button", text: "保存到批注笔记", attr: { type: "button" } });
    const saved = notes.createDiv({ cls: "cld-saved-notes" });
    await this.renderSavedAnnotations(saved, item, article);
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        const file = await this.plugin.appendAnnotation(item, thought.value, quote.value);
        if (!file) {
          new Notice("请先写下批注或摘录。");
          return;
        }
        thought.value = "";
        quote.value = "";
        await this.renderSavedAnnotations(saved, item, article);
        await this.applyAnnotationHighlights(article, item);
        new Notice(`已保存到 ${file.path}`);
      } catch (error) {
        new Notice(error instanceof Error ? `保存失败：${error.message}` : "保存失败，请重试。");
      } finally {
        save.disabled = false;
      }
    });

    const selectionToolbar = this.contentEl.createDiv({ cls: "cld-selection-toolbar cld-glass" });
    selectionToolbar.hidden = true;
    let selectedQuote = "";
    const collect = selectionToolbar.createEl("button", { cls: "cld-selection-action", attr: { type: "button" } });
    const collectIcon = collect.createSpan();
    setIcon(collectIcon, "star");
    collect.createSpan({ text: "收藏摘录" });
    const annotate = selectionToolbar.createEl("button", { cls: "cld-selection-action", attr: { type: "button" } });
    const annotateIcon = annotate.createSpan();
    setIcon(annotateIcon, "notebook-pen");
    annotate.createSpan({ text: "写笔记" });
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
        new Notice(`摘录已收藏到 ${file.path}`);
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
      const left = Math.max(12, Math.min(article.ownerDocument.defaultView!.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2));
      selectionToolbar.style.left = `${left}px`;
      selectionToolbar.style.top = `${Math.min(article.ownerDocument.defaultView!.innerHeight - 58, rect.bottom + 10)}px`;
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

  private startInlineNoteEdit(grid: HTMLElement, item: ContentItem, content: string): void {
    const article = grid.querySelector<HTMLElement>(".cld-reading-page");
    if (!article) return;
    const editor = grid.ownerDocument.createElement("section");
    editor.className = "cld-inline-note-editor cld-glass";
    const heading = editor.createEl("div", { cls: "cld-inline-note-editor-heading" });
    heading.createEl("strong", { text: "编辑笔记" });
    heading.createEl("small", { text: item.file.path });
    const textarea = editor.createEl("textarea", {
      cls: "cld-note-source-editor",
      attr: { "aria-label": "Markdown 笔记内容", spellcheck: "false" },
    });
    textarea.value = content;
    const actions = editor.createDiv({ cls: "cld-inline-note-editor-actions" });
    const cancel = actions.createEl("button", { cls: "cld-text-button", text: "取消", attr: { type: "button" } });
    const save = actions.createEl("button", { cls: "cld-primary-button", text: "保存笔记", attr: { type: "button" } });
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
        new Notice("笔记已保存。");
        this.detailOpen = true;
        this.selected = this.plugin.indexer.itemForFile(item.file, item.source);
        await this.refresh();
      } catch (error) {
        new Notice(error instanceof Error ? `保存失败：${error.message}` : "保存失败，请重试。");
        save.disabled = false;
        cancel.disabled = false;
      }
    });
  }

  private renderReadingNavigation(parent: HTMLElement, item: ContentItem): void {
    const queue = this.plugin.indexer
      .list(item.source, 240)
      .filter((entry) => entry.file.extension === "md" && entry.kind !== "podcast")
      .sort((a, b) => b.created - a.created);
    const index = queue.findIndex((entry) => entry.id === item.id);
    if (index < 0 || queue.length < 2) return;
    const previous = parent.createEl("button", { cls: "cld-text-button", text: "← 上一篇", attr: { type: "button" } });
    const next = parent.createEl("button", { cls: "cld-text-button", text: "下一篇 →", attr: { type: "button" } });
    previous.disabled = index === 0;
    next.disabled = index === queue.length - 1;
    previous.addEventListener("click", () => this.openReadingItem(queue[index - 1]));
    next.addEventListener("click", () => this.openReadingItem(queue[index + 1]));
  }

  private openReadingItem(item: ContentItem | undefined): void {
    if (!item) return;
    void this.plugin.recordView(item.file);
    this.selected = item;
    this.detailOpen = true;
    void this.refresh();
  }

  private updateReadStateButton(button: HTMLButtonElement, item: ContentItem): void {
    const complete = this.plugin.contentProgress(item.file)?.state === "complete";
    button.empty();
    const icon = button.createSpan();
    setIcon(icon, complete ? "check" : "circle-check");
    button.createSpan({ text: complete ? "已读 · 设为未读" : "标记已读" });
  }

  private setupReadingCompletion(item: ContentItem, button: HTMLButtonElement): void {
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

  private async hydrateWebCard(cover: HTMLElement, url: string, hasCover: string): Promise<void> {
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

  private renderRelatedLinks(parent: HTMLElement, content: string, item: ContentItem): void {
    const links = extractWebLinks(content);
    if (item.externalUrl && !links.some((entry) => entry.url === item.externalUrl)) links.unshift({ label: item.title, url: item.externalUrl });
    if (!links.length) return;
    const section = parent.createEl("section", { cls: "cld-related-links" });
    section.createEl("strong", { text: "相关链接" });
    const list = section.createDiv({ cls: "cld-related-link-list" });
    for (const entry of links.slice(0, 3)) {
      const card = list.createEl("button", { cls: "cld-related-link-card cld-glass", attr: { type: "button" } });
      const image = card.createDiv({ cls: "cld-related-link-image" });
      const copy = card.createDiv({ cls: "cld-related-link-copy" });
      copy.createEl("small", { text: webHost(entry.url) });
      const title = copy.createEl("strong", { text: entry.label || webHost(entry.url) });
      const description = copy.createEl("p", { text: "打开原始网页" });
      card.addEventListener("click", () => window.open(entry.url, "_blank"));
      void this.plugin.getWebPreview(entry.url).then((preview) => {
        if (!card.isConnected) return;
        if (preview.image) image.style.backgroundImage = `url("${preview.image.replace(/"/g, "%22")}")`;
        else setIcon(image.createSpan(), "globe-2");
        if (preview.title && preview.title !== preview.host) title.textContent = preview.title;
        if (preview.description) description.textContent = preview.description;
      });
    }
  }

  private async renderSavedAnnotations(parent: HTMLElement, item: ContentItem, article?: HTMLElement): Promise<void> {
    parent.empty();
    const file = this.plugin.annotationFile(item);
    if (!file) {
      parent.createEl("small", { text: "保存后会在这里显示，重新打开文章也不会消失。" });
      return;
    }
    const head = parent.createDiv({ cls: "cld-saved-notes-head" });
    head.createEl("strong", { text: "已保存笔记" });
    const open = head.createEl("button", { cls: "cld-text-button", text: "在 Obsidian 中打开", attr: { type: "button" } });
    open.addEventListener("click", () => void this.openFile(file));
    const annotations = storedAnnotationsFor(await this.app.vault.cachedRead(file), item.file.path);
    if (!annotations.length) {
      parent.createEl("small", { text: "保存后会在这里显示，重新打开文章也不会消失。" });
      return;
    }
    const list = parent.createDiv({ cls: "cld-saved-annotation-list" });
    for (const annotation of annotations) {
      const card = list.createDiv({ cls: "cld-saved-annotation" });
      if (annotation.quote && article) {
        card.addClass("is-locatable");
        card.setAttr("role", "button");
        card.setAttr("tabindex", "0");
        card.setAttr("aria-label", "定位到文章原文");
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
      if (!annotation.note && !annotation.quote) card.createEl("p", { text: "空白批注" });
      const actions = card.createDiv({ cls: "cld-saved-annotation-actions" });
      const edit = actions.createEl("button", { cls: "cld-text-button", text: "编辑", attr: { type: "button" } });
      edit.addEventListener("click", (event) => {
        event.stopPropagation();
        new AnnotationEditModal(this.app, annotation, async (quote, note) => {
        await this.updateStoredAnnotation(item, annotation, quote, note);
        await this.refresh();
        }).open();
      });
      const remove = actions.createEl("button", { cls: "cld-text-button cld-annotation-delete", text: "删除", attr: { type: "button" } });
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        new AnnotationDeleteModal(this.app, async () => {
        await this.deleteStoredAnnotation(item, annotation);
        await this.refresh();
        }).open();
      });
    }
  }

  private scrollToAnnotation(article: HTMLElement, annotation: StoredAnnotation): void {
    const selector = `.cld-annotation-highlight[data-cld-annotation-key="${annotation.start}"]`;
    const highlights = Array.from(article.querySelectorAll<HTMLElement>(selector));
    const target = highlights[0];
    if (!target) {
      new Notice("这条摘录暂时没有匹配到文章原文。", 3200);
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    for (const highlight of highlights) highlight.addClass("is-locating");
    window.setTimeout(() => {
      for (const highlight of highlights) highlight.removeClass("is-locating");
    }, 1600);
  }

  private async updateStoredAnnotation(item: ContentItem, annotation: StoredAnnotation, quote: string, note: string): Promise<void> {
    if (!quote.trim() && !note.trim()) throw new Error("批注和摘录不能同时为空。");
    const file = this.plugin.annotationFile(item);
    if (!file) throw new Error("没有找到批注笔记。");
    await this.app.vault.process(file, (content) => {
      const replacement = annotationBlock(annotation, quote, note);
      return `${content.slice(0, annotation.start)}${replacement}${content.slice(annotation.end)}`;
    });
  }

  private async deleteStoredAnnotation(item: ContentItem, annotation: StoredAnnotation): Promise<void> {
    const file = this.plugin.annotationFile(item);
    if (!file) throw new Error("没有找到批注笔记。");
    await this.app.vault.process(file, (content) => `${content.slice(0, annotation.start)}${content.slice(annotation.end)}`.replace(/\n{3,}/g, "\n\n"));
  }

  private async applyAnnotationHighlights(article: HTMLElement, item: ContentItem): Promise<void> {
    const file = this.plugin.annotationFile(item);
    if (!file) return;
    const annotations = storedAnnotationsFor(await this.app.vault.cachedRead(file), item.file.path);
    const merged = new Map<string, StoredAnnotation>();
    for (const annotation of annotations) {
      const current = merged.get(annotation.quote);
      if (!current) merged.set(annotation.quote, { ...annotation });
      else if (annotation.note && !current.note.includes(annotation.note)) current.note = [current.note, annotation.note].filter(Boolean).join("\n\n");
    }
    for (const annotation of merged.values()) this.highlightQuote(article, annotation);
  }

  private highlightQuote(article: HTMLElement, annotation: StoredAnnotation): void {
    const quote = annotation.quote.trim();
    if (!quote) return;
    const target = normalizedTextOffsets(quote);
    if (!target.text) return;
    const indexed = indexedArticleText(article);
    const index = indexed.text.indexOf(target.text);
    if (index < 0) return;
    const segments = new Map<Text, { start: number; end: number }>();
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
      highlight.dataset.cldAnnotation = annotation.note || "已收藏摘录";
      highlight.dataset.cldAnnotationKey = String(annotation.start);
      highlight.setAttribute("tabindex", "0");
      highlight.setAttribute("aria-label", `批注：${annotation.note || "已收藏摘录"}`);
      range.surroundContents(highlight);
    }
  }

  private renderReadingAudioPlayer(parent: HTMLElement, item: ContentItem, audioUrl: string): void {
    const player = parent.createDiv({ cls: "cld-reading-audio cld-glass" });
    const label = player.createDiv();
    label.createEl("small", { text: "关联音频" });
    label.createEl("strong", { text: item.title });
    const controls = player.createDiv({ cls: "cld-reading-audio-controls", attr: { "aria-label": "文章关联音频播放器" } });
    const play = controls.createEl("button", {
      cls: "cld-reading-audio-play",
      attr: { type: "button", "aria-label": "播放" },
    });
    setIcon(play, "play");
    const timeline = controls.createEl("input", {
      cls: "cld-audio-range",
      attr: { type: "range", min: "0", max: "1000", value: "0", "aria-label": "播放进度" },
    });
    const time = controls.createEl("time", { cls: "cld-reading-audio-time", text: "0:00 / 0:00" });
    const audio = new Audio(audioUrl);
    audio.preload = "metadata";
    const updateTimeline = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      const progress = duration > 0 ? Math.round((audio.currentTime / duration) * 1000) : 0;
      timeline.value = String(progress);
      timeline.style.setProperty("--cld-audio-progress", `${progress / 10}%`);
      time.textContent = `${formatTime(audio.currentTime)} / ${formatTime(duration)}`;
    };
    const updatePlayButton = () => {
      setIcon(play, audio.paused ? "play" : "pause");
      play.setAttr("aria-label", audio.paused ? "播放" : "暂停");
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
          new Notice("系统阻止了播放，请再点击一次播放键。", 3500);
        }
      } else {
        audio.pause();
      }
    });
    timeline.addEventListener("input", () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        audio.currentTime = (Number(timeline.value) / 1000) * audio.duration;
        updateTimeline();
      }
    });
  }

  private renderContinuedPodcastPlayer(parent: HTMLElement, item: ContentItem): void {
    const audio = this.audio;
    if (!audio || this.audioItemId !== item.id) {
      this.articleReturnItem = null;
      return;
    }
    const shouldAutoplay = this.autoplayItemId === item.id;
    this.autoplayItemId = null;
    const player = parent.createEl("section", {
      cls: "cld-continued-podcast cld-glass",
      attr: { "aria-label": "继续播放播客" },
    });
    const copy = player.createDiv({ cls: "cld-continued-podcast-copy" });
    copy.createEl("small", { text: "正在阅读原文 · 播客继续播放" });
    copy.createEl("strong", { text: item.title });
    const transport = player.createDiv({ cls: "cld-continued-podcast-transport" });
    const timeline = transport.createEl("input", {
      cls: "cld-audio-range",
      attr: { type: "range", min: "0", max: "1000", value: "0", "aria-label": "播客播放进度" },
    });
    const timecodes = transport.createDiv({ cls: "cld-player-timecodes" });
    const currentTime = timecodes.createEl("time", { text: formatTime(audio.currentTime) });
    const duration = timecodes.createEl("time", { text: formatTime(audio.duration) });
    const actions = player.createDiv({ cls: "cld-continued-podcast-actions" });
    const controls = actions.createDiv({ cls: "cld-continued-podcast-controls" });
    const previous = this.iconButton(controls, "skip-back", "上一条");
    const play = controls.createEl("button", {
      cls: "cld-play-button",
      attr: { type: "button", "aria-label": audio.paused ? "继续播放" : "暂停" },
    });
    setIcon(play, audio.paused ? "play" : "pause");
    const next = this.iconButton(controls, "skip-forward", "下一条");
    const speed = actions.createEl("button", {
      cls: "cld-speed-control",
      text: `${audio.playbackRate}×`,
      attr: { type: "button", "aria-label": "播放速度" },
    });
    const updateTimeline = () => {
      const total = Number.isFinite(audio.duration) ? audio.duration : 0;
      timeline.value = total > 0 ? String(Math.round((audio.currentTime / total) * 1000)) : "0";
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
        setIcon(play, "play");
        play.setAttr("aria-label", "继续播放");
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
          setIcon(play, "pause");
          play.setAttr("aria-label", "暂停");
        } catch {
          new Notice("系统阻止了自动播放，请再点击一次播放键。", 3500);
        }
      } else {
        audio.pause();
        this.playing = false;
        setIcon(play, "play");
        play.setAttr("aria-label", "继续播放");
      }
    });
    timeline.addEventListener("input", () => {
      if (audio.duration) audio.currentTime = (Number(timeline.value) / 1000) * audio.duration;
    });
    const speeds = [1, 1.25, 1.5, 2];
    speed.addEventListener("click", () => {
      const currentIndex = Math.max(0, speeds.findIndex((value) => value === audio.playbackRate));
      const nextSpeed = speeds[(currentIndex + 1) % speeds.length];
      audio.playbackRate = nextSpeed;
      speed.textContent = `${nextSpeed}×`;
    });
    if (shouldAutoplay) {
      void audio.play().then(() => {
        this.beginAudioProgress(item);
        this.playing = true;
        setIcon(play, "pause");
        play.setAttr("aria-label", "暂停");
      }).catch(() => {
        this.playing = false;
        setIcon(play, "play");
      });
    }
  }

  private beginAudioProgress(item: ContentItem): void {
    const saved = this.plugin.contentProgress(item.file);
    if (!saved) void this.plugin.startContent(item.file);
    this.updateRenderedStatus(item, saved?.progress || 1);
  }

  private trackAudioProgress(item: ContentItem, audio: HTMLAudioElement): void {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const progress = Math.max(1, Math.min(100, (audio.currentTime / audio.duration) * 100));
    void this.plugin.setContentProgress(item.file, progress, progress >= 90);
    this.updateRenderedStatus(item, progress);
    const button = this.contentEl.querySelector<HTMLButtonElement>(".cld-listen-state-button");
    if (button && progress >= 90) this.updateListenStateButton(button, item);
  }

  private completeAudioProgress(item: ContentItem): void {
    void this.plugin.markContentComplete(item.file);
    this.updateRenderedStatus(item, 100);
    const button = this.contentEl.querySelector<HTMLButtonElement>(".cld-listen-state-button");
    if (button) this.updateListenStateButton(button, item);
  }

  private updateListenStateButton(button: HTMLButtonElement, item: ContentItem): void {
    const complete = this.plugin.contentProgress(item.file)?.state === "complete";
    button.empty();
    const icon = button.createSpan();
    setIcon(icon, complete ? "check" : "circle-check");
    button.createSpan({ text: complete ? "已听完 · 设为未听" : "标记已听完" });
  }

  private async renderPodcastDetail(parent: HTMLElement, item: ContentItem): Promise<void> {
    const playerCard = parent.createDiv({ cls: "cld-podcast-player" });
    const header = playerCard.createDiv({ cls: "cld-podcast-header" });
    const visual = header.createDiv({ cls: "cld-podcast-artwork" });
    const override = this.plugin.settings.coverOverrides[item.file.path] || "";
    const cover = this.plugin.indexer.resolveResource(override, item.file) || item.cover;
    if (cover) {
      visual.addClass("has-image");
      visual.style.backgroundImage = `url("${cover.replace(/"/g, "%22")}")`;
    }
    else {
      const wave = visual.createDiv({ cls: "cld-podcast-wave", attr: { "aria-hidden": "true" } });
      for (const height of [24, 48, 72, 44, 64, 32, 54]) {
        wave.createSpan().style.height = `${height}%`;
      }
    }
    const copy = header.createDiv({ cls: "cld-podcast-copy" });
    copy.createEl("small", { text: `${item.subtitle} · ${this.plugin.indexer.kindLabel(item.kind)} · ${formatDate(item.created)}` });
    copy.createEl("h2", { text: item.title });
    if (item.excerpt && item.excerpt !== item.subtitle) copy.createEl("p", { text: item.excerpt });
    const audioUrl = await this.resolveAudio(item);
    const consoleEl = playerCard.createDiv({ cls: "cld-player-console" });
    const timeline = consoleEl.createEl("input", { cls: "cld-audio-range", attr: { type: "range", min: "0", max: "1000", value: "0", "aria-label": "播放进度" } });
    const timelineRow = consoleEl.createDiv({ cls: "cld-player-timecodes" });
    const currentTime = timelineRow.createEl("time", { text: "00:00" });
    const duration = timelineRow.createEl("time", { text: "00:00" });
    const controls = consoleEl.createDiv({ cls: "cld-player-controls" });
    const previous = this.iconButton(controls, "skip-back", "上一条");
    const play = controls.createEl("button", { cls: "cld-play-button", attr: { type: "button", "aria-label": "播放" } });
    setIcon(play, "play");
    const next = this.iconButton(controls, "skip-forward", "下一条");
    const options = consoleEl.createDiv({ cls: "cld-player-options" });
    this.createPlaybackModeSelect(options);
    const speed = options.createEl("button", { cls: "cld-speed-control", text: "1×", attr: { type: "button", "aria-label": "播放速度" } });
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
        timeline.value = String(Math.round((this.audio.currentTime / this.audio.duration) * 1000));
        currentTime.textContent = formatTime(this.audio.currentTime);
        this.trackAudioProgress(item, this.audio);
        this.renderMiniPlayer(item);
      };
      this.audio.onended = () => {
        this.completeAudioProgress(item);
        if (!this.playAfterEnd(item)) {
          this.playing = false;
          setIcon(play, "play");
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
          setIcon(play, "pause");
        } else {
          this.audio.pause();
          this.playing = false;
          setIcon(play, "play");
        }
      });
      timeline.addEventListener("input", () => {
        if (this.audio?.duration) this.audio.currentTime = (Number(timeline.value) / 1000) * this.audio.duration;
      });
      const speeds = [1, 1.25, 1.5, 2];
      let speedIndex = 0;
      speed.addEventListener("click", () => {
        speedIndex = (speedIndex + 1) % speeds.length;
        if (this.audio) this.audio.playbackRate = speeds[speedIndex];
        speed.textContent = `${speeds[speedIndex]}×`;
      });
      if (shouldAutoplay) {
        void this.audio.play().then(() => {
          this.beginAudioProgress(item);
          this.playing = true;
          setIcon(play, "pause");
        }).catch(() => {
          this.playing = false;
          setIcon(play, "play");
        });
      } else if (wasPlaying) {
        this.playing = true;
        setIcon(play, "pause");
      }
    } else {
      this.destroyAudio();
      this.autoplayItemId = null;
      play.addEventListener("click", () => this.executeCommand("vaultcast:open-player"));
      timeline.disabled = true;
      consoleEl.createEl("small", { cls: "cld-player-status", text: "没有检测到本地音频；播放按钮将打开 VaultCast。" });
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
    const source = actions.createEl("button", { cls: "cld-text-button", text: item.file.extension === "md" ? "打开节目笔记" : "打开音频文件", attr: { type: "button" } });
    source.addEventListener("click", () => void this.openFile(item.file));
    if (item.externalUrl) {
      const link = actions.createEl("button", { cls: "cld-text-button", text: "打开原始链接", attr: { type: "button" } });
      link.addEventListener("click", () => window.open(item.externalUrl, "_blank"));
    }
    if (this.getMatchedNote(item)) {
      const article = actions.createEl("button", { cls: "cld-text-button", text: "阅读对应文章", attr: { type: "button" } });
      article.addEventListener("click", () => this.openMatchedArticle(item));
    }
    const moment = parent.createDiv({ cls: "cld-moment cld-glass" });
    moment.createEl("strong", { text: "记录此刻" });
    const thought = moment.createEl("textarea", { cls: "cld-textarea", attr: { rows: "4", placeholder: "记录现在想到的内容…", "aria-label": "此刻的想法" } });
    const save = moment.createEl("button", { cls: "cld-primary-button", text: "保存想法", attr: { type: "button" } });
    save.addEventListener("click", async () => {
      const time = formatTime(this.audio?.currentTime ?? 0);
      const file = await this.plugin.appendAnnotation(item, thought.value, "", time);
      if (!file) {
        new Notice("请先写下想法。");
        return;
      }
      thought.value = "";
      new Notice(`已保存到 ${file.path}`);
    });

  }

  private async renderPodcastInspector(layout: HTMLElement): Promise<void> {
    const aside = layout.createEl("aside", { cls: "cld-inspector cld-side-player cld-glass", attr: { "aria-label": "当前播放节目" } });
    const item = this.selected || this.currentItems()[0];
    if (!item) {
      aside.createEl("small", { text: "当前播放" });
      aside.createEl("h3", { text: "选择一集节目" });
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
    copy.createEl("small", { text: `${item.subtitle} · 当前节目` });
    copy.createEl("h3", { text: item.title });
    this.renderContentStatus(copy, item);
    if (item.excerpt && item.excerpt !== item.subtitle) copy.createEl("p", { text: item.excerpt });

    const timeline = aside.createEl("input", { cls: "cld-audio-range", attr: { type: "range", min: "0", max: "1000", value: "0", "aria-label": "播放进度" } });
    const timelineRow = aside.createDiv({ cls: "cld-player-timecodes" });
    const current = timelineRow.createEl("time", { text: "00:00" });
    const total = timelineRow.createEl("time", { text: "00:00" });
    const controls = aside.createDiv({ cls: "cld-side-player-controls" });
    const previous = this.iconButton(controls, "skip-back", "上一条");
    const play = controls.createEl("button", { cls: "cld-play-button", attr: { type: "button", "aria-label": "播放" } });
    setIcon(play, "play");
    const next = this.iconButton(controls, "skip-forward", "下一条");
    const options = aside.createDiv({ cls: "cld-player-options" });
    this.createPlaybackModeSelect(options);
    const speed = options.createEl("button", { cls: "cld-speed-control", text: "1×", attr: { type: "button", "aria-label": "播放速度" } });

    const audioUrl = await this.resolveAudio(item);
    if (audioUrl) {
      const shouldAutoplay = this.autoplayItemId === item.id;
      this.autoplayItemId = null;
      const wasPlaying = this.audioItemId === item.id && Boolean(this.audio && !this.audio.paused);
      this.audio = this.prepareAudio(item, audioUrl, shouldAutoplay);
      this.audio.onloadedmetadata = () => { total.textContent = formatTime(this.audio?.duration ?? 0); };
      this.audio.ontimeupdate = () => {
        if (!this.audio?.duration) return;
        current.textContent = formatTime(this.audio.currentTime);
        timeline.value = String(Math.round((this.audio.currentTime / this.audio.duration) * 1000));
        this.trackAudioProgress(item, this.audio);
        this.renderMiniPlayer(item);
      };
      this.audio.onended = () => {
        this.completeAudioProgress(item);
        if (!this.playAfterEnd(item)) {
          this.playing = false;
          setIcon(play, "play");
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
          setIcon(play, "pause");
        } else {
          this.audio.pause();
          this.playing = false;
          setIcon(play, "play");
        }
      });
      timeline.addEventListener("input", () => {
        if (this.audio?.duration) this.audio.currentTime = (Number(timeline.value) / 1000) * this.audio.duration;
      });
      const speeds = [1, 1.25, 1.5, 2];
      let speedIndex = 0;
      speed.addEventListener("click", () => {
        speedIndex = (speedIndex + 1) % speeds.length;
        if (this.audio) this.audio.playbackRate = speeds[speedIndex];
        speed.textContent = `${speeds[speedIndex]}×`;
      });
      if (shouldAutoplay) {
        void this.audio.play().then(() => {
          this.beginAudioProgress(item);
          this.playing = true;
          setIcon(play, "pause");
        }).catch(() => {
          this.playing = false;
          setIcon(play, "play");
          new Notice("系统阻止了自动播放，请点击一次右侧播放键。", 3500);
        });
      } else if (wasPlaying) {
        this.playing = true;
        setIcon(play, "pause");
        this.renderMiniPlayer(item);
      }
    } else {
      this.destroyAudio();
      const shouldOpenFallback = this.autoplayItemId === item.id;
      this.autoplayItemId = null;
      timeline.disabled = true;
      play.addEventListener("click", () => this.executeCommand("vaultcast:open-player"));
      aside.createEl("small", { cls: "cld-player-status", text: "未检测到本地音频" });
      if (shouldOpenFallback) this.executeCommand("vaultcast:open-player");
    }

    const matchedNote = this.getMatchedNote(item);
    if (matchedNote) {
      const article = aside.createEl("button", { cls: "cld-primary-button cld-open-article", text: "阅读对应文章", attr: { type: "button" } });
      article.addEventListener("click", () => this.openMatchedArticle(item));
    }
  }

  private renderInspector(layout: HTMLElement): void {
    const aside = layout.createEl("aside", { cls: "cld-inspector cld-glass", attr: { "aria-label": "内容详情" } });
    const item = this.selected || this.currentItems()[0];
    if (!item) {
      aside.createEl("small", { text: "内容详情" });
      aside.createEl("h3", { text: "选择一项内容" });
      aside.createEl("p", { text: "封面、进度和下一步操作会显示在这里。" });
      return;
    }
    const preview = aside.createDiv({ cls: `cld-inspector-cover cld-kind-${item.kind}` });
    const cover = this.plugin.indexer.resolveResource(this.plugin.settings.coverOverrides[item.file.path] || "", item.file) || item.cover;
    if (cover) preview.style.backgroundImage = `url("${cover.replace(/"/g, "%22")}")`;
    else {
      const icon = preview.createSpan();
      setIcon(icon, item.source.icon || "file-text");
    }
    aside.createEl("small", { text: this.plugin.indexer.kindLabel(item.kind) });
    aside.createEl("h3", { text: item.title });
    aside.createEl("p", { text: item.subtitle });
    const savedProgress = this.plugin.contentProgress(item.file)?.progress ?? item.progress;
    const head = aside.createDiv({ cls: "cld-progress-head" });
    head.createSpan({ text: "进度" });
    head.createEl("strong", { text: `${Math.round(savedProgress)}%` });
    const track = aside.createDiv({ cls: "cld-track" });
    track.createSpan().style.width = `${savedProgress}%`;
    const open = aside.createEl("button", { cls: "cld-primary-button", text: item.kind === "podcast" ? "打开播放器" : "继续阅读", attr: { type: "button" } });
    open.addEventListener("click", () => {
      this.selected = item;
      this.detailOpen = true;
      void this.refresh();
    });
  }

  private renderMiniPlayer(item: ContentItem): void {
    const host = this.contentEl.querySelector<HTMLElement>(".cld-root");
    const existing = host?.querySelector<HTMLElement>(".cld-mini-player");
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
    copy.createEl("small", { text: `正在播放 · ${formatTime(this.audio.currentTime)}` });
    copy.createEl("strong", { text: item.title });
    const button = dock.createEl("button", { cls: "cld-play-button", attr: { type: "button", "aria-label": "暂停" } });
    setIcon(button, "pause");
    button.addEventListener("click", () => {
      this.audio?.pause();
      this.playing = false;
      dock.remove();
    });
  }

  private async resolveAudio(item: ContentItem): Promise<string> {
    const direct = this.plugin.indexer.resolveResource(item.audioPath, item.file);
    if (direct) return direct;
    if (item.file.extension !== "md") return this.app.vault.getResourcePath(item.file);
    const content = await this.app.vault.cachedRead(item.file);
    const wikiLink = content.match(/!?\[\[([^\]]+\.(?:mp3|m4a|wav|flac|aac|ogg|opus))(?:\|[^\]]+)?\]\]/i);
    if (wikiLink) return this.plugin.indexer.resolveResource(wikiLink[1], item.file);
    const markdownLink = content.match(/\[[^\]]*\]\(([^)]+\.(?:mp3|m4a|wav|flac|aac|ogg|opus)(?:\?[^)]*)?)\)/i);
    return markdownLink ? this.plugin.indexer.resolveResource(markdownLink[1], item.file) : "";
  }

  private executeCommand(id: string): void {
    const host = this.app as unknown as CommandHost;
    if (!host.commands?.executeCommandById(id)) new Notice("对应插件或命令当前不可用。");
  }

  private async openFile(file: TFile): Promise<void> {
    void this.plugin.recordView(file);
    await this.app.workspace.getLeaf(Platform.isMobile ? false : "tab").openFile(file);
  }

  private iconButton(parent: HTMLElement, iconName: string, label: string): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "cld-icon-button", attr: { type: "button", "aria-label": label } });
    setIcon(button, iconName);
    return button;
  }

  private createPlaybackModeSelect(parent: HTMLElement): HTMLSelectElement {
    const select = parent.createEl("select", {
      cls: "cld-playback-mode",
      attr: { "aria-label": "播放模式" },
    });
    for (const [value, label] of [
      ["sequential", "顺序播放"],
      ["list-loop", "列表循环"],
      ["single-loop", "单曲循环"],
      ["shuffle", "随机播放"],
    ] as const) select.createEl("option", { value, text: label });
    select.value = this.plugin.settings.playbackMode;
    select.addEventListener("change", async () => {
      this.plugin.settings.playbackMode = select.value as typeof this.plugin.settings.playbackMode;
      await this.plugin.saveSettings(false);
    });
    return select;
  }

  private playAfterEnd(item: ContentItem): boolean {
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

  private playRandom(item: ContentItem): boolean {
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

  private getMatchedNote(item: ContentItem): TFile | null {
    if (!item.notePath) return null;
    const file = this.app.vault.getAbstractFileByPath(item.notePath);
    return file instanceof TFile ? file : null;
  }

  private openMatchedArticle(item: ContentItem): void {
    const note = this.getMatchedNote(item);
    if (!note) {
      new Notice("没有找到与这条音频对应的文章。");
      return;
    }
    this.openArticleFile(note, item);
  }

  private openArticlePath(path: string): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) this.openArticleFile(file);
    else new Notice("原文章已经移动或不存在。");
  }

  private openArticleFile(note: TFile, returnPodcast: ContentItem | null = null): void {
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

  private sourceForNote(note: TFile): ContentSource | undefined {
    return this.enabledSources()
      .filter((entry) => entry.id !== ANNOTATION_SOURCE_ID)
      .filter((entry) => entry.kind !== "podcast")
      .filter((entry) => note.path === entry.folder || note.path.startsWith(`${entry.folder.replace(/\/$/, "")}/`))
      .sort((a, b) => b.folder.length - a.folder.length)[0];
  }

  private returnToPodcastList(): void {
    const podcast = this.articleReturnItem;
    if (!podcast) return;
    this.articleReturnItem = null;
    this.selected = podcast;
    this.activeSourceId = podcast.source.id;
    this.detailOpen = false;
    void this.refresh();
  }

  private playAdjacent(item: ContentItem, direction: -1 | 1, wrap: boolean): boolean {
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

  private async playAdjacentArticle(item: ContentItem, direction: -1 | 1): Promise<void> {
    const queue = this.currentItems().filter((entry) => entry.kind === "podcast");
    const currentIndex = queue.findIndex((entry) => entry.id === item.id);
    if (currentIndex < 0) return;
    for (let offset = 1; offset < queue.length; offset += 1) {
      const index = (currentIndex + direction * offset + queue.length) % queue.length;
      const target = queue[index];
      const note = this.getMatchedNote(target);
      const source = note ? this.sourceForNote(note) : undefined;
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
    new Notice("没有找到带对应原文的上一条或下一条节目。");
  }

  private destroyAudio(): void {
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

  private prepareAudio(item: ContentItem, url: string, continuePlayback: boolean): HTMLAudioElement {
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
    return this.audio!;
  }
}

async function openMusicApp(url: string): Promise<void> {
  let resolvedUrl = url;
  if (isQqMusicUrl(url) && !/(?:playlist|gedan)[/:]\d+|[?&]id=\d+/i.test(url)) {
    try {
      const response = await requestUrl({
        url,
        method: "GET",
        headers: {
          Accept: "text/html",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
        },
      });
      const canonical = response.text.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)/i)?.[1]
        || response.text.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)?.[1]
        || "";
      if (canonical) resolvedUrl = canonical.replace(/&amp;/g, "&");
    } catch {
      // Keep the original share URL if QQ blocks the metadata request.
    }
  }
  const songId = resolvedUrl.match(/[#/?&]song[/?&]?id=(\d+)/i)?.[1] || (resolvedUrl.includes("#/song") ? resolvedUrl.match(/[?&]id=(\d+)/i)?.[1] : "");
  let qqSongMid = isQqMusicUrl(resolvedUrl)
    ? resolvedUrl.match(/songDetail[/:]([0-9A-Za-z]+)/i)?.[1] || resolvedUrl.match(/[?&]songmid=([0-9A-Za-z]+)/i)?.[1]
    : "";
  if (qqSongMid && /^\d+$/.test(qqSongMid)) {
    try {
      const songResponse = await requestUrl({
        url: `https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg?songid=${qqSongMid}&format=json`,
        headers: { Accept: "application/json", Referer: "https://y.qq.com/", "User-Agent": "Mozilla/5.0" },
      });
      const songPayload = JSON.parse(songResponse.text) as { data?: Array<{ mid?: string }> };
      qqSongMid = songPayload.data?.[0]?.mid || qqSongMid;
    } catch {
      // Keep the original value and let the platform decide how to handle it.
    }
  }
  const programId = resolvedUrl.match(/[#/?&]program[/?&]?id=(\d+)/i)?.[1];
  const radioId = resolvedUrl.match(/[#/?&](?:djradio|dj)[/?&]?id=(\d+)/i)?.[1];
  const netEasePlaylistId = !songId
    ? resolvedUrl.match(/[#/?&]playlist[/?&]?id=(\d+)/i)?.[1] || resolvedUrl.match(/playlist[/:](\d+)/i)?.[1]
    : "";
  const qqPlaylistId = !songId && isQqMusicUrl(resolvedUrl)
    ? resolvedUrl.match(/(?:playlist|gedan)[/:](\d+)/i)?.[1] || resolvedUrl.match(/[?&](?:id|playlistid|dissid)=(\d+)/i)?.[1]
    : "";
  const qqAlbumId = !songId && isQqMusicUrl(resolvedUrl)
    ? resolvedUrl.match(/albumDetail[/:](\d+)/i)?.[1] || resolvedUrl.match(/[?&]albumId=(\d+)/i)?.[1]
    : "";
  const qqScheme = Platform.isMobile ? "qqmusic" : "qqmusicmac";
  const deepLink = songId
    ? `orpheus://song/${songId}`
    : qqSongMid
      ? `${qqScheme}://qq.com/media/playSonglist?p=${encodeURIComponent(JSON.stringify({ action: "play", song: [{ songmid: qqSongMid }] }))}`
    : programId
      ? `orpheus://program/${programId}`
      : radioId
        ? `orpheus://radio/${radioId}`
    : netEasePlaylistId
      ? `orpheus://playlist/${netEasePlaylistId}`
      : qqAlbumId
        ? `${qqScheme}://qq.com/ui/album?p=${encodeURIComponent(JSON.stringify({ id: qqAlbumId }))}`
      : qqPlaylistId
        ? `${qqScheme}://qq.com/ui/gedan?p=${encodeURIComponent(JSON.stringify({ id: qqPlaylistId }))}`
        : "";
  const appPath = Platform.isMobile ? "" : isQqMusicUrl(resolvedUrl) ? "/Applications/QQMusic.app" : "/Applications/NeteaseMusic.app";
  if (deepLink) {
    try {
      await openExternalUrl(deepLink, appPath);
      return;
    } catch {
      // If macOS rejects the custom scheme, fall back to the original link.
    }
  }
  await openExternalUrl(url);
}

function openExternalUrl(url: string, appPath = ""): Promise<void> {
  if (Platform.isMobile) {
    window.location.href = url;
    return Promise.resolve();
  }
  try {
    const childProcess = typeof require === "function" ? require("child_process") as { execFile?: (file: string, args: string[], callback: (error: Error | null) => void) => void } : null;
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
    // Fall through to Electron shell or browser fallback.
  }
  try {
    const electron = typeof require === "function" ? require("electron") as { shell?: { openExternal?: (value: string) => Promise<void> } } : null;
    if (electron?.shell?.openExternal) {
      return electron.shell.openExternal(url);
    }
  } catch {
    // Obsidian mobile and restricted runtimes may not expose Electron shell.
  }
  try {
    window.open(url, "_blank");
  } catch {
    return Promise.reject(new Error("无法打开外部链接"));
  }
  return Promise.resolve();
}

function isQqMusicUrl(url: string): boolean {
  return /(?:^|\/)(?:y\.qq\.com|i\.y\.qq\.com|c6\.y\.qq\.com)\//i.test(url);
}

function isNetEaseProgramUrl(url: string): boolean {
  return /music\.163\.com\/(?:dj|djradio)(?:[/?#]|$)/i.test(url);
}

class NoteTitleModal extends Modal {
  constructor(
    app: App,
    private sourceName: string,
    private onSubmitTitle: (title: string) => Promise<void>,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cld-note-modal");
    contentEl.createEl("h2", { text: "新建笔记" });
    contentEl.createEl("p", { text: `保存到：${this.sourceName}` });
    const form = contentEl.createEl("form", { cls: "cld-note-modal-form" });
    const input = form.createEl("input", {
      cls: "cld-note-title-input",
      attr: { type: "text", placeholder: "输入笔记标题", autocomplete: "off", "aria-label": "笔记标题" },
    });
    const actions = form.createDiv({ cls: "cld-note-modal-actions" });
    const cancel = actions.createEl("button", { text: "取消", attr: { type: "button" } });
    const create = actions.createEl("button", { cls: "mod-cta", text: "创建", attr: { type: "submit" } });
    cancel.addEventListener("click", () => this.close());
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const title = input.value.trim();
      if (!title) {
        new Notice("请输入笔记标题。");
        input.focus();
        return;
      }
      create.disabled = true;
      try {
        await this.onSubmitTitle(title);
        this.close();
      } catch (error) {
        new Notice(error instanceof Error ? `创建失败：${error.message}` : "创建失败，请重试。");
        create.disabled = false;
      }
    });
    window.setTimeout(() => input.focus(), 0);
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

class AnnotationEditModal extends Modal {
  constructor(
    app: App,
    private annotation: StoredAnnotation,
    private onSubmit: (quote: string, note: string) => Promise<void>,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cld-note-modal");
    contentEl.createEl("h2", { text: "编辑批注" });
    const form = contentEl.createEl("form", { cls: "cld-note-modal-form" });
    form.createEl("label", { text: "摘录原文" });
    const quote = form.createEl("textarea", { cls: "cld-textarea", attr: { rows: "4", "aria-label": "摘录原文" } });
    quote.value = this.annotation.quote;
    form.createEl("label", { text: "批注内容" });
    const note = form.createEl("textarea", { cls: "cld-textarea", attr: { rows: "6", "aria-label": "批注内容" } });
    note.value = this.annotation.note;
    const actions = form.createDiv({ cls: "cld-note-modal-actions" });
    const cancel = actions.createEl("button", { text: "取消", attr: { type: "button" } });
    const save = actions.createEl("button", { cls: "mod-cta", text: "保存修改", attr: { type: "submit" } });
    cancel.addEventListener("click", () => this.close());
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      save.disabled = true;
      try {
        await this.onSubmit(quote.value, note.value);
        this.close();
      } catch (error) {
        new Notice(error instanceof Error ? `保存失败：${error.message}` : "保存失败，请重试。");
        save.disabled = false;
      }
    });
    window.setTimeout(() => note.focus(), 0);
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

class AnnotationDeleteModal extends Modal {
  constructor(app: App, private onConfirm: () => Promise<void>) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cld-note-modal");
    contentEl.createEl("h2", { text: "删除这条批注？" });
    contentEl.createEl("p", { text: "删除后文章高亮和这条批注会一并移除。" });
    const actions = contentEl.createDiv({ cls: "cld-note-modal-actions" });
    const cancel = actions.createEl("button", { text: "取消", attr: { type: "button" } });
    const remove = actions.createEl("button", { cls: "mod-warning", text: "删除", attr: { type: "button" } });
    cancel.addEventListener("click", () => this.close());
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      try {
        await this.onConfirm();
        this.close();
      } catch (error) {
        new Notice(error instanceof Error ? `删除失败：${error.message}` : "删除失败，请重试。");
        remove.disabled = false;
      }
    });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

class MusicPlaylistModal extends Modal {
  constructor(
    app: App,
    private sourceName: string,
    private onSubmitUrl: (url: string, title: string) => Promise<void>,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cld-note-modal");
    contentEl.createEl("h2", { text: "添加网易云歌单" });
    contentEl.createEl("p", { text: `保存到：${this.sourceName} · 粘贴分享链接即可` });
    const form = contentEl.createEl("form", { cls: "cld-note-modal-form" });
    const input = form.createEl("input", {
      cls: "cld-note-title-input",
      attr: { type: "url", placeholder: "https://music.163.com/#/playlist?id=...", autocomplete: "off", "aria-label": "网易云歌单链接" },
    });
    const titleInput = form.createEl("input", {
      cls: "cld-note-title-input",
      attr: { type: "text", placeholder: "自定义名称（可选）", autocomplete: "off", "aria-label": "歌单名称" },
    });
    const actions = form.createDiv({ cls: "cld-note-modal-actions" });
    const cancel = actions.createEl("button", { text: "取消", attr: { type: "button" } });
    const create = actions.createEl("button", { cls: "mod-cta", text: "添加", attr: { type: "submit" } });
    cancel.addEventListener("click", () => this.close());
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const url = input.value.trim();
      if (!/^https?:\/\/(?:www\.)?(?:music\.163\.com|y\.qq\.com|i\.y\.qq\.com|c6\.y\.qq\.com)\//i.test(url)) {
        new Notice("请粘贴网易云或 QQ 音乐的歌单分享链接。");
        input.focus();
        return;
      }
      create.disabled = true;
      try {
        await this.onSubmitUrl(url, titleInput.value.trim());
        this.close();
      } catch (error) {
        new Notice(error instanceof Error ? `添加失败：${error.message}` : "添加失败，请重试。");
        create.disabled = false;
      }
    });
    window.setTimeout(() => input.focus(), 0);
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

class MusicPlaylistNameModal extends Modal {
  constructor(
    app: App,
    private currentTitle: string,
    private onSubmitTitle: (title: string) => Promise<void>,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cld-note-modal");
    contentEl.createEl("h2", { text: "编辑歌单名称" });
    const form = contentEl.createEl("form", { cls: "cld-note-modal-form" });
    const input = form.createEl("input", {
      cls: "cld-note-title-input",
      attr: { type: "text", value: this.currentTitle, autocomplete: "off", "aria-label": "歌单名称" },
    });
    const actions = form.createDiv({ cls: "cld-note-modal-actions" });
    const cancel = actions.createEl("button", { text: "取消", attr: { type: "button" } });
    const save = actions.createEl("button", { cls: "mod-cta", text: "保存", attr: { type: "submit" } });
    cancel.addEventListener("click", () => this.close());
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const title = input.value.trim();
      if (!title) {
        new Notice("名称不能为空。");
        input.focus();
        return;
      }
      save.disabled = true;
      try {
        await this.onSubmitTitle(title);
        this.close();
      } catch (error) {
        new Notice(error instanceof Error ? `保存失败：${error.message}` : "保存失败，请重试。");
        save.disabled = false;
      }
    });
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

function storedAnnotationsFor(content: string, sourcePath: string): StoredAnnotation[] {
  const source = `来源：[[${sourcePath}]]`;
  const annotations: StoredAnnotation[] = [];
  const headings = [...content.matchAll(/^##\s[^\n]*$/gm)];
  for (let index = 0; index < headings.length; index += 1) {
    const match = headings[index];
    if (match.index === undefined) continue;
    const start = match.index;
    const end = headings[index + 1]?.index ?? content.length;
    const block = content.slice(start, end);
    if (!block.includes(source)) continue;
    const lines = block.trimEnd().split(/\r?\n/);
    const heading = lines.shift() || "## 批注";
    const sourceLine = lines.find((line) => line.startsWith("来源：")) || `来源：[[${sourcePath}]]`;
    const timeLine = lines.find((line) => line.startsWith("时间：")) || "";
    const quoteStart = lines.findIndex((line) => /^>\s?/.test(line));
    let quoteEnd = quoteStart;
    while (quoteStart >= 0 && quoteEnd < lines.length && /^>\s?/.test(lines[quoteEnd])) quoteEnd += 1;
    const quote = quoteStart >= 0 ? lines.slice(quoteStart, quoteEnd).map((line) => line.replace(/^>\s?/, "")).join("\n").trim() : "";
    const noteStart = quoteStart >= 0 ? quoteEnd : 0;
    const note = lines.slice(noteStart)
      .filter((line) => !/^\s*(来源|时间)：/.test(line))
      .join("\n")
      .trim();
    annotations.push({
      quote,
      note,
      heading,
      sourceLine,
      timeLine,
      start,
      end,
    });
  }
  return annotations;
}

function annotationBlock(annotation: StoredAnnotation, quote: string, note: string): string {
  const quotation = quote.trim() ? `\n\n> ${quote.trim().replace(/\n+/g, "\n> ")}` : "";
  const text = note.trim() ? `\n\n${note.trim()}` : "";
  return `${annotation.heading}\n\n${annotation.sourceLine}${annotation.timeLine ? `\n${annotation.timeLine}` : ""}${quotation}${text}\n\n`;
}

function normalizedTextOffsets(value: string): { text: string; offsets: number[] } {
  let text = "";
  const offsets: number[] = [];
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
    text: text.slice(leading, trailing ? -trailing : undefined),
    offsets: offsets.slice(leading, trailing ? -trailing : undefined),
  };
}

function indexedArticleText(article: HTMLElement): { text: string; positions: Array<{ node: Text; offset: number }> } {
  let text = "";
  const positions: Array<{ node: Text; offset: number }> = [];
  let previousWasWhitespace = false;
  const walker = article.ownerDocument.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
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
    text: text.slice(leading, trailing ? -trailing : undefined),
    positions: positions.slice(leading, trailing ? -trailing : undefined),
  };
}

function annotationOriginalPath(content: string): string {
  const match = content.match(/来源：\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
  return match?.[1]?.trim() || "";
}

function extractInspirationSentences(content: string, annotation: boolean): string[] {
  const body = content
    .replace(/^---\s*[\s\S]*?\n---\s*/m, "")
    .replace(/```[\s\S]*?```/g, "");
  const sentences: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of body.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || /^#{1,6}\s/.test(trimmed) || /^[-*_]{3,}$/.test(trimmed) || /^\|/.test(trimmed)) continue;
    if (annotation && /^>/.test(trimmed)) continue;
    if (/^(来源|时间|日期|原文链接|音频|播客音频)\s*[：:]/.test(trimmed)) continue;
    const clean = trimmed
      .replace(/^\s*(?:[-*+] |\d+[.)]\s+)/, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/!\[\[[^\]]+\]\]/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, path: string, alias: string | undefined) => alias || path.split("/").pop() || path)
      .replace(/https?:\/\/\S+/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/[*_`~]/g, "")
      .replace(/\s+/g, " ")
      .trim();
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

function formatTime(value: number): string {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatDate(value: number): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function initials(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "♪";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
}

function formatCompactDuration(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "--m";
  const minutes = Math.round(value / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function formatUsage(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)}小时${minutes % 60 ? `${minutes % 60}分` : ""}`;
}

function greetingForHour(hour: number): string {
  if (hour < 6) return "凌晨好";
  if (hour < 12) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

function webHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "网页链接"; }
}

function extractWebLinks(content: string): Array<{ label: string; url: string }> {
  const entries: Array<{ label: string; url: string }> = [];
  const seen = new Set<string>();
  const add = (label: string, rawUrl: string) => {
    const url = rawUrl.replace(/[)>\],，。；;]+$/, "");
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    entries.push({ label: label.trim().replace(/[*_`]/g, "").slice(0, 100), url });
  };
  for (const match of content.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g)) add(match[1], match[2]);
  for (const match of content.matchAll(/https?:\/\/[^\s<]+/g)) add("", match[0]);
  return entries;
}
