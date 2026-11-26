// The room: where the one companion lives, and what it knows about today. It
// connects to petd, shows the global state, source summaries, your time at the
// desk, and the day's diary.

import { connect, getJson, inTauri, onHost, postJson, SOURCE_NAMES, subscribe, type CampDay, type Conn, type PetView, type Report, type SourceSummary } from "./api";
import type { TreatLook } from "./treats";
import { initLang, t } from "./i18n";
import { faceFor, greet, mountPortrait, type Mood } from "./rig/portrait";
import type { RigPet } from "./rig/rig.js";
import { mountPlay } from "./play";
import { applySkin, PLAY_LABEL, skinFor, worn } from "./skin";
import { line } from "./voice";

interface BondResp { familiarity: number; trust: number; vitality: number }
interface Noticed { ts: number; text: string }
interface Today { desk_ms: number; breaks: number; fish_left: number; noticed: Noticed[] }

const $ = (id: string) => document.getElementById(id)!;
const room = $("room");
const pill = $("pill");
const sayEl = $("say");
const sourcesEl = $("sources");
const feedBtn = $("feed") as HTMLButtonElement;
const companyBtn = $("company") as HTMLButtonElement;
const pop = $("pop");

let mood: Mood | null = null;
let prevState = "";
let project = "";
let petId = "";
let fish = 0;
/** Something the pet just said on the desktop; it stays in the bubble for a while. */
let saidUntil = 0;

const SOURCE_PRIORITY: Record<string, number> = { needs_you: 100, attention: 100, error: 90, stone: 88, aborted: 84, thinking: 70, tool: 68, reading: 66, waiting: 35, done: 50, idle: 20, parked: 15, sleeping: 10, offline: 0 };

function mergeSources(values: PetView[]): PetView | undefined {
  const base = values.find((p) => p.id === "claude-code") ?? values[0];
  if (!base) return undefined;
  const sessions = values.flatMap((p) => p.sessions ?? []).sort((a, b) => {
    const d = (SOURCE_PRIORITY[b.state] ?? 0) - (SOURCE_PRIORITY[a.state] ?? 0);
    return d || b.updated_at - a.updated_at;
  });
  const top = sessions[0];
  return {
    ...base,
    id: "main",
    camp: null,
    marker: "Rill",
    state: (top?.state ?? "sleeping") as PetView["state"],
    since: top?.since ?? base.since,
    online: sessions.length,
    waiting: sessions.filter((s) => s.state === "attention").length,
    sessions,
  };
}

const sourceState = (state: string): string => ({
  attention: t("等你", "Waiting for you"),
  thinking: t("思考中", "Thinking"),
  tool: t("干活中", "Working"),
  reading: t("读代码", "Reading"),
  done: t("完成", "Done"),
  error: t("出错", "Error"),
  aborted: t("已中断", "Interrupted"),
  idle: t("空闲", "Idle"),
  sleeping: t("休眠", "Sleeping"),
  offline: t("已离线", "Offline"),
}[state] ?? state);

function showSources(values: SourceSummary[], byCamp: Record<string, CampDay> = {}): void {
  sourcesEl.textContent = "";
  const ordered = [...values].sort((a, b) => (SOURCE_PRIORITY[b.state] ?? 0) - (SOURCE_PRIORITY[a.state] ?? 0));
  if (!ordered.some((p) => p.online > 0)) {
    const none = document.createElement("div");
    none.className = "none";
    none.textContent = t("现在没有在线来源。", "No sources are online right now.");
    sourcesEl.append(none);
    return;
  }
  for (const p of ordered) {
    const row = document.createElement("div");
    row.className = `source-row${p.waiting ? " wait" : ""}`;
    const name = p.name || p.id;
    const project = p.project ?? p.sessions[0]?.project ?? p.items?.[0]?.title;
    row.innerHTML = `<i></i><b></b><span></span>${project ? "<small></small>" : ""}`;
    row.querySelector("b")!.textContent = name;
    const stats = byCamp[p.id];
    row.querySelector("span")!.textContent = `${sourceState(p.state)}${p.online > 1 ? ` · ${p.online}` : ""}${p.waiting ? ` · ${t("等你", "waiting")}` : ""}`;
    if (project || stats) {
      const detail = [project, stats ? t(`${stats.turns} 轮${stats.errors ? ` · 卡住 ${stats.errors}` : ""}`, `${stats.turns} turns${stats.errors ? ` · stuck ${stats.errors}` : ""}`) : ""].filter(Boolean).join(" · ");
      const small = row.querySelector("small") ?? document.createElement("small");
      if (!small.parentElement) row.append(small);
      small.textContent = detail;
    }
    sourcesEl.append(row);
  }
}

