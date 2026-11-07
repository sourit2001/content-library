/** 视频收藏: YouTube and Bilibili links resolved into one video with chapters and its description. */
import { requestUrl } from "obsidian";

export type VideoPlatform = "youtube" | "bilibili" | "quark";

export interface VideoChapter {
  /** Seconds from the start of the video (or of the part, for multi-part Bilibili videos). */
  start: number;
  title: string;
}

export interface VideoInfo {
  platform: VideoPlatform;
  /** Canonical link to the video (with ?p= for a Bilibili part). */
  url: string;
  /** YouTube video id or Bilibili BV id. */
  videoId: string;
  /** Bilibili part number, 1 for single-part videos and YouTube. */
  part: number;
  /** Stable key used to spot a video that is already saved. */
  key: string;
  title: string;
  author: string;
  cover: string;
  /** Seconds, 0 when unknown. */
  duration: number;
  published: string;
  description: string;
  chapters: VideoChapter[];
  /** Where the chapters came from: the platform's own chapter data or timestamps in the description. */
  chapterSource: "platform" | "description" | "";
  /** Width ÷ height of the picture (0.5625 for a 9:16 vertical video), 0 when unknown. */
  aspect: number;
}

export const VIDEO_PLATFORM_LABELS: Record<VideoPlatform, string> = {
  youtube: "YouTube",
  bilibili: "B站",
  quark: "夸克网盘",
};

/** Title used for a 夸克网盘 video until its file name is read from the player page. */
export const QUARK_PLACEHOLDER_TITLE = "夸克网盘视频";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const BILI_HEADERS = { "User-Agent": UA, Referer: "https://www.bilibili.com/", Accept: "application/json, text/plain, */*" };

