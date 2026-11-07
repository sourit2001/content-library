import {
  arrayBufferToBase64,
  Plugin,
  Notice,
  requestUrl,
  TAbstractFile,
  TFile,
  normalizePath,
} from "obsidian";
import { VaultContentIndexer } from "./indexer";
import { NOTE_SUFFIXES, dateLocale, noteSuffix, setLanguage, sourceLabel, t, timeLabel } from "./i18n";
import { AmbientPlayer } from "./ambient";
import { parseYouTubeUrl } from "./youtube";
import { fetchShowEpisodes, resolvePodcastLink, resolvePodcastShow, PODCAST_PLATFORM_LABELS, type PodcastEpisode } from "./podcast";
import { VIDEO_PLATFORM_LABELS, fetchVideoAspect, formatClock, resolveVideoLink, videoFromFrontmatter, type VideoInfo } from "./video";
import { ThemePackManager, ThemePackStoreModal, sanitizePack, type ThemePack } from "./packs";
import { ContentLibrarySettingsTab } from "./settings";
import { SupportModal } from "./support";
import { AIChatView, AI_CHAT_VIEW_TYPE } from "./ai-view";
import {
  ContentLibraryView,
  CONTENT_LIBRARY_VIEW_TYPE,
} from "./view";
import {
  DEFAULT_SETTINGS,
  type ContentItem,
  type ContentProgress,
  type ContentSource,
  type AnnotationHighlight,
  type DashboardSettings,
  type DashboardTheme,
  type MusicCollectionSnapshot,
  type MusicTrackSnapshot,
  type ThemeMode,
  type SourceGroup,
  type WebPreview,
} from "./types";

type SettingsHost = { setting?: { open(): void; openTabById(id: string): void } };

export type MusicTrack = MusicTrackSnapshot;

export interface NetEasePlaylist extends MusicCollectionSnapshot { tracks: MusicTrack[] }

type NetEaseSongPayload = { id?: number; name?: string; dt?: number; ar?: Array<{ name?: string }>; al?: { name?: string; picUrl?: string }; noCopyrightRcmd?: unknown };
/** st < 0: taken down / no copyright; pl 0: no playable quality for a guest (VIP or paid). */
type NetEasePrivilege = { id?: number; st?: number; pl?: number; fee?: number };

function netEaseSongPlayable(song: NetEaseSongPayload, privilege: NetEasePrivilege | undefined): boolean | undefined {
  if (song.noCopyrightRcmd) return false;
  if (!privilege) return undefined;
  if (typeof privilege.st === "number" && privilege.st < 0) return false;
  if (typeof privilege.pl === "number" && privilege.pl <= 0) return false;
  return true;
}

/** Followed shows are checked at most this often (ms). */
const PODCAST_CHECK_INTERVAL = 3 * 60 * 60 * 1000;
const PODCAST_MAX_NEW_PER_CHECK = 10;
const PODCAST_SEEN_LIMIT = 300;

export default class ContentLibraryDashboardPlugin extends Plugin {
  override settings: DashboardSettings = { ...DEFAULT_SETTINGS };
  indexer!: VaultContentIndexer;
  packs = new ThemePackManager(this);
  ambient = new AmbientPlayer(this);
  private refreshTimer: number | null = null;
  private webPreviewCache = new Map<string, Promise<WebPreview>>();
  private playlistCache = new Map<string, Promise<NetEasePlaylist | null>>();

