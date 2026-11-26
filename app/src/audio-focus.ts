/** One audible source across the desktop window and every tab/iframe.
 * The Web Lock stays held until the previous player has actually gone silent.
 * Broadcast messages only ask for a stop; they never grant playback rights.
 */
import { connect, getJson, inTauri, subscribe, type Conn, type WorldState } from "./api";

type Priority = "manual" | "background" | "effect";
const LOCK = "rillbuddy-audio";
const bus = typeof BroadcastChannel === "function" ? new BroadcastChannel(LOCK) : null;
const clients = new Set<AudioFocus>();
let muted = false;
let policy: Promise<void> | undefined;

export function initAudioPolicy(conn?: Conn): Promise<void> {
  return policy ??= (async () => {
    try {
      const c = conn ?? await connect();
      const update = (w: WorldState) => {
        muted = w.focus || w.sounds === false;
        if (muted) for (const client of clients) void client.stop();
      };
      update(await getJson<WorldState>(c, "/v1/world"));
      subscribe(c, (type, data) => {
        if (type === "world.state") update(data as WorldState);
        if (type === "settings.changed") {
          const s = data as { focus_mode: boolean; sounds: boolean };
          update({ focus: s.focus_mode, sounds: s.sounds } as WorldState);
        }
      });
    } catch (e) {
      // A temporary daemon/WebView fetch failure must not turn every player
      // into a permanently muted source. Explicit focus/sounds settings are
      // applied when the next world or settings event arrives.
      console.warn("audio policy", e);
      muted = false; // Plain browser previews also work without petd.
    }
    if (inTauri) {
      const { listen } = await import("@tauri-apps/api/event");
      let boss = false;
      await listen<boolean>("boss", (e) => {
        boss = e.payload;
        if (boss) for (const client of clients) void client.stop();
      });
      const { invoke } = await import("@tauri-apps/api/core");
      boss = await invoke<boolean>("boss_muted");
      isBossMuted = () => boss;
    }
  })();
}
let isBossMuted = () => false;

function publish(label: string, playing: boolean, owner: string, phase = "loading") {
  localStorage.setItem("rill.audio.status", JSON.stringify({ label, playing, owner, phase, ts: Date.now() }));
  window.dispatchEvent(new Event("audio-status"));
}

bus?.addEventListener("message", (e) => {
  if (e.data?.type === "interrupt") {
    for (const client of clients) if (client.lease === e.data.owner) void client.stop();
  }
});

type AudioStatus = { owner?: string; playing?: boolean; ts?: number };

function status(): AudioStatus {
  try { return JSON.parse(localStorage.getItem("rill.audio.status") ?? "{}"); }
  catch { return {}; }
}

function interrupt(owner: string): void {
  bus?.postMessage({ type: "interrupt", owner });
  for (const client of clients) if (client.lease === owner) void client.stop();
}

export class AudioFocus {
  readonly id = crypto.randomUUID();
  private generation = 0;
  private unlock: (() => void) | null = null;
  lease: string | null = null;
  private stopping: Promise<void> = Promise.resolve();
  private stoppingActive = false;
  constructor(readonly label: string, private readonly silence: () => void | Promise<void>) {
    clients.add(this);
  }
  get held(): boolean { return this.unlock !== null; }
  markPlaying(): void { if (this.lease && this.held) publish(this.label, true, this.lease, "playing"); }

  async acquire(priority: Priority = "manual"): Promise<boolean> {
    const gen = ++this.generation;
    if (this.held) await this.halt();
    else await this.stopping;
    await initAudioPolicy();
    if (muted || isBossMuted() || gen !== this.generation) return false;
    // Some WebView2 versions expose no Web Locks implementation. Keep one
    // audible owner with the same status channel in that case.
    if (!navigator.locks) return this.acquireFallback(priority, gen);
    const until = Date.now() + (priority === "manual" ? 2500 : 0);
    do {
      const granted = await new Promise<boolean>((resolve) => {
        void navigator.locks.request(LOCK, { ifAvailable: true }, async (lock) => {
          if (!lock || muted || isBossMuted() || gen !== this.generation) return void resolve(false);
          await new Promise<void>((release) => {
            this.unlock = release;
            this.lease = `${this.id}:${gen}`;
            publish(this.label, true, this.lease);
            resolve(true);
          });
        }).catch(() => resolve(false));
      });
      if (granted) return true;
      if (priority !== "manual") break;
      // Target the exact lease. A delayed message must never stop a newer play.
      let owner: string | undefined;
      try { owner = JSON.parse(localStorage.getItem("rill.audio.status") ?? "{}").owner; } catch { /* No owner yet. */ }
      if (owner) {
        interrupt(owner);
      }
      await new Promise((r) => setTimeout(r, 60));
    } while (Date.now() < until && gen === this.generation && !muted && !isBossMuted());
    return false;
  }

  private async acquireFallback(priority: Priority, gen: number): Promise<boolean> {
    const until = Date.now() + (priority === "manual" ? 2500 : 0);
    do {
      if (gen !== this.generation || muted || isBossMuted()) return false;
      const current = status();
      if (current.playing && current.owner) {
        interrupt(current.owner);
        await new Promise((r) => setTimeout(r, 60));
        continue;
      }
      const lease = `${this.id}:${gen}`;
      publish(this.label, true, lease);
      // Another page can win the same tick. Verify the status before exposing
      // the lease to the caller.
      if (status().owner !== lease || status().playing !== true) return false;
      this.unlock = () => {
        const latest = status();
        if (latest.owner === lease) publish(this.label, false, lease);
      };
      this.lease = lease;
      return true;
    } while (priority === "manual" && Date.now() < until);
    return false;
  }

  /** Invalidate pending loads first, silence the source, then release the lock. */
  stop(): Promise<void> {
    this.generation++;
    return this.halt();
  }

  private halt(): Promise<void> {
    if (this.stoppingActive) return this.stopping;
    this.stoppingActive = true;
    const release = this.unlock;
    const lease = this.lease;
    this.unlock = null;
    this.lease = null;
    this.stopping = Promise.resolve().then(() => this.silence()).then(() => {
      if (release && lease) { publish(this.label, false, lease); release(); }
    }).finally(() => { this.stoppingActive = false; });
    return this.stopping;
  }
}

/** Short notifications yield to music/radio/ambience instead of interrupting it. */
export async function playEffect(urls: string[], volume: number, spacingMs = 0): Promise<void> {
  const audio: HTMLAudioElement[] = [];
  const timers: number[] = [];
  const focus = new AudioFocus("提示音", () => {
    timers.forEach(clearTimeout);
    audio.forEach((a) => { a.pause(); a.removeAttribute("src"); });
    clients.delete(focus);
  });
  if (!await focus.acquire("effect")) { clients.delete(focus); return; }
  let left = urls.length;
  const done = () => { if (--left <= 0) { void focus.stop(); clients.delete(focus); } };
  urls.forEach((url, i) => timers.push(window.setTimeout(() => {
    if (!focus.held) return;
    const a = new Audio(url);
    audio.push(a);
    a.volume = volume;
    a.onended = a.onerror = done;
    void a.play().then(() => focus.markPlaying()).catch(done);
  }, i * spacingMs)));
  timers.push(window.setTimeout(() => { void focus.stop(); clients.delete(focus); }, 10_000));
}

window.addEventListener("pagehide", () => { for (const client of clients) void client.stop(); });
