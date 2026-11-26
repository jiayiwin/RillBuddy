// Gallery: the five pets and the one you picked, the sweets, what the pet
// remembers, and the settings.

import { connect, getJson, inTauri, onHost, postJson, RARITY_COLORS, RARITY_NAMES, type Conn } from "./api";
import { toast } from "./toast";
import { drawTreat, whenOf } from "./treats";
import { EN, initLang, t as tr } from "./i18n"; // `t` is a common local name here
import { mountPortrait } from "./rig/portrait";
import { applySkin, followSkin, ORDER, SKINS, type Skin, type SkinId } from "./skin";
import { Ambience } from "./ambience";

const TABS = ["pets", "fish", "mem", "settings"];

const $ = (id: string) => document.getElementById(id)!;
let conn: Conn;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

const ICONS: Record<string, string> = {
  paw: `<ellipse cx="12" cy="15.5" rx="4.6" ry="3.6"/><circle cx="6.3" cy="10.6" r="1.7"/><circle cx="10" cy="6.8" r="1.7"/><circle cx="14" cy="6.8" r="1.7"/><circle cx="17.7" cy="10.6" r="1.7"/>`,
  lift: `<circle cx="12" cy="12" r="9"/><path d="M12 16.5V8M8.5 11.5L12 8l3.5 3.5"/>`,
  globe: `<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>`,
};
const ic = (k: string) =>
  `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[k] ?? ""}</svg>`;

/** A progress ring, `p` in 0..1, with `label` in the middle. */
function ring(p: number, label: string): string {
  const c = 2 * Math.PI * 34;
  return `<div class="ring"><svg viewBox="0 0 80 80"><circle class="trk" cx="40" cy="40" r="34"/>
    <circle class="val" cx="40" cy="40" r="34" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - Math.max(0, Math.min(1, p)))).toFixed(1)}" transform="rotate(-90 40 40)"/></svg><b>${label}</b></div>`;
}

// ------------------------------------------------------------ the wardrobe

/** The cast is now a wardrobe for the single desktop companion. */
interface Cast { main: string; cast: { id: string; name: string; instrument: string; here: boolean }[] }
let cast: Cast | null = null;
let picked: SkinId = "zimeng";
let fiveBuilt = false;
let arrivedAt = 0;

/** A pet that is here idles in the picture; one that is not is its still. */
function artOf(sk: Skin, here: boolean): HTMLElement {
  if (!here || !sk.rig) return Object.assign(document.createElement("img"), { className: "art", src: sk.art ?? "", alt: "" });
  const cv = Object.assign(document.createElement("canvas"), { className: "art" });
  void mountPortrait(cv, sk.rig).catch(() => {});
  return cv;
}

