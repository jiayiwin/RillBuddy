import { t } from "./i18n";
import { loadRig, type RigExpr, type RigPet } from "./rig/rig.js";
import { ORDER, skin, type SkinId } from "./skin";
import { desks, hall, lounge, monitorPosition, OfficeScene, project, restroom, sceneSize, water, type Desk, type Point, type ScreenMode } from "./workbench-office-scene";

export interface FloorItem {
  id: string;
  title: string;
  sourceId: string;
  sourceName: string;
  state: string;
  status: string;
  updated: string;
  health?: string;
}

type Activity = "arrive" | "type" | "think" | "stretch" | "drink" | "away" | "chat" | "sleep" | "wait" | "worry" | "rest" | "off";

const screenModeByState = new Map<string, ScreenMode>([
  ["tool", "typing"], ["working", "typing"], ["thinking", "thinking"], ["reading", "reading"],
  ["attention", "waiting"], ["needs_you", "waiting"], ["waiting", "waiting"],
  ["error", "paused"], ["blocked", "paused"], ["stone", "paused"], ["aborted", "paused"],
  ["sleeping", "sleep"], ["offline", "off"],
]);
const runningLabel: [string, string] = ["运作中", "Running"];
const screenLabels: Record<ScreenMode, [string, string]> = {
  typing: runningLabel, thinking: runningLabel, reading: runningLabel,
  waiting: ["等待中", "Waiting"], paused: ["中断", "Interrupted"], idle: ["待机", "Standby"],
  sleep: ["休眠", "Sleeping"], off: ["关屏", "Screen off"], stale: ["待同步", "Awaiting sync"],
};

const activityText: Record<Activity, [string, string]> = {
  arrive: ["走向工位", "Walking to the desk"],
  type: ["敲键盘", "Typing"],
  think: ["盯着屏幕想一想", "Thinking at the screen"],
  stretch: ["伸个懒腰", "Stretching"],
  drink: ["喝口水", "Drinking water"],
  away: ["去趟洗手间", "Restroom break"],
  chat: ["和同事聊两句", "Chatting with a coworker"],
  sleep: ["打盹", "Napping"],
  wait: ["等你回话", "Waiting for you"],
  worry: ["看下哪里卡住了", "Checking what went wrong"],
  rest: ["在桌边歇一会儿", "Taking a breather"],
  off: ["已收工", "Off shift"],
};
const faces: Partial<Record<Activity, RigExpr>> = {
  think: "calm", stretch: "happy", chat: "happy", sleep: "asleep", worry: "worried", rest: "sleepy", off: "asleep",
};
const petsBySource: Partial<Record<string, SkinId>> = {
  "claude-code": "zimeng", codex: "mashu", gemini: "paopao", cursor: "gugu", opencode: "rongrong",
  workbuddy: "gugu", "deepseek-harness": "paopao",
};
const breaks: Activity[] = ["rest", "stretch", "drink", "rest", "away", "rest"];
const canChat = (state: string) => ["idle", "done", "parked", "waiting"].includes(state);

function hash(text: string): number {
  let value = 0;
  for (const character of text) value = (Math.imul(value, 31) + character.codePointAt(0)!) >>> 0;
  return value;
}

function activityFor(state: string, elapsed: number, offset: number): Activity {
  if (state === "offline") return "off";
  if (state === "sleeping") return "sleep";
  if (state === "attention" || state === "needs_you") return "wait";
  if (["error", "stone", "aborted", "blocked"].includes(state)) return "worry";
  if (state === "thinking" || state === "reading") return "think";
  if (state === "done" && elapsed < 3500) return "stretch";
  if (state === "tool" || state === "working") return "type";
  if (elapsed < 1800) return "arrive";
  return breaks[Math.floor((elapsed + offset % 18_000) / 10_000) % breaks.length];
}

interface Seat {
  button: HTMLButtonElement;
  item: FloorItem;
  worker: ReturnType<typeof skin>;
  laptop: boolean;
  offset: number;
  since: number;
  screen: ScreenMode;
  activity?: Activity;
  pet?: RigPet;
  loading?: Promise<void>;
  desk?: Desk;
  position: Point;
  route: Point[];
  destination?: Point;
  walk: number;
  title: HTMLElement;
  screenLabel: HTMLElement;
}

const conversation = [{ x: 7.98, y: 5.46 }, { x: 8.62, y: 5.76 }];

