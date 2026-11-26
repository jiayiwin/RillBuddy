import { connect, getJson, inTauri, onHost, postJson, SOURCE_NAMES, STATE_NAMES, subscribe, type Conn, type SessionCard, type SourceSummary, type State } from "./api";
import { initLang, t } from "./i18n";
import { applySkin, skinFor } from "./skin";
import { WorkbenchFloor } from "./workbench-floor";

type DisplayItem = { id: string; kind: string; sourceId: string; sourceName: string; title: string; state: string; project?: string; updatedAt: number; session?: SessionCard; todoId?: number; wait?: string; action?: { kind?: string; target?: unknown }; health?: string };
type WorkEvent = { ts: number; kind: string; source: string; item: string; action: string; detail: string };
type HistoryTurn = { source: string; session: string; project: string; started_at: number; ended_at: number; result: string; tool_errors: number };
const $ = (id: string) => document.getElementById(id)!;
const rows = $("rows"), empty = $("empty"), detail = $("detail"), count = $("count"), history = $("history");
const search = $("search") as HTMLInputElement, kind = $("kind") as HTMLSelectElement, state = $("state") as HTMLSelectElement;
let conn: Conn;
let sources: SourceSummary[] = [];
let workHistory: WorkEvent[] = [];
let historyTurns: HistoryTurn[] = [];
let viewMode: "current" | "history" = "current";
let displayMode: "list" | "floor" = "list";
let selected = "";
let refreshRequested = 0;
let refreshApplied = 0;
const floor = new WorkbenchFloor($("floor"), select);

function select(id: string): void {
  selected = id;
  render();
}

const priority: Record<string, number> = { needs_you: 100, attention: 100, error: 90, blocked: 88, working: 70, thinking: 70, tool: 68, reading: 66, waiting: 40, done: 20, parked: 10, idle: 5, sleeping: 0, offline: 0 };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const stateName = (s: string) => ({ needs_you: t("需要你", "Needs you"), working: t("进行中", "Working"), waiting: t("等待中", "Waiting"), blocked: t("卡住了", "Blocked"), parked: t("稍后处理", "Parked") }[s] ?? STATE_NAMES[s as State] ?? s);
const ago = (ms: number) => { const m = Math.max(0, Math.floor((Date.now() - ms) / 60000)); return m < 1 ? t("刚刚", "just now") : m < 60 ? t(`${m} 分钟前`, `${m}m ago`) : t(`${Math.floor(m / 60)} 小时前`, `${Math.floor(m / 60)}h ago`); };

function flatten(): DisplayItem[] {
  const out: DisplayItem[] = [];
  for (const s of sources) {
    for (const session of s.sessions ?? []) out.push({ id: `${s.kind}:${s.id}:session:${session.key}`, kind: s.kind, sourceId: s.id, sourceName: s.name, title: session.project || t("未命名项目", "Unnamed project"), state: session.state, project: session.project, updatedAt: session.updated_at, session, health: s.health });
    for (const item of s.items ?? []) out.push({ id: `${s.kind}:${s.id}:item:${item.id}`, kind: s.kind, sourceId: s.id, sourceName: s.name, title: item.title, state: item.state, project: item.project, updatedAt: item.updated_at, todoId: s.kind === "tasks" && /^\d+$/.test(item.id) ? Number(item.id) : undefined, wait: item.wait, action: item.action, health: s.health });
  }
  return out;
}

function filtered(): DisplayItem[] {
  const q = search.value.trim().toLowerCase();
  return flatten().filter((x) => (!q || `${x.title} ${x.sourceName} ${x.sourceId} ${x.project ?? ""}`.toLowerCase().includes(q)) && (kind.value === "all" || x.kind === kind.value) && (state.value === "all" || x.state === state.value)).sort((a, b) => (priority[b.state] ?? 0) - (priority[a.state] ?? 0) || b.updatedAt - a.updatedAt);
}