  override async onload(): Promise<void> {
    this.indexer = new VaultContentIndexer(this.app);
    await this.loadSettings();
    setLanguage(this.settings.language);
    await this.saveData(this.settings);
    this.app.workspace.onLayoutReady(() => {
      const seededPodcasts = this.seedPodcastLinksSource();
      const seededVideos = this.seedVideoLinksSource();
      if (seededPodcasts || seededVideos) {
        void this.saveData(this.settings);
        this.refreshViews();
      }
      // Look for new episodes of followed shows shortly after start, then every few hours.
      window.setTimeout(() => void this.checkPodcastSubscriptions(), 20_000);
    });
    this.registerInterval(window.setInterval(() => void this.checkPodcastSubscriptions(), PODCAST_CHECK_INTERVAL));
    this.ambient.register();

    this.registerView(
      CONTENT_LIBRARY_VIEW_TYPE,
      (leaf) => new ContentLibraryView(leaf, this),
    );
    this.registerView(AI_CHAT_VIEW_TYPE, (leaf) => new AIChatView(leaf, this));
    this.addRibbonIcon("messages-square", t("AI 对话"), () => {
      void this.activateAIChat();
    });
    this.addCommand({
      id: "open-ai-chat",
      name: "Open AI chat",
      callback: () => void this.activateAIChat(),
    });
    this.addRibbonIcon("layout-dashboard", "Open Content Library", () => {
      void this.activateView();
    });
    this.addCommand({
      id: "open-dashboard",
      name: "Open dashboard",
      callback: () => void this.activateView(),
    });
    this.addCommand({
      id: "open-theme-packs",
      name: "Browse theme packs",
      callback: () => this.openPackStore(),
    });
    this.addCommand({
      id: "support-author",
      name: "Support the author",
      callback: () => this.openSupport(),
    });
    this.addSettingTab(new ContentLibrarySettingsTab(this.app, this));
    this.registerEvent(this.app.workspace.on("css-change", () => {
      // Pack palettes are resolved per light/dark mode in TS, so follow Obsidian's theme switch.
      if (this.settings.activePackId && this.settings.themeMode === "system") this.refreshViews();
    }));

    const onChange = (file: TAbstractFile) => {
      if (file instanceof TFile && file.extension !== "md" && !/\.(png|jpe?g|webp|gif|mp3|m4a|wav|flac|aac)$/i.test(file.path)) return;
      this.scheduleRefresh();
    };
    this.registerEvent(this.app.vault.on("create", onChange));
    this.registerEvent(this.app.vault.on("modify", onChange));
    this.registerEvent(this.app.vault.on("delete", onChange));
    this.registerEvent(this.app.vault.on("rename", onChange));
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      const file = (leaf?.view as { file?: unknown } | undefined)?.file;
      if (file instanceof TFile) void this.recordView(file);
      if (file instanceof TFile && this.isReadingFile(file)) void this.startContent(file);
    }));
  }

  override onunload(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
  }

  async activateView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(CONTENT_LIBRARY_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: CONTENT_LIBRARY_VIEW_TYPE, active: true });
    }
    void this.app.workspace.revealLeaf(leaf);
  }

  /** Open the dashboard and toggle its AI drawer. */
  async activateAIChat(): Promise<void> {
    // The chat now lives in the dashboard; close the old sidebar copy if one was restored.
    for (const leaf of this.app.workspace.getLeavesOfType(AI_CHAT_VIEW_TYPE)) leaf.detach();
    await this.activateView();
    const view = this.app.workspace.getLeavesOfType(CONTENT_LIBRARY_VIEW_TYPE)[0]?.view;
    if (view instanceof ContentLibraryView) view.toggleAI();
  }

  openSupport(): void {
    new SupportModal(this.app).open();
  }

  openPackStore(): void {
    new ThemePackStoreModal(this.app, this).open();
  }

  openSettingTab(): void {
    const host = this.app as unknown as SettingsHost;
    host.setting?.open();
    host.setting?.openTabById(this.manifest.id);
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<DashboardSettings> | null;
    const theme = (["grass", "blue", "pink", "rose", "black", "glass"] as DashboardTheme[]).includes(loaded?.theme as DashboardTheme)
      ? (loaded?.theme as DashboardTheme)
      : DEFAULT_SETTINGS.theme;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      theme,
      installedPacks: this.normalizeInstalledPacks(loaded?.installedPacks),
      activePackId: typeof loaded?.activePackId === "string" ? loaded.activePackId : "",
      licenses: loaded?.licenses && typeof loaded.licenses === "object" ? loaded.licenses : {},
      ambientVolume: typeof loaded?.ambientVolume === "number" && loaded.ambientVolume >= 0 && loaded.ambientVolume <= 1
        ? loaded.ambientVolume
        : DEFAULT_SETTINGS.ambientVolume,
      themeMode: (["system", "light", "dark"] as ThemeMode[]).includes(loaded?.themeMode as ThemeMode)
        ? loaded?.themeMode as ThemeMode
        : DEFAULT_SETTINGS.themeMode,
      annotationHighlight: (["yellow", "orange", "blue", "pink"] as AnnotationHighlight[]).includes(loaded?.annotationHighlight as AnnotationHighlight)
        ? loaded?.annotationHighlight as AnnotationHighlight
        : DEFAULT_SETTINGS.annotationHighlight,
      sources: Array.isArray(loaded?.sources)
        ? loaded.sources.map((source) => this.normalizeSource(source))
        : [],
      sourceGroupOrder: this.normalizeSourceGroupOrder(loaded?.sourceGroupOrder),
      coverOverrides: loaded?.coverOverrides && typeof loaded.coverOverrides === "object"
        ? loaded.coverOverrides
        : {},
      usageByDate: loaded?.usageByDate && typeof loaded.usageByDate === "object" ? loaded.usageByDate : {},
      viewHistory: loaded?.viewHistory && typeof loaded.viewHistory === "object" ? loaded.viewHistory : {},
      contentProgress: loaded?.contentProgress && typeof loaded.contentProgress === "object" ? loaded.contentProgress : {},
      musicCollectionSnapshots: loaded?.musicCollectionSnapshots && typeof loaded.musicCollectionSnapshots === "object"
        ? loaded.musicCollectionSnapshots
        : {},
      claimedThemes: Array.isArray(loaded?.claimedThemes)
        ? loaded.claimedThemes.filter((value): value is DashboardTheme => ["grass", "blue", "pink", "rose", "black", "glass"].includes(value))
        : [],
      podcastLinksSeeded: loaded?.podcastLinksSeeded === true,
      videoLinksSeeded: loaded?.videoLinksSeeded === true,
      podcastSubscriptions: Array.isArray(loaded?.podcastSubscriptions)
        ? loaded.podcastSubscriptions.filter((entry) => entry && typeof entry.url === "string")
          .map((entry) => ({ ...entry, seen: Array.isArray(entry.seen) ? entry.seen : [] }))
        : [],
      language: loaded?.language === "zh" || loaded?.language === "en" ? loaded.language : "auto",
      playbackMode: (["sequential", "list-loop", "single-loop", "shuffle"] as const).includes(
        loaded?.playbackMode as DashboardSettings["playbackMode"],
      ) ? loaded?.playbackMode as DashboardSettings["playbackMode"] : "sequential",
      aiProvider: (["claude", "codex", "grok", "deepseek"] as const).includes(loaded?.aiProvider as DashboardSettings["aiProvider"])
        ? loaded?.aiProvider as DashboardSettings["aiProvider"]
        : DEFAULT_SETTINGS.aiProvider,
      aiChatFolder: typeof loaded?.aiChatFolder === "string" && loaded.aiChatFolder.trim() ? loaded.aiChatFolder : DEFAULT_SETTINGS.aiChatFolder,
      aiAttachActiveNote: loaded?.aiAttachActiveNote === true,
      aiCliPaths: loaded?.aiCliPaths && typeof loaded.aiCliPaths === "object" ? loaded.aiCliPaths : {},
      aiCliModels: loaded?.aiCliModels && typeof loaded.aiCliModels === "object" ? loaded.aiCliModels : {},
      aiProxy: typeof loaded?.aiProxy === "string" ? loaded.aiProxy : "",
      deepseekApiKey: typeof loaded?.deepseekApiKey === "string" ? loaded.deepseekApiKey : "",
      deepseekModel: typeof loaded?.deepseekModel === "string" && loaded.deepseekModel ? loaded.deepseekModel : DEFAULT_SETTINGS.deepseekModel,
    };
    // Anyone already on the glass theme keeps it after it became a premium (limited-free) theme.
    if (this.settings.theme === "glass" && !this.settings.claimedThemes.includes("glass")) this.settings.claimedThemes.push("glass");
    // 音乐收藏 only needs pasted links: a music category without a folder gets one automatically.
    for (const source of this.settings.sources) {
      if ((source.kind === "music" || source.group === "music") && !source.folder.trim()) {
        source.folder = this.defaultMusicFolder(source.id);
        source.kind = "music";
        if (!source.icon || source.icon === "folder") source.icon = "music-2";
      }
    }
    const musicFolder = normalizePath("音乐收藏");
    const hasMusicFolder = Boolean(this.app.vault.getAbstractFileByPath(musicFolder));
    const hasMusicSource = this.settings.sources.some((source) => normalizePath(source.folder).replace(/\/$/, "") === musicFolder);
    if (hasMusicFolder && !hasMusicSource) {
      this.settings.sources.push({
        id: "source-music-collection",
        name: "音乐收藏",
        folder: musicFolder,
        kind: "music",
        group: "music",
        icon: "music-2",
        coverPath: "",
        enabled: true,
      });
    }
  }

  /**
   * Picks the folder a music category stores its link notes in when the user didn't choose one.
   * Prefers 音乐收藏; never takes a folder another category already uses or one holding audio.
   */
  defaultMusicFolder(excludeSourceId?: string): string {
    const used = new Set(this.settings.sources
      .filter((source) => source.id !== excludeSourceId && source.folder)
      .map((source) => normalizePath(source.folder).replace(/\/$/, "")));
    const base = normalizePath("音乐收藏");
    for (let index = 1; index < 100; index += 1) {
      const candidate = index === 1 ? base : `${base}-${index}`;
      if (!used.has(candidate) && this.indexer.sourceStats(candidate).audio === 0) return candidate;
    }
    return `${base}-${Date.now()}`;
  }

  /**
   * Adds the 播客收藏 category once. It gets its own folder: an existing folder that
   * holds audio or already belongs to another category is never reused.
   */
  private seedPodcastLinksSource(): boolean {
    if (this.settings.podcastLinksSeeded) return false;
    this.settings.podcastLinksSeeded = true;
    if (this.settings.sources.some((source) => source.kind === "podlink")) return true;
    const used = new Set(this.settings.sources.map((source) => normalizePath(source.folder).replace(/\/$/, "")));
    const folder = ["播客收藏", "播客链接", "Podcast Links"].map((name) => normalizePath(name)).find((candidate) => {
      if (used.has(candidate)) return false;
      return this.indexer.sourceStats(candidate).audio === 0;
    }) || normalizePath(`播客链接-${Date.now()}`);
    this.settings.sources.push({
      id: "source-podcast-links",
      name: "播客收藏",
      folder,
      kind: "podlink",
      group: "podlinks",
      icon: "podcast",
      coverPath: "",
      enabled: true,
    });
    return true;
  }

  /**
   * Adds the 视频收藏 category once, in its own folder (never one another category uses).
   */
  private seedVideoLinksSource(): boolean {
    if (this.settings.videoLinksSeeded) return false;
    this.settings.videoLinksSeeded = true;
    if (this.settings.sources.some((source) => source.kind === "video")) return true;
    this.settings.sources.push({
      id: "source-video-links",
      name: "视频收藏",
      folder: this.defaultVideoFolder(),
      kind: "video",
      group: "videos",
      icon: "clapperboard",
      coverPath: "",
      enabled: true,
    });
    return true;
  }

  /** Folder for a video category: 视频收藏, unless another category already uses it. */
  defaultVideoFolder(excludeSourceId?: string): string {
    const used = new Set(this.settings.sources
      .filter((source) => source.id !== excludeSourceId && source.folder)
      .map((source) => normalizePath(source.folder).replace(/\/$/, "")));
    const base = normalizePath("视频收藏");
    for (let index = 1; index < 100; index += 1) {
      const candidate = index === 1 ? base : `${base}-${index}`;
      if (!used.has(candidate)) return candidate;
    }
    return `${base}-${Date.now()}`;
  }

  private normalizeSourceGroupOrder(value: unknown): SourceGroup[] {
    const defaults: SourceGroup[] = ["podcast", "podlinks", "music", "videos", "information", "skills", "bookshelf", "ideas", "needs"];
    const requested = (Array.isArray(value) ? value : []).slice();
    // Older saved orders don't know 播客收藏 yet: put it right after the TTS podcast group.
    if (requested.length && !requested.includes("podlinks")) {
      const at = requested.indexOf("podcast");
      requested.splice(at >= 0 ? at + 1 : requested.length, 0, "podlinks");
    }
    // 视频收藏 is newer still: right after 音乐收藏.
    if (requested.length && !requested.includes("videos")) {
      const at = requested.indexOf("music");
      requested.splice(at >= 0 ? at + 1 : requested.length, 0, "videos");
    }
    return [...requested.filter((entry): entry is SourceGroup => defaults.includes(entry as SourceGroup)), ...defaults]
      .filter((entry, index, array) => array.indexOf(entry) === index)
      .slice(0, defaults.length);
  }

  private normalizeInstalledPacks(raw: unknown): Record<string, ThemePack> {
    const packs: Record<string, ThemePack> = {};
    if (!raw || typeof raw !== "object") return packs;
    for (const value of Object.values(raw as Record<string, unknown>)) {
      const pack = sanitizePack(value);
      if (pack) packs[pack.id] = pack;
    }
    return packs;
  }

  private normalizeSource(source: ContentSource): ContentSource {
    const folder = source.folder || "";
    const requestedKind = ["book", "podcast", "podlink", "music", "video", "x", "news", "clip", "generic"].includes(source.kind)
      ? source.kind
      : "generic";
    const isYouTubeArticleFolder = folder.split("/").pop()?.trim().toLowerCase() === "youtube podcast";
    return {
      id: source.id || `source-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: source.name || "New source",
      folder,
      kind: isYouTubeArticleFolder ? "generic" : requestedKind,
      group: (["information", "skills", "bookshelf", "ideas", "needs", "podcast", "podlinks", "music", "videos"] as SourceGroup[]).includes(source.group)
        ? source.group
        : this.inferSourceGroup(source),
      icon: source.icon || "folder",
      coverPath: source.coverPath || "",
      enabled: source.enabled !== false,
    };
  }

  async getNetEasePlaylist(url: string): Promise<NetEasePlaylist | null> {
    const programRadioId = url.match(/(?:djradio|dj)[^#?]*[?#]?(?:[^#]*&)?id=(\d+)/i)?.[1]
      || url.match(/#\/(?:djradio|dj)\?id=(\d+)/i)?.[1]
      || "";
    const playlistId = !programRadioId
      ? url.match(/[?&]id=(\d+)/i)?.[1] || url.match(/playlist[/:](\d+)/i)?.[1] || ""
      : "";
    const cacheKey = programRadioId ? `dj:${programRadioId}` : `playlist:${playlistId}`;
    if (!programRadioId && !playlistId) return null;
    const cached = this.playlistCache.get(cacheKey);
    if (cached) return cached;
    if (programRadioId) {
      const request = requestUrl({
        url: `https://music.163.com/api/dj/program/byradio?asc=false&limit=1000&radioId=${programRadioId}&offset=0`,
        headers: { Accept: "application/json", Referer: "https://music.163.com/" },
      }).then((response) => {
        const payload = JSON.parse(response.text) as { programs?: Array<{
          id?: number;
          name?: string;
          description?: string;
          coverUrl?: string;
          duration?: number;
          radio?: { name?: string; picUrl?: string };
          dj?: { nickname?: string };
        }> };
        const programs = payload.programs || [];
        if (!programs.length) return null;
        const radio = programs[0].radio;
        return {
          id: programRadioId,
          title: radio?.name || t("网易云播客"),
          cover: radio?.picUrl || programs[0].coverUrl || "",
          creator: radio?.name || t("网易云播客"),
          trackCount: programs.length,
          tracks: programs.map((program) => ({
            id: String(program.id || ""),
            title: program.name || t("未命名节目"),
            artist: program.dj?.nickname || radio?.name || t("网易云播客"),
            album: program.description || "",
            cover: program.coverUrl || radio?.picUrl || "",
            url: program.id ? `https://music.163.com/#/program?id=${program.id}` : "",
            duration: Number(program.duration || 0) || undefined,
          })),
          collectionType: "program" as const,
        };
      }).catch((error) => {
        console.warn("[Content Library] NetEase podcast sync failed", error);
        return null;
      });
      this.playlistCache.set(cacheKey, request);
      return request;
    }
    const request = requestUrl({
      url: `https://music.163.com/api/v6/playlist/detail?id=${playlistId}&s=0`,
      headers: { Accept: "application/json" },
    }).then(async (response) => {
      const payload = JSON.parse(response.text) as { playlist?: {
        id?: number;
        name?: string;
        coverImgUrl?: string;
        trackCount?: number;
        creator?: { nickname?: string };
        tracks?: NetEaseSongPayload[];
        trackIds?: Array<{ id?: number }>;
      }; privileges?: NetEasePrivilege[] };
      const playlist = payload.playlist;
      if (!playlist?.id || !playlist.name) return null;
      // Without a login, NetEase only returns the first few full tracks; the rest come as ids.
      const privileges = new Map<number, NetEasePrivilege>();
      for (const privilege of payload.privileges || []) if (typeof privilege.id === "number") privileges.set(privilege.id, privilege);
      const tracks = await this.completeNetEaseTracks(playlist.tracks || [], playlist.trackIds || [], privileges);
      return {
        id: String(playlist.id),
        title: playlist.name,
        cover: playlist.coverImgUrl || "",
        creator: playlist.creator?.nickname || t("网易云歌单"),
        trackCount: playlist.trackCount || playlist.tracks?.length || 0,
        tracks: tracks.map((track) => ({
          id: String(track.id || ""),
          title: track.name || t("未命名歌曲"),
          artist: (track.ar || []).map((artist) => artist.name).filter(Boolean).join(" / ") || t("未知歌手"),
          album: track.al?.name || "",
          cover: track.al?.picUrl || "",
          url: track.id ? `https://music.163.com/#/song?id=${track.id}` : "",
          duration: Number(track.dt || 0) || undefined,
          playable: netEaseSongPlayable(track, typeof track.id === "number" ? privileges.get(track.id) : undefined),
        })),
        collectionType: "playlist" as const,
      };
    }).catch((error) => {
      console.warn("[Content Library] NetEase playlist sync failed", error);
      return null;
    });
    this.playlistCache.set(cacheKey, request);
    return request;
  }

  /** Fills in the tracks NetEase only listed by id, in playlist order (up to 1000). */
  private async completeNetEaseTracks(tracks: NetEaseSongPayload[], trackIds: Array<{ id?: number }>, privileges: Map<number, NetEasePrivilege>): Promise<NetEaseSongPayload[]> {
    const ids = trackIds.map((entry) => entry.id).filter((id): id is number => typeof id === "number").slice(0, 1000);
    if (ids.length <= tracks.length) return tracks;
    const byId = new Map<number, NetEaseSongPayload>();
    for (const track of tracks) if (typeof track.id === "number") byId.set(track.id, track);
    const missing = ids.filter((id) => !byId.has(id));
    for (let start = 0; start < missing.length; start += 200) {
      const batch = missing.slice(start, start + 200);
      try {
        const response = await requestUrl({
          url: `https://music.163.com/api/v3/song/detail?c=${encodeURIComponent(JSON.stringify(batch.map((id) => ({ id }))))}`,
          headers: { Accept: "application/json", Referer: "https://music.163.com/" },
        });
        const payload = JSON.parse(response.text) as { songs?: NetEaseSongPayload[]; privileges?: NetEasePrivilege[] };
        for (const song of payload.songs || []) if (typeof song.id === "number") byId.set(song.id, song);
        for (const privilege of payload.privileges || []) if (typeof privilege.id === "number") privileges.set(privilege.id, privilege);
      } catch (error) {
        console.warn("[Content Library] NetEase track detail fetch failed", error);
        break;
      }
    }
    return ids.map((id) => byId.get(id)).filter((track): track is NetEaseSongPayload => Boolean(track));
  }

  async getQqPlaylist(url: string): Promise<NetEasePlaylist | null> {
    const playlistId = url.match(/[?&](?:id|disstid|playlistid)=(\d+)/i)?.[1]
      || url.match(/(?:playlist|gedan)[/:](\d+)/i)?.[1]
      || "";
    if (!playlistId) return null;
    const cacheKey = `qq:${playlistId}`;
    const cached = this.playlistCache.get(cacheKey);
    if (cached) return cached;
    const request = requestUrl({
      url: `https://i.y.qq.com/qzone-music/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&disstid=${playlistId}&format=json`,
      headers: {
        Accept: "application/json",
        Referer: "https://y.qq.com/",
        "User-Agent": "Mozilla/5.0",
      },
    }).then((response) => {
      const payload = JSON.parse(response.text) as { cdlist?: Array<{
        disstid?: string;
        dissname?: string;
        logo?: string;
        nick?: string;
        nickname?: string;
        songnum?: number;
        total_song_num?: number;
        songlist?: Array<{
          songid?: number;
          songmid?: string;
          songname?: string;
          albumname?: string;
          albummid?: string;
          singer?: Array<{ name?: string }>;
        }>;
      }> };
      const playlist = payload.cdlist?.[0];
      if (!playlist) return null;
      const tracks = playlist.songlist || [];
      return {
        id: playlist.disstid || playlistId,
        title: playlist.dissname || t("QQ音乐歌单"),
        cover: (playlist.logo || "").replace(/^http:/i, "https:"),
        creator: playlist.nickname || playlist.nick || t("QQ音乐"),
        trackCount: playlist.total_song_num || playlist.songnum || tracks.length,
        tracks: tracks.map((track) => ({
          id: track.songmid || String(track.songid || ""),
          title: track.songname || t("未命名歌曲"),
          artist: (track.singer || []).map((singer) => singer.name).filter(Boolean).join(" / ") || t("未知歌手"),
          album: track.albumname || "",
          cover: track.albummid ? `https://y.qq.com/music/photo_new/T002R300x300M000${track.albummid}.jpg` : "",
          url: track.songmid ? `https://y.qq.com/n/ryqq/songDetail/${track.songmid}` : url,
        })),
        collectionType: "playlist" as const,
      };
    }).catch((error) => {
      console.warn("[Content Library] QQ playlist sync failed", error);
      return null;
    });
    this.playlistCache.set(cacheKey, request);
    return request;
  }

  async getQqAlbum(url: string): Promise<NetEasePlaylist | null> {
    let albumId = url.match(/albumDetail[/:](\d+)/i)?.[1] || url.match(/[?&]albumId=(\d+)/i)?.[1] || "";
    if (!albumId) {
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
        albumId = canonical.match(/albumDetail[/:](\d+)/i)?.[1] || canonical.match(/[?&]albumId=(\d+)/i)?.[1] || "";
      } catch {
        return null;
      }
    }
    if (!albumId) return null;
    const cacheKey = `qq-album:${albumId}`;
    const cached = this.playlistCache.get(cacheKey);
    if (cached) return cached;
    const request = requestUrl({
      url: `https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg?albumid=${albumId}&format=json`,
      headers: {
        Accept: "application/json",
        Referer: "https://y.qq.com/",
        "User-Agent": "Mozilla/5.0",
      },
    }).then((response) => {
      const payload = JSON.parse(response.text) as { data?: {
        id?: number;
        cur_song_num?: number;
        company?: string;
        list?: Array<{
          songid?: number;
          songmid?: string;
          songname?: string;
          albumname?: string;
          albummid?: string;
          singer?: Array<{ name?: string }>;
        }>;
      } };
      const album = payload.data;
      const tracks = album?.list || [];
      if (!album || !tracks.length) return null;
      const albumMid = tracks[0].albummid || "";
      const albumTitle = tracks[0].albumname || t("QQ音乐专辑");
      const creator = (tracks[0].singer || []).map((singer) => singer.name).filter(Boolean).join(" / ") || album.company || t("QQ音乐");
      return {
        id: String(album.id || albumId),
        title: albumTitle,
        cover: albumMid ? `https://y.qq.com/music/photo_new/T002R300x300M000${albumMid}.jpg` : "",
        creator,
        trackCount: album.cur_song_num || tracks.length,
        tracks: tracks.map((track) => ({
          id: track.songmid || String(track.songid || ""),
          title: track.songname || t("未命名歌曲"),
          artist: (track.singer || []).map((singer) => singer.name).filter(Boolean).join(" / ") || t("未知歌手"),
          album: track.albumname || albumTitle,
          cover: track.albummid ? `https://y.qq.com/music/photo_new/T002R300x300M000${track.albummid}.jpg` : "",
          url: track.songmid ? `https://y.qq.com/n/ryqq/songDetail/${track.songmid}` : url,
        })),
        collectionType: "album" as const,
      };
    }).catch((error) => {
      console.warn("[Content Library] QQ album sync failed", error);
      return null;
    });
    this.playlistCache.set(cacheKey, request);
    return request;
  }

  async getYouTubeCollection(url: string): Promise<NetEasePlaylist | null> {
    const parsed = parseYouTubeUrl(url);
    if (!parsed) return null;
    const snapshot = this.settings.musicCollectionSnapshots[url];
    if (snapshot) return snapshot;
    const isPlaylist = !parsed.videoId && Boolean(parsed.listId);
    const canonical = parsed.videoId
      ? `https://www.youtube.com/watch?v=${parsed.videoId}`
      : `https://www.youtube.com/playlist?list=${parsed.listId}`;
    const fallbackCover = parsed.videoId ? `https://i.ytimg.com/vi/${parsed.videoId}/hqdefault.jpg` : "";
    const fallbackTitle = isPlaylist ? t("YouTube 播放列表") : t("YouTube 视频");
    let title = "";
    let creator = "";
    let cover = fallbackCover;
    try {
      const response = await requestUrl({
        url: `https://www.youtube.com/oembed?url=${encodeURIComponent(canonical)}&format=json`,
        headers: { Accept: "application/json" },
      });
      const payload = JSON.parse(response.text) as { title?: string; author_name?: string; thumbnail_url?: string };
      title = payload.title || "";
      creator = payload.author_name || "";
      cover = payload.thumbnail_url || fallbackCover;
    } catch (error) {
      console.warn("[Content Library] YouTube metadata fetch failed", error);
    }
    const collection: NetEasePlaylist = {
      id: parsed.videoId || parsed.listId,
      title: title || fallbackTitle,
      cover,
      creator: creator || "YouTube",
      trackCount: 1,
      tracks: [{
        id: parsed.videoId || parsed.listId,
        title: title || fallbackTitle,
        artist: creator || "YouTube",
        album: "",
        cover,
        url: canonical,
      }],
      collectionType: isPlaylist ? "playlist" : "video",
    };
    // Only remember real metadata, so a failed lookup (e.g. no network) is retried next time.
    return title ? this.rememberMusicCollection(url, collection) : collection;
  }

  async getQqMusicCollection(url: string): Promise<NetEasePlaylist | null> {
    const snapshot = this.settings.musicCollectionSnapshots[url];
    if (snapshot) {
      if (snapshot.cover.startsWith("data:image/")) return snapshot;
      return this.rememberMusicCollection(url, snapshot);
    }
    const collection = await this.getQqPlaylist(url) || await this.getQqAlbum(url) || await this.getQqSong(url);
    return collection ? this.rememberMusicCollection(url, collection) : null;
  }

  private async rememberMusicCollection(url: string, collection: NetEasePlaylist): Promise<NetEasePlaylist> {
    const remembered = {
      ...collection,
      cover: await this.cacheMusicCover(collection.cover),
      tracks: collection.tracks.map((track) => ({ ...track })),
    };
    this.settings.musicCollectionSnapshots[url] = remembered;
    const entries = Object.entries(this.settings.musicCollectionSnapshots);
    for (const [staleUrl] of entries.slice(0, Math.max(0, entries.length - 50))) {
      delete this.settings.musicCollectionSnapshots[staleUrl];
    }
    await this.saveSettings(false);
    return remembered;
  }

  private async cacheMusicCover(url: string): Promise<string> {
    if (!url || url.startsWith("data:image/")) return url;
    try {
      const response = await requestUrl({
        url,
        headers: {
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          Referer: "https://y.qq.com/",
          "User-Agent": "Mozilla/5.0",
        },
      });
      if (!response.arrayBuffer.byteLength || response.arrayBuffer.byteLength > 2_000_000) return url;
      const contentType = response.headers["content-type"]?.split(";")[0] || "image/jpeg";
      if (!contentType.startsWith("image/")) return url;
      return `data:${contentType};base64,${arrayBufferToBase64(response.arrayBuffer)}`;
    } catch (error) {
      console.warn("[Content Library] Music cover cache failed", error);
      return url;
    }
  }

  async getQqSong(url: string): Promise<NetEasePlaylist | null> {
    let songId = url.match(/songDetail[/:](\d+)/i)?.[1] || url.match(/[?&]songid=(\d+)/i)?.[1] || "";
    if (!songId) {
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
        songId = canonical.match(/songDetail[/:](\d+)/i)?.[1] || canonical.match(/[?&]songid=(\d+)/i)?.[1] || "";
      } catch {
        return null;
      }
    }
    if (!songId) return null;
    const cacheKey = `qq-song:${songId}`;
    const cached = this.playlistCache.get(cacheKey);
    if (cached) return cached;
    const request = requestUrl({
      url: `https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg?songid=${songId}&format=json`,
      headers: {
        Accept: "application/json",
        Referer: "https://y.qq.com/",
        "User-Agent": "Mozilla/5.0",
      },
    }).then((response) => {
      const payload = JSON.parse(response.text) as { data?: Array<{
        id?: number;
        mid?: string;
        name?: string;
        title?: string;
        singer?: Array<{ name?: string }>;
        album?: { name?: string; mid?: string };
      }> };
      const song = payload.data?.[0];
      if (!song) return null;
      const songMid = song.mid || "";
      const albumMid = song.album?.mid || "";
      const artist = (song.singer || []).map((singer) => singer.name).filter(Boolean).join(" / ") || t("未知歌手");
      const cover = albumMid ? `https://y.qq.com/music/photo_new/T002R300x300M000${albumMid}.jpg` : "";
      const title = song.title || song.name || t("QQ音乐单曲");
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
          url: songMid ? `https://y.qq.com/n/ryqq/songDetail/${songMid}` : url,
        }],
        collectionType: "song" as const,
      };
    }).catch((error) => {
      console.warn("[Content Library] QQ song sync failed", error);
      return null;
    });
    this.playlistCache.set(cacheKey, request);
    return request;
  }

  private inferSourceGroup(source: ContentSource): SourceGroup {
    const value = `${source.name || ""} ${source.folder || ""}`.toLowerCase();
    if (source.kind === "podlink") return "podlinks";
    if (source.kind === "video") return "videos";
    if (value.includes("tts audio") || source.kind === "podcast") return "podcast";
    if (value.includes("音乐") || value.includes("music") || source.kind === "music") return "music";
    if (value.includes("weave epub") || source.kind === "book") return "bookshelf";
    if (value.includes("github")) return "skills";
    if (value.includes("reddit") || value.includes("money radar")) return "needs";
    if (value.includes("x推送") || value.includes("youtube")) return "information";
    return "ideas";
  }

  todayUsageMinutes(): number {
    return this.settings.usageByDate[this.dateKey()] || 0;
  }

  async recordUsageMinute(): Promise<void> {
    const key = this.dateKey();
    this.settings.usageByDate[key] = (this.settings.usageByDate[key] || 0) + 1;
    const keys = Object.keys(this.settings.usageByDate).sort().reverse();
    for (const stale of keys.slice(31)) delete this.settings.usageByDate[stale];
    await this.saveSettings(false);
  }

  viewedAt(file: TFile | string): number {
    const path = typeof file === "string" ? file : file.path;
    return this.settings.viewHistory[path] || 0;
  }

  async recordView(file: TFile | string): Promise<void> {
    const path = typeof file === "string" ? file : file.path;
    const previous = this.settings.viewHistory[path] || 0;
    const now = Date.now();
    if (now - previous < 5_000) return;
    this.settings.viewHistory[path] = now;
    const paths = Object.keys(this.settings.viewHistory)
      .sort((a, b) => this.settings.viewHistory[b] - this.settings.viewHistory[a]);
    for (const stale of paths.slice(200)) delete this.settings.viewHistory[stale];
    await this.saveSettings(false);
  }

  contentProgress(file: TFile | string): ContentProgress | null {
    const path = typeof file === "string" ? file : file.path;
    return this.settings.contentProgress[path] || null;
  }

  async startContent(file: TFile | string): Promise<void> {
    if (this.contentProgress(file)) return;
    await this.setContentProgress(file, 1, false, true);
  }

  async setContentProgress(file: TFile | string, progress: number, complete = false, force = false): Promise<void> {
    const path = typeof file === "string" ? file : file.path;
    const previous = this.settings.contentProgress[path];
    if (previous?.state === "complete" && !force) return;
    const normalized = complete || progress >= 90 ? 100 : Math.max(1, Math.min(89, progress));
    const state: ContentProgress["state"] = normalized >= 90 ? "complete" : "in-progress";
    const now = Date.now();
    if (!force && previous
      && previous.state === state
      && Math.abs(previous.progress - normalized) < 2
      && now - previous.updated < 15_000) return;
    this.settings.contentProgress[path] = { state, progress: normalized, updated: now };
    const paths = Object.keys(this.settings.contentProgress)
      .sort((a, b) => this.settings.contentProgress[b].updated - this.settings.contentProgress[a].updated);
    for (const stale of paths.slice(500)) delete this.settings.contentProgress[stale];
    await this.saveSettings(false);
  }

  async markContentComplete(file: TFile | string): Promise<void> {
    await this.setContentProgress(file, 100, true, true);
  }

  async resetContentProgress(file: TFile | string): Promise<void> {
    const path = typeof file === "string" ? file : file.path;
    delete this.settings.contentProgress[path];
    await this.saveSettings(false);
  }

  private isReadingFile(file: TFile): boolean {
    if (file.extension !== "md") return false;
    return this.settings.sources.some((source) => {
      if (!source.enabled || source.kind === "podcast") return false;
      const folder = normalizePath(source.folder).replace(/\/$/, "");
      return Boolean(folder && (file.path === folder || file.path.startsWith(`${folder}/`)));
    });
  }

  async getWebPreview(url: string): Promise<WebPreview> {
    const normalized = url.trim();
    const existing = this.webPreviewCache.get(normalized);
    if (existing) return existing;
    const pending = this.fetchWebPreview(normalized);
    this.webPreviewCache.set(normalized, pending);
    return pending;
  }

  annotationFile(item: ContentItem): TFile | null {
    const folder = normalizePath(this.settings.annotationFolder || DEFAULT_SETTINGS.annotationFolder);
    const safeTitle = item.title.replace(/[\\/:*?"<>|#^[\]]/g, "-").slice(0, 80) || "Untitled";
    for (const suffix of NOTE_SUFFIXES) {
      const file = this.app.vault.getAbstractFileByPath(normalizePath(`${folder}/${safeTitle}${suffix}.md`));
      if (file instanceof TFile) return file;
    }
    return null;
  }

  private async fetchWebPreview(url: string): Promise<WebPreview> {
    const fallback = this.fallbackPreview(url);
    const youtubeId = this.youtubeId(url);
    if (youtubeId) return { ...fallback, image: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`, host: "YouTube" };
    try {
      const response = await requestUrl({
        url,
        method: "GET",
        headers: {
          Accept: "text/html",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
        },
      });
      const document = new DOMParser().parseFromString(response.text, "text/html");
      const meta = (selector: string) => document.querySelector(selector)?.getAttribute("content")?.trim() || "";
      const title = meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]') || document.title.trim();
      const description = meta('meta[property="og:description"]') || meta('meta[name="description"]') || meta('meta[name="twitter:description"]');
      const image = meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]');
      const canonical = meta('meta[property="og:url"]') || document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || "";
      const favicon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href || "";
      return {
        ...fallback,
        title: title || fallback.title,
        description,
        image: this.absoluteUrl(image, url) || this.qqMusicCoverUrl(url, canonical),
        favicon: this.absoluteUrl(favicon, url),
      };
    } catch {
      return fallback;
    }
  }

  private fallbackPreview(url: string): WebPreview {
    try {
      const parsed = new URL(url);
      return { url, title: parsed.hostname.replace(/^www\./, ""), description: "", host: parsed.hostname.replace(/^www\./, ""), image: "", favicon: `${parsed.origin}/favicon.ico` };
    } catch {
      return { url, title: t("网页链接"), description: "", host: t("网页"), image: "", favicon: "" };
    }
  }

  private absoluteUrl(value: string, origin: string): string {
    if (!value) return "";
    try { return new URL(value, origin).href; } catch { return ""; }
  }

  private qqMusicCoverUrl(sourceUrl: string, canonicalUrl: string): string {
    if (!/(?:y\.qq\.com|c6\.y\.qq\.com|i\.y\.qq\.com)/i.test(`${sourceUrl} ${canonicalUrl}`)) return "";
    const albumId = `${canonicalUrl} ${sourceUrl}`.match(/(?:albumDetail\/|albumId=|album\/)(\d+)/i)?.[1] || "";
    if (!albumId) return "";
    const bucket = String(Number(albumId) % 100);
    return `https://imgcache.qq.com/music/photo/album/${bucket}/albumpic_${albumId}_0.jpg`;
  }

  private youtubeId(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes("youtu.be")) return parsed.pathname.split("/").filter(Boolean)[0] || "";
      if (parsed.hostname.includes("youtube.com")) return parsed.searchParams.get("v") || parsed.pathname.match(/\/(?:shorts|embed)\/([^/?]+)/)?.[1] || "";
    } catch { return ""; }
    return "";
  }

  private dateKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  async saveSettings(refresh = true): Promise<void> {
    await this.saveData(this.settings);
    if (refresh) this.refreshViews();
  }

  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(CONTENT_LIBRARY_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof ContentLibraryView) void view.refresh();
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      this.refreshViews();
    }, 220);
  }

  async appendAnnotation(item: ContentItem, text: string, quote = "", time = ""): Promise<TFile | null> {
    const cleanText = text.trim();
    if (!cleanText && !quote.trim()) return null;
    const folder = normalizePath(this.settings.annotationFolder || DEFAULT_SETTINGS.annotationFolder);
    await this.ensureFolder(folder);
    const safeTitle = item.title.replace(/[\\/:*?"<>|#^[\]]/g, "-").slice(0, 80) || "Untitled";
    const existingNote = this.annotationFile(item);
    const path = existingNote?.path ?? normalizePath(`${folder}/${safeTitle}${noteSuffix()}.md`);
    const existing = existingNote ?? this.app.vault.getAbstractFileByPath(path);
    const heading = `## ${new Date().toLocaleString(dateLocale())}`;
    const source = `${sourceLabel()}[[${item.file.path}]]${item.externalUrl ? ` · ${item.externalUrl}` : ""}`;
    const timestamp = time ? `\n${timeLabel()}${time}` : "";
    const quotation = quote.trim() ? `\n\n> ${quote.trim().replace(/\n+/g, "\n> ")}` : "";
    const block = `${heading}\n\n${source}${timestamp}${quotation}${cleanText ? `\n\n${cleanText}` : ""}\n\n`;
    if (existing instanceof TFile) {
      await this.app.vault.append(existing, `\n${block}`);
      return existing;
    }
    return this.app.vault.create(path, `# ${item.title} · ${t("笔记")}\n\n${block}`);
  }

  async createNoteInSource(source: ContentSource, title: string): Promise<TFile> {
    const folder = normalizePath(source.folder);
    await this.ensureFolder(folder);
    const safeTitle = title.trim().replace(/[\\/:*?"<>|#^[\]]/g, "-").slice(0, 100) || t("未命名笔记");
    let path = normalizePath(`${folder}/${safeTitle}.md`);
    let counter = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${folder}/${safeTitle}-${counter}.md`);
      counter += 1;
    }
    const file = await this.app.vault.create(path, `# ${title.trim()}\n\n`);
    await this.app.workspace.getLeaf("tab").openFile(file, { state: { mode: "source" } });
    return file;
  }

  async createMusicPlaylistNote(source: ContentSource, url: string, title: string): Promise<TFile> {
    const folder = normalizePath(source.folder);
    await this.ensureFolder(folder);
    const safeTitle = title.trim().replace(/[\\/:*?"<>|#^[\]]/g, "-").slice(0, 100) || t("网易云歌单");
    let path = normalizePath(`${folder}/${safeTitle}.md`);
    let counter = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${folder}/${safeTitle}-${counter}.md`);
      counter += 1;
    }
    const content = `---\ntitle: ${JSON.stringify(title.trim() || t("网易云歌单"))}\nplaylist_url: ${url.trim()}\n---\n`;
    return this.app.vault.create(path, content);
  }

  /** Looks up a podcast link and saves the episode (audio + show notes) as a note in the source folder. */
  async createPodcastEpisodeNote(source: ContentSource, link: string): Promise<{ file: TFile; episode: PodcastEpisode }> {
    const episode = await resolvePodcastLink(link);
    const existing = this.findPodcastEpisodeNote(source, episode);
    if (existing && !episode.fromShowLink) return { file: existing, episode };
    return { file: await this.writePodcastEpisodeNote(source, episode), episode };
  }

  private findPodcastEpisodeNote(source: ContentSource, episode: PodcastEpisode): TFile | null {
    const folder = normalizePath(source.folder);
    return this.app.vault.getMarkdownFiles().find((file) => {
      if (!file.path.startsWith(`${folder}/`)) return false;
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (episode.key && frontmatter?.episode_key === episode.key) return true;
      return !episode.fromShowLink && typeof frontmatter?.podcast_url === "string" && frontmatter.podcast_url.trim() === episode.url;
    }) ?? null;
  }

  private async writePodcastEpisodeNote(source: ContentSource, episode: PodcastEpisode): Promise<TFile> {
    const folder = normalizePath(source.folder);
    await this.ensureFolder(folder);
    const title = episode.title || t("未命名单集");
    const safeTitle = title.replace(/[\\/:*?"<>|#^[\]]/g, "-").slice(0, 100).trim() || t("未命名单集");
    let path = normalizePath(`${folder}/${safeTitle}.md`);
    let counter = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${folder}/${safeTitle}-${counter}.md`);
      counter += 1;
    }
    const fields: Array<[string, string | number]> = [
      ["title", title],
      ["podcast", episode.show],
      ["platform", PODCAST_PLATFORM_LABELS[episode.platform]],
      ["podcast_url", episode.url],
      ["episode_key", episode.key],
      ["audio_url", episode.audioUrl],
      ["cover", episode.cover],
      ["published", episode.published],
      ["duration", episode.duration],
    ];
    const yaml = fields
      .filter(([, value]) => value !== "" && value !== 0)
      .map(([key, value]) => `${key}: ${typeof value === "number" ? value : JSON.stringify(value)}`)
      .join("\n");
    const body = episode.notes.trim() || t("这一期没有 show notes。");
    return this.app.vault.create(path, `---\n${yaml}\n---\n\n${body}\n`);
  }

  /** Looks up a YouTube / Bilibili link and saves it as a video note (chapters + description). */
  async createVideoNote(source: ContentSource, link: string, title = ""): Promise<{ file: TFile; video: VideoInfo; existed: boolean }> {
    const video = await resolveVideoLink(link, title);
    const existing = this.findVideoNote(source, video);
    if (existing) return { file: existing, video, existed: true };
    return { file: await this.writeVideoNote(source, video), video, existed: false };
  }

  private findVideoNote(source: ContentSource, video: VideoInfo): TFile | null {
    const folder = normalizePath(source.folder);
    return this.app.vault.getMarkdownFiles().find((file) => {
      if (!file.path.startsWith(`${folder}/`)) return false;
      return this.app.metadataCache.getFileCache(file)?.frontmatter?.video_key === video.key;
    }) ?? null;
  }

  private async writeVideoNote(source: ContentSource, video: VideoInfo): Promise<TFile> {
    const folder = normalizePath(source.folder);
    await this.ensureFolder(folder);
    const title = video.title || t("未命名视频");
    const safeTitle = title.replace(/[\\/:*?"<>|#^[\]]/g, "-").slice(0, 100).trim() || t("未命名视频");
    let path = normalizePath(`${folder}/${safeTitle}.md`);
    let counter = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${folder}/${safeTitle}-${counter}.md`);
      counter += 1;
    }
    const cover = video.platform === "bilibili" ? await this.saveVideoCover(folder, video) : video.cover;
    const summarySource = video.chapters.length ? "creator_chapters" : "none";
    const fields: Array<[string, string | number]> = [
      ["type", "video"],
      ["title", title],
      ["platform", video.platform],
      ["url", video.url],
      ["video_id", video.videoId],
      ["part", video.part > 1 ? video.part : 0],
      ["video_key", video.key],
      ["author", video.author],
      ["cover", cover],
      ["duration", video.duration ? formatClock(video.duration) : ""],
      ["aspect", video.aspect],
      ["published", video.published],
      ["summary_source", summarySource],
      ["added", this.dateKey()],
    ];
    const yaml = fields
      .filter(([, value]) => value !== "" && value !== 0)
      .map(([key, value]) => `${key}: ${typeof value === "number" ? value : JSON.stringify(value)}`)
      .join("\n");
    const points = video.chapters.length
      ? [
        `> ${video.chapterSource === "platform" ? t("要点来自创作者设置的章节") : t("要点来自简介里创作者写的时间戳")}`,
        "",
        ...video.chapters.map((chapter) => `- [${formatClock(chapter.start)}] ${chapter.title.replace(/\s+/g, " ")}`),
      ].join("\n")
      : video.platform === "quark"
      ? `> ${t("网盘视频没有章节。在下面“我的笔记”里写 [12:30] 这样的时间戳，点一下就能跳过去。")}`
      : `> ${t("无要点：这个视频没有创作者章节。")}`;
    const description = video.description.trim()
      ? video.description.trim().replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd()).join("  \n")
      : video.platform === "quark" ? t("（网盘视频没有简介）") : t("（这个视频没有简介）");
    const platform = VIDEO_PLATFORM_LABELS[video.platform];
    const body = [
      `## ${t("要点")}`,
      points,
      "",
      `## ${t("简介原文")}`,
      `*${platform}${video.author ? ` · ${video.author}` : ""}*`,
      "",
      description,
      "",
      `## ${t("我的笔记")}`,
      "",
    ].join("\n");
    return this.app.vault.create(path, `---\n${yaml}\n---\n\n${body}\n`);
  }

  private aspectLookups = new Map<string, Promise<number>>();

  /** Saves the file name read from Quark's player page as the title of a 夸克网盘 video note. */
  async setVideoTitle(file: TFile, title: string): Promise<void> {
    const clean = title.trim();
    if (!clean) return;
    await this.app.fileManager.processFrontMatter(file, (data: Record<string, unknown>) => { data.title = clean; });
  }

  /** Picture shape (width ÷ height) of a video note; looked up once and saved for notes made before it was recorded. */
  videoAspect(file: TFile): Promise<number> {
    const frontmatter = (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
    const saved = Number(frontmatter.aspect);
    if (saved > 0) return Promise.resolve(saved);
    const pending = this.aspectLookups.get(file.path);
    if (pending) return pending;
    const video = videoFromFrontmatter(frontmatter);
    if (!video) return Promise.resolve(0);
    const lookup = fetchVideoAspect(video.platform, video.videoId, video.part).then(async (aspect) => {
      if (aspect > 0) await this.app.fileManager.processFrontMatter(file, (data: Record<string, unknown>) => { data.aspect = aspect; });
      return aspect;
    }).catch((error) => {
      console.warn("[Content Library] Video size lookup failed", error);
      this.aspectLookups.delete(file.path);
      return 0;
    });
    this.aspectLookups.set(file.path, lookup);
    return lookup;
  }

  /** Bilibili covers refuse other sites' referers, so a copy is kept next to the notes. */
  private async saveVideoCover(folder: string, video: VideoInfo): Promise<string> {
    if (!video.cover) return "";
    try {
      const response = await requestUrl({
        url: video.cover.includes("@") ? video.cover : `${video.cover}@640w_400h_1c.jpg`,
        headers: { Referer: "https://www.bilibili.com/", "User-Agent": "Mozilla/5.0" },
      });
      const type = response.headers["content-type"]?.split(";")[0] || "";
      if (!type.startsWith("image/") || !response.arrayBuffer.byteLength) return video.cover;
      const extension = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
      const coverFolder = normalizePath(`${folder}/covers`);
      await this.ensureFolder(coverFolder);
      const path = normalizePath(`${coverFolder}/${video.key.replace(/[^\w-]+/g, "-")}.${extension}`);
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) await this.app.vault.modifyBinary(existing, response.arrayBuffer);
      else await this.app.vault.createBinary(path, response.arrayBuffer);
      return path;
    } catch (error) {
      console.warn("[Content Library] Bilibili cover download failed", error);
      return video.cover;
    }
  }

  /** Moves a podcast episode note to the trash (recoverable). Followed shows won't re-add it. */
  async deletePodcastEpisodeNote(file: TFile): Promise<void> {
    await this.app.fileManager.trashFile(file);
  }

  /** Follows a show: saves its newest episode now and pulls later ones as they come out. */
  async subscribePodcast(source: ContentSource, link: string): Promise<{ title: string; added: number }> {
    const show = await resolvePodcastShow(link);
    const known = this.settings.podcastSubscriptions.find((entry) => entry.url === show.url || (show.feedUrl && entry.feedUrl === show.feedUrl));
    if (known) return { title: known.title, added: 0 };
    let added = 0;
    const latest = show.episodes[0];
    if (latest && !this.findPodcastEpisodeNote(source, latest)) {
      await this.writePodcastEpisodeNote(source, latest);
      added = 1;
    }
    this.settings.podcastSubscriptions.push({
      id: `show-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      url: show.url,
      platform: show.platform,
      title: show.title || latest?.show || t("未命名节目"),
      author: show.author,
      cover: show.cover || latest?.cover || "",
      feedUrl: show.feedUrl,
      sourceId: source.id,
      // Everything already out counts as seen: following starts from the newest episode.
      seen: show.episodes.map((episode) => episode.key).filter(Boolean).slice(0, PODCAST_SEEN_LIMIT),
      added: Date.now(),
      lastChecked: Date.now(),
    });
    await this.saveSettings(false);
    return { title: show.title, added };
  }

  async unsubscribePodcast(id: string): Promise<void> {
    this.settings.podcastSubscriptions = this.settings.podcastSubscriptions.filter((entry) => entry.id !== id);
    await this.saveSettings(false);
  }

  private podcastCheckRunning: Promise<number> | null = null;

  /**
   * Pulls new episodes of followed shows. Without `force`, shows checked in the last few hours
   * are skipped. `onlyId` checks one show. Returns how many episodes were added.
   */
  checkPodcastSubscriptions(force = false, onlyId = ""): Promise<number> {
    if (this.podcastCheckRunning) return this.podcastCheckRunning;
    const run = this.runPodcastCheck(force, onlyId).finally(() => { this.podcastCheckRunning = null; });
    this.podcastCheckRunning = run;
    return run;
  }

  private async runPodcastCheck(force: boolean, onlyId: string): Promise<number> {
    const due = this.settings.podcastSubscriptions.filter((entry) => (
      (!onlyId || entry.id === onlyId) && (force || Date.now() - (entry.lastChecked || 0) > PODCAST_CHECK_INTERVAL)
    ));
    if (!due.length) return 0;
    let added = 0;
    const names: string[] = [];
    for (const subscription of due) {
      const source = this.settings.sources.find((entry) => entry.id === subscription.sourceId && entry.kind === "podlink")
        || this.settings.sources.find((entry) => entry.kind === "podlink");
      if (!source) continue;
      try {
        const episodes = await fetchShowEpisodes(subscription);
        const seen = new Set(subscription.seen);
        // Oldest first, so the notes are created in release order.
        const fresh = episodes.filter((episode) => episode.key && !seen.has(episode.key)).slice(0, PODCAST_MAX_NEW_PER_CHECK).reverse();
        for (const episode of fresh) {
          if (!this.findPodcastEpisodeNote(source, episode)) {
            await this.writePodcastEpisodeNote(source, episode);
            added += 1;
            if (!names.includes(subscription.title)) names.push(subscription.title);
          }
        }
        subscription.seen = [...episodes.map((episode) => episode.key), ...subscription.seen]
          .filter((key, index, list) => key && list.indexOf(key) === index)
          .slice(0, PODCAST_SEEN_LIMIT);
        if (!subscription.cover && episodes[0]?.cover) subscription.cover = episodes[0].cover;
      } catch (error) {
        console.warn(`[Content Library] Checking ${subscription.title} failed`, error);
      }
      subscription.lastChecked = Date.now();
    }
    await this.saveSettings(false);
    if (added) {
      new Notice(t("播客更新：{shows} 有 {count} 期新节目", { shows: names.join("、"), count: added }), 6000);
      this.refreshViews();
    }
    return added;
  }

  /** Moves a music collection note to the trash (recoverable) and forgets its cached snapshot. */
  async deleteMusicPlaylistNote(file: TFile, url: string): Promise<void> {
    if (url && this.settings.musicCollectionSnapshots[url]) {
      delete this.settings.musicCollectionSnapshots[url];
      await this.saveSettings(false);
    }
    await this.app.fileManager.trashFile(file);
  }

  /** Song length in ms from NetEase, or 0 when unknown. */
  async getNetEaseSongDuration(songId: string): Promise<number> {
    try {
      const response = await requestUrl({
        url: `https://music.163.com/api/song/detail/?id=${songId}&ids=%5B${songId}%5D`,
        headers: { Accept: "application/json", Referer: "https://music.163.com/" },
      });
      const payload = JSON.parse(response.text) as { songs?: Array<{ duration?: number; dt?: number }> };
      const song = payload.songs?.[0];
      return Number(song?.duration || song?.dt || 0);
    } catch (error) {
      console.warn("[Content Library] NetEase song duration lookup failed", error);
      return 0;
    }
  }

  async renameMusicPlaylistNote(file: TFile, title: string): Promise<void> {
    const nextTitle = title.trim();
    if (!nextTitle) throw new Error(t("名称不能为空。"));
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      Object.assign(frontmatter, { title: nextTitle });
    });
  }

  async setCoverOverride(item: ContentItem, path: string): Promise<void> {
    if (path.trim()) this.settings.coverOverrides[item.file.path] = path.trim();
    else delete this.settings.coverOverrides[item.file.path];
    await this.saveSettings();
  }

  async importImage(file: File, group: "Banners" | "Covers" = "Covers"): Promise<string> {
    if (!/^image\/(png|jpeg|webp|gif)$/i.test(file.type) && !/\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
      throw new Error(t("请选择 PNG、JPG、WEBP 或 GIF 图片。"));
    }
    const folder = normalizePath(`Content Library Assets/${group}`);
    await this.ensureFolder(folder);
    const extension = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || "jpg").toLowerCase();
    const stem = file.name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9\u4e00-\u9fff_-]+/gi, "-").slice(0, 60) || "image";
    let path = normalizePath(`${folder}/${stem}.${extension}`);
    let counter = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${folder}/${stem}-${counter}.${extension}`);
      counter += 1;
    }
    await this.app.vault.createBinary(path, await file.arrayBuffer());
    return path;
  }

  private async ensureFolder(path: string): Promise<void> {
    if (!path || this.app.vault.getAbstractFileByPath(path)) return;
    const segments = path.split("/").filter(Boolean);
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }
}
