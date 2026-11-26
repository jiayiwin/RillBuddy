// One pet window: the rig (the pet's body) on one canvas, and over it the
// The one desktop companion: it summarizes every source/session, acts when
// the daemon asks, and keeps the mouse interactions deliberately small. The
// workbench still owns the full per-agent/session detail.

import { connect, getJson, holderOf, inTauri, postJson, SOURCE_NAMES, subscribe, type PetView, type Todo, type WorldState } from "./api";
import { FOOT_H, PetRenderer, type HitRect } from "./pet";
import { initLang, t as tr } from "./i18n"; // `t` is a common local name here
import { loadRig, type RigPet } from "./rig/rig.js";
import { faceFor, type Mood } from "./rig/portrait";
import { applySkin, sampleUrl } from "./skin";
import { line as voiceLine } from "./voice";
import { createPerformer, type Performer } from "./rig/perform.js";
import { BRISTLE, drawBroom, newBroom, sweep, sweepLean, type DeskPlan, type Pose, type Stage } from "./sweep";
import { Ambience, type Soundscape } from "./ambience";
import { AudioFocus, initAudioPolicy } from "./audio-focus";

const petId = new URLSearchParams(location.search).get("pet") ?? "main";
const canvas = document.getElementById("pet") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
/** The pet's body: a layered rig on its own canvas, under the overlay canvas. */
const rigCanvas = document.getElementById("rig") as HTMLCanvasElement;
const rigCtx = rigCanvas.getContext("2d")!;
/** Logical px per rig unit at size 1: the pet stands about 122 px wide. */
const RIG_PX = 0.288;
/** How long a dance it was told to do lasts: one full round of moves. */
const DANCE_BARS = 12;
let rig: RigPet | null = null;
/** The screen edge it is clinging to after a hard throw ("left" | "right" | "top"), and the sway that goes with hanging. */
let clinging: string | null = null;
let clingSway = 0;
/** Back to standing as usual: it was picked up, it slipped, it landed. */
function uncling() {
  clinging = null;
  window.clearInterval(clingSway);
  if (rig) Object.assign(rig.play, { rot: 0, face: null });
}
let stage: Performer | null = null;
let rigScale = RIG_PX;
let winSize = { w: 200, h: 182 };
const HOVER_MS = 1000;
/** 5 s, more than 12 clicks: it has had enough. */
const ANNOY_WINDOW = 5000;
const ANNOY_CLICKS = 12;
const SULK_MS = 60_000;
/** Back and forth over the head 3 times within 2 s: petted. */
const PET_TURNS = 6;
const PET_WINDOW = 2000;

async function tauriWindow() {
  return (await import("@tauri-apps/api/window")).getCurrentWindow();
}

async function invoke<T = void>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  if (!inTauri) return undefined;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args).catch((e) => {
    console.error(cmd, e);
    return undefined;
  });
}

/** One beat of something the daemon scripted for this pet: a line, sometimes with a gesture. */
interface Script {
  pet: string;
  rule: string;
  action?: string | null;
  bubble?: string | null;
  ms: number;
  delay?: number;
  /** With the `kegel` action: how many squeezes the set has. */
  reps?: number;
}

/** The agent's state as petd names it. */
let agentState = "";
let globalOverride: PetView | null = null;

/** State priority for the single desktop surface. Details stay in sessions. */
const GLOBAL_PRIORITY: Record<string, number> = {
  attention: 100,
  error: 90,
  stone: 88,
  aborted: 84,
  thinking: 70,
  tool: 68,
  reading: 66,
  done: 50,
  idle: 20,
  sleeping: 10,
  offline: 0,
};

function globalView(views: PetView[]): PetView | null {
  const live = views.flatMap((v) => v.sessions ?? []);
  const top = [...live].sort((a, b) => {
    const d = (GLOBAL_PRIORITY[b.state] ?? 0) - (GLOBAL_PRIORITY[a.state] ?? 0);
    return d || b.updated_at - a.updated_at || b.started_at - a.started_at;
  })[0];
  const source = views.find((v) => v.id === "claude-code") ?? views[0];
  if (!source && !live.length) return null;
  const state = top?.state ?? "sleeping";
  const bubbleKey = ["attention", "done", "error", "stone"].includes(state) ? state : undefined;
  const sessions = [...live].sort((a, b) => {
    const d = (a.state === "attention" ? 0 : 1) - (b.state === "attention" ? 0 : 1);
    return d || b.updated_at - a.updated_at;
  });
  return {
    // The desktop identity is stable and source-neutral. No second window is created.
    id: "main",
    state: state as PetView["state"],
    since: top?.since ?? source?.since ?? 0,
    camp: null,
    marker: "Rill",
    attention_kind: source?.attention_kind,
    bubble: bubbleKey ? { key: bubbleKey, project: top ? `${SOURCE_NAMES[top.source] ?? top.source} · ${top.project}` : undefined } : undefined,
    online: sessions.length,
    waiting: sessions.filter((s) => s.state === "attention").length,
    sessions,
    activity: views.find((v) => v.activity)?.activity,
    size: source?.size ?? 1,
    skin: source?.skin ?? "zimeng",
  };
}

function moodOf(state: string): Mood {
  const h = new Date().getHours();
  if (state === "attention") return "wait";
  if (state === "done") return "done";
  if (state === "thinking" || state === "tool" || state === "reading") return h < 5 || h >= 23 ? "night" : "work";
  if (state === "error" || state === "stone" || state === "aborted" || state === "offline") return "worry";
  return "rest";
}

/** The broom it sweeps the desktop with, and the colour of its binding (the pet's own). */
const broom = newBroom();
let band = "#7a5fc0";
/** Set once the window is up: sweep the desktop now (a "yes" on its offer). */
let startSweep: ((stow?: boolean) => void) | null = null;

/** 收工: the lamp left on round it while you see the last turn through (0..1, eased toward `lampTo`). */
let lampK = 0;
let lampTo = 0;

/** The warm pool of the lamp, behind the pet, fading out before the window's edges. */
function drawLamp() {
  if (lampK < 0.01) return;
  const cx = winSize.w / 2, floor = winSize.h - FOOT_H;
  const r = winSize.w / 2;
  const g = rigCtx.createRadialGradient(cx, floor - r * 0.45, 4, cx, floor - r * 0.45, r);
  g.addColorStop(0, `rgba(255,214,150,${0.34 * lampK})`);
  g.addColorStop(0.55, `rgba(255,196,130,${0.12 * lampK})`);
  g.addColorStop(1, "rgba(255,190,120,0)");
  rigCtx.fillStyle = g;
  rigCtx.fillRect(0, 0, winSize.w, winSize.h);
}

