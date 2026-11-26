/** Natural field recordings, bundled for offline playback. See audio/ambience/LICENSE.txt. */
import { AudioFocus } from "./audio-focus";

export type Soundscape = "none" | "rain" | "wind" | "night";
type Active = { source: AudioBufferSourceNode; gain: GainNode };

export class Ambience {
  private ctx: AudioContext | null = null;
  private active: Active | null = null;
  private requested: Soundscape = "none";
  private generation = 0;
  private requests = 0;
  private cached: { kind: Soundscape; buffer: AudioBuffer } | null = null;
  private volume = 0.25;
  private timer = 0;
  private focus = new AudioFocus("环境声", () => this.silence());
  error = "";
  get playing(): boolean { return this.focus.held && this.active !== null; }

  async start(kind: Soundscape, volume = this.volume, durationMin?: number, manual = false): Promise<void> {
    this.setVolume(volume);
    if (kind === "none") return void this.stop();
    if (kind === this.requested) return;
    const request = ++this.requests;
    await this.focus.stop();
    if (request !== this.requests) return;
    this.requested = kind;
    this.error = "";
    const gen = ++this.generation;
    try {
      if (!await this.focus.acquire(manual ? "manual" : "background") || gen !== this.generation) {
        if (gen === this.generation) {
          this.requested = "none";
          if (manual) {
            this.error = "Audio is muted, unsupported, or still occupied";
            localStorage.setItem("ambience.error", this.error);
          }
        }
        return;
      }
      const ctx = this.ctx ??= new AudioContext();
      let buffer = this.cached?.kind === kind ? this.cached.buffer : null;
      if (!buffer) {
        const response = await fetch(`audio/ambience/${kind}.mp3`);
        if (!response.ok) throw new Error("recording unavailable");
        buffer = await ctx.decodeAudioData(await response.arrayBuffer());
        if (gen !== this.generation) return;
        this.cached = { kind, buffer };
      }
      if (gen !== this.generation || !this.focus.held) return;
      await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 1500))]);
      if (gen !== this.generation || !this.focus.held) return;
      if (ctx.state !== "running") throw new Error("audio needs a user gesture");
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      // The recordings are level-matched in the asset pipeline; cap maximum gain.
      source.connect(gain).connect(ctx.destination);
      gain.gain.linearRampToValueAtTime(this.volume * 0.65, ctx.currentTime + 2);
      this.active = { source, gain };
      source.start();
      this.focus.markPlaying();
      localStorage.removeItem("ambience.error");
      if (durationMin) this.timer = window.setTimeout(() => this.stop(), durationMin * 60_000);
    } catch (e) {
      if (gen !== this.generation) return;
      this.error = String(e);
      await this.focus.stop();
      localStorage.setItem("ambience.error", this.error);
    }
  }

  setVolume(volume: number): void {
    const next = Math.max(0, Math.min(1, volume));
    if (next === this.volume) return;
    this.volume = next;
    if (!this.ctx || !this.active) return;
    const now = this.ctx.currentTime;
    const param = this.active.gain.gain;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(this.volume * 0.65, now, 0.18);
  }

  stop(): void { this.requests++; void this.focus.stop(); }

  private async silence(): Promise<void> {
    this.generation++;
    this.requested = "none";
    clearTimeout(this.timer);
    this.timer = 0;
    const old = this.active;
    this.active = null;
    if (old) {
      const now = this.ctx!.currentTime;
      old.gain.gain.cancelAndHoldAtTime(now);
      old.gain.gain.linearRampToValueAtTime(0, now + 0.06);
      await new Promise((r) => setTimeout(r, 70));
      old.gain.gain.value = 0;
      old.source.stop();
      old.source.disconnect();
      old.gain.disconnect();
    }
    if (this.ctx?.state === "running") await this.ctx.suspend();
  }
}