function renderDetail(item?: DisplayItem) {
  if (!item) { detail.innerHTML = `<div class="empty">${t("选择一件工作项查看详情。", "Select a work item to see details.")}</div>`; return; }
  const target = typeof item.action?.target === "string" ? item.action.target : "";
  detail.innerHTML = `<h2>${esc(item.title)}</h2><div class="source">${esc(item.sourceName)} · ${esc(item.sourceId)}</div><div class="facts"><div class="fact"><b>${t("状态", "State")}</b><span>${esc(stateName(item.state))}</span></div>${item.project ? `<div class="fact"><b>${t("项目", "Project")}</b><span>${esc(item.project)}</span></div>` : ""}<div class="fact"><b>${t("更新时间", "Updated")}</b><span>${esc(ago(item.updatedAt))}</span></div>${item.session?.tool ? `<div class="fact"><b>${t("最近工具", "Last tool")}</b><span>${esc(item.session.tool)}${item.session.file ? ` · ${esc(item.session.file)}` : ""}</span></div>` : ""}${item.wait ? `<div class="fact"><b>${t("等待", "Waiting")}</b><span>${esc(item.wait)}</span></div>` : ""}</div><div class="actions">${item.session?.pid ? `<button class="primary" data-action="focus">${t("打开窗口", "Open window")}</button>` : ""}${target ? `<button class="primary" data-action="open">${t("打开来源", "Open source")}</button>` : ""}${item.todoId ? `<button class="primary" data-action="done">${t("完成这件", "Mark done")}</button>` : ""}${!item.todoId && item.kind !== "agent" && item.state !== "done" ? `<button data-action="source-done">${t("标记完成", "Mark done")}</button><button data-action="source-park">${t("稍后处理", "Park")}</button>` : ""}<button data-action="clear">${t("清除选择", "Clear")}</button></div><p class="hint">${t("桌宠只提示最需要你注意的事项；完整来源和会话细节保留在这里。", "The pet only surfaces what needs you most; full source and session details stay here.")}</p>`;
  detail.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((b) => b.onclick = () => void action(item, b.dataset.action!));
}

async function action(item: DisplayItem, what: string) {
  if (what === "clear") { selected = ""; render(); return; }
  if (what === "done" && item.todoId) { await postJson(conn, "/v1/todos/done", { id: item.todoId, back: false, pet: "main" }); await refresh(); return; }
  if (what === "todo-park" && item.todoId) { await postJson(conn, "/v1/sources/action", { kind: "tasks", id: "rill-todos", item_id: String(item.todoId), action: "snooze", until: Date.now() + 60 * 60_000 }); await refresh(); return; }
  if (what === "source-done" || what === "source-park") { await postJson(conn, "/v1/sources/action", { kind: item.kind, id: item.sourceId, item_id: item.id.split(":item:").pop(), action: what === "source-done" ? "done" : "park" }); await refresh(); return; }
  if (what === "open" && typeof item.action?.target === "string") { window.open(item.action.target, "_blank", "noopener"); return; }
  if (what === "focus" && item.session?.pid && inTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("focus_session", { pid: item.session.pid, project: item.session.project || null });
  }
}

function render() {
  rows.hidden = displayMode === "floor";
  if (displayMode === "list") floor.hide();
  empty.textContent = t("还没有工作项。", "No work items yet.");
  if (viewMode === "history") return renderHistoryTurns();
  const list = filtered();
  count.textContent = t(`${list.length} 件`, `${list.length} items`);
  if (displayMode === "floor") {
    floor.show(list.map((item) => ({ ...item, status: stateName(item.state), updated: ago(item.updatedAt), health: item.health })), selected, false);
  } else {
    rows.innerHTML = list.map((x) => `<button class="row${x.id === selected ? " on" : ""}" data-id="${esc(x.id)}"><i class="dot ${esc(x.state)}"></i><span><b class="mainline">${esc(x.title)}</b><small class="subline">${esc(x.sourceName)}${x.project ? ` · ${esc(x.project)}` : ""}${x.health === "stale" ? ` · ${t("来源较久未同步", "source stale")}` : ""}</small></span><span class="state">${esc(stateName(x.state))}</span><small class="meta">${esc(ago(x.updatedAt))}</small></button>`).join("");
    rows.querySelectorAll<HTMLButtonElement>(".row").forEach((row) => row.onclick = () => select(row.dataset.id ?? ""));
  }
  empty.hidden = list.length > 0;
  renderDetail(list.find((x) => x.id === selected));
}

