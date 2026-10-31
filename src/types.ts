import type { TFile } from "obsidian";
import type { ThemePack } from "./packs";
import type { LanguagePreference } from "./i18n";

export type DashboardTheme = "grass" | "blue" | "pink" | "rose" | "black" | "glass";
export type ThemeMode = "system" | "light" | "dark";
export type AnnotationHighlight = "yellow" | "orange" | "blue" | "pink";
export type SourceKind = "book" | "podcast" | "music" | "x" | "news" | "clip" | "generic";
export type SourceGroup = "information" | "skills" | "bookshelf" | "ideas" | "needs" | "podcast" | "music";
export type ContentProgressState = "in-progress" | "complete";

export interface ContentProgress {
  state: ContentProgressState;
  progress: number;
  updated: number;
}

export interface MusicTrackSnapshot {
  id: string;
  title: string;
  artist: string;
  album: string;
  cover: string;
  url: string;
  /** Length in ms, when the platform reports it. */
  duration?: number;
  /** false when the platform says it can't be played without the app / VIP (copyright). */
  playable?: boolean;
}

export interface MusicCollectionSnapshot {
  id: string;
  title: string;
  cover: string;
  creator: string;
  trackCount: number;
  tracks: MusicTrackSnapshot[];
  collectionType?: "playlist" | "album" | "program" | "song" | "video";
}

export interface ContentSource {
  id: string;
  name: string;
  folder: string;
  kind: SourceKind;
  group: SourceGroup;
  icon: string;
  coverPath: string;
  enabled: boolean;
}

export interface DashboardSettings {
  /** UI language; "auto" follows Obsidian's language. */
  language: LanguagePreference;
  theme: DashboardTheme;
  /** Installed theme pack currently applied; empty means the built-in `theme`. */
  activePackId: string;
  installedPacks: Record<string, ThemePack>;
  /** Gumroad product id → license key for premium theme packs. */
  licenses: Record<string, string>;
  /** 0–1 volume for theme pack ambient sound. */
  ambientVolume: number;
  themeMode: ThemeMode;
  /** Premium built-in themes the user used during their free window (kept for good). */
  claimedThemes: DashboardTheme[];
  annotationHighlight: AnnotationHighlight;
  bannerPath: string;
  annotationFolder: string;
  dashboardTitle: string;
  sourceGroupOrder: SourceGroup[];
  sources: ContentSource[];
  coverOverrides: Record<string, string>;
  playbackMode: "sequential" | "list-loop" | "single-loop" | "shuffle";
  usageByDate: Record<string, number>;
  viewHistory: Record<string, number>;
  contentProgress: Record<string, ContentProgress>;
  musicCollectionSnapshots: Record<string, MusicCollectionSnapshot>;
}

export interface WebPreview {
  url: string;
  title: string;
  description: string;
  host: string;
  image: string;
  favicon: string;
}

export interface ContentItem {
  id: string;
  file: TFile;
  source: ContentSource;
  kind: SourceKind;
  title: string;
  subtitle: string;
  excerpt: string;
  cover: string;
  externalUrl: string;
  audioPath: string;
  playlistUrl: string;
  notePath: string;
  progress: number;
  created: number;
  modified: number;
}

export const THEME_LABELS: Record<DashboardTheme, string> = {
  grass: "浅草绿",
  blue: "海盐蓝",
  pink: "樱花粉",
  rose: "玫瑰红",
  black: "曜石黑",
  glass: "森林玻璃",
};

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  book: "阅读",
  podcast: "收听",
  music: "音乐",
  x: "推文",
  news: "新闻",
  clip: "收藏",
  generic: "文件夹",
};

export const SOURCE_GROUP_LABELS: Record<SourceGroup, string> = {
  information: "信息",
  skills: "技能储备",
  bookshelf: "书架",
  ideas: "想法收藏",
  needs: "需求收集",
  podcast: "播客页面",
  music: "音乐收藏",
};

export const DEFAULT_SETTINGS: DashboardSettings = {
  language: "auto",
  theme: "grass",
  activePackId: "",
  installedPacks: {},
  licenses: {},
  ambientVolume: 0.5,
  themeMode: "system",
  claimedThemes: [],
  annotationHighlight: "yellow",
  bannerPath: "",
  annotationFolder: "Dashboard Notes",
  dashboardTitle: "内容图书馆",
  sourceGroupOrder: ["podcast", "music", "information", "skills", "bookshelf", "ideas", "needs"],
  sources: [],
  coverOverrides: {},
  playbackMode: "sequential",
  usageByDate: {},
  viewHistory: {},
  contentProgress: {},
  musicCollectionSnapshots: {},
};
