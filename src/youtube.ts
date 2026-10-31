/** Helpers for YouTube links in the music collection. */

export function isYouTubeUrl(url: string): boolean {
  return /^https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)\//i.test(url.trim());
}

/** Extracts the video id and/or playlist id from any common YouTube link shape. */
export function parseYouTubeUrl(url: string): { videoId: string; listId: string } | null {
  if (!isYouTubeUrl(url)) return null;
  const value = url.trim();
  const videoId = value.match(/[?&]v=([\w-]{11})/)?.[1]
    || value.match(/youtu\.be\/([\w-]{11})/)?.[1]
    || value.match(/\/(?:embed|shorts|live)\/([\w-]{11})/)?.[1]
    || "";
  const listId = value.match(/[?&]list=([\w-]+)/)?.[1] || "";
  if (!videoId && !listId) return null;
  return { videoId, listId };
}

/** Embed URL for the official YouTube player. Single videos loop; real playlists play in order. */
export function youTubeEmbedUrl(url: string, autoplay = true, options: { loop?: boolean; api?: boolean } = {}): string {
  const parsed = parseYouTubeUrl(url);
  if (!parsed) return "";
  const params = new URLSearchParams({ rel: "0", playsinline: "1" });
  if (autoplay) params.set("autoplay", "1");
  // enablejsapi lets the dashboard hear when a video ends, to move the queue on.
  if (options.api) params.set("enablejsapi", "1");
  const loop = options.loop !== false;
  // Auto-generated mixes (RD...) cannot be embedded, so those fall back to looping the video.
  const embeddableList = parsed.listId && !/^RD/i.test(parsed.listId) ? parsed.listId : "";
  if (parsed.videoId) {
    if (embeddableList) params.set("list", embeddableList);
    else if (loop) {
      params.set("loop", "1");
      params.set("playlist", parsed.videoId);
    }
    return `https://www.youtube.com/embed/${parsed.videoId}?${params.toString()}`;
  }
  if (!embeddableList) return "";
  params.set("list", embeddableList);
  return `https://www.youtube.com/embed/videoseries?${params.toString()}`;
}