async function renderFive() {
  const [mem, settings] = await Promise.all([
    getJson<{ arrived: number }>(conn, "/v1/memories").catch(() => null),
    getJson<{ pets?: Cast }>(conn, "/v1/settings").catch(() => null),
  ]);
  cast = settings?.pets ?? cast;
  // The gallery belongs to the one desktop companion and follows its skin.
  applySkin(cast?.main);
  arrivedAt = mem?.arrived ?? 0;
  const here = (id: SkinId) => cast?.cast.find((c) => c.id === id)?.here ?? id === "zimeng";
  const status = (id: SkinId) => {
    if (!here(id)) return tr("还没来", "Not here yet");
    return id === cast?.main ? tr("当前桌宠", "Current companion") : tr("可换装", "Available");
  };
  const box = $("five");
  if (!fiveBuilt) {
    fiveBuilt = true;
    for (const id of ORDER) {
      const sk = SKINS[id];
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.pet = id;
      b.style.setProperty("--tint", sk.colors.room);
      b.append(artOf(sk, here(id)), Object.assign(document.createElement("b"), { textContent: tr(sk.zh, sk.en) }), document.createElement("small"));
      b.onclick = () => {
        picked = id;
        void renderFive();
      };
      box.append(b);
    }
    const all = document.createElement("div");
    all.className = "all";
    all.append(
      Object.assign(document.createElement("b"), { textContent: tr("一只桌宠，五种外观", "One companion, five looks") }),
      Object.assign(document.createElement("span"), { textContent: tr("它们是同一只桌宠可以换上的角色和乐器。Agent、任务和其他来源不会各自拥有宠物。", "These are looks and instruments for the same desktop companion. Agents, tasks and other sources do not own separate pets.") }),
    );
    box.append(all);
  }
  for (const id of ORDER) {
    const b = box.querySelector<HTMLElement>(`[data-pet="${id}"]`)!;
    b.className = `pt${id === picked ? " on" : ""}${here(id) ? "" : " away"}`;
    b.querySelector("small")!.textContent = status(id);
  }

  // The selected wardrobe item.
  const sk = SKINS[picked];
  const one = $("one");
  if (one.dataset.pet !== sk.id) {
    one.dataset.pet = sk.id;
    one.textContent = "";
    const pic = document.createElement("div");
    pic.className = `pic${here(sk.id) ? "" : " away"}`;
    pic.style.setProperty("--tint", sk.colors.room);
    pic.append(artOf(sk, here(sk.id)));
    const who = document.createElement("div");
    who.className = "who";
    who.append(Object.assign(document.createElement("b"), { textContent: tr(sk.zh, sk.en) }), Object.assign(document.createElement("span"), { textContent: tr(...sk.about) }));
    const facts = document.createElement("div");
    facts.className = "facts";
    const grow = Object.assign(document.createElement("div"), { className: "grow" });
    const btns = document.createElement("div");
    btns.className = "btns";
    one.append(pic, who, facts, grow, btns);
  }
  const fact = (k: string, v: string) => `<div><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`;
  const facts = one.querySelector<HTMLElement>(".facts")!;
  const btns = one.querySelector<HTMLElement>(".btns")!;
  facts.innerHTML = fact(tr("乐器", "Plays"), tr(...sk.plays));
  btns.innerHTML = "";
  if (!here(sk.id)) {
    facts.innerHTML += fact(tr("现在", "Now"), tr("还在路上。画好了，还没学会动。", "On its way. Drawn, but not moving yet."));
    return;
  }
  const days = arrivedAt ? Math.floor((Date.now() - arrivedAt) / 86_400_000) + 1 : 1;
  facts.innerHTML += fact(tr("状态", "Status"), sk.id === cast?.main ? tr("当前桌宠外观", "Current desktop companion") : tr("可作为桌宠外观", "Available as companion skin")) + (sk.id === "zimeng" ? fact(tr("来了", "Here"), tr(`第 ${days} 天`, `Day ${days}`)) : "");
  const add = (cls: string, label: string, run: () => void) => {
    const b = Object.assign(document.createElement("button"), { type: "button", className: cls, textContent: label });
    b.onclick = run;
    btns.append(b);
  };
  if (sk.id !== cast?.main) add("go", tr("换成这只", "Use this look"), () => void changeMainSkin(sk.id));
  else add("alt", tr("当前使用中", "Currently used"), () => {});
}

async function changeMainSkin(id: SkinId): Promise<void> {
  const r = await postJson(conn, "/v1/settings", { key: "main_skin", value: id });
  toast(r.message);
  await renderFive();
}

// ------------------------------------------------------------ what it remembers

async function renderMem() {
  const box = $("mem");
  const d = await getJson<{ items: { ts: number; text: string }[] }>(conn, "/v1/memories").catch(() => null);
  box.textContent = "";
  if (!d || !d.items.length) {
    box.append(Object.assign(document.createElement("div"), { className: "none", textContent: d ? tr("还没有。它注意到的事会记在这里。", "Nothing yet. What it notices is kept here.") : tr("这一页要新版的后台，重启睿洱后再看。", "This page needs the new daemon. Restart Rill and look again.") }));
    return;
  }
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();
  let key = "";
  let day: HTMLElement | null = null;
  for (const it of d.items) {
    const at = new Date(it.ts);
    if (at.toDateString() !== key) {
      key = at.toDateString();
      const label =
        key === today ? tr("今天", "Today") : key === yesterday ? tr("昨天", "Yesterday") : EN ? at.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : `${at.getMonth() + 1} 月 ${at.getDate()} 日，周${"日一二三四五六"[at.getDay()]}`;
      box.append(Object.assign(document.createElement("h2"), { textContent: label }));
      day = Object.assign(document.createElement("div"), { className: "day" });
      box.append(day);
    }
    const row = Object.assign(document.createElement("div"), { className: "it" });
    row.append(
      Object.assign(document.createElement("time"), { textContent: `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}` }),
      Object.assign(document.createElement("span"), { textContent: it.text }),
    );
    day!.append(row);
  }
}

// ---------------------------------------------------------------- fish

/** One kind of sweet or fruit (the daemon still calls the list `fish`, as it did when they were). */
interface FishInfo {
  id: string;
  name: string;
  rarity: string;
  note: string;
  count: number;
  first: number;
  shape?: string;
  colors?: string[];
  from?: string | null;
  hours?: [number, number] | null;
  months?: [number, number] | null;
}

