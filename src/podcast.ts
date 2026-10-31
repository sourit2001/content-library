/** Podcast links (Apple Podcasts, 小宇宙, Spotify) resolved into one episode with audio and show notes. */
import { htmlToMarkdown, requestUrl } from "obsidian";

export type PodcastPlatform = "apple" | "xiaoyuzhou" | "spotify";

export interface PodcastEpisode {
  platform: PodcastPlatform;
  /** The link the user pasted (cleaned). */
  url: string;
  title: string;
  show: string;
  cover: string;
  /** Direct audio file; empty when the episode can only play through the platform's embed. */
  audioUrl: string;
  published: string;
  /** Seconds, 0 when unknown. */
  duration: number;
  /** Show notes as Markdown. */
  notes: string;
  /** True when a show page was pasted and its latest episode was used. */
  fromShowLink: boolean;
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

export const PODCAST_PLATFORM_LABELS: Record<PodcastPlatform, string> = {
  apple: "Apple 播客",
  xiaoyuzhou: "小宇宙",
  spotify: "Spotify",
};

/** Pulls the first link out of pasted share text ("听听这期… https://…"). */
export function extractPodcastUrl(raw: string): string {
  const match = (raw || "").match(/https?:\/\/[^\s"'<>，。）)]+/i);
  return match ? match[0].replace(/[.,;!?]+$/, "") : "";
}

export function podcastPlatform(url: string): PodcastPlatform | null {
  if (/^https?:\/\/(?:[\w-]+\.)?(?:podcasts|itunes)\.apple\.com\//i.test(url)) return "apple";
  if (/^https?:\/\/(?:www\.)?(?:xiaoyuzhoufm\.com|xyzfm\.link|xyzfm\.space)\//i.test(url)) return "xiaoyuzhou";
  if (/^https?:\/\/open\.spotify\.com\/(?:intl-[\w-]+\/)?(?:episode|show)\//i.test(url)) return "spotify";
  return null;
}

/** Official Spotify embed player for an episode or show link. */
export function spotifyEmbedUrl(url: string): string {
  const match = (url || "").match(/open\.spotify\.com\/(?:intl-[\w-]+\/)?(episode|show)\/([A-Za-z0-9]+)/i);
  return match ? `https://open.spotify.com/embed/${match[1].toLowerCase()}/${match[2]}` : "";
}

export async function resolvePodcastLink(raw: string): Promise<PodcastEpisode> {
  const url = extractPodcastUrl(raw);
  const platform = podcastPlatform(url);
  if (!platform) throw new Error("unsupported");
  if (platform === "xiaoyuzhou") return resolveXiaoyuzhou(url);
  if (platform === "apple") return resolveApple(url);
  return resolveSpotify(url);
}

// ---------- 小宇宙 ----------

async function resolveXiaoyuzhou(url: string): Promise<PodcastEpisode> {
  const html = await getText(url);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const data = nextData(doc);
  const wantedId = url.match(/\/episode\/([0-9a-f]{16,})/i)?.[1] || "";
  const isShow = /\/podcast\//i.test(url) && !wantedId;
  const episodes = data ? findAll(data, (value) => typeof value.eid === "string" && Boolean(str(value.title))) : [];
  const episode = episodes.find((value) => value.eid === wantedId)
    || episodes.find((value) => Boolean(enclosureUrl(value)))
    || episodes[0];
  const show = (episode?.podcast as Json | undefined) || (data ? findAll(data, (value) => typeof value.pid === "string" && Boolean(str(value.title)))[0] : undefined);
  const meta = metaReader(doc);
  const ld = jsonLd(doc);
  const title = str(episode?.title) || meta("og:title") || str(ld?.name) || doc.title;
  const audioUrl = enclosureUrl(episode) || meta("og:audio") || str((ld?.associatedMedia as Json | undefined)?.contentUrl);
  const notesHtml = str(episode?.shownotes) || str(episode?.description) || meta("og:description") || str(ld?.description);
  return {
    platform: "xiaoyuzhou",
    url,
    title: title.trim(),
    show: str(show?.title) || str(show?.author) || str((ld?.partOfSeries as Json | undefined)?.name),
    cover: imageUrl(episode?.image) || imageUrl(show?.image) || meta("og:image"),
    audioUrl,
    published: day(str(episode?.pubDate) || str(ld?.datePublished)),
    duration: Number(episode?.duration) || 0,
    notes: toMarkdown(notesHtml),
    fromShowLink: isShow,
  };
}

function enclosureUrl(value: Json | undefined): string {
  if (!value) return "";
  return str((value.enclosure as Json | undefined)?.url)
    || str(((value.media as Json | undefined)?.source as Json | undefined)?.url)
    || str(value.mediaUrl);
}

function imageUrl(value: unknown): string {
  if (typeof value === "string") return value;
  const image = value as Json | undefined;
  return str(image?.largePicUrl) || str(image?.middlePicUrl) || str(image?.picUrl) || str(image?.thumbnailUrl);
}

// ---------- Apple Podcasts ----------

interface ItunesResult {
  wrapperType?: string;
  kind?: string;
  trackId?: number;
  trackName?: string;
  collectionName?: string;
  artistName?: string;
  episodeUrl?: string;
  episodeGuid?: string;
  description?: string;
  shortDescription?: string;
  releaseDate?: string;
  trackTimeMillis?: number;
  artworkUrl600?: string;
  artworkUrl160?: string;
  feedUrl?: string;
}

async function resolveApple(url: string): Promise<PodcastEpisode> {
  const showId = url.match(/\/id(\d+)/i)?.[1] || url.match(/[?&]id=(\d+)/i)?.[1] || "";
  const episodeId = url.match(/[?&]i=(\d+)/i)?.[1] || "";
  if (!showId) throw new Error("no-id");
  const country = url.match(/apple\.com\/([a-z]{2})\//i)?.[1]?.toLowerCase() || "";
  const lookup = await getJson<{ results?: ItunesResult[] }>(
    `https://itunes.apple.com/lookup?id=${showId}&entity=podcastEpisode&limit=200${country ? `&country=${country}` : ""}`,
  );
  const results = lookup.results || [];
  const show = results.find((entry) => entry.kind === "podcast" || entry.wrapperType === "track");
  const episodes = results
    .filter((entry) => entry.wrapperType === "podcastEpisode" || entry.kind === "podcast-episode")
    .sort((a, b) => Date.parse(b.releaseDate || "") - Date.parse(a.releaseDate || ""));
  let episode = episodeId ? episodes.find((entry) => String(entry.trackId) === episodeId) : episodes[0];
  const feedUrl = show?.feedUrl || "";
  if (!episode && episodeId && feedUrl) {
    // Older than the 200 newest: find it in the RSS feed by the title on the Apple page.
    const page = new DOMParser().parseFromString(await getText(url), "text/html");
    const title = metaReader(page)("og:title") || page.title;
    const item = await findFeedItem(feedUrl, "", title);
    if (item) return { ...item, platform: "apple", url, show: item.show || show?.collectionName || "", cover: item.cover || show?.artworkUrl600 || "", fromShowLink: false };
  }
  if (!episode) throw new Error("not-found");
  return appleEpisode(episode, url, feedUrl || episode.feedUrl || "", !episodeId, show);
}

async function appleEpisode(episode: ItunesResult, url: string, feedUrl: string, fromShowLink: boolean, show?: ItunesResult): Promise<PodcastEpisode> {
  let notes = episode.description || episode.shortDescription || "";
  let richNotes = "";
  if (feedUrl) {
    try {
      richNotes = (await findFeedItem(feedUrl, episode.episodeGuid || "", episode.trackName || ""))?.notes || "";
    } catch (error) {
      console.warn("[Content Library] Podcast RSS read failed", error);
    }
  }
  if (!richNotes) notes = plainTextToMarkdown(notes);
  return {
    platform: "apple",
    url,
    title: episode.trackName || "",
    show: episode.collectionName || show?.collectionName || "",
    cover: episode.artworkUrl600 || show?.artworkUrl600 || episode.artworkUrl160 || "",
    audioUrl: episode.episodeUrl || "",
    published: day(episode.releaseDate || ""),
    duration: Math.round((episode.trackTimeMillis || 0) / 1000),
    notes: richNotes || notes,
    fromShowLink,
  };
}

/** Reads one item from a podcast RSS feed by guid or title. */
async function findFeedItem(feedUrl: string, guid: string, title: string): Promise<Omit<PodcastEpisode, "platform" | "url" | "fromShowLink"> | null> {
  const xml = new DOMParser().parseFromString(await getText(feedUrl, "application/rss+xml, application/xml, text/xml"), "text/xml");
  const channelTitle = xml.querySelector("channel > title")?.textContent?.trim() || "";
  const channelImage = xml.querySelector("channel > image > url")?.textContent?.trim() || itunesAttr(xml.querySelector("channel"), "image", "href");
  const wanted = normalizeTitle(title);
  const item = Array.from(xml.getElementsByTagName("item")).find((entry) => {
    const entryGuid = entry.getElementsByTagName("guid")[0]?.textContent?.trim() || "";
    if (guid && entryGuid === guid) return true;
    return Boolean(wanted) && normalizeTitle(entry.getElementsByTagName("title")[0]?.textContent || "") === wanted;
  });
  if (!item) return null;
  const encoded = item.getElementsByTagNameNS("http://purl.org/rss/1.0/modules/content/", "encoded")[0]?.textContent || "";
  const description = encoded || item.getElementsByTagName("description")[0]?.textContent || itunesText(item, "summary");
  const durationText = itunesText(item, "duration");
  return {
    title: item.getElementsByTagName("title")[0]?.textContent?.trim() || title,
    show: channelTitle,
    cover: itunesAttr(item, "image", "href") || channelImage,
    audioUrl: item.getElementsByTagName("enclosure")[0]?.getAttribute("url") || "",
    published: day(item.getElementsByTagName("pubDate")[0]?.textContent || ""),
    duration: parseDuration(durationText),
    notes: toMarkdown(description),
  };
}

function itunesText(parent: Element, name: string): string {
  return parent.getElementsByTagNameNS("http://www.itunes.com/dtds/podcast-1.0.dtd", name)[0]?.textContent?.trim() || "";
}

function itunesAttr(parent: Element | null, name: string, attr: string): string {
  return parent?.getElementsByTagNameNS("http://www.itunes.com/dtds/podcast-1.0.dtd", name)[0]?.getAttribute(attr) || "";
}

// ---------- Spotify ----------

async function resolveSpotify(url: string): Promise<PodcastEpisode> {
  const match = url.match(/open\.spotify\.com\/(?:intl-[\w-]+\/)?(episode|show)\/([A-Za-z0-9]+)/i);
  if (!match) throw new Error("no-id");
  const type = match[1].toLowerCase();
  const cleanUrl = `https://open.spotify.com/${type}/${match[2]}`;
  const page = new DOMParser().parseFromString(await getText(cleanUrl), "text/html");
  if (type === "show") {
    // Show page: open its newest episode.
    const episodeHref = Array.from(page.querySelectorAll<HTMLAnchorElement>('a[href*="/episode/"]'))
      .map((link) => link.getAttribute("href") || "")
      .find(Boolean);
    const episodeId = episodeHref?.match(/\/episode\/([A-Za-z0-9]+)/)?.[1]
      || (page.documentElement.innerHTML.match(/spotify:episode:([A-Za-z0-9]{22})/)?.[1] ?? "");
    if (!episodeId) throw new Error("not-found");
    const latest = await resolveSpotify(`https://open.spotify.com/episode/${episodeId}`);
    return { ...latest, fromShowLink: true };
  }
  const meta = metaReader(page);
  let title = meta("og:title");
  let cover = meta("og:image");
  try {
    const embed = await getJson<{ title?: string; thumbnail_url?: string }>(`https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`);
    title = embed.title || title;
    cover = embed.thumbnail_url || cover;
  } catch {
    // The page metadata is enough.
  }
  const description = meta("og:description") || meta("description");
  // "Listen to this episode from <Show> on Spotify. <notes>" / "收听 <Show> 在 Spotify 上的这一集。…"
  const fromMatch = description.match(/^Listen to this episode from (.+?) on Spotify\.\s*/i)
    || description.match(/^收听\s*(.+?)\s*在\s*Spotify\s*上的这一集。\s*/);
  const show = fromMatch?.[1]?.trim() || page.title.split("|")[1]?.trim() || "";
  const pageNotes = fromMatch ? description.slice(fromMatch[0].length) : description;
  const base: PodcastEpisode = {
    platform: "spotify",
    url: cleanUrl,
    title: title.replace(/\s*\|\s*Podcast on Spotify$/i, "").trim(),
    show,
    cover,
    audioUrl: "",
    published: day(meta("music:release_date")),
    duration: Number(meta("music:duration")) || 0,
    notes: plainTextToMarkdown(pageNotes),
    fromShowLink: false,
  };
  // Spotify does not hand out audio files; most podcasts are also on Apple's directory, which does.
  try {
    const twin = await findItunesTwin(base.title, base.show);
    if (twin) {
      const apple = await appleEpisode(twin, cleanUrl, twin.feedUrl || "", false);
      return {
        ...base,
        audioUrl: apple.audioUrl,
        notes: apple.notes.length > base.notes.length ? apple.notes : base.notes,
        show: base.show || apple.show,
        cover: base.cover || apple.cover,
        published: base.published || apple.published,
        duration: base.duration || apple.duration,
      };
    }
  } catch (error) {
    console.warn("[Content Library] Spotify → Apple lookup failed", error);
  }
  return base;
}

async function findItunesTwin(title: string, show: string): Promise<ItunesResult | null> {
  if (!title) return null;
  const search = await getJson<{ results?: ItunesResult[] }>(
    `https://itunes.apple.com/search?media=podcast&entity=podcastEpisode&limit=25&term=${encodeURIComponent(title)}`,
  );
  const wanted = normalizeTitle(title);
  const wantedShow = normalizeTitle(show);
  const candidates = (search.results || []).filter((entry) => normalizeTitle(entry.trackName || "") === wanted && entry.episodeUrl);
  return candidates.find((entry) => !wantedShow || normalizeTitle(entry.collectionName || "") === wantedShow)
    || (candidates.length === 1 && !wantedShow ? candidates[0] : null)
    || null;
}

// ---------- helpers ----------

type Json = Record<string, unknown>;

async function getText(url: string, accept = "text/html,application/xhtml+xml"): Promise<string> {
  const response = await requestUrl({ url, method: "GET", headers: { Accept: accept, "User-Agent": UA } });
  return response.text;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await requestUrl({ url, method: "GET", headers: { Accept: "application/json", "User-Agent": UA } });
  return JSON.parse(response.text) as T;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nextData(doc: Document): Json | null {
  const text = doc.getElementById("__NEXT_DATA__")?.textContent;
  if (!text) return null;
  try { return JSON.parse(text) as Json; } catch { return null; }
}

function jsonLd(doc: Document): Json | null {
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const parsed = JSON.parse(script.textContent || "") as Json | Json[];
      const list = Array.isArray(parsed) ? parsed : [parsed];
      const found = list.find((entry) => /PodcastEpisode/i.test(String(entry["@type"] || "")));
      if (found) return found;
    } catch {
      // Ignore malformed blocks.
    }
  }
  return null;
}

/** Depth-first search for every object matching the test, in document order. */
function findAll(root: unknown, test: (value: Json) => boolean, found: Json[] = [], depth = 0): Json[] {
  if (!root || typeof root !== "object" || depth > 12) return found;
  if (Array.isArray(root)) {
    for (const entry of root) findAll(entry, test, found, depth + 1);
    return found;
  }
  const value = root as Json;
  if (test(value)) found.push(value);
  for (const child of Object.values(value)) findAll(child, test, found, depth + 1);
  return found;
}

function metaReader(doc: Document): (name: string) => string {
  return (name: string) => (
    doc.querySelector(`meta[property="${name}"]`)?.getAttribute("content")
    || doc.querySelector(`meta[name="${name}"]`)?.getAttribute("content")
    || ""
  ).trim();
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function day(value: string): string {
  if (!value) return "";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "";
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDuration(value: string): number {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  return value.split(":").map(Number).reduce((total, part) => total * 60 + (Number.isFinite(part) ? part : 0), 0);
}

function toMarkdown(value: string): string {
  if (!value) return "";
  if (!/<[a-z][\s\S]*>/i.test(value)) return plainTextToMarkdown(value);
  return htmlToMarkdown(value).replace(/\n{3,}/g, "\n\n").trim();
}

/** Keeps line breaks of plain-text notes and turns bare links into Markdown links. */
function plainTextToMarkdown(value: string): string {
  return (value || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("  \n")
    .replace(/(?:  \n){2,}/g, "\n\n")
    .trim();
}

/** Seconds for "1:02:03" / "05:30" timestamps in show notes. */
export function timestampSeconds(value: string): number {
  return value.split(":").map(Number).reduce((total, part) => total * 60 + part, 0);
}