function renderHistoryTurns() {
  const q = search.value.trim().toLowerCase();
  const turns = historyTurns.filter((x) => !q || `${x.source} ${x.project} ${x.session}`.toLowerCase().includes(q));
  if (displayMode === "floor") {
    const sessions = new Map<string, HistoryTurn>();
    for (const turn of turns) {
      const id = JSON.stringify([turn.source, turn.session]);
      const latest = sessions.get(id);
      if (!latest || latest.ended_at < turn.ended_at) sessions.set(id, turn);
    }
    const items = Array.from(sessions, ([id, turn]) => {
      const state = turn.result !== "ok" || turn.tool_errors > 0 ? "error" : "done";
      return {
        id, state, sourceId: turn.source, sourceName: SOURCE_NAMES[turn.source] ?? turn.source,
        title: turn.project || t("未命名项目", "Unnamed project"),
        updated: ago(turn.ended_at), status: stateName(state),
      };
    });
    floor.show(items, selected, true);
    count.textContent = t(`${items.length} 个工位`, `${items.length} workstations`);
    empty.hidden = items.length > 0;
    const turn = sessions.get(selected);
    if (turn) {
      const item = items.find((item) => item.id === selected)!;
      detail.innerHTML = `<h2>${esc(item.title)}</h2><div class="source">${esc(item.sourceName)} · ${esc(turn.session)}</div><div class="facts">
        <div class="fact"><b>${t("结束时间", "Ended")}</b><span>${esc(new Date(turn.ended_at).toLocaleString())}</span></div>
        <div class="fact"><b>${t("状态", "State")}</b><span>${esc(item.status)}</span></div>
        <div class="fact"><b>${t("工具错误", "Tool errors")}</b><span>${turn.tool_errors}</span></div></div>`;
      return;
    }
  } else {
    count.textContent = t(`${turns.length} 条历史`, `${turns.length} history items`);
    rows.innerHTML = turns.map((x) => {
      const failed = x.result !== "ok" || x.tool_errors > 0;
      const title = x.project || t("未命名项目", "Unnamed project");
      const detailText = failed ? t(`已结束 · 工具错误 ${x.tool_errors} 次`, `ended · ${x.tool_errors} tool errors`) : t("已完成", "completed");
      return `<button class="row" data-history="1"><i class="dot ${failed ? "error" : "done"}"></i><span><b class="mainline">${esc(title)}</b><small class="subline">${esc(x.source)} · ${esc(x.session)}</small></span><span class="state">${detailText}</span><small class="meta">${esc(ago(x.ended_at))}</small></button>`;
    }).join("");
    empty.hidden = turns.length > 0;
  }
  if (!turns.length) empty.textContent = t("没有符合条件的历史记录。", "No matching history.");
  detail.innerHTML = turns.length ? `<div class="empty">${t("历史记录只保留工作摘要；选择当前工作项可查看可执行动作。", "History keeps work summaries only; select a current item for actions.")}</div>` : `<div class="empty">${t("最近 7 天没有已结束的会话。", "No finished sessions in the last 7 days.")}</div>`;
}

