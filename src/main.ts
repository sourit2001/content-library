import {
  arrayBufferToBase64,
  Plugin,
  requestUrl,
  TAbstractFile,
  TFile,
  normalizePath,
} from "obsidian";
import { VaultContentIndexer } from "./indexer";
import { NOTE_SUFFIXES, dateLocale, noteSuffix, setLanguage, sourceLabel, t, timeLabel } from "./i18n";
import { AmbientPlayer } from "./ambient";
import { parseYouTubeUrl } from "./youtube";
import { resolvePodcastLink, PODCAST_PLATFORM_LABELS, type PodcastEpisode } from "./podcast";
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

export default class ContentLibraryDashboardPlugin extends Plugin {
  override settings: DashboardSettings = { ...DEFAULT_SETTINGS };
  indexer!: VaultContentIndexer;
  packs = new ThemePackManager(this);
  ambient = new AmbientPlayer(this);
  private refreshTimer: number | null = null;
  private webPreviewCache = new Map<string, Promise<WebPreview>>();
  private playlistCache = new Map<string, Promise<NetEasePlaylist | null>>();

  override async onload(): Promise<void> {
    await this.loadSettings();
    setLanguage(this.settings.language);
    await this.saveData(this.settings);
    this.indexer = new VaultContentIndexer(this.app);
    this.app.workspace.onLayoutReady(() => {
      if (!this.seedPodcastLinksSource()) return;
      void this.saveData(this.settings);
      this.refreshViews();
    });
    this.ambient.register();

    this.registerView(
      CONTENT_LIBRARY_VIEW_TYPE,
      (leaf) => new ContentLibraryView(leaf, this),
    );
    this.registerView(AI_CHAT_VIEW_TYPE, (leaf) => new AIChatView(leaf, this));
    this.addRibbonIcon("bot-message-square", t("AI 对话"), () => {
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

  async activateAIChat(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(AI_CHAT_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf("split");
      await leaf.setViewState({ type: AI_CHAT_VIEW_TYPE, active: true });
    }
    void this.app.workspace.revealLeaf(leaf);
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

  private normalizeSourceGroupOrder(value: unknown): SourceGroup[] {
    const defaults: SourceGroup[] = ["podcast", "podlinks", "music", "information", "skills", "bookshelf", "ideas", "needs"];
    const requested = (Array.isArray(value) ? value : []).slice();
    // Older saved orders don't know 播客收藏 yet: put it right after the TTS podcast group.
    if (requested.length && !requested.includes("podlinks")) {
      const at = requested.indexOf("podcast");
      requested.splice(at >= 0 ? at + 1 : requested.length, 0, "podlinks");
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
    const requestedKind = ["book", "podcast", "podlink", "music", "x", "news", "clip", "generic"].includes(source.kind)
      ? source.kind
      : "generic";
    const isYouTubeArticleFolder = folder.split("/").pop()?.trim().toLowerCase() === "youtube podcast";
    return {
      id: source.id || `source-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: source.name || "New source",
      folder,
      kind: isYouTubeArticleFolder ? "generic" : requestedKind,
      group: (["information", "skills", "bookshelf", "ideas", "needs", "podcast", "podlinks", "music"] as SourceGroup[]).includes(source.group)
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
    const folder = normalizePath(source.folder);
    await this.ensureFolder(folder);
    const existing = this.app.vault.getMarkdownFiles().find((file) => {
      if (!file.path.startsWith(`${folder}/`)) return false;
      const saved = this.app.metadataCache.getFileCache(file)?.frontmatter?.podcast_url;
      return typeof saved === "string" && saved.trim() === episode.url;
    });
    if (existing && !episode.fromShowLink) return { file: existing, episode };
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
    const file = await this.app.vault.create(path, `---\n${yaml}\n---\n\n${body}\n`);
    return { file, episode };
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