/** Pulls the first link out of pasted share text ("【标题】 https://b23.tv/xxxx"). A bare BV id also works. */
export function extractVideoUrl(raw: string): string {
  const value = (raw || "").trim();
  const match = value.match(/https?:\/\/[^\s"'<>，。）)】]+/i);
  if (match) return match[0].replace(/[.,;!?]+$/, "");
  const bv = value.match(/\b(BV[0-9A-Za-z]{10})\b/)?.[1];
  return bv ? `https://www.bilibili.com/video/${bv}` : "";
}

export function videoPlatform(url: string): VideoPlatform | null {
  if (/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)\//i.test(url)) return "youtube";
  if (/^https?:\/\/(?:www\.|m\.)?bilibili\.com\/(?:video|list|festival|bangumi)?/i.test(url)) return "bilibili";
  if (/^https?:\/\/(?:b23\.tv|bili2233\.cn|bili22\.cn|bili33\.cn)\//i.test(url)) return "bilibili";
  if (/^https?:\/\/(?:pan\.quark\.cn|drive\.quark\.cn)\//i.test(url)) return "quark";
  return null;
}

/** File id of a video in your own 夸克网盘 (pan.quark.cn/list#/video/<fid>) or the id of a share link (/s/<id>). */
export function quarkVideoId(url: string): { id: string; share: boolean } | null {
  const fid = url.match(/#\/video\/([0-9a-f]{16,})/i)?.[1];
  if (fid) return { id: fid, share: false };
  const share = url.match(/\/s\/([0-9A-Za-z]+)/)?.[1];
  return share ? { id: share, share: true } : null;
}

export function isVideoLink(raw: string): boolean {
  return Boolean(videoPlatform(extractVideoUrl(raw)));
}

export async function resolveVideoLink(raw: string, title = ""): Promise<VideoInfo> {
  const url = extractVideoUrl(raw);
  const platform = videoPlatform(url);
  if (!platform) throw new Error("unsupported");
  if (platform === "quark") return resolveQuark(url, title);
  return platform === "youtube" ? resolveYouTube(url) : resolveBilibili(url);
}

/**
 * 夸克网盘 has no public API: nothing is fetched. The video plays in Quark's own web player
 * (signed in inside Obsidian) and its file name is read from that page the first time it opens.
 */
function resolveQuark(url: string, title: string): VideoInfo {
  const found = quarkVideoId(url);
  if (!found) throw new Error("no-id");
  return {
    platform: "quark",
    url,
    videoId: found.id,
    part: 1,
    key: `quark:${found.id}`,
    title: title.trim() || QUARK_PLACEHOLDER_TITLE,
    author: "",
    cover: "",
    duration: 0,
    published: "",
    description: "",
    chapters: [],
    chapterSource: "",
    aspect: 0,
  };
}

// ---------- YouTube ----------

function youTubeId(url: string): string {
  return url.match(/[?&]v=([\w-]{11})/)?.[1]
    || url.match(/youtu\.be\/([\w-]{11})/)?.[1]
    || url.match(/\/(?:embed|shorts|live|v)\/([\w-]{11})/)?.[1]
    || "";
}

async function resolveYouTube(url: string): Promise<VideoInfo> {
  const videoId = youTubeId(url);
  if (!videoId) throw new Error("no-id");
  const canonical = `https://www.youtube.com/watch?v=${videoId}`;
  const info: VideoInfo = {
    platform: "youtube",
    url: canonical,
    videoId,
    part: 1,
    key: `yt:${videoId}`,
    title: "",
    author: "",
    cover: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    duration: 0,
    published: "",
    description: "",
    chapters: [],
    chapterSource: "",
    aspect: /\/shorts\//i.test(url) ? 9 / 16 : 0,
  };
  let platformChapters: VideoChapter[] = [];
  try {
    const html = await getText(`${canonical}&hl=zh-CN`, { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" });
    const player = embeddedJson(html, "ytInitialPlayerResponse");
    const details = player?.videoDetails as Json | undefined;
    const micro = (player?.microformat as Json | undefined)?.playerMicroformatRenderer as Json | undefined;
    info.title = str(details?.title);
    info.author = str(details?.author);
    info.duration = Number(details?.lengthSeconds) || 0;
    info.description = str(details?.shortDescription);
    info.published = day(str(micro?.publishDate) || str(micro?.uploadDate));
    const thumbs = ((details?.thumbnail as Json | undefined)?.thumbnails as Json[] | undefined) || [];
    const best = thumbs.slice().sort((a, b) => (Number(b.width) || 0) - (Number(a.width) || 0))[0];
    if (str(best?.url)) info.cover = str(best?.url).split("?")[0];
    info.aspect = youTubeAspect(player) || info.aspect;
    // Chapters the creator set up show in the player bar; they live in ytInitialData.
    const data = embeddedJson(html, "ytInitialData");
    if (data) {
      platformChapters = findAll(data, (value) => Boolean(value.chapterRenderer))
        .map((value) => value.chapterRenderer as Json)
        .map((chapter) => ({
          start: Math.round((Number(chapter.timeRangeStartMillis) || 0) / 1000),
          title: text(chapter.title),
        }))
        .filter((chapter) => chapter.title);
    }
  } catch (error) {
    console.warn("[Content Library] YouTube page read failed, using oEmbed", error);
  }
  if (!info.title) {
    // The watch page may be blocked (consent page, region); oEmbed still gives title and channel.
    const embed = await getJson<{ title?: string; author_name?: string; thumbnail_url?: string }>(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(canonical)}&format=json`,
    );
    info.title = embed.title || "";
    info.author = embed.author_name || "";
    if (embed.thumbnail_url) info.cover = embed.thumbnail_url;
  }
  if (!info.title) throw new Error("not-found");
  pickChapters(info, uniqueChapters(platformChapters));
  return info;
}

// ---------- Bilibili ----------

interface BiliDimension {
  width?: number;
  height?: number;
  rotate?: number;
}

interface BiliPage {
  cid?: number;
  page?: number;
  part?: string;
  duration?: number;
  dimension?: BiliDimension;
}

interface BiliView {
  bvid?: string;
  aid?: number;
  title?: string;
  pic?: string;
  desc?: string;
  duration?: number;
  pubdate?: number;
  owner?: { name?: string };
  pages?: BiliPage[];
  dimension?: BiliDimension;
}

async function resolveBilibili(raw: string): Promise<VideoInfo> {
  let url = raw;
  if (/^https?:\/\/(?:b23\.tv|bili2233\.cn|bili22\.cn|bili33\.cn)\//i.test(url)) url = await expandShortLink(url);
  const bvid = url.match(/(BV[0-9A-Za-z]{10})/)?.[1] || "";
  const aid = bvid ? "" : url.match(/\/av(\d+)/i)?.[1] || url.match(/[?&]aid=(\d+)/i)?.[1] || "";
  if (!bvid && !aid) throw new Error("no-id");
  const wantedPart = Math.max(1, Number(url.match(/[?&]p=(\d+)/)?.[1]) || 1);
  const view = await getJson<{ code?: number; data?: BiliView }>(
    `https://api.bilibili.com/x/web-interface/view?${bvid ? `bvid=${bvid}` : `aid=${aid}`}`,
    BILI_HEADERS,
  );
  const data = view.data;
  if (view.code !== 0 || !data?.bvid) throw new Error("not-found");
  const pages = data.pages || [];
  const page = pages.find((entry) => entry.page === wantedPart) || pages[0];
  const part = page?.page || 1;
  const multiPart = pages.length > 1;
  const info: VideoInfo = {
    platform: "bilibili",
    url: `https://www.bilibili.com/video/${data.bvid}${multiPart ? `?p=${part}` : ""}`,
    videoId: data.bvid,
    part,
    key: `bili:${data.bvid}${multiPart ? `:p${part}` : ""}`,
    title: (data.title || "").trim() + (multiPart && page?.part ? ` · P${part} ${page.part.trim()}` : ""),
    author: data.owner?.name || "",
    cover: (data.pic || "").replace(/^http:/, "https:"),
    duration: (multiPart ? page?.duration : data.duration) || data.duration || 0,
    published: data.pubdate ? day(new Date(data.pubdate * 1000).toISOString()) : "",
    description: (data.desc || "").trim() === "-" ? "" : (data.desc || "").trim(),
    chapters: [],
    chapterSource: "",
    aspect: biliAspect(page?.dimension) || biliAspect(data.dimension),
  };
  let platformChapters: VideoChapter[] = [];
  if (page?.cid) {
    try {
      // 分段章节 (view_points) the uploader added in the player bar.
      const player = await getJson<{ code?: number; data?: { view_points?: Array<{ content?: string; from?: number }> } }>(
        `https://api.bilibili.com/x/player/v2?bvid=${data.bvid}&cid=${page.cid}`,
        BILI_HEADERS,
      );
      platformChapters = (player.data?.view_points || [])
        .map((point) => ({ start: Math.round(Number(point.from) || 0), title: (point.content || "").trim() }))
        .filter((chapter) => chapter.title);
    } catch (error) {
      console.warn("[Content Library] Bilibili chapters read failed", error);
    }
  }
  // Description timestamps refer to the whole video; only trust them for single-part videos.
  pickChapters(info, uniqueChapters(platformChapters), !multiPart);
  return info;
}

/** b23.tv share links redirect to the video page; the BV id is in the final page either way. */
async function expandShortLink(url: string): Promise<string> {
  const response = await requestUrl({ url, method: "GET", headers: { "User-Agent": UA }, throw: false });
  const location = response.headers?.location || response.headers?.Location || "";
  const page = response.text || "";
  // The video's own address (canonical / og:url) comes before any recommended videos on the page.
  const canonical = page.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i)?.[1]
    || page.match(/<meta[^>]+property="og:url"[^>]+content="([^"]+)"/i)?.[1]
    || "";
  const found = `${location} ${canonical} ${page}`;
  const bvid = found.match(/(BV[0-9A-Za-z]{10})/)?.[1];
  if (!bvid) throw new Error("no-id");
  const part = found.match(/[?&]p=(\d+)/)?.[1];
  return `https://www.bilibili.com/video/${bvid}${part && part !== "1" ? `?p=${part}` : ""}`;
}

function biliAspect(dimension: BiliDimension | undefined): number {
  const width = Number(dimension?.width) || 0;
  const height = Number(dimension?.height) || 0;
  if (!width || !height) return 0;
  // rotate = 1: the file is stored sideways and shown turned a quarter.
  return roundAspect(dimension?.rotate ? height / width : width / height);
}

function youTubeAspect(player: Json | null): number {
  const streaming = player?.streamingData as Json | undefined;
  const formats = [...((streaming?.formats as Json[] | undefined) || []), ...((streaming?.adaptiveFormats as Json[] | undefined) || [])];
  const sized = formats.find((format) => Number(format.width) > 0 && Number(format.height) > 0);
  if (sized) return roundAspect(Number(sized.width) / Number(sized.height));
  // No stream info (e.g. login wall): the embed tells width/height of its player.
  const embed = ((player?.microformat as Json | undefined)?.playerMicroformatRenderer as Json | undefined)?.embed as Json | undefined;
  const width = Number(embed?.width) || 0;
  const height = Number(embed?.height) || 0;
  return width && height ? roundAspect(width / height) : 0;
}

function roundAspect(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value * 10000) / 10000 : 0;
}

/** Looks up only the picture shape of an already saved video (notes made before `aspect` existed). */
export async function fetchVideoAspect(platform: VideoPlatform, videoId: string, part = 1): Promise<number> {
  if (platform === "quark") return 0;
  if (platform === "bilibili") {
    const view = await getJson<{ code?: number; data?: BiliView }>(`https://api.bilibili.com/x/web-interface/view?bvid=${videoId}`, BILI_HEADERS);
    const page = (view.data?.pages || []).find((entry) => entry.page === part) || view.data?.pages?.[0];
    return biliAspect(page?.dimension) || biliAspect(view.data?.dimension);
  }
  const html = await getText(`https://www.youtube.com/watch?v=${videoId}`, { "User-Agent": UA });
  return youTubeAspect(embeddedJson(html, "ytInitialPlayerResponse"));
}

// ---------- Chapters ----------

function pickChapters(info: VideoInfo, platform: VideoChapter[], allowDescription = true): void {
  if (platform.length >= 2) {
    info.chapters = platform;
    info.chapterSource = "platform";
    return;
  }
  const fromDescription = allowDescription ? descriptionChapters(info.description, info.duration) : [];
  if (fromDescription.length >= 2) {
    info.chapters = fromDescription;
    info.chapterSource = "description";
  }
}

/**
 * Reads a chapter list from a description: lines with a timestamp ("00:00 开场", "1:02:03 - 结尾",
 * "【05:30】观点"). Needs at least two stamps in increasing order, like YouTube's own rule.
 */
export function descriptionChapters(description: string, duration = 0): VideoChapter[] {
  const stamp = /(?<![\d:])((?:\d{1,2}:)?\d{1,2}:\d{2})(?![\d:])/;
  const chapters: VideoChapter[] = [];
  for (const rawLine of (description || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(stamp);
    if (!match || match.index === undefined) continue;
    const start = timeToSeconds(match[1]);
    if (duration && start > duration) continue;
    const title = (line.slice(0, match.index) + " " + line.slice(match.index + match[1].length))
      .replace(/^[\s\-–—:：|·•、.)）\]】[【(（]+/, "")
      .replace(/[\s\-–—:：|·•、([【（]+$/, "")
      .trim();
    if (!title) continue;
    chapters.push({ start, title });
  }
  const ordered = chapters.every((chapter, index) => index === 0 || chapter.start > chapters[index - 1].start);
  return ordered && chapters.length >= 2 ? chapters : [];
}

function uniqueChapters(chapters: VideoChapter[]): VideoChapter[] {
  const seen = new Set<number>();
  return chapters
    .sort((a, b) => a.start - b.start)
    .filter((chapter) => (seen.has(chapter.start) ? false : (seen.add(chapter.start), true)));
}

// ---------- Players ----------

/** Official embed player. `start` in seconds; YouTube gets the JS API so timestamps can seek without a reload. */
export function videoEmbedUrl(platform: VideoPlatform, videoId: string, part = 1, start = 0, autoplay = false): string {
  if (platform === "quark") return "";
  if (platform === "youtube") {
    const params = new URLSearchParams({ rel: "0", playsinline: "1", enablejsapi: "1" });
    if (start > 0) params.set("start", String(Math.floor(start)));
    if (autoplay) params.set("autoplay", "1");
    return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
  }
  const params = new URLSearchParams({
    bvid: videoId,
    p: String(part || 1),
    autoplay: autoplay ? "1" : "0",
    danmaku: "0",
    high_quality: "1",
  });
  if (start > 0) params.set("t", String(Math.floor(start)));
  return `https://player.bilibili.com/player.html?${params.toString()}`;
}

/** Link to the video on its own site at a given second (used when the embed can't play). */
export function videoUrlAt(url: string, platform: VideoPlatform, seconds: number): string {
  if (!seconds || platform === "quark") return url;
  const join = url.includes("?") ? "&" : "?";
  return platform === "youtube" ? `${url}${join}t=${Math.floor(seconds)}s` : `${url}${join}t=${Math.floor(seconds)}`;
}

/** Recovers platform, id and part from a saved video note's frontmatter. */
export function videoFromFrontmatter(frontmatter: Record<string, unknown>): { platform: VideoPlatform; videoId: string; part: number; url: string } | null {
  const url = str(frontmatter.url) || str(frontmatter.video_url);
  const platform = (frontmatter.platform === "youtube" || frontmatter.platform === "bilibili" || frontmatter.platform === "quark")
    ? frontmatter.platform
    : videoPlatform(url);
  if (!platform) return null;
  const videoId = str(frontmatter.video_id)
    || (platform === "youtube" ? youTubeId(url) : platform === "quark" ? quarkVideoId(url)?.id || "" : url.match(/(BV[0-9A-Za-z]{10})/)?.[1] || "");
  if (!videoId) return null;
  const part = Number(frontmatter.part) || Number(url.match(/[?&]p=(\d+)/)?.[1]) || 1;
  return { platform, videoId, part, url: url || (platform === "youtube" ? `https://www.youtube.com/watch?v=${videoId}` : `https://www.bilibili.com/video/${videoId}`) };
}

// ---------- helpers ----------

type Json = Record<string, unknown>;

async function getText(url: string, headers: Record<string, string> = { "User-Agent": UA }): Promise<string> {
  const response = await requestUrl({ url, method: "GET", headers });
  return response.text;
}

async function getJson<T>(url: string, headers: Record<string, string> = { "User-Agent": UA, Accept: "application/json" }): Promise<T> {
  const response = await requestUrl({ url, method: "GET", headers });
  return JSON.parse(response.text) as T;
}

/** Reads `var name = {...};` style JSON embedded in a page, by matching braces. */
function embeddedJson(html: string, name: string): Json | null {
  const at = html.search(new RegExp(`${name}\\s*=\\s*\\{`));
  if (at < 0) return null;
  const start = html.indexOf("{", at);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, index + 1)) as Json; } catch { return null; }
      }
    }
  }
  return null;
}

function findAll(root: unknown, test: (value: Json) => boolean, found: Json[] = [], depth = 0): Json[] {
  if (!root || typeof root !== "object" || depth > 40) return found;
  if (Array.isArray(root)) {
    for (const entry of root) findAll(entry, test, found, depth + 1);
    return found;
  }
  const value = root as Json;
  if (test(value)) found.push(value);
  for (const child of Object.values(value)) findAll(child, test, found, depth + 1);
  return found;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** YouTube text objects: { simpleText } or { runs: [{ text }] }. */
function text(value: unknown): string {
  const node = value as Json | undefined;
  if (!node) return "";
  if (typeof node.simpleText === "string") return node.simpleText.trim();
  const runs = node.runs as Json[] | undefined;
  return Array.isArray(runs) ? runs.map((run) => (typeof run.text === "string" ? run.text : "")).join("").trim() : "";
}

function day(value: string): string {
  if (!value) return "";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "";
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function timeToSeconds(value: string): number {
  return value.split(":").map(Number).reduce((total, part) => total * 60 + (Number.isFinite(part) ? part : 0), 0);
}

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (number: number) => String(number).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}