function pathTo(seat: Seat, target: Point): Point[] {
  const { position, desk } = seat;
  if (!desk) return [];
  // Leaving through the row aisle keeps the pet out of the desks and chairs.
  const insideRow = position.x < hall;
  const path: Point[] = [];
  const returning = target === desk.chair;
  if (insideRow) {
    path.push({ x: position.x, y: desk.aisle });
    if (returning) return [...path, { x: desk.chair.x, y: desk.aisle }, target];
    path.push({ x: hall, y: desk.aisle });
  } else {
    path.push({ x: hall, y: position.y });
  }
  return returning
    ? [...path, { x: hall, y: desk.aisle }, { x: desk.chair.x, y: desk.aisle }, target]
    : [...path, { x: hall, y: target.y }, target];
}

export class WorkbenchFloor {
  private readonly seats = new Map<string, Seat>();
  private visible: Seat[] = [];
  private readonly canvas = document.createElement("canvas");
  private readonly stage = document.createElement("div");
  private readonly toolbar = document.createElement("div");
  private readonly previous = document.createElement("button");
  private readonly next = document.createElement("button");
  private readonly pageNumber = document.createElement("span");
  private readonly motion = matchMedia("(prefers-reduced-motion: reduce)");
  private readonly scene: OfficeScene;
  private readonly furniture: ReturnType<OfficeScene["furniture"]>;
  private page = 0;
  private frame = 0;
  private lastFrame = 0;
  private nextActivity = 0;
  private historical = false;
  private selected = "";

