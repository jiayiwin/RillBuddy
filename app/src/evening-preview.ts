// 收工、第二天接上、离开回来一眼看懂 — on a pretend desktop. Two ideas the user
// asked to see before they are built:
//   1. the evening is learned from you (not the off-time in settings): the pets
//      keep a lamp on, ask for the day's tune only once every agent has stopped
//      and you are still there, tuck away where each agent stopped when you go,
//      and hand you the one thing to pick up when you sit down next morning;
//   2. coming back, what happened while you were away is in how the pets are
//      (asleep by a stack / holding a slip up at you / back turned, still busy),
//      not in a line of numbers.
// For looking at before it is built; never shipped.

import { FOOT_H, PetRenderer } from "./pet";
import { loadRig, type RigExpr, type RigPet } from "./rig/rig.js";
import { createPerformer, type Performer } from "./rig/perform.js";
import { applySkin, skin } from "./skin";

const q = new URLSearchParams(location.search);
const W = 1280, H = 720, BAR = 44;
const canvas = document.getElementById("desk") as HTMLCanvasElement;
canvas.width = W;
canvas.height = H;
const ctx = canvas.getContext("2d")!;
const RIG_PX = 0.288;
const FONT = "'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei UI', 'PingFang SC', system-ui, sans-serif";
const cap = document.getElementById("cap")!;
const nav = document.getElementById("nav")!;

type Scene = "lamp" | "stop" | "leave" | "morning" | "away" | "back" | "look";
const SCENES: Scene[] = ["lamp", "stop", "leave", "morning", "away", "back", "look"];
const LABEL: Record<Scene, string> = { lamp: "快收工了", stop: "最后一轮停下", leave: "你走了", morning: "你坐下", away: "你走开", back: "一眼看过去", look: "看向等你的那只" };
const CAPTION: Record<Scene, [string, string, string]> = {
  lamp: ["夜 ①", "23:38 · 快收工了", "它不看设置里的下班时间，看你：最近七晚你都在 23:40–23:58 之间停下。到了这段时间它不再开口，只把灯留着，陪你把最后一轮等完。不催你睡。"],
  stop: ["夜 ②", "23:51 · 最后一轮停下", "两个 agent 都停了、你还坐着，它才问收工曲。原来按「下班前半小时」问，正好错开你真正收工的时候。"],
  leave: ["夜 ③", "23:56 · 你走了", "每只替自己的 agent 收一张「停在哪」，取自 agent 最后一条回复里的「下一步：」那一行；不读你发给 agent 的话。干净做完、没有要接的，就只留一摞纸，不写。灯随后熄掉。"],
  morning: ["夜 ④", "次日 08:14 · 你坐下", "只说要接上的那一件。几只都有时挑最要紧的：在等你的 > 出错的 > 留了下一步的。这一句由本机模型把「下一步」压成一行；点「过去」到那个 agent 的窗口。"],
  away: ["回来 ①", "14:20 · 你走开", "三个 agent 同时在跑（你的记录里，三成的时间不止一个在跑）。还在忙的，背对着你，脸朝它的活。"],
  back: ["回来 ②", "15:57 · 回来，一眼看过去", "不说话。睡在一摞纸旁边 = 做完了；举着一张纸望着你 = 在等你；背对着你 = 还在忙。原来这里是一句「你离开了 97 分钟。那会儿做完了 1 件。」"],
  look: ["回来 ③", "看向举着纸的那只", "要细节，看它一眼它才说；点「过去」到那个 agent 的窗口。别的几只不出声。"],
};

// ---- the pets
interface Pet {
  id: string;
  name: string;
  agent: string;
  band: string;
  rig: RigPet;
  perf: Performer;
  r: PetRenderer;
  top: HTMLCanvasElement;
  rigW: number;
  rigH: number;
  /** Centre of its feet on the desk, and its window box around that. */
  cx: number;
  box: { w: number; h: number };
  on: boolean;
  /** A slip: in its hand at its side, held up over its head, or lying by its feet; `k` fades it in. */
  slip: "none" | "hand" | "up" | "side";
  slipK: number;
  slipT: number;
  /** The stack of finished pages beside it, faded in by `k`. */
  stack: number;
  stackT: number;
  /** Which side of it the stack sits on: -1 left, 1 right. */
  stackSide: number;
  /** Ears up now and then: it is waiting for you. */
  waiting: boolean;
  lastPerk: number;
}
const pets: Record<string, Pet> = {};