/** Draw the rig standing on the overlay's foot line, centred; the broom in front of it while it sweeps. */
function drawRig() {
  if (!rig || !stage) return;
  const dpr = window.devicePixelRatio || 1;
  rigCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  rigCtx.clearRect(0, 0, winSize.w, winSize.h);
  drawLamp();
  rigCtx.translate(winSize.w / 2 - rig.foot[0] * rigScale, winSize.h - FOOT_H - rig.foot[1] * rigScale);
  const k = rigScale / RIG_PX;
  // Sweeping, it holds the broom at its side, the handle behind it; riding, it sits on the stick.
  if (broom.pose === "sweep") {
    rigCtx.save();
    rigCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBroom(rigCtx, broom, winSize.w / 2, winSize.h - FOOT_H, k, performance.now(), band, "back");
    rigCtx.restore();
  }
  stage.draw(rigCtx, rigScale);
  if (broom.pose !== "off" || broom.dust.length) {
    rigCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBroom(rigCtx, broom, winSize.w / 2, winSize.h - FOOT_H, k, performance.now(), band, "front");
  }
}

/** Nothing the pet does should be heard under the boss key, in focus mode, or with sound off. */
let bossMuted = false;
let desktopVisible = true;
let focusOn = false;
/** `features.sounds`, as the world reports it. */
let soundsOn = true;
type PetMode = "auto" | "quiet" | "settle" | "work" | "waiting" | "wind_down";
const ambience = new Ambience();
const MODE_SOUND: Record<PetMode, Soundscape> = {
  auto: "wind",
  quiet: "none",
  settle: "rain",
  work: "wind",
  waiting: "rain",
  wind_down: "night",
};
let petMode: PetMode = "auto";
let audioAway = false, audioNight = false, ambienceAuto = true, ambienceVolume = 0.25;
let audioSettingsReady = false;
const autoSoundAfter = Date.now() + 15_000;
let musicContext: typeof import("tone") | null = null;
let startingMusic = false;
const musicFocus = new AudioFocus("宠物奏乐", async () => {
  startingMusic = false;
  // A cancelled Tone.start() can still resume its context later. Keep its
  // destination muted so release/reverb tails cannot leak over the next source.
  if (musicContext) musicContext.getDestination().mute = true;
  stage?.stop();
  if (musicContext?.getContext().state === "running") await (musicContext.getContext().rawContext as AudioContext).suspend();
});

function syncAmbience(manual = false): void {
  if (!audioSettingsReady || bossMuted || !desktopVisible || focusOn || !soundsOn || audioAway || ambienceVolume === 0) {
    ambience.stop();
    return;
  }
  const mode = petMode === "auto" ? (!ambienceAuto || Date.now() < autoSoundAfter ? "quiet" : audioNight ? "wind_down" : "work") : petMode;
  const sound = MODE_SOUND[mode];
  if (sound === "none") ambience.stop();
  else void ambience.start(sound, ambienceVolume, undefined, manual);
}

function setPetMode(mode: PetMode, manual = false): void {
  petMode = mode;
  syncAmbience(manual);
}