  constructor(private readonly container: HTMLElement, private readonly select: (id: string) => void) {
    this.stage.className = "office-stage";
    this.canvas.setAttribute("aria-hidden", "true");
    this.stage.append(this.canvas);
    this.stage.addEventListener("pointerup", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest(".office-task")) return;
      const rect = this.stage.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width * sceneSize.width;
      const y = (event.clientY - rect.top) / rect.height * sceneSize.height;
      let closest: Seat | undefined;
      let distance = Number.POSITIVE_INFINITY;
      for (const seat of this.visible) {
        const monitor = monitorPosition(seat.desk!, seat.laptop);
        const next = Math.hypot(monitor.x - x, monitor.y - y);
        if (next < distance) {
          distance = next;
          closest = seat;
        }
      }
      if (closest && distance < 78) this.select(closest.item.id);
    });
    this.scene = new OfficeScene(this.canvas.getContext("2d")!);
    this.furniture = this.scene.furniture();
    this.toolbar.className = "office-pages";
    this.previous.type = this.next.type = "button";
    this.previous.addEventListener("click", () => this.changePage(-1));
    this.next.addEventListener("click", () => this.changePage(1));
    this.toolbar.append(this.previous, this.pageNumber, this.next);
  }

  show(items: FloorItem[], selected: string, historical: boolean): void {
    if (!items.length) {
      this.hide();
      return;
    }
    if (this.historical !== historical) this.page = 0;
    this.historical = historical;
    this.selected = selected;
    const byId = new Map(items.map((item) => [item.id, item]));
    for (const [id, seat] of this.seats) {
      if (byId.has(id)) continue;
      seat.button.remove();
      this.seats.delete(id);
    }
    // Keep the same seating order when the underlying list sorts by a new status.
    for (const item of items) {
      const seat = this.seats.get(item.id) ?? this.makeSeat(item);
      if (seat.item.state !== item.state) seat.since = Date.now();
      seat.item = item;
      seat.title.textContent = item.title;
      seat.screen = historical ? "off" : item.health === "stale" ? "stale" : screenModeByState.get(item.state) ?? "idle";
      seat.button.dataset.screen = seat.screen;
      seat.screenLabel.textContent = t(...screenLabels[seat.screen]);
    }
    if (!this.stage.isConnected) this.mountRoom();
    this.container.hidden = false;
    this.placeSeats();
    this.nextActivity = 0;
    if (!this.frame) this.frame = requestAnimationFrame(this.draw);
  }

  hide(): void {
    cancelAnimationFrame(this.frame);
    this.frame = this.lastFrame = this.nextActivity = 0;
    this.seats.clear();
    this.visible = [];
    this.page = 0;
    for (const button of this.stage.querySelectorAll(".office-task")) button.remove();
    this.container.replaceChildren();
    this.container.hidden = true;
  }

  private mountRoom(): void {
    const legend = document.createElement("div");
    legend.className = "office-guide";
    const hint = document.createElement("span");
    hint.textContent = t("点工位查看任务", "Select a desk to see its task");
    const active = document.createElement("span");
    active.className = "office-running";
    active.textContent = t(...runningLabel);
    legend.append(hint, active);
    for (const [spot, label] of [
      [project(8.85, 0.02, 1.15), t("洗手间", "Restroom")],
      [project(9.55, 2.28, 1.18), t("饮水区", "Water")],
      [project(8.82, 5.94), t("休息区", "Lounge")],
    ] as const) {
      const sign = document.createElement("span");
      sign.className = "office-location";
      sign.textContent = label;
      this.pin(sign, spot);
      this.stage.append(sign);
    }
    this.previous.textContent = t("上一间", "Previous");
    this.next.textContent = t("下一间", "Next");
    this.container.append(legend, this.stage, this.toolbar);
  }

  private changePage(delta: number): void {
    this.page += delta;
    this.placeSeats();
    this.nextActivity = 0;
    if (this.selected) this.select("");
  }

  private pin(element: HTMLElement, point: Point): void {
    element.style.left = `${point.x / sceneSize.width * 100}%`;
    element.style.top = `${point.y / sceneSize.height * 100}%`;
  }

  private placeSeats(): void {
    const pages = Math.ceil(this.seats.size / desks.length);
    this.page = Math.max(0, Math.min(this.page, pages - 1));
    const offset = this.page * desks.length;
    const nextSeats = [...this.seats.values()].slice(offset, offset + desks.length);
    for (const seat of this.visible) if (!nextSeats.includes(seat)) seat.button.remove();
    this.visible = nextSeats;
    for (const [index, seat] of this.visible.entries()) {
      const desk = desks[index];
      if (seat.desk !== desk || !seat.button.isConnected) {
        seat.desk = desk;
        seat.position = { ...desk.chair };
        seat.destination = desk.chair;
        seat.route = [];
        this.pin(seat.button, monitorPosition(desk, seat.laptop));
        if (!seat.button.isConnected) this.stage.append(seat.button);
      }
      seat.button.setAttribute("aria-pressed", String(seat.item.id === this.selected));
      seat.button.classList.toggle("on", seat.item.id === this.selected);
      this.describe(seat);
      seat.loading ??= loadRig(seat.worker.rig ?? "rig/zimeng/").then((pet) => {
        seat.pet = pet;
        pet.expr = faces[seat.activity ?? "rest"] ?? "neutral";
      }).catch((error) => console.error("office pet", error));
    }
    this.toolbar.hidden = pages <= 1;
    this.previous.disabled = this.page === 0;
    this.next.disabled = this.page === pages - 1;
    this.pageNumber.textContent = t(`办公室 ${this.page + 1} / ${pages}`, `Office ${this.page + 1} of ${pages}`);
  }

  private describe(seat: Seat): void {
    const state = t(...screenLabels[seat.screen]);
    const pet = t(seat.worker.zh, seat.worker.en);
    const activity = seat.activity ? t(...activityText[seat.activity]) : "";
    const label = [seat.item.title, seat.item.sourceName, seat.item.status, state, pet, activity].filter(Boolean).join(" · ");
    seat.button.title = label;
    seat.button.setAttribute("aria-label", label);
  }

  private makeSeat(item: FloorItem): Seat {
    const offset = hash(item.id);
    const worker = skin(petsBySource[item.sourceId] ?? ORDER[offset % ORDER.length]);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "office-task";
    button.style.pointerEvents = "auto";
    button.innerHTML = '<span class="office-task-name"></span><span class="office-task-status"></span>';
    const seat: Seat = {
      button, item, worker, offset, since: Date.now(), laptop: Boolean((offset >>> 4) % 2),
      screen: "idle", position: { x: 0, y: 0 }, route: [], walk: 0,
      title: button.querySelector(".office-task-name")!,
      screenLabel: button.querySelector(".office-task-status")!,
    };
    button.addEventListener("click", () => this.select(item.id));
    this.seats.set(item.id, seat);
    return seat;
  }

  private planWalks(): void {
    const now = Date.now();
    const round = Math.floor(now / 45_000);
    const available = now % 45_000 < 13_000 && !this.historical && !this.motion.matches
      ? this.visible.filter((seat) => canChat(seat.item.state) && seat.screen !== "stale")
      : [];
    const chat = available.length >= 2 ? round % (available.length - 1) : -1;
    for (const seat of this.visible) {
      const desk = seat.desk!;
      const side = chat < 0 ? -1 : [available[chat], available[chat + 1]].indexOf(seat);
      let activity = activityFor(seat.item.state, now - seat.since, seat.offset);
      if (this.historical || seat.screen === "off") activity = "off";
      else if (seat.screen === "stale") activity = "rest";
      else if (side >= 0) activity = "chat";
      let target = desk.chair;
      if (side >= 0 && activity === "chat") target = conversation[side];
      else if (activity === "drink") target = water;
      else if (activity === "away") target = restroom;
      else if (activity === "rest" && Math.floor((now - seat.since + seat.offset % 18_000) / 10_000) % breaks.length === 3) target = lounge;
      if (this.motion.matches) target = desk.chair;
      if (target !== seat.destination) {
        seat.destination = target;
        seat.route = pathTo(seat, target);
      }
      if (this.motion.matches && seat.route.length) {
        seat.position = { ...desk.chair };
        seat.route = [];
      }
      if (activity === seat.activity) continue;
      seat.activity = activity;
      seat.button.dataset.activity = activity;
      this.describe(seat);
      if (seat.pet) {
        seat.pet.expr = faces[activity] ?? "neutral";
        if (!this.motion.matches && (activity === "wait" || activity === "arrive")) seat.pet.react("perk");
        if (!this.motion.matches && activity === "stretch") seat.pet.react("cheer");
      }
    }
  }

  private walk(seat: Seat, dt: number): number {
    const next = seat.route[0];
    if (!next) return seat.activity === "chat" ? (seat.destination === conversation[0] ? 0.65 : -0.65) : 0.12;
    const dx = next.x - seat.position.x;
    const dy = next.y - seat.position.y;
    const distance = Math.hypot(dx, dy);
    const step = dt * 3.3;
    if (distance <= step) {
      seat.position = { ...next };
      seat.route.shift();
    } else {
      seat.position.x += dx * step / distance;
      seat.position.y += dy * step / distance;
    }
    seat.walk += dt * 22;
    return Math.sign(dx * 56 - dy * 46) * 0.58;
  }

  private drawPet(seat: Seat, dt: number, turn: number): void {
    const { pet } = seat;
    if (!pet || seat.activity === "off") return;
    const c = this.scene.context;
    const foot = project(seat.position.x, seat.position.y);
    const walking = seat.route.length > 0;
    const seated = !walking && seat.destination === seat.desk!.chair;
    const pose = seated ? 10 : walking ? Math.abs(Math.sin(seat.walk)) * 4 : 0;
    this.scene.shadow(seat.position);
    const [, top, , bottom] = pet.rig.bbox;
    const scale = 42 / (bottom - top);
    pet.play.yaw = turn;
    pet.play.pitch = seated && seat.screen === "typing" ? 0.32 : null;
    pet.play.head = walking ? Math.sin(seat.walk) * 5 : null;
    pet.update(dt);
    c.save();
    c.translate(foot.x - pet.foot[0] * scale, foot.y - pose - pet.foot[1] * scale);
    pet.draw(c, scale, null);
    c.restore();
    if (!walking && seat.activity === "chat") {
      c.fillStyle = "#fdfaf0";
      c.beginPath();
      c.roundRect(foot.x - 11, foot.y - 58, 26, 13, 6);
      c.fill();
      c.fillStyle = "#6e8f87";
      for (const x of [-5, 2, 9]) {
        c.beginPath();
        c.arc(foot.x + x, foot.y - 51, 1.25, 0, Math.PI * 2);
        c.fill();
      }
    }
  }

  private draw = (time: number): void => {
    this.frame = requestAnimationFrame(this.draw);
    if (time - this.lastFrame < 29 || !this.canvas.clientWidth || document.hidden) return;
    const dt = this.lastFrame ? Math.min(0.06, (time - this.lastFrame) / 1000) : 0;
    this.lastFrame = time;
    if (time >= this.nextActivity) {
      this.planWalks();
      this.nextActivity = time + 400;
    }
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const height = Math.round(width * sceneSize.height / sceneSize.width);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const c = this.scene.context;
    c.setTransform(width / sceneSize.width, 0, 0, height / sceneSize.height, 0, 0);
    this.scene.begin();
    const objects = [...this.furniture];
    const seconds = this.motion.matches || this.historical ? 0 : time / 1000;
    for (const seat of this.visible) {
      const desk = seat.desk!;
      const { x, y } = desk.position;
      const turn = this.walk(seat, dt);
      objects.push(
        { depth: x + y + 1.68, draw: () => {
          this.scene.desk(desk, seat.laptop, seat.item.id === this.selected);
          this.scene.screen(desk, seat.laptop, seat.screen, seconds + seat.offset % 11 / 7);
        } },
        { depth: desk.chair.x + desk.chair.y - 0.05, draw: () => this.scene.chair(desk) },
        { depth: seat.position.x + seat.position.y, draw: () => this.drawPet(seat, this.motion.matches ? 0 : dt, turn) },
      );
    }
    objects.sort((left, right) => left.depth - right.depth);
    for (const object of objects) object.draw();
  };
}