function sourceRowsFromPets(values: PetView[]): SourceSummary[] {
  return values.map((p) => ({
    kind: "agent",
    id: p.camp ?? p.id,
    name: p.marker ?? p.camp ?? p.id,
    state: p.state,
    since: p.since,
    online: p.online,
    waiting: p.waiting,
    project: p.sessions[0]?.project,
    sessions: p.sessions,
    updated_at: p.sessions.reduce((n, s) => Math.max(n, s.updated_at), p.since),
  }));
}

/** How quick each is on its feet when it chases: 麻薯 darts, 泡泡 is half a beat behind. */
const PACE: Record<string, number> = { zimeng: 1, mashu: 1.25, paopao: 0.6, gugu: 0.85, rongrong: 0.72 };
/** ...and how high each jumps for the toy: the cat highest, the drop of water least. */
const SPRING: Record<string, number> = { zimeng: 0.9, mashu: 1.15, paopao: 0.6, gugu: 0.72, rongrong: 0.8 };
/** The pet is fitted to this box and stands this far above the bottom of the stage (on its cushion); the rest of the stage is room to jump in. */
const STAND = { box: [230, 196] as [number, number], floor: 12 };

/** The pet on its cushion, idling with the face that goes with the state. */
let rigPet: RigPet | null = null;
function seat(rig: string | null) {
  void mountPortrait($("rpet") as HTMLCanvasElement, rig ?? undefined, STAND).then((p) => {
    rigPet = p;
    if (mood) p.expr = faceFor(mood, prevState);
    // It can be played with here: watched, poked, turned round, stroked, teased with its own charm.
    const sk = worn();
    mountPlay(p, {
      stage: $("stage"),
      canvas: $("rpet") as HTMLCanvasElement,
      toy: $("toy") as HTMLCanvasElement,
      tease: $("tease") as HTMLButtonElement,
      spin: $("spin") as HTMLButtonElement,
      game: $("game") as HTMLButtonElement,
      looks: () => looks,
      earn: async (caught) => {
        if (!roomConn) return null;
        const r = await postJson<{ ok: boolean; text?: string; fish_left?: number }>(roomConn, "/v1/earn", { why: "catch", pet: petId, n: caught }).catch(() => null);
        if (r?.ok && typeof r.fish_left === "number") showFish(r.fish_left);
        return r?.ok ? r.text ?? null : null;
      },
      sayText: (text) => {
        saidUntil = Math.max(saidUntil, Date.now() + 5000);
        say(text);
      },
      position: ({ cx, top, width, height }) => {
        // `say` is absolutely positioned in the stage; follow the pet's head
        // instead of staying at the stage's fixed centre while it runs.
        // Keep the whole bubble inside the narrow room when the pet reaches
        // either side of the stage.
        const half = Math.min(sayEl.offsetWidth / 2, Math.max(0, width / 2 - 8));
        const cxSafe = Math.max(8 + half, Math.min(width - 8 - half, cx));
        // A high jump can put the pet's head above the stage. Keep the bubble
        // readable while it tracks that head as closely as the room permits.
        const minY = Math.min(height - 8, sayEl.offsetHeight + 8);
        const ySafe = Math.max(minY, Math.min(height - 8, top - 14));
        const sx = `${Math.round(cxSafe)}px`;
        const sy = `${Math.round(ySafe)}px`;
        if (sayEl.style.getPropertyValue("--say-x") !== sx) sayEl.style.setProperty("--say-x", sx);
        if (sayEl.style.getPropertyValue("--say-y") !== sy) sayEl.style.setProperty("--say-y", sy);
      },
      ...STAND,
      motif: sk.motif,
      fill: sk.colors.motifFill,
      line: sk.colors.motifLine,
      pace: PACE[sk.id] ?? 1,
      spring: SPRING[sk.id] ?? 1,
      say: (key) => {
        // Its play line holds the bubble for a moment, then what it was saying comes back.
        saidUntil = Math.max(saidUntil, Date.now() + 3200);
        say(line(key));
        window.setTimeout(() => Date.now() >= saidUntil && mood && say(restingLine(mood)), 3400);
      },
    });
  });
}
/** The connection, and the kinds of sweet there are (the game drops these). */
let roomConn: Conn | null = null;
let looks: TreatLook[] = [];
// `?pet=` was accepted by older builds. The room is global now, so the query
// is intentionally ignored and all actions target the stable main companion.
const petIdForActions = "main";