async function main() {
  const conn = await connect();
  await initAudioPolicy(conn);
  await initLang(conn);
  const pet = new PetRenderer(ctx);
  // The daemon still reports one view per source for the workbench. The
  // desktop surface folds them into one stable companion view.
  const [{ pets }, global] = await Promise.all([
    getJson<{ pets: PetView[] }>(conn, "/v1/pets"),
    getJson<PetView>(conn, "/v1/pet").catch(() => null),
  ]);
  const sourceViews = new Map<string, PetView>();
  for (const v of pets) sourceViews.set(v.id, v);
  const firstGlobal = globalView([...sourceViews.values()]);
  globalOverride = global;
  // In a browser (no host) `?skin=` dresses the page as any of them, for looking at one without an agent.
  const previewSkin = inTauri ? null : new URLSearchParams(location.search).get("skin");
  const me = applySkin(previewSkin ?? global?.skin ?? firstGlobal?.skin);
  band = me.colors.accentOff;
  const [loaded, tone] = await Promise.all([loadRig(me.rig ?? "rig/zimeng/"), import("tone").catch(() => null)]);
  musicContext = tone;
  rig = loaded;
  // Samples ship with the app (see each folder's LICENSE.txt).
  stage = createPerformer(tone, rig, { instrument: me.instrument, baseUrl: sampleUrl(me.instrument), onError: (e) => console.warn("samples", e) });
  const audioSettings = (s: { sounds?: boolean; focus_mode?: boolean; ambience_auto?: boolean; ambience_volume?: number; pet_mode?: string }) => {
    soundsOn = s.sounds !== false;
    focusOn = s.focus_mode === true;
    ambienceAuto = s.ambience_auto !== false;
    ambienceVolume = Math.max(0, Math.min(100, s.ambience_volume ?? 25)) / 100;
    audioSettingsReady = true;
    const mode = s.pet_mode && s.pet_mode in MODE_SOUND ? s.pet_mode as PetMode : "auto";
    setPetMode(mode, mode !== petMode && mode !== "auto");
  };
  audioSettings(await getJson(conn, "/v1/settings"));
  window.setInterval(() => {
    if (musicFocus.held && !startingMusic && !stage?.playing) void musicFocus.stop();
    syncAmbience();
  }, 3000);
  const fitRig = (size: number) => {
    const [x0, y0, x1, y1] = loaded.rig.bbox;
    rigScale = RIG_PX * size;
    pet.rigBox = { w: (x1 - x0) * rigScale, h: (y1 - y0) * rigScale };
    pet.fit();
  };
  pet.onGesture = (g) => loaded.react(g);
  // A set done to the end earns a fish: the daemon says whether one is due, and what the pet says about it.
  pet.onKegelDone = () => {
    void postJson<{ ok: boolean; text?: string }>(conn, "/v1/earn", { why: "kegel", pet: petId })
      .then((r) => r.ok && r.text && window.setTimeout(() => pet.say(r.text!, 4200), 2900))
      .catch(() => {});
  };
  pet.onResize = (w, h) => void resize(w, h);
  pet.onHits = (rects) => void reportHits(rects);
  fitRig(1);
  // Waiting on you: it keeps looking up until you come.
  window.setInterval(() => {
    if (agentState === "attention") loaded.react("perk");
  }, 6000);
  loaded.expr = faceFor("rest", "");

  // ---- 收工 and coming back (see petd's evening.rs): how it is, rather than what it says.
  const WORKING = ["thinking", "tool", "reading"];
  const FAILED = ["error", "stone", "aborted"];
  /** Back at the desk: this long (or until you look at it) it stays as it was while you were gone. */
  const GLANCE_MS = 90_000;
  let deskNow = { away: false, lamp: false, night: false, slip: false };
  let glanceUntil = 0;
  /** A job of its agent's ended while you were out. */
  let doneAway = false;
  /** Since when its agent has been at the current turn (0: not working). */
  let workSince = 0;
  /** Its back to you, face to the work. */
  let turnedAway = false;
  /** The morning's slip, in its hand while it asks. */
  let holdSlipUntil = 0;
  /** "Take you there?", kept back until you look at it. */
  let heldOffer: (() => void) | null = null;
  const glancing = () => Date.now() < glanceUntil;
  const pose = () => {
    const now = Date.now();
    const out = deskNow.away || glancing();
    const working = WORKING.includes(agentState);
    const waiting = agentState === "attention";
    // Back turned: while you are away, and on the lamp-lit last turns once a turn has gone on a little.
    turnedAway = working && (out || (deskNow.lamp && workSince > 0 && now - workSince > 8000));
    pet.pile = out && doneAway && !working && !waiting;
    pet.sign = (out && waiting) || (now < holdSlipUntil && pet.isAsking());
    pet.footSlip = deskNow.slip && deskNow.away;
    pet.hush = out;
    const asleep = out && !working && !waiting && !FAILED.includes(agentState) && (doneAway || deskNow.night);
    loaded.expr = asleep ? "asleep" : faceFor(moodOf(agentState), agentState);
    lampTo = deskNow.lamp ? 1 : 0;
    if (!out) {
      // The glance is over: as before you left; what it held back, it says now (if it still applies).
      doneAway = false;
      const f = heldOffer;
      heldOffer = null;
      if (f && waiting) f();
    }
  };
  window.setInterval(pose, 1000);
  // You look at it: the glance is over for this one.
  window.addEventListener("pointermove", () => {
    if (!glancing()) return;
    glanceUntil = 0;
    pose();
  });
  let scriptTimers: number[] = [];

  function onView(v: PetView) {
    sourceViews.set(v.id, v);
    const global = globalOverride ?? globalView([...sourceViews.values()]);
    if (!global) return;
    if (!previewSkin && global.skin && global.skin !== me.id) return location.reload();
    fitRig(global.size ?? 1);
    // Being needed ends a performance: nothing plays over "your turn".
    if (global.state === "attention" && stage?.playing) stage.stop();
    // ...and gets it down from the screen edge it was clinging to.
    if (global.state === "attention" && clinging && inTauri) void import("@tauri-apps/api/core").then(({ invoke }) => invoke("pet_let_go", { why: "called" }));
    pet.setView(global);
    if ((global.state as string) !== agentState) {
      const was = agentState;
      agentState = global.state as string;
      if (WORKING.includes(agentState)) workSince ||= Date.now();
      else {
        workSince = 0;
        // A job ended while you were out: it will be asleep by the pages when you come back.
        if (WORKING.includes(was) && (deskNow.away || glancing()) && !FAILED.includes(agentState) && agentState !== "attention") doneAway = true;
      }
      pose();
    }
  }

  /** The gesture that goes with a scripted action name. */
  const gestureOf = (action?: string | null) => (action === "cheer" || action === "applaud" || action === "eat" ? "cheer" : "perk");

  function onScript(s: Script) {
    const run = () => {
      if (s.action === "kegel") {
        // A set asked for from the menu: it says how many, then turns round and counts.
        perform("kegel", s.bubble ?? null, s.reps ?? Math.max(1, Math.round((s.ms - 3000) / 6000)));
        return;
      }
      if (s.bubble) pet.act(gestureOf(s.action), s.bubble, s.ms);
      else if (s.action) pet.act(gestureOf(s.action));
    };
    // One scene can queue several beats for the same pet, so each delayed beat
    // keeps its own timer; pet.cancel clears them all.
    if (s.delay) scriptTimers.push(window.setTimeout(run, s.delay));
    else run();
  }

  /**
   * Something the pet decided to do for you: speak, dance, play its piece, lead
   * a kegel set, or sit by the other one and listen. `at` is the wall-clock
   * moment a shared performance begins, so two pets in two windows start on the
   * same beat; `walks` means this one is walking over first and speaks when it
   * gets there.
   */
  let actTimers: number[] = [];
  function perform(act: string, text: string | null, reps = 10, at = 0, walks = false, extra: Record<string, unknown> = {}) {
    actTimers.forEach(clearTimeout);
    actTimers = [];
    // Waiting on you comes first; only an offer about that wait (or about where it stopped) is made meanwhile.
    if (agentState === "attention" && !(act === "offer" && (extra.offer === "go" || extra.offer === "pickup"))) return;
    const later = (ms: number, fn: () => void) => actTimers.push(window.setTimeout(fn, Math.max(0, ms)));
    const wait = Math.max(0, at - Date.now());
    const free = () => agentState !== "attention" && !pet.isMoving();
    // A pet on the move (walking over, or home from the last performance) begins once it stands still.
    const whenStill = (fn: () => void, tries = 24) => {
      if (agentState === "attention") return;
      if (!pet.isMoving()) fn();
      else if (tries > 0) later(150, () => whenStill(fn, tries - 1));
    };
    const silent = () => bossMuted || !desktopVisible || focusOn || !soundsOn;
    const say = (ms: number) => {
      if (!text) return;
      // The walk takes a little over a second.
      later(walks ? Math.min(wait, 1500) : 0, () => whenStill(() => pet.say(text, ms)));
    };
    if (act === "speak") {
      if (text) later(walks ? Math.min(wait, 1500) : 0, () => whenStill(() => pet.act("perk", text, 6000)));
    } else if (act === "watch") {
      // Whatever it was doing, it stops to listen.
      if (stage?.playing) stage.stop();
      // It sits by the one playing and listens: a look up as each phrase turns.
      say(4000);
      for (let i = 0; i < 4; i++) later(wait + 6000 + i * 8200, () => free() && !stage?.playing && loaded.react("perk"));
    } else if (act === "dance" || act === "play" || act === "piano") {
      say(4000);
      const mode = act === "dance" ? "dance" : "play";
      // The audio wakes a moment early, then both count in from `at`.
      later(wait - 700, () => whenStill(() => void (async () => {
        if (silent()) return void stage?.start(mode, { bars: mode === "dance" ? DANCE_BARS : 0, silent: true });
        const acquired = await musicFocus.acquire(extra.why === "asked" ? "manual" : "background");
        if (!acquired || !musicFocus.held) return;
        startingMusic = true;
        const until = Date.now() + 8000;
        while (stage && !stage.ready && musicFocus.held && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
        if (!musicFocus.held) return;
        if (!stage?.ready) {
          await musicFocus.stop();
          pet.say(tr("乐器还没准备好，稍后再试一下。", "The instrument isn't ready yet. Try again shortly."), 3500);
          return;
        }
        if (musicContext) musicContext.getDestination().mute = false;
        await stage?.start(mode, { bars: mode === "dance" ? DANCE_BARS : 0, at: at || undefined });
        startingMusic = false;
        if (musicContext?.getContext().state === "running" && musicFocus.held) musicFocus.markPlaying();
        else await musicFocus.stop();
      })()));
    } else if (act === "kegel") {
      // It says why first, then turns round and counts.
      if (stage?.playing) stage.stop();
      if (text) pet.say(text, 3000);
      later(text ? 2800 : 0, () => whenStill(() => pet.startKegel(reps)));
    } else if (act === "give") {
      // It has walked over with a sweet from the jar, and holds it out.
      if (stage?.playing) stage.stop();
      later(wait, () => whenStill(() => pet.act("cheer", text ?? undefined, 3800)));
    } else if (act === "take") {
      // The sweet comes over from the one standing beside it; it eats, then says so.
      if (stage?.playing) stage.stop();
      later(wait + 400, () =>
        whenStill(() =>
          void sideOf(String(extra.from ?? "")).then((side) =>
            pet.fx.fish(() => {
              pet.act("cheer");
              if (text) later(300, () => pet.say(text, 4200));
            }, extra.treat as { shape?: string; colors?: string[] } | null, side),
          ),
        ),
      );
    } else if (act === "bump") {
      // Two finished together. The one that walked over goes the last bit, right up to the other;
      // then both hop at the same moment, and it speaks first.
      if (stage?.playing) stage.stop();
      if (walks && extra.to) later(wait - 1300, () => whenStill(() => void sidle(String(extra.to))));
      later(wait, () =>
        whenStill(() => {
          pet.act("cheer");
          if (text) later(walks ? 0 : 1600, () => pet.say(text, 3200));
        }),
      );
    } else if (act === "offer") {
      // It asks; "yes" on its bubble does it (the host knows what: offer|pet|what).
      const what = String(extra.offer ?? "");
      // "go": you are back and its agent waits on you; "yes" brings that session's window to the front.
      // "card": yesterday's notes, in the morning; "yes" opens its card, where they are.
      if (text && what === "card") whenStill(() => pet.ask(text, tr("看看", "Have a look"), tr("不用", "Not now"), 30_000, () => void showCardNow?.()));
      else if (text && what === "go") {
        // Just back, while you take in how they all are: it says it only once you look at it.
        const go = () => pet.ask(text, tr("好", "Yes"), tr("不用", "Not now"), 60_000, () => void goToSession(pet), true);
        // In the morning it has just asked about the same session (where it stopped): not twice.
        if (Date.now() - holdSlipUntil > -100_000) {
          if (glancing()) heldOffer = go;
          else go();
        }
      }
      // The morning: where its agent stopped last night; "yes" brings that very session to the front.
      else if (text && what === "pickup") {
        holdSlipUntil = Date.now() + 120_000;
        heldOffer = null;
        rig?.react("perk");
        pet.ask(text, tr("过去", "Go"), tr("等会儿", "Later"), 120_000, () => void goToStop(pet, Number(extra.pid) || 0, String(extra.project ?? "")), true);
      }
      else if (text && what) whenStill(() => pet.ask(text, tr("好", "Yes"), tr("不用", "Not now"), 20_000, () => void invoke("menu_pick", { id: `offer|${petId}|${what}` })));
    } else if (act === "chat") {
      // It walks over and says something about nothing in particular...
      if (text) later(walks ? Math.min(wait, 1500) : 0, () => whenStill(() => pet.act("perk", text, 5200)));
    } else if (act === "reply") {
      // ...and the other one answers, a breath later.
      if (text) later(wait + 1700, () => whenStill(() => pet.act("perk", text, 4600)));
    }
  }

  /** Scamper along the floor until it stands shoulder to shoulder with `other` (it goes home with the rest of the walk). */
  async function sidle(other: string) {
    if (!inTauri) return;
    const { WebviewWindow, getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const o = await WebviewWindow.getByLabel(`pet-${other}`);
    if (!o) return;
    const me = getCurrentWebviewWindow();
    const sc = await me.scaleFactor();
    const [mp, ms, op, os] = await Promise.all([me.outerPosition(), me.outerSize(), o.outerPosition(), o.outerSize()]);
    const mine = (mp.x + ms.width / 2) / sc, theirs = (op.x + os.width / 2) / sc;
    // About one body apart, centre to centre: they touch, and nobody gets pushed away.
    const gap = (pet.rigBox?.w ?? 96) * 0.95;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("pet_chase", { pet: petId, x: theirs + (mine < theirs ? -gap : gap) }).catch(() => {});
  }

  /** Which side of this pet another pet's window stands on. */
  async function sideOf(other: string): Promise<"left" | "right" | undefined> {
    if (!inTauri || !other) return undefined;
    const { WebviewWindow, getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const o = await WebviewWindow.getByLabel(`pet-${other}`);
    if (!o) return undefined;
    const [mine, theirs] = await Promise.all([getCurrentWebviewWindow().outerPosition(), o.outerPosition()]);
    return theirs.x < mine.x ? "left" : "right";
  }

  // ---- sweeping the desktop: the pet window rides, the host moves the icons.
  const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
  /** Its window, and where the bristles are within it (physical px). */
  const bristles = async () => {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const w = getCurrentWebviewWindow();
    const sc = await w.scaleFactor();
    const k = rigScale / RIG_PX;
    return { w, bx: (winSize.w / 2 + BRISTLE[0] * k) * sc, by: (winSize.h - FOOT_H + BRISTLE[1] * k) * sc };
  };
  const desk: Stage = {
    plan: async () => (await invoke<DeskPlan | null>("desk_plan")) ?? null,
    begin: async () => (await invoke<boolean>("desk_begin")) === true,
    move: (m) => void invoke("desk_move", { moves: m }),
    end: async (n) => void (await invoke("desk_end", { who: me.id, n })),
    flyTo: async (x, y, ms) => {
      const o = await bristles();
      await invoke("pet_fly", { pet: petId, x: x - o.bx, y: y - o.by, ms });
      await sleep(ms + 30);
    },
    where: async () => {
      const o = await bristles();
      const p = await o.w.outerPosition();
      return { x: p.x + o.bx, y: p.y + o.by };
    },
    home: async () => {
      await invoke("pet_chase", { pet: petId, x: null });
      // Home when the window stops moving.
      const { w } = await bristles();
      let last = "";
      for (let i = 0; i < 40; i++) {
        await sleep(100);
        const p = await w.outerPosition();
        if (`${p.x},${p.y}` === last) break;
        last = `${p.x},${p.y}`;
      }
    },
  };
  /** Its body goes with the broom: leaning into the ride, looking down at the straw as it sweeps. */
  const lean = (p: Pose, dir: 1 | -1) => {
    if (p === "ride") Object.assign(loaded.play, { rot: dir * 7, yaw: dir * 0.5, look: [dir * 4, 0], face: "happy" });
    else if (p === "sweep") Object.assign(loaded.play, { rot: -5, yaw: -0.4, look: [-5, 3], face: null });
    else Object.assign(loaded.play, { rot: 0, yaw: null, look: null, face: null });
  };
  let sweeping = false;
  /** The sweep, done: it offers to put things back where they were. */
  const swept = (n: number | null) => {
    if (!n) return pet.say(voiceLine("tidy.neat"), 3500);
    pet.ask(voiceLine("tidy.done"), tr("放回原处", "Put them back"), tr("留着", "Keep"), 30_000, () =>
      void invoke<number>("desk_undo").then((k) => k && pet.say(voiceLine("tidy.undo"), 3000)),
    );
  };
  /**
   * The put-away sweep: a new 桌面收纳 folder appears, the icons of the files
   * nobody touched in weeks fly into it (petd moves the files when they get
   * there), and what stays is packed around it. One "put back" undoes it all.
   */
  const putAway = async () => {
    type Old = { old?: { path: string }[] };
    const seen = await getJson<Old>(conn, "/v1/drawer?place=desktop").catch(() => null);
    const paths = seen?.old?.map((f) => f.path) ?? [];
    if (!paths.length) return swept(await sweep(desk, broom, { pose: lean }));
    const made = await postJson<{ ok: boolean; path?: string }>(conn, "/v1/drawer/prepare", { place: "desktop" }).catch(() => null);
    if (!made?.ok || !made.path) return;
    // The shell shows the new folder within a moment.
    let plan: DeskPlan | null = null;
    for (let i = 0; i < 12 && !plan; i++) {
      await sleep(250);
      plan = (await invoke<DeskPlan | null>("desk_stow_plan", { paths, drawer: made.path })) ?? null;
    }
    if (!plan) return swept(await sweep(desk, broom, { pose: lean }));
    let put: { id: string } | null = null;
    const into: Stage = {
      ...desk,
      plan: async () => plan,
      // The diary gets the put-away from petd; the sweep itself says nothing more.
      end: async () => void (await invoke("desk_end", { who: me.id, n: 0 })),
      stow: async (keys) => {
        const r = await postJson<{ ok: boolean; done?: { moved: number; stowed?: { id: string } | null } }>(conn, "/v1/drawer/stow", { place: "desktop", paths: keys }).catch(() => null);
        put = r?.done?.stowed ?? null;
        return !!r?.done?.moved;
      },
    };
    const n = await sweep(into, broom, { pose: lean });
    const id = (put as { id: string } | null)?.id;
    if (!id) return swept(n);
    pet.ask(tr("收好了。都在「桌面收纳」里，按类分开放的。", "Put away, by type, in the Desktop put-away folder."), tr("放回原处", "Put them back"), tr("留着", "Keep"), 30_000, async () => {
      await postJson(conn, "/v1/drawer/unstow", { id }).catch(() => null);
      // The files come back first, then each icon to its old place.
      await sleep(900);
      await invoke<number>("desk_undo");
      pet.say(voiceLine("tidy.undo"), 3000);
    });
  };
  startSweep = (stow = false) => {
    if (sweeping || agentState === "attention") return;
    sweeping = true;
    if (stage?.playing) stage.stop();
    void (stow ? putAway() : sweep(desk, broom, { pose: lean }).then(swept))
      .catch((e) => console.error("sweep", e))
      .finally(() => {
        sweeping = false;
        broom.pose = "off";
        lean("off", -1);
      });
  };

  let lastFocus: boolean | null = null;
  for (const v of pets) onView(v);
  // 手上的事: how many slips this pet holds for you.
  const holds = async () => {
    const [{ todos }, { pets: all }] = await Promise.all([getJson<{ todos: Todo[] }>(conn, "/v1/todos"), getJson<{ pets: PetView[] }>(conn, "/v1/pets")]);
    return petId === "main" ? todos.filter((t) => !t.done_at).length : todos.filter((t) => !t.done_at && holderOf(t, all) === petId).length;
  };
  void holds().then((n) => (pet.notes = n)).catch(() => {});
  subscribe(conn, (type, data) => {
    const d = data as Record<string, unknown>;
    switch (type) {
      case "pet.state":
        sourceViews.set((data as PetView).id, data as PetView);
        void getJson<PetView>(conn, "/v1/pet").then((g) => { globalOverride = g; onView(g); }).catch(() => onView(data as PetView));
        break;
      case "pet.script":
        onScript(data as unknown as Script);
        break;
      case "codex.limits":
        {
          const used = Math.round(Number(d.used) || 0);
          if (d.kind === "card") playFx(pet, { kind: "card", from: d.from, used: d.used });
          else if (d.kind === "refresh") pet.act("cheer", tr("额度回来了。继续。", "Quota's back. On we go."), 2500);
          else if (d.kind === "low") pet.act("perk", tr(`Codex 额度快见底了，用掉 ${used}% 了。`, `Codex quota is almost gone: ${used}% used.`), 3500);
        }
        break;
      case "usage":
        // Claude Code's own limits, from its status line.
        {
          const used = Math.round(Number(d.used) || 0);
          if (d.kind === "refresh") pet.act("cheer", tr("额度回来了。继续。", "Quota's back. On we go."), 2500);
          else if (d.kind === "low")
            pet.act("perk", d.window === "seven_day" ? tr(`这一周的额度，用掉 ${used}% 了。`, `This week's quota is ${used}% gone.`) : tr(`这五个小时的额度，用掉 ${used}% 了。`, `This five-hour quota is ${used}% gone.`), 3500);
        }
        break;
      case "todo.changed":
        void holds()
          .then((n) => {
            const line = typeof d.line === "string" ? d.line : "";
            if (d.added && (petId === "main" || d.pet === petId)) {
              // A slip comes down into its hand; it looks up, and says it has it.
              pet.fx.slipIn(() => {
                pet.notes = n;
                rig?.react("perk");
                if (line) pet.say(line, 3200);
              });
            } else if (d.done && (petId === "main" || d.pet === petId)) {
              // Crossed off: the slip, balled up, goes into its mouth.
              pet.notes = n;
              pet.fx.slipEat(() => {
                rig?.react("cheer");
                pet.fx.burst("bite");
                if (line) pet.say(line, 3200);
              });
            } else pet.notes = n;
          })
          .catch(() => {});
        break;
      case "desk": {
        const away = d.away === true;
        if (deskNow.away && !away) {
          // Back: for a while (or until you look at it) it stays as it was, so you can read them at a glance.
          glanceUntil = Date.now() + GLANCE_MS;
        } else if (!deskNow.away && away) doneAway = false;
        deskNow = { away, lamp: d.lamp === true, night: d.night === true, slip: Array.isArray(d.slips) && (d.slips as string[]).length > 0 };
        audioAway = away;
        audioNight = deskNow.night;
        syncAmbience();
        pose();
        break;
      }
      case "pet.act":
        // Legacy multi-source plans used `from` for a second pet's helper
        // action. The desktop has one actor now, so the primary action is the
        // only one that should animate here.
        if (d.from) break;
        perform(String(d.act), (d.text as string | null) ?? null, Number(d.reps) || 10, Number(d.at) || 0, false, d);
        break;
      case "pet.cancel":
        scriptTimers.forEach(clearTimeout);
        scriptTimers = [];
        break;
      case "fx":
        playFx(pet, d.payload as Record<string, unknown>);
        break;
      case "pet.fx":
        if (d.kind === "catch") pet.reel(d.items as never[]);
        break;
      case "world.state": {
        const focus = (data as WorldState).focus;
        // Say so when it flips, so nobody wonders why it went quiet.
        if (lastFocus !== null && focus !== lastFocus) {
          pet.say(focus ? tr("好。我安静。", "All right. I'll be quiet.") : tr("我回来了。", "I'm back."), 3500);
        }
        lastFocus = focus;
        focusOn = focus;
        soundsOn = (data as WorldState).sounds !== false;
        syncAmbience();
        pet.setFocus(focus);
        break;
      }
      case "source.state":
        void getJson<PetView>(conn, "/v1/pet").then((g) => { globalOverride = g; onView(g); }).catch(() => {});
        break;
      case "settings.changed":
        audioSettings(d);
        break;
    }
  });

  let lastT = 0;
  const frame = (t: number) => {
    pet.update(t);
    // A kegel set: the rig turns its back and squeezes along with the count.
    const clench = pet.kegelClench(t);
    loaded.setBack(clench !== null || (turnedAway && !sweeping), clench ?? 0);
    lampK += (lampTo - lampK) * 0.04;
    if (broom.pose === "sweep") loaded.play.rot = sweepLean(broom, t);
    stage?.tick(Math.min(0.1, (t - (lastT || t)) / 1000));
    lastT = t;
    drawRig();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  setupMouse(pet);
  // In a plain browser (debugging): ?act=dance|piano|speak|kegel starts a performance without the daemon asking.
  const tryAct = inTauri ? null : new URLSearchParams(location.search).get("act");
  if (tryAct) perform(tryAct, new URLSearchParams(location.search).get("text"));
  if (inTauri) await listenHost(pet);
}

/** Events from the host: being moved about, the boss key, results of menu picks. */
async function listenHost(pet: PetRenderer) {
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const win = getCurrentWebviewWindow();
  let dizzy = false;
  await win.listen<{ kind: string }>("phys", (e) => {
    switch (e.payload.kind) {
      case "fly":
        dizzy = false;
        uncling();
        pet.setMoving(true);
        if (stage?.playing) stage.stop();
        break;
      case "cling": {
        // Thrown hard at a side or the top of the screen: it sticks there, leaning on a wall or swinging from the top.
        const edge = (e.payload as { edge?: string }).edge ?? "top";
        clinging = edge;
        dizzy = false;
        if (rig) {
          const hung = rig;
          Object.assign(hung.play, { rot: edge === "left" ? -17 : edge === "right" ? 17 : 0, face: "surprised" });
          // Startled at first; then wide awake for as long as it hangs there, even if its agent is asleep.
          window.setTimeout(() => clinging && (hung.play.face = "neutral"), 1100);
          const t0 = performance.now();
          window.clearInterval(clingSway);
          if (edge === "top") clingSway = window.setInterval(() => (hung.play.rot = 7 * Math.sin((performance.now() - t0) / 420)), 33);
        }
        pet.say(voiceLine("cling"), 3200);
        break;
      }
      case "slip": {
        const why = (e.payload as { why?: string }).why;
        uncling();
        if (rig) rig.play.face = "surprised";
        pet.say(voiceLine(why === "fed" ? "heavy" : "slip"), 2200);
        break;
      }
      case "dizzy":
        dizzy = true;
        break;
      case "land":
        uncling();
        pet.setMoving(false);
        if (dizzy) pet.act("poke", tr("……晕。", "…dizzy."), 2500);
        dizzy = false;
        break;
      case "walk":
        pet.setMoving(true);
        break;
      case "stop":
        pet.setMoving(false);
        break;
      case "peek":
        pet.act("perk");
        break;
    }
  });
  await win.listen<boolean>("boss", (e) => {
    bossMuted = e.payload;
    pet.setMuted(bossMuted || !desktopVisible);
    if (bossMuted && stage?.playing) stage.stop();
    if (bossMuted) ambience.stop();
    else syncAmbience();
  });
  await win.listen<boolean>("pet-visible", (e) => {
    desktopVisible = e.payload;
    pet.setMuted(bossMuted || !desktopVisible);
    if (!desktopVisible) void musicFocus.stop();
    syncAmbience();
  });
  await win.listen<PetMode>("pet-mode", (e) => {
    if (!["auto", "quiet", "settle", "work", "waiting", "wind_down"].includes(e.payload)) return;
    setPetMode(e.payload, true);
    const line = e.payload === "settle" ? tr("先缓一缓。", "Let's settle for a moment.")
      : e.payload === "quiet" ? tr("我陪你安静一会儿。", "I'll sit quietly with you.")
      : e.payload === "work" ? tr("从一件小事开始。", "Start with one small thing.")
      : e.payload === "wind_down" ? tr("今天到这儿。明天再接。", "That's enough for today. Continue tomorrow.")
      : e.payload === "auto" ? tr("在桌前就轻轻陪着，放电台时我会让位。", "A little ambience at your desk. Radio takes priority.")
      : tr("我在这儿等结果。", "I'll stay while we wait.");
    pet.say(line, 3200);
  });
  // What a menu pick did to this pet (a feed, the reset card).
  await win.listen<Record<string, unknown>>("fx", (e) => playFx(pet, e.payload));
  await win.listen<{ text: string; action?: string | null }>("say", (e) => pet.say(e.payload.text, 3500));
  // Got to a bug: a pounce, and a hop of pleasure when it was the last one.
  await win.listen<{ last?: boolean }>("swat", (e) => {
    rig?.react(e.payload?.last ? "cheer" : "poke");
  });
  // A "yes" on its offer to sweep the desktop.
  await win.listen<{ stow?: boolean } | null>("sweep", (e) => startSweep?.(!!e.payload?.stow));
  desktopVisible = !await invoke<boolean>("quiet");
  bossMuted = await invoke<boolean>("boss_muted") === true;
  pet.setMuted(bossMuted || !desktopVisible);
  syncAmbience();
}

function playFx(pet: PetRenderer, p: Record<string, unknown>) {
  switch (p.kind) {
    case "card":
      pet.fx.card(Number(p.from) || 95, Number(p.used) || 0);
      setTimeout(() => {
        pet.act("cheer", tr("刷新了。像没用过一样。", "Reset. Like it was never used."), 2600);
        pet.fx.burst("confetti");
      }, 2300);
      break;
    case "feed":
      if (p.ok) {
        // The fish flies in; when it lands: a bite, a shimmer, and whatever the pet has to say.
        const bond = String(p.bond ?? "");
        pet.fx.fish(() => {
          pet.act("cheer", String(p.text ?? tr("……嗯。", "…mm.")), 4000);
          pet.fx.burst("bite");
          pet.fx.burst("hearts", 350);
          if (bond === "secret") pet.fx.burst("glow", 500);
        }, p.treat as { shape?: string; colors?: string[] } | null);
      } else {
        pet.say(String(p.text), 3000);
      }
      break;
  }
}

/** Opens this pet's card and keeps it up a while (set once the mouse is wired). */
let showCardNow: (() => Promise<void>) | null = null;

/** Fit canvas and window to the pet, keeping the bottom-centre where it was. */
/** Latest size asked for, and whether a window resize is already running. */
let wanted: { w: number; h: number } | null = null;
let resizing = false;

async function resize(w: number, h: number) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  rigCanvas.width = canvas.width;
  rigCanvas.height = canvas.height;
  rigCanvas.style.width = canvas.style.width;
  rigCanvas.style.height = canvas.style.height;
  const frameEl = document.getElementById("pr");
  if (frameEl) {
    frameEl.style.width = canvas.style.width;
    frameEl.style.height = canvas.style.height;
  }
  winSize = { w, h };
  drawRig();
  if (!inTauri) return;
  // Resizes are async; two in flight could finish out of order and leave the
  // window at an old size. Run one at a time, always toward the latest size.
  wanted = { w, h };
  if (resizing) return;
  resizing = true;
  try {
    const { LogicalSize, LogicalPosition } = await import("@tauri-apps/api/window");
    const win = await tauriWindow();
    while (wanted) {
      const t = wanted;
      wanted = null;
      const scale = await win.scaleFactor();
      const pos = (await win.outerPosition()).toLogical(scale);
      const size = (await win.innerSize()).toLogical(scale);
      if (Math.round(size.width) === t.w && Math.round(size.height) === t.h) continue;
      await win.setSize(new LogicalSize(t.w, t.h));
      await win.setPosition(new LogicalPosition(pos.x + size.width / 2 - t.w / 2, pos.y + size.height - t.h));
    }
  } finally {
    resizing = false;
  }
}

/** Only the pet's body takes clicks; the host makes the rest click-through. */
async function reportHits(rects: HitRect[]) {
  await invoke("set_hit_rects", { rects: rects.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })) });
}