function renderHistory() {
  const sessions = new Map<string, { source: string; project: string }>();
  const sourceItems = new Map<string, string>();
  for (const source of sources) {
    for (const session of source.sessions ?? []) sessions.set(session.key, { source: session.source, project: session.project });
    for (const item of source.items ?? []) sourceItems.set(`${source.id}:${item.id}`, item.title);
  }
  for (const turn of historyTurns) {
    const key = `${turn.source}/${turn.session}`;
    if (!sessions.has(key)) sessions.set(key, { source: turn.source, project: turn.project });
  }
  const meaningful = new Set(["attention", "done", "error", "stone", "aborted", "offline"]);
  const labels: Record<string, [string, string]> = {
    attention: ["等你回复", "Waiting for you"],
    done: ["已完成", "Completed"],
    error: ["执行出错", "Failed"],
    stone: ["卡住了", "Blocked"],
    aborted: ["已中断", "Interrupted"],
    offline: ["已离线", "Went offline"],
  };
  const seen = new Set<string>();
  const rows = workHistory.filter((event) => {
    if (event.action !== "state") return event.kind === "tasks";
    return event.kind === "agent" && meaningful.has(event.detail);
  }).filter((event) => {
    const key = `${event.kind}|${event.source}|${event.item}|${event.action}|${event.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 40);
  if (!rows.length) {
    history.innerHTML = `<div class="empty">${t("近期没有需要提醒的动态。", "No noteworthy activity recently.")}</div>`;
    return;
  }
  history.innerHTML = rows.map((event) => {
    const session = sessions.get(event.item);
    const source = SOURCE_NAMES[session?.source ?? event.source] ?? session?.source ?? event.source;
    const task = session?.project || sourceItems.get(`${event.source}:${event.item}`) || event.item || t("工作项", "Work item");
    const message = labels[event.detail] ? t(...labels[event.detail]) : event.action;
    return `<div class="event"><time>${esc(new Date(event.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</time><span class="kind">${esc(source)}</span><span class="item" title="${esc(task)}">${esc(task)}</span><span class="detail">${esc(message)}</span></div>`;
  }).join("");
}

async function refresh() {
  const request = ++refreshRequested;
  const [r, h] = await Promise.all([
    getJson<{ sources: SourceSummary[] }>(conn, "/v1/sources"),
    getJson<{ events: WorkEvent[]; turns: HistoryTurn[] }>(conn, "/v1/work-history?days=7&limit=200").catch(() => ({ events: [] as WorkEvent[], turns: [] as HistoryTurn[] })),
  ]);
  if (request < refreshApplied) return;
  refreshApplied = request;
  sources = r.sources;
  workHistory = h.events;
  historyTurns = h.turns;
  render();
  renderHistory();
}

async function openStoreroom() {
  if (inTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("menu_pick", { id: "storeroom" });
  } else {
    window.parent.postMessage({ type: "open-tab", payload: { kind: "storeroom" } }, location.origin);
  }
}

async function clarify() {
  const raw = window.prompt(t("把脑中的几件事分行写下来，我会分成“现在、稍后、等待”并记进工作台。", "Write the things on your mind, one per line. I will sort them into now, later and waiting, then keep them in the workbench."));
  if (!raw?.trim()) return;
  const lines = raw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 12);
  const groups = { now: [] as string[], later: [] as string[], waiting: [] as string[] };
  for (const line of lines) {
    if (/^(等|等待|等到|when\b|after\b)/i.test(line) || /等.+(做完|完成|回复|回来)/.test(line)) groups.waiting.push(line);
    else if (/(稍后|以后|明天|下周|周末|later|tomorrow|next week)/i.test(line)) groups.later.push(line);
    else groups.now.push(line);
  }
  const summary = [
    groups.now.length ? `现在：\n${groups.now.map((x) => `· ${x}`).join("\n")}` : "",
    groups.later.length ? `稍后：\n${groups.later.map((x) => `· ${x}`).join("\n")}` : "",
    groups.waiting.length ? `等待：\n${groups.waiting.map((x) => `· ${x}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
  if (!window.confirm(`${summary}\n\n${t("确认记进工作台？", "Keep these in the workbench?")}`)) return;
  await Promise.all(lines.map((text) => postJson(conn, "/v1/todos", { text, pet: "main" })));
  await refresh();
}

async function main() {
  conn = await connect();
  await initLang(conn);
  for (const group of document.querySelectorAll<HTMLElement>("[data-en-label]")) {
    group.setAttribute("aria-label", t(group.getAttribute("aria-label")!, group.dataset.enLabel!));
  }
  const skin = await skinFor(conn, "main"); applySkin(skin.skin.id);
  await refresh();
  search.oninput = render; kind.onchange = render; state.onchange = render;
  const toggle = (firstId: string, secondId: string, change: (first: boolean) => void) => {
    const buttons = [$(firstId), $(secondId)];
    for (const button of buttons) button.addEventListener("click", () => {
      for (const peer of buttons) {
        peer.classList.toggle("on", peer === button);
        peer.setAttribute("aria-pressed", String(peer === button));
      }
      change(button === buttons[0]);
      render();
    });
  };
  toggle("view-current", "view-history", (first) => {
    const next = first ? "current" : "history";
    if (viewMode !== next) selected = "";
    viewMode = next;
  });
  toggle("display-list", "display-floor", (first) => { displayMode = first ? "list" : "floor"; });
  $("storeroom").addEventListener("click", () => void openStoreroom());
  $("clarify").addEventListener("click", () => void clarify());
  subscribe(conn, (type) => { if (type === "source.state" || type === "pet.state" || type === "todo.changed") void refresh(); });
  await onHost("refresh-workbench", () => void refresh());
}
void main().catch((e) => { console.error("workbench", e); empty.hidden = false; empty.textContent = String(e); });