async function pick(id: string) {
  if (!inTauri) return console.log("menu_pick", id);
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("menu_pick", { id });
}

// ---- state

function mapState(s: string): Mood {
  const h = new Date().getHours();
  const night = h < 5 || h >= 23;
  if (s === "attention") return "wait";
  if (s === "done") return "done";
  if (s === "thinking" || s === "tool" || s === "reading") return night ? "night" : "work";
  if (s === "error" || s === "stone" || s === "aborted" || s === "offline") return "worry";
  return "rest"; // idle, sleeping
}

/** The pill: what it is doing, in a few words. */
function pillText(m: Mood): string {
  switch (m) {
    case "work": return project ? t(`在看 ${project}`, `Watching ${project}`) : t("在看", "Watching");
    case "night": return project ? t(`夜里还在看 ${project}`, `Still watching ${project}`) : t("夜里还在看", "Still watching");
    case "wait": return t("它停下了，等你", "It stopped. Waiting for you");
    case "done": return t("做完了", "Done");
    case "worry": return prevState === "offline" ? t("没连上", "Not connected") : t("卡住了", "Stuck");
    default: return prevState === "sleeping" ? t("睡着了", "Asleep") : t("歇着", "Resting");
  }
}

/** What it says when it has nothing newer to say. Only what it can see. */
function restingLine(m: Mood): string {
  switch (m) {
    case "work": return line("room.work");
    case "night": return line("room.night");
    case "wait": return line("room.wait");
    case "done": return line("room.done");
    case "worry": return line(prevState === "offline" ? "room.offline" : "room.stuck");
    default: return line(prevState === "sleeping" ? "room.asleep" : "room.rest");
  }
}

function say(text: string) {
  if (sayEl.textContent === text) return;
  sayEl.classList.add("swap");
  setTimeout(() => {
    sayEl.textContent = text;
    sayEl.classList.remove("swap");
  }, 220);
}

function applyState(m: Mood) {
  // Falling asleep does not change the room, only the face.
  if (rigPet) rigPet.expr = faceFor(m, prevState);
  pill.className = `pill ${m}`;
  $("ptxt").textContent = pill.title = pillText(m);
  if (Date.now() > saidUntil) say(restingLine(m));
  const sign = prevState === "sleeping" ? "zzz" : m === "worry" ? "sweat" : "";
  for (const id of ["zzz", "sweat"]) $(`ex-${id}`).classList.toggle("on", id === sign);
  room.classList.toggle("night", m === "night");
  if (m === mood) return;
  mood = m;
  if (rigPet) greet(rigPet, m);
}

function setPet(pet: PetView | undefined) {
  if (!pet) return;
  petId = petIdForActions;
  prevState = pet.state as string;
  const latest = [...(pet.sessions ?? [])].sort((a, b) => b.updated_at - a.updated_at)[0];
  project = latest ? `${SOURCE_NAMES[latest.source] ?? latest.source} · ${latest.project}` : "";
  applyState(mapState(prevState));
}

// ---- today

/** "5 小时 40 分" */
function span(ms: number): string {
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  if (h === 0) return t(`${m} 分`, `${m}m`);
  return m % 60 ? t(`${h} 小时 ${m % 60} 分`, `${h}h ${m % 60}m`) : t(`${h} 小时`, `${h}h`);
}