/** The session its agent stopped in last night comes to the front; if it closed in the night, its latest one. */
async function goToStop(pet: PetRenderer, pid: number, project: string) {
  const ok = pid ? await invoke<boolean>("focus_session", { pid, project: project || null }).catch(() => false) : false;
  if (!ok) await goToSession(pet);
}

/** The terminal or IDE of its agent's session comes to the front: the one waiting on you first, else the latest. */
async function goToSession(pet: PetRenderer) {
  const v = pet.currentView();
  if (!v) return;
  const card = v.sessions.find((s) => s.state === "attention") ?? [...v.sessions].sort((a, b) => b.updated_at - a.updated_at)[0];
  if (!card) return pet.say(tr("现在没有在跑的。", "Nothing is running right now."), 2500);
  const ok = await invoke<boolean>("focus_session", { pid: card.pid, project: card.project || null });
  if (!ok) pet.say(tr(`找不到 ${card.project || "它"} 的窗口。`, `Can't find the window for ${card.project || "it"}.`), 3000);
}

/**
 * Click = a poke (12 clicks in 5 s and it has had enough for a minute);
 * press and move = drag and throw; stroking the head = petted;
 * right-click = menu; hover 1 s = session card (a row in it goes to that session); double-click = go to the session.
 */
function setupMouse(pet: PetRenderer) {
  let down: { id: number; x: number; y: number } | null = null;
  let hovering = false;
  let hoverTimer = 0;
  let cardShown = false;
  let clicks: number[] = [];
  let sulkUntil = 0;
  let stroke: { lastX: number; dir: number; turns: number[] } = { lastX: 0, dir: 0, turns: [] };
  let pettedUntil = 0;

  /** `soft`: the pointer only left the pet, maybe on its way to the card (whose rows can be clicked). */
  const hideCard = async (soft = false) => {
    clearTimeout(hoverTimer);
    hovering = false;
    if (!cardShown || !inTauri) return;
    cardShown = false;
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo("card", "card:hide", { soft });
  };

  const showCard = async (_hit: HitRect | null, pin = false) => {
    if (!inTauri) return;
    const win = await tauriWindow();
    const scale = await win.scaleFactor();
    const pos = (await win.innerPosition()).toLogical(scale);
    const { emitTo } = await import("@tauri-apps/api/event");
    cardShown = true;
    // The card goes clear of the whole pet (its body, its bubble, its tag), not just of the part under the pointer.
    const all = pet.hitRects();
    const l = Math.min(...all.map((r) => r.x)), t = Math.min(...all.map((r) => r.y));
    const r = Math.max(...all.map((q) => q.x + q.w)), b = Math.max(...all.map((q) => q.y + q.h));
    await emitTo("card", "card:show", { pet: petId, ax: pos.x + l, ay: pos.y + t, aw: r - l, ah: b - t, pin });
  };
  showCardNow = () => showCard(null, true);

  const onStroke = (e: MouseEvent, hit: HitRect | null) => {
    // Only over the top half of the pet (its head).
    if (!hit || e.offsetY > hit.y + hit.h * 0.55) {
      stroke = { lastX: e.offsetX, dir: 0, turns: [] };
      return;
    }
    const dx = e.offsetX - stroke.lastX;
    if (Math.abs(dx) < 3) return;
    const dir = Math.sign(dx);
    const now = performance.now();
    if (stroke.dir && dir !== stroke.dir) stroke.turns.push(now);
    stroke.dir = dir;
    stroke.lastX = e.offsetX;
    stroke.turns = stroke.turns.filter((t) => now - t < PET_WINDOW);
    if (stroke.turns.length >= PET_TURNS && now > pettedUntil) {
      stroke.turns = [];
      pettedUntil = now + 2500;
      pet.act("cheer");
    }
  };

  const onClick = () => {
    // A click on a performing pet is "enough, thanks".
    if (stage?.playing) {
      stage.stop();
      return;
    }
    const now = performance.now();
    if (now < sulkUntil) return;
    clicks = clicks.filter((t) => now - t < ANNOY_WINDOW);
    clicks.push(now);
    if (clicks.length > ANNOY_CLICKS) {
      clicks = [];
      sulkUntil = now + SULK_MS;
      pet.say(tr("够了。", "Enough."), 2500);
      const side = Math.random() < 0.5 ? -1 : 1;
      void invoke("pet_hop", { vx: side * 420, vy: -520 });
      return;
    }
    pet.poke();
  };

  canvas.addEventListener("pointerdown", (e) => {
    // A click on an asking bubble answers it (and is not a poke or a drag).
    const answer = e.button === 0 ? pet.offerAt(e.offsetX, e.offsetY) : null;
    if (answer === "yes" || answer === "no") return pet.answer(answer === "yes");
    if (answer === "bubble") return;
    if (e.button === 0 && pet.hitTest(e.offsetX, e.offsetY)) {
      down = { id: e.pointerId, x: e.screenX, y: e.screenY };
      canvas.setPointerCapture(e.pointerId);
    }
    void hideCard();
  });
  // A click on a pet that clings to a screen edge gets it down.
  canvas.addEventListener("click", (e) => {
    if (clinging && pet.hitTest(e.offsetX, e.offsetY)) void invoke("pet_let_go", { why: "poked" });
  });
  canvas.addEventListener("pointermove", async (e) => {
    if (down?.id === e.pointerId) {
      if (Math.abs(e.screenX - down.x) + Math.abs(e.screenY - down.y) > 3) {
        down = null;
        // The host follows the cursor and throws the pet on release.
        await invoke("drag_start");
      }
      return;
    }
    // Over an asking bubble: a hand on its answers, and no hover card.
    const over = pet.offerAt(e.offsetX, e.offsetY);
    canvas.style.cursor = over === "yes" || over === "no" ? "pointer" : "";
    if (over) return;
    const hit = pet.hitTest(e.offsetX, e.offsetY);
    onStroke(e, hit);
    if (!!hit === hovering) return;
    await hideCard(true);
    hovering = !!hit;
    if (hit) hoverTimer = window.setTimeout(() => void showCard(hit), HOVER_MS);
  });
  canvas.addEventListener("mouseleave", () => void hideCard(true));
  canvas.addEventListener("pointerup", (e) => {
    if (down?.id !== e.pointerId || e.button !== 0) return;
    down = null;
    if (pet.hitTest(e.offsetX, e.offsetY)) onClick();
  });
  canvas.addEventListener("lostpointercapture", (e) => {
    if (down?.id === e.pointerId) down = null;
  });
  // Double-click: jump to the terminal or IDE of the session (the one waiting on you first).
  canvas.addEventListener("dblclick", async (e) => {
    if (pet.hitTest(e.offsetX, e.offsetY)) await goToSession(pet);
  });
  canvas.addEventListener("contextmenu", async (e) => {
    e.preventDefault();
    await hideCard();
    await invoke("pet_menu", { pet: petId });
  });

  if (inTauri) {
    // The host turns on click-through when the cursor leaves the pet's body,
    // which also means no mouseleave reaches us.
    void import("@tauri-apps/api/webviewWindow").then(({ getCurrentWebviewWindow }) =>
      getCurrentWebviewWindow().listen("cursor-left", () => void hideCard(true)),
    );
  }
}

main().catch((e) => console.error("Rill window failed", e));
