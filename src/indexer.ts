import { App, normalizePath, TFile } from "obsidian";
import type { ContentItem, ContentSource, SourceKind } from "./types";

const AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "wav", "flac", "aac", "ogg", "opus"]);

function cleanLink(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^!\[\[/, "").replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0];
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const found = value.find((entry) => typeof entry === "string" && entry.trim());
      if (typeof found === "string") return found.trim();
    }
  }
  return "";
}

function parseProgress(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, value <= 1 ? value * 100 : value));
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace("%", ""));
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(100, parsed <= 1 ? parsed * 100 : parsed));
  }
  return 0;
}

function cleanAudioTitle(value: string): string {
  return value
    .replace(/-20\d{2}-\d{2}-\d{2}T\d{2}[-:]\d{2}[-:]\d{2}(?:\.\d+Z?)?$/i, "")
    .replace(/[-_]+$/, "")
    .trim();
}

export class VaultContentIndexer {
  constructor(private app: App) {}

  sourceStats(folderPath: string): { audio: number; playlists: number; notes: number; total: number } {
    const prefix = normalizePath(folderPath).replace(/\/$/, "");
    if (!prefix) return { audio: 0, playlists: 0, notes: 0, total: 0 };
    let audio = 0;
    let playlists = 0;
    let notes = 0;
    for (const file of this.app.vault.getFiles()) {
      if (file.path !== prefix && !file.path.startsWith(`${prefix}/`)) continue;
      if (AUDIO_EXTENSIONS.has(file.extension.toLowerCase())) audio += 1;
      else if (file.extension.toLowerCase() === "md") {
        notes += 1;
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
        if (firstString(frontmatter?.playlist_url, frontmatter?.playlistUrl, frontmatter?.music_playlist)) playlists += 1;
      }
    }
    return { audio, playlists, notes, total: audio + notes };
  }

  inferSourceKind(folderPath: string, current: SourceKind = "generic"): SourceKind {
    const stats = this.sourceStats(folderPath);
    if (stats.playlists > 0) return "music";
    return stats.audio > 0 ? "podcast" : current === "podcast" ? "generic" : current;
  }

  list(source: ContentSource, limit = 80): ContentItem[] {
    const prefix = normalizePath(source.folder).replace(/\/$/, "");
    const notesByTitle = new Map(
      this.app.vault.getMarkdownFiles().map((file) => [file.basename, file.path]),
    );
    return this.app.vault
      .getFiles()
      .filter((file) => file.extension === "md" || AUDIO_EXTENSIONS.has(file.extension.toLowerCase()))
      .filter((file) => !prefix || file.path === prefix || file.path.startsWith(`${prefix}/`))
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, limit)
      .map((file) => this.toItem(file, source, notesByTitle));
  }

  all(sources: ContentSource[], limitPerSource = 40): ContentItem[] {
    return sources
      .filter((source) => source.enabled)
      .flatMap((source) => this.list(source, limitPerSource))
      .sort((a, b) => b.modified - a.modified);
  }

  itemForFile(file: TFile, source: ContentSource): ContentItem {
    const notesByTitle = new Map(
      this.app.vault.getMarkdownFiles().map((note) => [note.basename, note.path]),
    );
    return this.toItem(file, source, notesByTitle);
  }

  private toItem(file: TFile, source: ContentSource, notesByTitle: Map<string, string>): ContentItem {
    const isAudioFile = AUDIO_EXTENSIONS.has(file.extension.toLowerCase());
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = (cache?.frontmatter ?? {}) as Record<string, unknown>;
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
      source.coverPath,
    );
    const rawAudio = firstString(
      frontmatter.audio,
      frontmatter.audioPath,
      frontmatter.audio_url,
      frontmatter.media,
      frontmatter["音频"],
      frontmatter["播客音频"],
    );
    const playlistUrl = firstString(
      frontmatter.playlist_url,
      frontmatter.playlistUrl,
      frontmatter.music_playlist,
      frontmatter.musicPlaylist,
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
      modified: file.stat.mtime,
    };
  }

  resolveResource(path: string, origin?: TFile): string {
    if (!path) return "";
    if (/^(https?:|data:|app:)/i.test(path)) return path;
    const normalized = normalizePath(path.replace(/^\/+/, ""));
    const direct = this.app.vault.getAbstractFileByPath(normalized);
    if (direct instanceof TFile) return this.app.vault.getResourcePath(direct);
    const linked = this.app.metadataCache.getFirstLinkpathDest(normalized, origin?.path ?? "");
    return linked instanceof TFile ? this.app.vault.getResourcePath(linked) : "";
  }

  kindLabel(kind: SourceKind): string {
    return ({ book: "书籍", podcast: "播客", music: "音乐", x: "X 推文", news: "新闻", clip: "网页收藏", generic: "笔记" })[kind];
  }
}