function showFish(n: number) {
  fish = n;
  // An empty jar is not a dead end: the button says how sweets are earned.
  feedBtn.textContent = n > 0 ? t(`喂它 · 罐里 ${n} 颗`, `Feed it · ${n} in the jar`) : t("罐空了 · 怎么挣糖", "The jar's empty · how to earn");
  feedBtn.classList.toggle("empty", n <= 0);
}

function showToday(d: Today) {
  $("desk-v").textContent = d.desk_ms >= 60000 ? span(d.desk_ms) : "—";
  $("desk-s").textContent =
    d.desk_ms < 60000 ? t("刚坐下", "Just sat down") : d.breaks > 0 ? t(`中间起身 ${d.breaks} 次`, `${d.breaks} break${d.breaks > 1 ? "s" : ""} so far`) : t("还没起过身", "No break yet");
  showFish(d.fish_left);
  const list = $("noticed");
  list.textContent = "";
  if (!d.noticed.length) {
    const none = document.createElement("div");
    none.className = "none";
    none.textContent = t("今天还没有。", "Nothing yet today.");
    list.append(none);
    return;
  }
  for (const n of d.noticed) {
    const row = document.createElement("div");
    row.className = "it";
    const when = document.createElement("time");
    const at = new Date(n.ts);
    when.textContent = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
    const what = document.createElement("span");
    what.textContent = n.text;
    row.append(when, what);
    list.append(row);
  }
}

function showReport(r: Report) {
  $("work-v").textContent = r.work_ms >= 60000 ? span(r.work_ms) : "—";
  $("work-s").textContent =
    r.turns <= 0 ? t("今天还没开工", "Nothing run yet today") : r.errors > 0 ? t(`${r.turns} 轮，卡住 ${r.errors} 次`, `${r.turns} turns, stuck ${r.errors}×`) : t(`${r.turns} 轮，没卡住`, `${r.turns} turns, none stuck`);
}

function showBond(b: BondResp) {
  for (const [id, v] of [["fam", b.familiarity], ["trust", b.trust], ["vit", b.vitality]] as const) {
    const pct = Math.max(0, Math.min(100, Math.round(v)));
    $(`bb-${id}`).style.width = `${pct}%`;
    $(`bv-${id}`).textContent = String(pct);
  }
}

// ---- the buttons

feedBtn.addEventListener("click", () => {
  if (fish <= 0) return say(line("room.nofish"));
  if (!petId) return;
  void pick(`feed|${petId}|1`);
  showFish(fish - 1);
  rigPet?.react("cheer");
});

const closePop = () => {
  pop.classList.remove("open");
  companyBtn.setAttribute("aria-expanded", "false");
};
companyBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const open = !pop.classList.contains("open");
  pop.classList.toggle("open", open);
  companyBtn.setAttribute("aria-expanded", String(open));
});
pop.addEventListener("click", (e) => {
  const target = (e.target as HTMLElement).closest<HTMLElement>("[data-act],[data-mode]");
  const act = target?.dataset.act;
  const mode = target?.dataset.mode;
  if (!act && !mode) return;
  closePop();
  if (mode) void pick(`mode|${mode}`);
  else if (act === "radio") void pick("radio");
  else if (!petId) say(line("room.away"));
  else if (act === "kegel") void pick(`kegel|${petId}`);
  else void pick(`act|${petId}|${act}`);
});
document.addEventListener("click", closePop);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePop();
});
document.querySelector(".tabs")!.addEventListener("click", (e) => {
  const go = (e.target as HTMLElement).closest<HTMLElement>("[data-go]")?.dataset.go;
  if (go) void pick(go);
});
// The day's numbers open the day's report.
$("work-card").addEventListener("click", () => void pick("report"));

// ---- wiring