async function makePet(id: string, agent: string): Promise<Pet> {
  const s = skin(id);
  const rig = await loadRig(s.rig ?? `rig/${id}/`);
  const perf = createPerformer(null, rig);
  const [x0, y0, x1, y1] = rig.rig.bbox;
  const top = document.createElement("canvas");
  const r = new PetRenderer(top.getContext("2d")!);
  const p: Pet = {
    id, name: s.zh, agent, band: s.colors.accentOff, rig, perf, r, top,
    rigW: (x1 - x0) * RIG_PX, rigH: (y1 - y0) * RIG_PX,
    cx: 0, box: { w: 0, h: 0 }, on: false,
    slip: "none", slipK: 0, slipT: 1, stack: 0, stackT: 0, stackSide: -1, waiting: false, lastPerk: 0,
  };
  r.rigBox = { w: p.rigW, h: p.rigH };
  r.onResize = (w, h) => {
    top.width = w;
    top.height = h;
    p.box = { w, h };
  };
  r.fit();
  return p;
}

// ---- the desk
type Sky = "night" | "morning" | "day";
let sky: Sky = "night";
/** The lamp's warm pool round the pets, 0..1, and how dark the screen has gone, 0..1. */
let lamp = 0, lampT = 0, dim = 0, dimT = 0;
let clock = "23:38 2026/11/13";
let cursor: { x: number; y: number; tx: number; ty: number } | null = null;

