import {
  arrayBufferToBase64,
  Plugin,
  requestUrl,
  TAbstractFile,
  TFile,
  normalizePath,
} from "obsidian";
import { VaultContentIndexer } from "./indexer";
import { ContentLibrarySettingsTab } from "./settings";
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

export default class ContentLibraryDashboardPlugin extends Plugin {
  override settings: DashboardSettings = { ...DEFAULT_SETTINGS };
  indexer!: VaultContentIndexer;
  private refreshTimer: number | null = null;
  private webPreviewCache = new Map<string, Promise<WebPreview>>();
  private playlistCache = new Map<string, Promise<NetEasePlaylist | null>>();

  override async onload(): Promise<void> {
    await this.loadSettings();
    await this.saveData(this.settings);
    this.indexer = new VaultContentIndexer(this.app);

    this.registerView(
      CONTENT_LIBRARY_VIEW_TYPE,
      (leaf) => new ContentLibraryView(leaf, this),
    );
    this.addRibbonIcon("layout-dashboard", "Open Content Library", () => {
      void this.activateView();
    });
    this.addCommand({
      id: "open-dashboard",
      name: "Open dashboard",
      callback: () => void this.activateView(),
    });
    this.addSettingTab(new ContentLibrarySettingsTab(this.app, this));

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

  openSettingTab(): void {
    const host = this.app as unknown as SettingsHost;
    host.setting?.open();
    host.setting?.openTabById(this.manifest.id);
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<DashboardSettings> | null;
    const theme = (["grass", "blue", "pink", "rose", "black"] as DashboardTheme[]).includes(loaded?.theme as DashboardTheme)
      ? (loaded?.theme as DashboardTheme)
      : DEFAULT_SETTINGS.theme;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      theme,
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
      playbackMode: (["sequential", "list-loop", "single-loop", "shuffle"] as const).includes(
        loaded?.playbackMode as DashboardSettings["playbackMode"],
      ) ? loaded?.playbackMode as DashboardSettings["playbackMode"] : "sequential",
    };
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

  private normalizeSourceGroupOrder(value: unknown): SourceGroup[] {
    const defaults: SourceGroup[] = ["podcast", "music", "information", "skills", "bookshelf", "ideas", "needs"];
    const requested = Array.isArray(value) ? value : [];
    return [...requested.filter((entry): entry is SourceGroup => defaults.includes(entry as SourceGroup)), ...defaults]
      .filter((entry, index, array) => array.indexOf(entry) === index)
      .slice(0, defaults.length);
  }

  private normalizeSource(source: ContentSource): ContentSource {
    const folder = source.folder || "";
    const requestedKind = ["book", "podcast", "music", "x", "news", "clip", "generic"].includes(source.kind)
      ? source.kind
      : "generic";
    const isYouTubeArticleFolder = folder.split("/").pop()?.trim().toLowerCase() === "youtube podcast";
    return {
      id: source.id || `source-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: source.name || "New source",
      folder,
      kind: isYouTubeArticleFolder ? "generic" : requestedKind,
      group: (["information", "skills", "bookshelf", "ideas", "needs", "podcast", "music"] as SourceGroup[]).includes(source.group)
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
          radio?: { name?: string; picUrl?: string };
          dj?: { nickname?: string };
        }> };
        const programs = payload.programs || [];
        if (!programs.length) return null;
        const radio = programs[0].radio;
        return {
          id: programRadioId,
          title: radio?.name || "网易云播客",
          cover: radio?.picUrl || programs[0].coverUrl || "",
          creator: radio?.name || "网易云播客",
          trackCount: programs.length,
          tracks: programs.map((program) => ({
            id: String(program.id || ""),
            title: program.name || "未命名节目",
            artist: program.dj?.nickname || radio?.name || "网易云播客",
            album: program.description || "",
            cover: program.coverUrl || radio?.picUrl || "",
            url: program.id ? `https://music.163.com/#/program?id=${program.id}` : "",
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
    }).then((response) => {
      const payload = JSON.parse(response.text) as { playlist?: {
        id?: number;
        name?: string;
        coverImgUrl?: string;
        trackCount?: number;
        creator?: { nickname?: string };
        tracks?: Array<{ id?: number; name?: string; ar?: Array<{ name?: string }>; al?: { name?: string; picUrl?: string } }>;
      } };
      const playlist = payload.playlist;
      if (!playlist?.id || !playlist.name) return null;
      return {
        id: String(playlist.id),
        title: playlist.name,
        cover: playlist.coverImgUrl || "",
        creator: playlist.creator?.nickname || "网易云歌单",
        trackCount: playlist.trackCount || playlist.tracks?.length || 0,
        tracks: (playlist.tracks || []).map((track) => ({
          id: String(track.id || ""),
          title: track.name || "未命名歌曲",
          artist: (track.ar || []).map((artist) => artist.name).filter(Boolean).join(" / ") || "未知歌手",
          album: track.al?.name || "",
          cover: track.al?.picUrl || "",
          url: track.id ? `https://music.163.com/#/song?id=${track.id}` : "",
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
        title: playlist.dissname || "QQ音乐歌单",
        cover: (playlist.logo || "").replace(/^http:/i, "https:"),
        creator: playlist.nickname || playlist.nick || "QQ音乐",
        trackCount: playlist.total_song_num || playlist.songnum || tracks.length,
        tracks: tracks.map((track) => ({
          id: track.songmid || String(track.songid || ""),
          title: track.songname || "未命名歌曲",
          artist: (track.singer || []).map((singer) => singer.name).filter(Boolean).join(" / ") || "未知歌手",
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
      const albumTitle = tracks[0].albumname || "QQ音乐专辑";
      const creator = (tracks[0].singer || []).map((singer) => singer.name).filter(Boolean).join(" / ") || album.company || "QQ音乐";
      return {
        id: String(album.id || albumId),
        title: albumTitle,
        cover: albumMid ? `https://y.qq.com/music/photo_new/T002R300x300M000${albumMid}.jpg` : "",
        creator,
        trackCount: album.cur_song_num || tracks.length,
        tracks: tracks.map((track) => ({
          id: track.songmid || String(track.songid || ""),
          title: track.songname || "未命名歌曲",
          artist: (track.singer || []).map((singer) => singer.name).filter(Boolean).join(" / ") || "未知歌手",
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
      const artist = (song.singer || []).map((singer) => singer.name).filter(Boolean).join(" / ") || "未知歌手";
      const cover = albumMid ? `https://y.qq.com/music/photo_new/T002R300x300M000${albumMid}.jpg` : "";
      const title = song.title || song.name || "QQ音乐单曲";
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
    const file = this.app.vault.getAbstractFileByPath(normalizePath(`${folder}/${safeTitle}-笔记.md`));
    return file instanceof TFile ? file : null;
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
      return { url, title: "网页链接", description: "", host: "网页", image: "", favicon: "" };
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
    const path = normalizePath(`${folder}/${safeTitle}-笔记.md`);
    const existing = this.app.vault.getAbstractFileByPath(path);
    const heading = `## ${new Date().toLocaleString()}`;
    const source = `来源：[[${item.file.path}]]${item.externalUrl ? ` · ${item.externalUrl}` : ""}`;
    const timestamp = time ? `\n时间：${time}` : "";
    const quotation = quote.trim() ? `\n\n> ${quote.trim().replace(/\n+/g, "\n> ")}` : "";
    const block = `${heading}\n\n${source}${timestamp}${quotation}${cleanText ? `\n\n${cleanText}` : ""}\n\n`;
    if (existing instanceof TFile) {
      await this.app.vault.append(existing, `\n${block}`);
      return existing;
    }
    return this.app.vault.create(path, `# ${item.title} · 笔记\n\n${block}`);
  }

  async createNoteInSource(source: ContentSource, title: string): Promise<TFile> {
    const folder = normalizePath(source.folder);
    await this.ensureFolder(folder);
    const safeTitle = title.trim().replace(/[\\/:*?"<>|#^[\]]/g, "-").slice(0, 100) || "未命名笔记";
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
    const safeTitle = title.trim().replace(/[\\/:*?"<>|#^[\]]/g, "-").slice(0, 100) || "网易云歌单";
    let path = normalizePath(`${folder}/${safeTitle}.md`);
    let counter = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${folder}/${safeTitle}-${counter}.md`);
      counter += 1;
    }
    const content = `---\ntitle: ${JSON.stringify(title.trim() || "网易云歌单")}\nplaylist_url: ${url.trim()}\n---\n`;
    return this.app.vault.create(path, content);
  }

  async renameMusicPlaylistNote(file: TFile, title: string): Promise<void> {
    const nextTitle = title.trim();
    if (!nextTitle) throw new Error("名称不能为空。");
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
      throw new Error("请选择 PNG、JPG、WEBP 或 GIF 图片。");
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
