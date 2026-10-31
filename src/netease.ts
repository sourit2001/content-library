/** NetEase Cloud Music official outchain (embed) player. */

export interface NetEaseEmbed {
  src: string;
  /** iframe height in px for this player type. */
  height: number;
  /** Song id when this is a single song (used to look up its length). */
  songId: string;
}

/**
 * Builds the official outchain player for a NetEase song, program or playlist link.
 * type: 0 playlist, 2 song, 3 program. Songs with copyright limits may still refuse to play.
 */
export function netEaseEmbed(url: string): NetEaseEmbed | null {
  const value = (url || "").trim();
  if (!/music\.163\.com/i.test(value)) return null;
  const songId = value.match(/[#/?&]song[/?&]?id=(\d+)/i)?.[1] || value.match(/\/song\/(\d+)/i)?.[1] || "";
  if (songId) return { ...build(2, songId, 66), songId };
  const programId = value.match(/[#/?&]program[/?&]?id=(\d+)/i)?.[1] || value.match(/\/program\/(\d+)/i)?.[1] || "";
  if (programId) return build(3, programId, 66);
  if (/(?:djradio|\/dj)(?:[/?#]|$)/i.test(value)) return null;
  const playlistId = /playlist/i.test(value)
    ? value.match(/[?&]id=(\d+)/i)?.[1] || value.match(/playlist[/:](\d+)/i)?.[1] || ""
    : "";
  if (playlistId) return build(0, playlistId, 430);
  return null;
}

function build(type: number, id: string, playerHeight: number): NetEaseEmbed {
  return {
    src: `https://music.163.com/outchain/player?type=${type}&id=${id}&auto=1&height=${playerHeight}`,
    height: playerHeight + 20,
    songId: "",
  };
}