async function live() {
  const conn: Conn = await connect();
  roomConn = conn;
  await initLang(conn);
  void getJson<{ fish: TreatLook[] }>(conn, "/v1/stats").then((s) => (looks = s.fish ?? [])).catch(() => {});
  const mine = await skinFor(conn, "main");
  seat(applySkin(mine.skin.id).rig);
  document.title = t(`${mine.skin.zh}的小屋`, `${mine.skin.en}'s room`);
  const playItem = pop.querySelector<HTMLElement>('[data-act="play"]');
  if (playItem) playItem.textContent = t(...PLAY_LABEL[mine.skin.instrument]);
  showFish(0);

  const refresh = async () => {
    const [report, bond, today] = await Promise.allSettled([
      getJson<Report>(conn, "/v1/report"),
      getJson<BondResp>(conn, "/v1/bond"),
      getJson<Today>(conn, "/v1/today"),
    ]);
    if (report.status === "fulfilled") {
      showReport(report.value);
      const sourceResult = await getJson<{ sources: SourceSummary[] }>(conn, "/v1/sources").catch(() => null);
      if (sourceResult) showSources(sourceResult.sources, report.value.by_camp);
    }
    if (bond.status === "fulfilled") showBond(bond.value);
    if (today.status === "fulfilled") showToday(today.value);
  };
  await refresh();
  try {
    const [{ pets }, { sources }, report] = await Promise.all([
      getJson<{ pets: PetView[] }>(conn, "/v1/pets"),
      getJson<{ sources: SourceSummary[] }>(conn, "/v1/sources").catch(() => ({ sources: [] as SourceSummary[] })),
      getJson<Report>(conn, "/v1/report").catch(() => null),
    ]);
    const merged = mergeSources(pets);
    showSources(sources.length ? sources : sourceRowsFromPets(pets), report?.by_camp ?? {});
    setPet(merged);
  } catch {
    /* will sync on the first push */
  }
  if (!mood) applyState("rest");

  subscribe(conn, (type, data) => {
    if (type === "pet.state") {
      const pet = data as PetView;
      if (pet?.id === "main" && pet.skin && pet.skin !== mine.skin.id) return location.reload();
      if (pet?.id === "main") setPet(pet);
    } else if (type === "source.state") {
      void Promise.all([
        getJson<{ sources: SourceSummary[] }>(conn, "/v1/sources"),
        getJson<Report>(conn, "/v1/report"),
      ]).then(([r, report]) => showSources(r.sources, report.by_camp)).catch(() => {});
    } else if (type === "pet.act") {
      // What it just did out there goes into the bubble, and soon into the diary.
      const d = data as { pet?: string; text?: string | null; act?: string };
      // Only this room's pet: what another one says belongs in its own room.
      if (d.text) {
        saidUntil = Date.now() + 5 * 60_000;
        say(d.text);
      }
      rigPet?.react(d.act === "speak" ? "perk" : "cheer");
      setTimeout(() => void refresh(), 1500);
    } else if (type === "report") {
      const r = data as Report;
      if (r?.work_ms !== undefined) showReport(r);
    } else if (type === "pet.fx") {
      // A feed from the desktop menu changes the basket.
      setTimeout(() => void refresh(), 800);
    }
  });
  setInterval(() => void refresh(), 60_000);
  // Older host versions may still send this event. Keep the room global.
  await onHost<string | null>("for-pet", () => void refresh());
}

/** A filled room to look at in a browser, with nothing of the user's in it. */
function demo() {
  const q = new URLSearchParams(location.search);
  seat(applySkin(q.get("skin")).rig);
  const now = new Date();
  const at = (h: number, m: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime();
  prevState = q.get("state") ?? "tool";
  project = "rillbuddy";
  petId = "p";
  showToday({
    desk_ms: (5 * 60 + 40) * 60000,
    breaks: 3,
    fish_left: 3,
    noticed: [
      { ts: at(16, 5), text: "你坐了 95 分钟没动。它转过身，带你做了一组提肛。" },
      { ts: at(14, 20), text: "你坐了 62 分钟没动。它跳了一轮舞。" },
      { ts: at(11, 48), text: "你离开了 35 分钟。那会儿做完了 2 件，还有一件卡住了。" },
      { ts: at(10, 5), text: "半小时里卡了 3 次。它弹了一段琴。" },
      { ts: at(9, 12), text: "你来了。" },
    ],
  });
  showReport({ work_ms: (2 * 60 + 14) * 60000, turns: 7, errors: 1 } as Report);
  showBond({ familiarity: 42, trust: 61, vitality: 55 });
  applyState(mapState(prevState));
  if (q.has("pop")) companyBtn.click();
}

if (new URLSearchParams(location.search).has("demo")) demo();
else void live();