interface Stats {
  fish: FishInfo[];
}

const RARITIES = ["common", "rare", "epic", "legendary"];
/** One kind, drawn; a kind not met yet is a pale shape. */
function fishCanvas(f: FishInfo, locked: boolean): HTMLCanvasElement {
  const W = 108, H = 78;
  const c = document.createElement("canvas");
  const dpr = devicePixelRatio || 1;
  c.width = Math.round(W * dpr);
  c.height = Math.round(H * dpr);
  c.style.width = `${W}px`;
  c.style.height = `${H}px`;
  const g = c.getContext("2d")!;
  g.scale(dpr, dpr);
  if (!locked && (f.rarity === "epic" || f.rarity === "legendary")) {
    g.shadowColor = f.colors?.[0] ?? "#f6d77a";
    g.shadowBlur = 14;
  }
  drawTreat(g, f, W / 2, H / 2 + 2, 1.55, locked);
  return c;
}

async function renderFish() {
  const st = await getJson<Stats>(conn, "/v1/stats");
  const got = st.fish.filter((f) => f.count > 0);
  const total = got.reduce((n, f) => n + f.count, 0);
  $("fishhead").innerHTML = `<div class="head fishhead">
    <div class="num"><span>${tr("已收集", "COLLECTED")}</span><b>${got.length}</b><i>/ ${st.fish.length}</i></div>
    <div class="rars">${RARITIES.map((r) => {
      const all = st.fish.filter((f) => f.rarity === r);
      const have = all.filter((f) => f.count > 0).length;
      return all.length
        ? `<div class="rarrow" style="--rc:${RARITY_COLORS[r]}"><em>${RARITY_NAMES[r]}</em><div class="bar"><i style="width:${(have / all.length) * 100}%"></i></div><span>${have}/${all.length}</span></div>`
        : "";
    }).join("")}</div>
    <div class="ringbox">${ring(got.length / Math.max(1, st.fish.length), String(total))}<span>${tr("一共得到的颗数", "earned in all")}</span></div>
  </div>`;
  const grid = $("fishgrid");
  grid.innerHTML = "";
  st.fish.forEach((f, i) => {
    const locked = f.count === 0;
    const shiny = !locked && (f.rarity === "epic" || f.rarity === "legendary");
    const el = document.createElement("div");
    el.className = `fc${locked ? " locked" : ""}`;
    el.style.setProperty("--rc", RARITY_COLORS[f.rarity] ?? "#7f8aa3");
    el.style.setProperty("--i", String(i));
    el.innerHTML = `<div class="tank">${shiny ? `<i class="sheen"></i>` : ""}</div>
      ${locked ? "" : `<span class="cnt">×${f.count}</span>`}
      <div class="info"><span class="rar">${RARITY_NAMES[f.rarity] ?? f.rarity}</span>
      <b>${locked ? "？？？" : esc(f.name)}</b>
      <small>${locked ? tr("还没遇到过", "Not met yet") + (whenOf(f, tr) ? ` · ${whenOf(f, tr)}` : "") : esc(f.note)}</small></div>`;
    el.querySelector(".tank")!.prepend(fishCanvas(f, locked));
    grid.appendChild(el);
  });
}

// ---------------------------------------------------------------- settings

interface Settings { language: string; size: string; chatter: string; kegel_reps?: number; config_error?: string | null; focus_mode: boolean; sounds: boolean; ambience_auto?: boolean; ambience_volume?: number; pet_mode?: string; approve: boolean; night?: boolean; approve_wait_s: number; usage: { primary: UsageWindow | null; secondary: UsageWindow | null } | null }
interface UsageWindow { used_percent: number; window_minutes: number; resets_at: number }
let soundStatusTimer = 0;
let settingsPreview: Ambience | null = null;

