import type ContentLibraryDashboardPlugin from "./main";
import type { ThemePack } from "./packs";

const FADE_SECONDS = 4;
const TICK_MS = 100;

/**
 * Loops a theme pack's ambient sound (rain, birds, city hum) with a crossfade
 * between two audio elements, so the loop seam is inaudible. Other media that
 * starts playing anywhere in Obsidian (podcasts, music) pauses the ambience,
 * and it resumes when that media pauses or ends.
 */
export class AmbientPlayer {
  private decks: [HTMLAudioElement, HTMLAudioElement] | null = null;
  private current = 0;
  private timer: number | null = null;
  private fading = false;
  private packId = "";
  private heldByMedia = new Set<HTMLMediaElement>();
  private listeners = new Set<() => void>();
  playing = false;

  constructor(private plugin: ContentLibraryDashboardPlugin) {}

  /** Wires document-level media events; call once from Plugin.onload. */
  register(): void {
    this.plugin.registerDomEvent(document, "play", (event) => this.onMediaPlay(event), true);
    const release = (event: Event) => this.onMediaStop(event);
    this.plugin.registerDomEvent(document, "pause", release, true);
    this.plugin.registerDomEvent(document, "ended", release, true);
    this.plugin.register(() => this.stop());
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  get volume(): number {
    return this.plugin.settings.ambientVolume;
  }

  isPlayingFor(pack: ThemePack | null): boolean {
    return this.playing && Boolean(pack) && pack?.id === this.packId;
  }

  async toggle(pack: ThemePack): Promise<void> {
    if (this.isPlayingFor(pack)) this.stop();
    else await this.play(pack);
  }

  async play(pack: ThemePack): Promise<void> {
    const url = pack.ambient ? this.plugin.packs.localResource(pack, pack.ambient) : "";
    if (!url) return;
    this.stop(false);
    const make = () => {
      const audio = new Audio(url);
      audio.preload = "auto";
      audio.volume = 0;
      audio.dataset.cldAmbient = "true";
      return audio;
    };
    this.decks = [make(), make()];
    this.current = 0;
    this.packId = pack.id;
    this.playing = true;
    this.heldByMedia.clear();
    const deck = this.decks[0];
    deck.volume = this.volume;
    try {
      await deck.play();
    } catch (error) {
      console.warn("[Content Library] Ambient playback failed", error);
      this.stop();
      return;
    }
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.emit();
  }

  stop(notify = true): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    for (const deck of this.decks ?? []) {
      deck.pause();
      deck.removeAttribute("src");
      deck.load();
    }
    this.decks = null;
    this.fading = false;
    this.playing = false;
    this.packId = "";
    this.heldByMedia.clear();
    if (notify) this.emit();
  }

  setVolume(value: number): void {
    const volume = Math.min(1, Math.max(0, value));
    this.plugin.settings.ambientVolume = volume;
    void this.plugin.saveSettings(false);
    if (this.decks && !this.fading) this.decks[this.current].volume = volume;
  }

  /** Called when the active pack changes: follow it, or stop if it has no ambience. */
  syncWithPack(pack: ThemePack | null): void {
    if (!this.playing) return;
    if (!pack?.ambient) this.stop();
    else if (pack.id !== this.packId) void this.play(pack);
  }

  private tick(): void {
    if (!this.decks || this.heldByMedia.size) return;
    const active = this.decks[this.current];
    const duration = Number.isFinite(active.duration) ? active.duration : 0;
    if (!duration) return;
    const remaining = duration - active.currentTime;
    if (!this.fading && remaining <= FADE_SECONDS) {
      const next = this.decks[1 - this.current];
      next.currentTime = 0;
      next.volume = 0;
      void next.play().catch(() => undefined);
      this.fading = true;
    }
    if (this.fading) {
      const next = this.decks[1 - this.current];
      const progress = Math.min(1, Math.max(0, 1 - remaining / FADE_SECONDS));
      // Equal-power crossfade keeps loudness steady through the seam.
      active.volume = this.volume * Math.cos((progress * Math.PI) / 2);
      next.volume = this.volume * Math.sin((progress * Math.PI) / 2);
      if (progress >= 1 || active.ended) {
        active.pause();
        active.currentTime = 0;
        this.current = 1 - this.current;
        this.decks[this.current].volume = this.volume;
        this.fading = false;
      }
    }
  }

  private isOwn(target: EventTarget | null): boolean {
    return target instanceof HTMLMediaElement && target.dataset.cldAmbient === "true";
  }

  private onMediaPlay(event: Event): void {
    const target = event.target;
    if (!this.playing || !(target instanceof HTMLMediaElement) || this.isOwn(target)) return;
    this.heldByMedia.add(target);
    for (const deck of this.decks ?? []) deck.pause();
    this.emit();
  }

  private onMediaStop(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLMediaElement) || this.isOwn(target) || !this.heldByMedia.delete(target)) return;
    if (!this.playing || this.heldByMedia.size || !this.decks) return;
    void this.decks[this.current].play().catch(() => undefined);
    if (this.fading) void this.decks[1 - this.current].play().catch(() => undefined);
    this.emit();
  }

  /** True while another player has temporarily paused the ambience. */
  get held(): boolean {
    return this.heldByMedia.size > 0;
  }
}