function wallpaper() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  if (sky === "night") {
    g.addColorStop(0, "#1f2440");
    g.addColorStop(0.6, "#2d2a4a");
    g.addColorStop(1, "#3b3352");
  } else if (sky === "morning") {
    g.addColorStop(0, "#d9e4f4");
    g.addColorStop(0.55, "#f3e6e6");
    g.addColorStop(1, "#fbe7cf");
  } else {
    g.addColorStop(0, "#c9d6ef");
    g.addColorStop(0.55, "#e8def0");
    g.addColorStop(1, "#f6e3d6");
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const hills = sky === "night"
    ? [[470, 40, "rgba(70,78,108,.55)"], [540, 30, "rgba(58,64,92,.7)"]]
    : [[470, 40, "rgba(176,196,170,.55)"], [540, 30, "rgba(150,178,146,.6)"]];
  for (const [y, amp, col] of hills as [number, number, string][]) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 20) ctx.lineTo(x, y + Math.sin(x / 210 + y) * amp + Math.sin(x / 90) * amp * 0.25);
    ctx.lineTo(W, H);
    ctx.fill();
  }
  if (sky === "night") {
    // A thin moon and a few stars, nothing that moves.
    ctx.fillStyle = "rgba(248,240,214,.85)";
    ctx.beginPath();
    ctx.arc(1010, 140, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#262b4a";
    ctx.beginPath();
    ctx.arc(1024, 132, 31, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(240,236,255,.55)";
    for (const [x, y, r] of [[160, 90, 1.4], [330, 170, 1], [612, 70, 1.2], [780, 210, 1], [880, 96, 1.5], [1180, 250, 1.1], [450, 280, 0.9]]) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.fillStyle = sky === "morning" ? "rgba(255,236,200,.85)" : "rgba(255,248,232,.7)";
    ctx.beginPath();
    ctx.arc(sky === "morning" ? 180 : 1010, sky === "morning" ? 210 : 150, 60, 0, Math.PI * 2);
    ctx.fill();
  }
}

function taskbar() {
  const night = sky === "night";
  ctx.fillStyle = night ? "rgba(40,38,58,.94)" : "rgba(246,244,250,.92)";
  ctx.fillRect(0, H - BAR, W, BAR);
  ctx.fillStyle = night ? "rgba(255,255,255,.08)" : "rgba(120,110,140,.18)";
  ctx.fillRect(0, H - BAR, W, 1);
  ["#9db7e6", "#8cc79a", "#e7b47d", "#c8a6e6", "#e79aa8", "#7fc6c2"].forEach((c, k) => {
    ctx.globalAlpha = night ? 0.7 : 1;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.roundRect(W / 2 - 3 * 40 + k * 40 + 6 - 120, H - BAR + 8, 28, 28, 7);
    ctx.fill();
    ctx.globalAlpha = 1;
  });
  ctx.fillStyle = night ? "#e6e0ee" : "#5b4a57";
  ctx.font = "12px system-ui, 'Microsoft YaHei', sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  const [time, date] = clock.split(" ");
  ctx.fillText(time, W - 16, H - BAR + 19);
  ctx.fillText(date, W - 16, H - BAR + 35);
}

/** The warm pool of a lamp left on, round the pets. */
function lampGlow(cx: number) {
  if (lamp <= 0.01) return;
  const y = H - BAR - 40;
  const g = ctx.createRadialGradient(cx, y, 10, cx, y, 330);
  g.addColorStop(0, `rgba(255,214,150,${0.42 * lamp})`);
  g.addColorStop(0.45, `rgba(255,196,130,${0.16 * lamp})`);
  g.addColorStop(1, "rgba(255,190,120,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** A slip of paper: folded corner, a few lines of writing, a pin in the pet's colour. */
function slip(x: number, y: number, rot: number, s: number, band: string, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(s, s);
  ctx.shadowColor = "rgba(40,30,60,.28)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1.5;
  ctx.fillStyle = "#fbf3df";
  ctx.beginPath();
  ctx.moveTo(-11, -13);
  ctx.lineTo(6, -13);
  ctx.lineTo(11, -8);
  ctx.lineTo(11, 13);
  ctx.lineTo(-11, 13);
  ctx.closePath();
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "#d8c9b3";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#efe2c6";
  ctx.beginPath();
  ctx.moveTo(6, -13);
  ctx.lineTo(6, -8);
  ctx.lineTo(11, -8);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#9b8a9a";
  ctx.lineWidth = 1.2;
  ctx.lineCap = "round";
  for (const [y, w] of [[-4, 14], [1, 11], [6, 13]] as const) {
    ctx.beginPath();
    ctx.moveTo(-7, y);
    for (let x = -7; x <= -7 + w; x += 2) ctx.lineTo(x, y + Math.sin(x * 1.3 + y) * 0.7);
    ctx.stroke();
  }
  ctx.fillStyle = band;
  ctx.beginPath();
  ctx.arc(-4, -10, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** The pages of a finished job, squared off beside the pet, a clip in its colour. */
function stack(x: number, y: number, band: string, alpha: number) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let k = 0; k < 5; k++) {
    const yy = y - k * 3.2;
    const dx = Math.sin(k * 2.1) * 2;
    ctx.fillStyle = k % 2 ? "#f6eedb" : "#fbf3df";
    ctx.strokeStyle = "#d3c3ad";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - 17 + dx, yy - 3.2, 34, 3.6, 1);
    ctx.fill();
    ctx.stroke();
  }
  // The top sheet, flat, with a line or two showing.
  const ty = y - 5 * 3.2;
  ctx.fillStyle = "#fffaf0";
  ctx.beginPath();
  ctx.moveTo(x - 18, ty);
  ctx.lineTo(x + 16, ty);
  ctx.lineTo(x + 19, ty - 7);
  ctx.lineTo(x - 15, ty - 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = band;
  ctx.fillRect(x + 8, ty - 9, 3.5, 7);
  ctx.restore();
}

function drawCursor() {
  if (!cursor) return;
  cursor.x += (cursor.tx - cursor.x) * 0.08;
  cursor.y += (cursor.ty - cursor.y) * 0.08;
  ctx.save();
  ctx.translate(cursor.x, cursor.y);
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#1d1a26";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 17);
  ctx.lineTo(4.5, 13);
  ctx.lineTo(7.5, 19.5);
  ctx.lineTo(10, 18.4);
  ctx.lineTo(7, 12);
  ctx.lineTo(12.5, 12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// ---- go
const wait = (ms: number) => new Promise<void>((d) => window.setTimeout(d, ms));
let gen = 0;
const STOP = Symbol("stop");

async function main() {
  const order: [string, string][] = [["paopao", "Claude Code"], ["rongrong", "Codex"], ["gugu", "Gemini CLI"]];
  for (const [id, agent] of order) pets[id] = await makePet(id, agent);
  const all = Object.values(pets);

  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    lamp += (lampT - lamp) * Math.min(1, dt * 1.6);
    dim += (dimT - dim) * Math.min(1, dt * 0.9);
    wallpaper();
    const shown = all.filter((p) => p.on);
    if (shown.length) lampGlow(shown.reduce((s, p) => s + p.cx, 0) / shown.length);
    taskbar();
    if (dim > 0.01) {
      ctx.fillStyle = `rgba(8,8,20,${0.62 * dim})`;
      ctx.fillRect(0, 0, W, H);
    }
    const floor = H - BAR;
    for (const p of shown) {
      p.perf.tick(dt);
      p.r.update(now);
      p.slipK += (p.slipT - p.slipK) * Math.min(1, dt * 2.2);
      p.stack += (p.stackT - p.stack) * Math.min(1, dt * 2);
      if (p.waiting && now - p.lastPerk > 3600) {
        p.lastPerk = now;
        p.rig.react("perk");
      }
      // The pages of what got done, at its feet on the near side.
      stack(p.cx + p.stackSide * p.rigW * 0.62, floor - 1, p.band, p.stack);
      ctx.save();
      ctx.translate(p.cx - p.rig.foot[0] * RIG_PX, floor - p.rig.foot[1] * RIG_PX);
      p.perf.draw(ctx, RIG_PX);
      ctx.restore();
      const sway = Math.sin(now / 900 + p.cx) * 0.06;
      if (p.slip === "hand") slip(p.cx + p.rigW * 0.36, floor - p.rigH * 0.3, 0.12 + sway, 1, p.band, p.slipK);
      else if (p.slip === "side") slip(p.cx + p.rigW * 0.5, floor - 7, 1.35, 1, p.band, p.slipK);
      else if (p.slip === "up") {
        // Held up over its head, like a sign, bobbing a little.
        const bob = Math.sin(now / 520) * 2.5;
        slip(p.cx + p.rigW * 0.08, floor - p.rigH - 22 + bob, -0.08 + sway * 0.6, 1.45, p.band, p.slipK);
      }
      // Its name under its feet, on the taskbar.
      ctx.font = `600 11px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = sky === "night" ? `rgba(230,224,238,${0.85 - dim * 0.5})` : "rgba(91,74,87,.85)";
      ctx.fillText(`${p.name} · ${p.agent}`, p.cx, floor + 22);
      // The bubble it says or asks, from its own window.
      ctx.drawImage(p.top, p.cx - p.box.w / 2, floor + FOOT_H - p.box.h);
    }
    drawCursor();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // ---- what each scene sets up
  const place = (ids: string[], xs: number[]) => {
    for (const p of all) p.on = false;
    ids.forEach((id, k) => {
      const p = pets[id];
      p.on = true;
      p.cx = xs[k];
      // The last one keeps its pages on its far side, out of the way of its neighbour.
      p.stackSide = k === ids.length - 1 && ids.length > 1 ? 1 : -1;
    });
  };
  const pose = (p: Pet, expr: RigExpr, back = false) => {
    p.rig.expr = expr;
    p.rig.setBack(back);
    Object.assign(p.rig.play, { face: null, look: null, head: null });
  };
  const reset = () => {
    cursor = null;
    for (const p of all) {
      p.r.answer(false);
      p.r.say("", 1);
      p.slip = "none";
      p.slipK = p.slipT = 0;
      p.stack = p.stackT = 0;
      p.waiting = false;
      pose(p, "neutral");
    }
    lamp = lampT = 0;
    dim = dimT = 0;
  };
  const ask = (p: Pet, text: string, yes: string, no: string) => {
    applySkin(p.id);
    p.r.ask(text, yes, no, 600_000, () => {}, true);
  };

  const scenes: Record<Scene, (sleep: (ms: number) => Promise<void>, still: boolean) => Promise<void>> = {
    lamp: async (sleep) => {
      sky = "night";
      clock = "23:38 2026/11/13";
      place(["paopao", "rongrong"], [900, 1070]);
      // Both agents still on their last turn: backs to you, at their work.
      pose(pets.paopao, "sleepy", true);
      pose(pets.rongrong, "sleepy", true);
      lampT = 1;
      lamp = 1;
      await sleep(2600);
      // Now and then one turns to see you are still there, and goes back to it.
      pets.rongrong.rig.setBack(false);
      pets.rongrong.rig.play.look = [-2, 0];
      await sleep(1700);
      pets.rongrong.rig.setBack(true);
      pets.rongrong.rig.play.look = null;
    },
    stop: async (sleep, still) => {
      sky = "night";
      clock = "23:51 2026/11/13";
      place(["paopao", "rongrong"], [900, 1070]);
      lamp = lampT = 1;
      pose(pets.paopao, "sleepy", true);
      pose(pets.rongrong, "happy");
      pets.rongrong.stack = pets.rongrong.stackT = 1;
      if (!still) {
        pose(pets.rongrong, "sleepy", true);
        pets.rongrong.stack = pets.rongrong.stackT = 0;
        await sleep(900);
        // Codex stops first: Rongrong turns round with its pages.
        pose(pets.rongrong, "happy");
        pets.rongrong.rig.react("cheer");
        pets.rongrong.stackT = 1;
        await sleep(1800);
        pets.rongrong.rig.expr = "sleepy";
        await sleep(900);
        // Then Claude.
        pose(pets.paopao, "happy");
        pets.paopao.rig.react("cheer");
        await sleep(1800);
        pets.paopao.rig.expr = "sleepy";
        await sleep(700);
      } else pose(pets.paopao, "sleepy");
      pets.paopao.slip = "hand";
      pets.paopao.slipT = 1;
      ask(pets.paopao, "今晚的，弹给你听？", "好", "不用");
    },
    leave: async (sleep, still) => {
      sky = "night";
      clock = "23:56 2026/11/13";
      place(["paopao", "rongrong"], [900, 1070]);
      lamp = lampT = 1;
      pose(pets.paopao, "sleepy");
      pose(pets.rongrong, "sleepy");
      pets.rongrong.stack = pets.rongrong.stackT = 1;
      if (still) {
        dim = dimT = 1;
        lamp = lampT = 0.25;
        pets.paopao.slip = "side";
        pets.paopao.slipK = pets.paopao.slipT = 1;
        pose(pets.paopao, "asleep");
        pose(pets.rongrong, "asleep");
        return;
      }
      await sleep(1000);
      // You get up: the screen goes dark the way it does when nobody is there.
      dimT = 1;
      await sleep(1400);
      // Paopao writes down where Claude stopped and keeps it by its feet.
      pets.paopao.slip = "hand";
      pets.paopao.slipT = 1;
      pets.paopao.rig.react("perk");
      await sleep(1600);
      pets.paopao.slipK = 0;
      pets.paopao.slip = "side";
      await sleep(900);
      lampT = 0.25;
      await sleep(900);
      pose(pets.rongrong, "asleep");
      await sleep(700);
      pose(pets.paopao, "asleep");
    },
    morning: async (sleep, still) => {
      sky = "morning";
      clock = "08:14 2026/11/14";
      place(["paopao", "rongrong"], [900, 1070]);
      pose(pets.paopao, "asleep");
      pose(pets.rongrong, "asleep");
      pets.paopao.slip = "side";
      pets.paopao.slipK = pets.paopao.slipT = 1;
      pets.rongrong.stack = pets.rongrong.stackT = 1;
      if (!still) {
        dim = 0.6;
        dimT = 0;
        await sleep(1500);
      } else dim = 0;
      // The one with something to pick up wakes; the other sleeps on by its finished pages.
      pose(pets.paopao, "neutral");
      pets.paopao.rig.react("perk");
      pets.paopao.slipK = 0;
      pets.paopao.slip = "hand";
      await sleep(still ? 0 : 900);
      ask(pets.paopao, "Claude 昨晚停在登录超时，还差一个测试。过去？", "过去", "等会儿");
    },
    away: async (sleep) => {
      sky = "day";
      clock = "14:20 2026/11/14";
      place(["paopao", "rongrong", "gugu"], [820, 980, 1140]);
      for (const p of [pets.paopao, pets.rongrong, pets.gugu]) pose(p, "neutral", true);
      cursor = { x: 700, y: 420, tx: 700, ty: 420 };
      await sleep(1200);
      // You go: the pointer leaves, and they keep at it.
      cursor.tx = -40;
      cursor.ty = 760;
    },
    back: async (sleep, still) => {
      sky = "day";
      clock = "15:57 2026/11/14";
      place(["paopao", "rongrong", "gugu"], [820, 980, 1140]);
      // Done: asleep by what it made. Waiting on you: facing you, a slip up. Still busy: back turned.
      pose(pets.paopao, "asleep");
      pets.paopao.stack = pets.paopao.stackT = 1;
      pose(pets.rongrong, "neutral");
      pets.rongrong.slip = "up";
      pets.rongrong.slipK = pets.rongrong.slipT = 1;
      pets.rongrong.waiting = true;
      pets.rongrong.rig.play.look = [-1.5, -0.5];
      pose(pets.gugu, "neutral", true);
      if (!still) {
        cursor = { x: -30, y: 700, tx: 520, ty: 430 };
        await sleep(1200);
      }
    },
    look: async (sleep, still) => {
      sky = "day";
      clock = "15:58 2026/11/14";
      place(["paopao", "rongrong", "gugu"], [820, 980, 1140]);
      pose(pets.paopao, "asleep");
      pets.paopao.stack = pets.paopao.stackT = 1;
      pose(pets.rongrong, "neutral");
      pets.rongrong.slip = "up";
      pets.rongrong.slipK = pets.rongrong.slipT = 1;
      pose(pets.gugu, "neutral", true);
      const at = { x: 984, y: H - BAR - 52 };
      cursor = still ? { ...at, tx: at.x, ty: at.y } : { x: 520, y: 430, tx: at.x, ty: at.y };
      await sleep(still ? 0 : 1300);
      pets.rongrong.slip = "hand";
      pets.rongrong.rig.react("perk");
      ask(pets.rongrong, "Codex 想删掉旧的构建目录，等你点头。", "过去", "等会儿");
    },
  };

  const buttons: Partial<Record<Scene, HTMLButtonElement>> = {};
  SCENES.forEach((s, k) => {
    if (k === 4) nav.appendChild(Object.assign(document.createElement("span"), { className: "gap" }));
    const b = document.createElement("button");
    b.textContent = `${CAPTION[s][0]} ${LABEL[s]}`;
    b.onclick = () => void play(s);
    nav.appendChild(b);
    buttons[s] = b;
  });

  const still = q.has("still");
  const play = async (s: Scene) => {
    const g = ++gen;
    const sleep = async (ms: number) => {
      await wait(ms);
      if (g !== gen) throw STOP;
    };
    reset();
    for (const [k, b] of Object.entries(buttons)) b!.classList.toggle("on", k === s);
    cap.innerHTML = `${CAPTION[s][0]} · ${CAPTION[s][1]}<small>${CAPTION[s][2]}</small>`;
    try {
      await sleep(60);
      await scenes[s](sleep, still);
    } catch (e) {
      if (e !== STOP) throw e;
    }
  };
  const w = window as unknown as { play: typeof play; ready: boolean; SCENES: Scene[] };
  w.play = play;
  w.SCENES = SCENES;
  const first = (q.get("scene") as Scene) ?? "lamp";
  await play(SCENES.includes(first) ? first : "lamp");
  w.ready = true;
  if (q.has("all")) {
    for (const s of SCENES.slice(SCENES.indexOf(first) + 1)) {
      await wait(7000);
      await play(s);
    }
  }
}

void main();