async function renderSettings() {
  const box = $("tab-settings");
  let s = await getJson<Settings>(conn, "/v1/settings");
  const soundStatus = async () => {
    const el = document.getElementById("sound-status");
    if (!el) return;
    let status: { label?: string; playing?: boolean; phase?: string } = {};
    try { status = JSON.parse(localStorage.getItem("rill.audio.status") ?? "{}"); } catch { /* Empty on first run. */ }
    const locks = await navigator.locks?.query();
    if (status.playing && locks?.held?.some((l) => l.name === "rillbuddy-audio")) {
      const label = status.label ?? "";
      const labels: Record<string, string> = { "环境声": "Ambience", "电台": "Radio", "宠物奏乐": "Pet music", "收工曲": "Day song", "提示音": "Alert" };
      el.textContent = status.phase === "loading" ? tr(`正在准备：${label}。`, `Preparing: ${labels[label] ?? label}.`)
        : tr(`正在播放：${label}。其他声音已让位。`, `Playing: ${labels[label] ?? label}. Other audio yields.`);
    } else {
      el.textContent = !s.sounds || s.focus_mode ? tr("当前静音。", "Sound is muted.")
        : localStorage.getItem("ambience.error") ? tr("环境声尚未播放成功，请点「试听」重试。", "Ambience could not start. Select a preview to retry.")
        : tr("当前没有声音。可试听，或选择「自动陪伴」等待触发。", "Nothing is playing. Try a sound or select Auto.");
    }
  };
  clearInterval(soundStatusTimer);
  soundStatusTimer = window.setInterval(() => void soundStatus(), 1500);
  const set = async (key: string, value: string | boolean | number) => {
    if (key === "pet_mode") settingsPreview?.stop();
    if (key === "ambience_volume") settingsPreview?.setVolume(Number(value) / 100);
    const res = await postJson(conn, "/v1/settings", { key, value });
    if (key === "language" && res.ok) {
      // Every label on the page is in the old language: come back on this tab in the new one.
      const q = new URLSearchParams(location.search);
      q.set("tab", "settings");
      setTimeout(() => (location.search = q.toString()), 250);
      return;
    }
    s = await getJson<Settings>(conn, "/v1/settings");
    draw();
    $("st-msg").textContent = res.message;
    $("st-msg").style.color = res.ok ? "" : "var(--red)";
  };
  const seg = (key: keyof Settings, opts: [string, string][]) =>
    `<span class="seg2">${opts.map(([id, label]) => `<button data-set="${key}" data-v="${id}" class="${s[key] === id ? "on" : ""}">${label}</button>`).join("")}</span>`;
  const sw = (key: keyof Settings, title: string, hint: string) =>
    `<label class="sw"><div class="txt"><b>${title}</b><small>${hint}</small></div>
      <input type="checkbox" data-flag="${key}"${s[key] ? " checked" : ""} /><span class="knob"></span></label>`;
  const draw = () => {
    const chatterHint: Record<string, string> = {
      quiet: tr("它不主动说话，也不主动做事。", "It says and does nothing on its own."),
      normal: tr("偶尔说一句；久坐、深夜、卡住时会跳舞、奏一段、带你提肛。", "A line now and then; a dance, a piece of music or a kegel set when you sit long, stay late or get stuck."),
      lively: tr("话多一些，也更早注意到你坐久了。", "More lines, and it notices a long sit sooner."),
    };
    const win = (w: UsageWindow | null | undefined, zh: string, en: string) => (w ? tr(`${zh} ${Math.round(w.used_percent)}%`, `${en} ${Math.round(w.used_percent)}%`) : "");
    const nums = [win(s.usage?.primary, "5 小时", "5-hour"), win(s.usage?.secondary, "每周", "weekly")].filter(Boolean).join(" · ");
    const usageNow = nums ? `<span class="chip" style="margin-left:8px">${nums}</span>` : "";
    const reps = s.kegel_reps ?? 10;
    const mins = Math.max(1, Math.round((3 + reps * 6) / 60));
    const steps: [string, string][] = [
      ["<b>找对肌肉：</b>就是憋尿、忍住放屁时用力的那块肌肉（盆底肌）。", "<b>Find the muscle:</b> the one you use to hold in pee or gas (the pelvic floor)."],
      ["<b>收紧上提：</b>它说「收紧」时，把肛门和会阴往上、往里收，保持 3 秒。", "<b>Squeeze and lift:</b> on “Squeeze”, pull the area up and in, and hold for 3 s."],
      ["<b>完全放松：</b>它说「放松」时彻底松开 3 秒。放松和收紧一样重要。", "<b>Let go fully:</b> on “Relax”, release completely for 3 s. Relaxing matters as much as squeezing."],
      ["<b>呼吸自然：</b>别憋气；肚子、屁股和大腿尽量不跟着用力。", "<b>Keep breathing:</b> don't hold your breath; keep your belly, buttocks and thighs loose."],
      ["坐着、站着都能做，旁边的人看不出来。", "Sitting or standing both work, and nobody can tell."],
    ];
    box.innerHTML = `
      ${s.config_error ? `<div class="banner">${tr("config.yaml 有错，先用着上一次的配置：", "config.yaml has an error; using the last good config for now: ")}${esc(s.config_error)}</div>` : ""}
      <section class="hcard">
        <div class="hhead"><div class="ib">${ic("paw")}</div><div><h3>${tr("它", "The pet")}</h3></div></div>
        <div class="srow"><div class="txt"><b>${tr("大小", "Size")}</b><small>${tr("小 0.75 倍，中 1 倍，大 1.35 倍。", "Small 0.75×, medium 1×, large 1.35×.")}</small></div>
          ${seg("size", [["s", tr("小", "S")], ["m", tr("中", "M")], ["l", tr("大", "L")]])}</div>
        <div class="srow"><div class="txt"><b>${tr("话多话少", "Chattiness")}</b><small>${chatterHint[s.chatter] ?? ""}</small></div>
          ${seg("chatter", [["quiet", tr("安静", "Quiet")], ["normal", tr("正常", "Normal")], ["lively", tr("活泼", "Lively")]])}</div>
        ${sw("focus_mode", tr("安静一会儿", "Quiet for a while"), tr("只留状态和“等你”的提醒，别的都不动、不出声。", "Only the status and the “waiting for you” alert; nothing else moves or sounds."))}
        ${sw("sounds", tr("声音", "Sound"), tr("环境声、电台、奏乐和提示音的总开关。同一时间只播放一种。", "Master switch for ambience, radio, music and alerts. One source plays at a time."))}
      </section>
      <section class="hcard">
        <div class="hhead"><div class="ib">${ic("paw")}</div><div><h3>${tr("声音陪伴", "Audio companion")}</h3></div></div>
        <label class="sw"><div class="txt"><b>${tr("自动环境声", "Automatic ambience")}</b><small>${tr("自动模式下，启动 15 秒后轻声播放；白天风声，夜间虫鸣。离开桌面时停止，电台和奏乐优先。", "In Auto mode, starts gently after 15 seconds: wind by day, crickets at night. Stops while away; radio and music take priority.")}</small></div>
          <input type="checkbox" data-flag="ambience_auto"${s.ambience_auto !== false ? " checked" : ""} /><span class="knob"></span></label>
        <div class="srow"><div class="txt"><b>${tr("陪伴模式", "Companion mode")}</b><small>${tr("选择会记住。手动播放环境声时，会暂停电台或奏乐。", "Your choice is saved. Starting ambience manually pauses radio or music.")}</small></div>
          <select id="sound-mode">${([["auto", tr("自动陪伴", "Auto")], ["quiet", tr("安静无声", "Silence")], ["settle", tr("缓一缓 · 轻雨", "Settle · rain")], ["work", tr("开始工作 · 风声", "Work · wind")], ["waiting", tr("等待结果 · 轻雨", "Waiting · rain")], ["wind_down", tr("收工 · 夜声", "Wind down · night")]]).map(([id, label]) => `<option value="${id}"${(s.pet_mode ?? "auto") === id ? " selected" : ""}>${label}</option>`).join("")}</select></div>
        <div class="srow"><div class="txt"><b>${tr("环境声音量", "Ambience volume")}</b><small>${tr("自然录音，默认轻声播放，可按自己的耳机调整。", "Natural recordings at a gentle default level. Adjust for your headphones.")}</small></div>
          <label style="display:flex;align-items:center;gap:8px"><input id="sound-volume" aria-label="${tr("环境声音量", "Ambience volume")}" type="range" min="0" max="100" value="${s.ambience_volume ?? 25}" style="width:100px" /><output id="sound-volume-value">${s.ambience_volume ?? 25}%</output></label></div>
        <div class="hrow" style="flex-wrap:wrap"><button data-sound="settle">${tr("试听轻雨", "Try rain")}</button><button data-sound="work">${tr("试听风声", "Try wind")}</button><button data-sound="wind_down">${tr("试听夜声", "Try night")}</button><button data-sound="quiet">${tr("停止环境声", "Stop ambience")}</button></div>
        <div id="sound-status" class="note" aria-live="polite"></div>
      </section>
      <section class="hcard">
        <div class="hhead"><div class="ib">${ic("lift")}</div><div><h3>${tr("提肛", "Kegels")}</h3></div></div>
        <div class="note">${tr("不定时。你坐久了，它会说一声，然后转过身、背对着你带你做一组：收紧时它夹紧、尾巴提起，放松时松开、尾巴摇一下，头顶有倒计时。点它一下可以跳过。",
          "No schedule. When you have sat a long while, it says so, turns its back and leads a set: it squeezes with its tail lifted, then lets go with a wag, with a countdown above it. Click it to skip.")}</div>
        <div class="hrow"><span>${tr("每次", "Each set")}</span>
          <select id="kg-reps">${[5, 10, 15, 20].map((n) => `<option value="${n}"${n === reps ? " selected" : ""}>${tr(`${n} 下`, `${n} reps`)}</option>`).join("")}</select>
          <span class="note" style="margin:0">${tr(`约 ${mins} 分钟`, `about ${mins} min`)}</span>
          <span class="sp"></span><button id="kg-try" class="primary">${tr("现在做一组", "Do a set now")}</button></div>
        <details class="howto"><summary>${tr("动作要领", "How to do it")}</summary>
          <div class="steps">${steps.map(([zh, en]) => `<div>${tr(zh, en)}</div>`).join("")}</div>
          <div class="note">${tr("刚开始每次 5 下，习惯后 10–15 下，每天 2–3 次。如果有盆底或肛肠方面的不适，先问问医生。",
          "Start with 5 reps, build up to 10–15, two or three times a day. If you have pelvic or rectal problems, ask a doctor first.")}</div></details>
      </section>
      <section class="hcard">
        <div class="hhead"><div class="ib">${ic("globe")}</div><div><h3>${tr("语言与工作来源", "Language and work sources")}</h3></div></div>
        <div class="srow"><div class="txt"><b>${tr("界面语言", "Language")}</b><small>${tr("「自动」跟随系统。", "“Auto” follows the system.")}</small></div>
          ${seg("language", [["auto", tr("自动", "Auto")], ["zh", "中文"], ["en", "English"]])}</div>
        ${sw("approve", tr("在宠物上批准权限", "Approve permissions on the pet"),
          tr(`Claude Code 要权限时，宠物上方弹出一张卡片，写着它要运行的命令或要改的文件，点「允许」或「拒绝」就行，不用切回终端。打开以后，终端里自己的确认框要等这张卡片（最多 ${s.approve_wait_s} 秒，或者你在卡片上点「回终端决定」）。要显示的命令内容只交给本机的睿洱。全屏、共享屏幕或按了老板键时不弹。`,
             `When Claude Code asks for permission, a card opens above the pet with the command it wants to run or the file it wants to change: click Allow or Deny without going back to the terminal. While this is on, the terminal's own prompt waits for the card (up to ${s.approve_wait_s} s, or until you click “Decide in terminal”). The command text goes only to Rill on this machine. Nothing pops up in fullscreen, while sharing the screen, or under the boss key.`))}
        ${s.approve ? `<div class="srow"><div class="txt"><b>${tr("卡片等多久", "How long the card waits")}</b><small>${tr("时间到了还没点，终端里照常问你。", "With no answer by then, the terminal asks as usual.")}</small></div>
          <span class="seg2">${[15, 30, 60].map((n) => `<button data-wait="${n}" class="${s.approve_wait_s === n ? "on" : ""}">${tr(`${n} 秒`, `${n} s`)}</button>`).join("")}</span></div>` : ""}
        <div class="srow"><div class="txt"><b>${tr("接入工作来源", "Connect work sources")}</b><small>${tr("把 Claude Code、Codex、DeepSeek Harness 或 WorkBuddy 的会话接到工作台。动手前都会先说明要改什么。", "Connect Claude Code, Codex, DeepSeek Harness or WorkBuddy sessions to the workbench. The change is explained first.")}</small></div>
          <button data-hook="claude-code"${inTauri ? "" : " disabled"}>Claude Code…</button><button data-hook="codex"${inTauri ? "" : " disabled"}>Codex…</button></div>
        <div class="srow"><div class="txt"><b>${tr("其他工作来源", "Other work sources")}</b><small>${tr("Gemini CLI、Cursor、OpenCode、WorkBuddy 和 DeepSeek Harness 都能接入工作台，状态会汇总到同一只桌宠。", "Gemini CLI, Cursor, OpenCode, WorkBuddy and DeepSeek Harness can feed the workbench; their status joins the same companion.")}</small></div>
          <button data-hook="gemini"${inTauri ? "" : " disabled"}>Gemini CLI…</button><button data-hook="cursor"${inTauri ? "" : " disabled"}>Cursor…</button><button data-hook="opencode"${inTauri ? "" : " disabled"}>OpenCode…</button><button data-hook="workbuddy"${inTauri ? "" : " disabled"}>WorkBuddy…</button><button data-hook="deepseek-harness"${inTauri ? "" : " disabled"}>DeepSeek Harness…</button></div>
        <div class="srow"><div class="txt"><b>${tr("Claude Code 用量", "Claude Code usage")}${usageNow}</b><small>${tr("接上以后，工作台和桌宠可以看到 5 小时和每周额度用了多少，用到 90% 时它会说一声。数字来自 Claude Code 自己的状态栏，只有订阅账号才有。", "Once hooked up, the workbench and companion can show 5-hour and weekly usage, and say so at 90%. The numbers come from Claude Code's own status line, on subscription accounts only.")}</small></div>
          <button data-hook="usage"${inTauri ? "" : " disabled"}>${tr("接上…", "Hook up…")}</button></div>
        <div class="srow"><div class="txt"><b>${tr("工作来源的储物间", "The work sources' storeroom")}</b><small>${tr("它们攒在这台机器上的旧会话占了多少磁盘，每开一个会话先读进去多少 token、哪些一个月没用过。可以装箱、收起，都能放回。堆多了桌宠会提一句。", "How much disk old work sessions take on this machine, and how many tokens every new session reads first, with what went unused for a month. Pack or put things away, and bring them back. The companion mentions it when it piles up.")}</small></div>
          <button data-pick="storeroom"${inTauri ? "" : " disabled"}>${tr("看看…", "Have a look…")}</button></div>
        ${sw("night", tr("夜里整理", "Tidy at night"),
          tr("晚上你离开电脑半小时后，它把桌面和下载里很久没碰的文件收进一个文件夹，把工作来源一个月以前的会话装箱；安装包、副本只列出来，不删。第二天告诉你做了什么，每样都能放回。你放回去的，它记住，不再动。关掉以后只看不动。",
             "Half an hour after you leave in the evening, it puts files untouched for weeks on the desktop and in Downloads into one folder, and boxes month-old work sessions; installers and copies are only listed, never deleted. The next day it tells you what it did, and each thing can go back. What you put back, it remembers and leaves alone. Off: it only looks."))}
        <div class="srow"><div class="txt"><b>${tr("快捷键和其他", "Hotkeys and the rest")}</b><small>${tr("老板键、专注键写在 config.yaml 里，保存后自动生效。", "The boss key and the focus key live in config.yaml; changes apply on save.")}</small></div>
          <button data-open="open_config"${inTauri ? "" : " disabled"}>${tr("编辑配置…", "Edit config…")}</button></div>
      </section>
      <section class="hcard">
        <div class="hhead"><div class="ib">${ic("globe")}</div><div><h3>${tr("本机", "This computer")}</h3></div></div>
        <div class="srow"><div class="txt"><b>${tr("开机自启", "Start with Windows")}</b><small>${tr("开机时一起启动。", "Starts with the computer.")}</small></div>
          <button data-auto${inTauri ? "" : " disabled"} id="st-auto">…</button></div>
        <div class="srow"><div class="txt"><b>${tr("桌宠的语言模型", "The companion's language model")}</b><small>${tr("下载到本机的小模型，用来写信，不联网。", "A small model kept on this computer, for writing letters. Works offline.")}</small></div>
          <button data-model${inTauri ? "" : " disabled"} id="st-model">…</button></div>
        <div class="srow"><div class="txt"><b>${tr("数据文件夹", "The data folder")}</b><small>${tr("配置、糖罐、信和日记。", "Settings, the jar, letters and the diary.")}</small></div>
          <button data-pick="folder"${inTauri ? "" : " disabled"}>${tr("打开…", "Open…")}</button></div>
      </section>
      <div id="st-msg" class="note"></div>`;
    box.querySelectorAll<HTMLButtonElement>("[data-set]").forEach((b) => (b.onclick = () => void set(b.dataset.set!, b.dataset.v!)));
    box.querySelectorAll<HTMLInputElement>("[data-flag]").forEach((c) => (c.onchange = () => void set(c.dataset.flag!, c.checked)));
    ($("sound-mode") as HTMLSelectElement).onchange = (e) => void set("pet_mode", (e.target as HTMLSelectElement).value);
    const soundVolume = $("sound-volume") as HTMLInputElement;
    soundVolume.oninput = () => { $("sound-volume-value").textContent = `${soundVolume.value}%`; };
    soundVolume.onchange = () => void set("ambience_volume", Number(soundVolume.value));
    box.querySelectorAll<HTMLButtonElement>("[data-sound]").forEach((b) => b.onclick = async () => {
      if (!s.sounds || s.focus_mode) { $("st-msg").textContent = tr("请先打开声音，并关闭「安静一会儿」。", "Enable sound and turn off Quiet for a while first."); return; }
      if (b.dataset.sound === "quiet") return void set("pet_mode", "quiet");
      if (s.ambience_volume === 0) { $("st-msg").textContent = tr("环境声音量为 0，请先调高音量。", "Ambience volume is zero. Turn it up first."); return; }
      const kind = b.dataset.sound === "settle" ? "rain" : b.dataset.sound === "work" ? "wind" : "night";
      await (settingsPreview ??= new Ambience()).start(kind, (s.ambience_volume ?? 25) / 100, 20 / 60, true);
      if (settingsPreview.error) $("st-msg").textContent = tr("没有播放成功，请重试。", "Could not play. Please retry.");
      else $("st-msg").textContent = tr("试听 20 秒，随后恢复原来的陪伴模式。", "A 20-second preview, then your previous companion mode resumes.");
    });
    void soundStatus();
    box.querySelectorAll<HTMLButtonElement>("[data-wait]").forEach((b) => (b.onclick = () => void set("approve_wait_s", Number(b.dataset.wait))));
    ($("kg-reps") as HTMLSelectElement).onchange = (e) => void set("kegel_reps", Number((e.target as HTMLSelectElement).value));
    $("kg-try").onclick = async () => {
      const res = await fetch(conn.base + "/v1/cmd", {
        method: "POST",
        headers: { "X-RillBuddy-Token": conn.token, "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "kegel" }),
      });
      toast(await res.text());
    };
    box.querySelectorAll<HTMLButtonElement>("[data-hook]").forEach(
      (b) =>
        (b.onclick = async () => {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("connect_agent", { which: b.dataset.hook });
        }),
    );
    // Auto-start and the model belong to the host: ask it how they stand, and change them through it.
    const auto = $("st-auto") as HTMLButtonElement, model = $("st-model") as HTMLButtonElement;
    const host = async () => {
      if (!inTauri) return;
      const { invoke } = await import("@tauri-apps/api/core");
      const st = await invoke<{ autostart: boolean }>("tray_info").catch(() => null);
      auto.textContent = st?.autostart ? tr("已开启 · 关闭", "On · turn off") : tr("已关闭 · 开启", "Off · turn on");
      const m = await invoke<{ ready: boolean; done: number; total: number }>("model_state").catch(() => null);
      model.disabled = !!m?.ready || (!!m && m.total > 0 && m.done < m.total);
      model.textContent = m?.ready ? tr("已下载", "Downloaded") : m && m.total > 0 ? tr(`下载中 ${Math.round((m.done / m.total) * 100)}%`, `Downloading ${Math.round((m.done / m.total) * 100)}%`) : tr("下载…", "Download…");
      if (m && !m.ready && m.total > 0) window.setTimeout(() => void host(), 800);
    };
    void host();
    auto.onclick = async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("tray_pick", { id: "autostart" });
      void host();
    };
    model.onclick = async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("start_model_download");
      window.setTimeout(() => void host(), 400);
    };
    box.querySelectorAll<HTMLButtonElement>("[data-pick]").forEach(
      (b) =>
        (b.onclick = async () => {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("menu_pick", { id: b.dataset.pick });
        }),
    );
    box.querySelectorAll<HTMLButtonElement>("[data-open]").forEach(
      (b) =>
        (b.onclick = async () => {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke(b.dataset.open!);
        }),
    );
  };
  draw();
}

/** Open a tab. */
function go(tab: string): void {
  // Links from before the reminders moved into the settings still arrive.
  if (tab === "health") tab = "settings";
  if (!TABS.includes(tab)) return;
  document.querySelectorAll<HTMLButtonElement>("#tabs button").forEach((x) => x.classList.toggle("on", x.dataset.tab === tab));
  for (const id of TABS) $(`tab-${id}`).hidden = id !== tab;
  if (tab === "pets") void renderFive();
  if (tab === "settings") void renderSettings();
  if (tab === "fish") void renderFish();
  if (tab === "mem") void renderMem();
}

async function main() {
  conn = await connect();
  await initLang(conn);
  document.querySelectorAll<HTMLButtonElement>("#tabs button").forEach((b) => {
    b.onclick = () => go(b.dataset.tab!);
  });
  await renderFive();
  // The pairing was changed somewhere else (the config file): the page follows.
  followSkin(conn, () => null, () => void renderFive());
  // gallery.html?tab=settings opens a tab directly.
  const tab = new URLSearchParams(location.search).get("tab");
  if (tab) go(tab);
  // The tray and the pet menu open a tab in a gallery that is already up.
  void onHost<string>("goto-tab", (tab) => go(tab));
}

main().catch((e) => {
  document.body.innerHTML = `<div class="banner">${tr("图鉴加载失败：", "Failed to load the Gallery: ")}${esc(String(e))}</div>`;
});
