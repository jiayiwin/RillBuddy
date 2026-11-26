//! 收工: the evening as you keep it, learned from when your last turn of the
//! day really ends (not the off time in the settings).
//!
//! - In that window, while an agent is still at it and you are here, the pets
//!   leave a lamp on and keep quiet (`LAMP`).
//! - Once every agent has stopped and you are still sitting there, one of them
//!   asks to play the day back (收工曲).
//! - When you get up for the night, each pet writes down where its agent
//!   stopped: waiting on you, stopped on an error, or the "next step" the agent
//!   left (from its last reply, never from what you wrote to it). A clean
//!   finish gets no slip.
//! - When you sit down again the next morning, the pet with the most pressing
//!   slip says that one thing, and "yes" takes you to that session.
//!
//! The pet windows hear all this as `desk` (away / lamp / who holds a slip),
//! sent every tick, so a window that opens late catches up.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use crate::session::State;

const MIN_MS: u64 = 60_000;
const HOUR_MS: u64 = 3_600_000;
const DAY_MS: u64 = 86_400_000;
/// Evenings looked back over, the latest ones that count, and how many it needs before it trusts them.
const LOOK_BACK_DAYS: u64 = 14;
const LATEST: usize = 7;
const NEED: usize = 4;
/// An evening counts with at least this many turns.
const FULL: usize = 6;
/// The window opens a little before the earliest usual stop and closes a little after the latest.
const EARLY_MIN: u32 = 15;
const LATE_MIN: u32 = 20;
/// Every agent quiet this long, with you still here: the day's tune is offered.
const STILL_MS: u64 = 2 * MIN_MS;
/// Away this long after the window opens: you have gone for the night.
const GONE_MS: u64 = 5 * MIN_MS;
/// Back within this: it was a break, not the night; the slips go back.
const BREAK_MS: u64 = 3 * HOUR_MS;
/// The morning line waits for you to have been gone at least this long.
const NIGHT_MS: u64 = 4 * HOUR_MS;
/// The night's own line (night.rs) keeps this far from the morning one.
pub const AFTER_PICKUP_MS: u64 = 10 * MIN_MS;

/// The lamp is on: the pets keep quiet and other offers wait.
pub static LAMP: AtomicBool = AtomicBool::new(false);

/// Minutes on the evening clock: from noon, so 23:50 is 710 and 00:30 is 750.
fn eve_min(ms: u64) -> u32 {
    use chrono::{Local, TimeZone, Timelike};
    let t = Local.timestamp_millis_opt(ms as i64).single().unwrap_or_else(Local::now);
    (t.hour() * 60 + t.minute() + 12 * 60) % 1440
}

/// The evening a moment belongs to: the date six hours earlier (00:40 is still last night).
fn eve_day(ms: u64) -> String {
    crate::db::day_of(ms.saturating_sub(6 * HOUR_MS))
}

/// When each evening's last turn ended (evening clock), oldest evening first; only full evenings.
fn ends(turns: &[crate::db::TurnRow]) -> Vec<u32> {
    let mut by: std::collections::BTreeMap<String, (usize, u64)> = Default::default();
    for t in turns {
        let e = by.entry(eve_day(t.started_at)).or_default();
        e.0 += 1;
        e.1 = e.1.max(t.ended_at);
    }
    by.into_values().filter(|(n, _)| *n >= FULL).map(|(_, end)| eve_min(end)).collect()
}

/// Where you usually stop, from the latest evenings' last turns: (from, to) on the evening clock.
fn window_of(ends: &[u32]) -> Option<(u32, u32)> {
    let latest = &ends[ends.len().saturating_sub(LATEST)..];
    if latest.len() < NEED {
        return None;
    }
    let mut v = latest.to_vec();
    v.sort_unstable();
    // The odd early night and the odd all-nighter don't move it.
    let lo = v[v.len() / 5];
    let hi = v[(v.len() * 4 / 5).min(v.len() - 1)];
    Some((lo.saturating_sub(EARLY_MIN), (hi + LATE_MIN).min(1439)))
}

/// From and to on the evening clock.
type Window = (u32, u32);

/// The learned window, worked out again at most once an hour.
pub fn window(sh: &crate::server::Shared, now: u64) -> Option<Window> {
    static CACHE: Mutex<Option<(u64, Option<Window>)>> = Mutex::new(None);
    let hour = now / HOUR_MS;
    let mut c = CACHE.lock().unwrap();
    if let Some((h, w)) = *c {
        if h == hour {
            return w;
        }
    }
    // Today's evening is still going on: only the ones before it.
    let today = eve_day(now);
    let turns: Vec<_> = sh.db.turns_since(now.saturating_sub(LOOK_BACK_DAYS * DAY_MS)).into_iter().filter(|t| eve_day(t.started_at) != today).collect();
    let w = window_of(&ends(&turns));
    *c = Some((hour, w));
    w
}

/// Whether it has learned when you stop (else 收工曲 keeps to the off time in the settings).
pub fn learned(sh: &crate::server::Shared) -> bool {
    window(sh, crate::now_ms()).is_some()
}

// ---------------------------------------------------------------- the slips

/// Where one agent stopped for the night.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Slip {
    /// The pet (its agent's id, "claude-code").
    pub pet: String,
    /// "wait": stopped to wait on you; "error": stopped on an error; "next": left a next step.
    pub kind: String,
    /// The next step, for "next".
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub pid: u32,
    #[serde(default)]
    pub project: String,
}

fn rank(kind: &str) -> u8 {
    match kind {
        "wait" => 0,
        "error" => 1,
        _ => 2,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct Eve {
    day: String,
    song: bool,
    left: Option<u64>,
    slips: Vec<Slip>,
    told: bool,
}

fn load(sh: &crate::server::Shared) -> Eve {
    sh.db.kv_get("evening").and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default()
}

fn save(sh: &crate::server::Shared, e: &Eve) {
    sh.db.kv_set("evening", &serde_json::to_string(e).unwrap_or_default());
}

fn failed(s: State) -> bool {
    matches!(s, State::Error | State::Stone | State::Aborted)
}

fn working(s: State) -> bool {
    matches!(s, State::Thinking | State::Tool | State::Reading)
}

/// What each agent was in the middle of as you left: one slip per pet at most. `nexts`: the next
/// step each live session's last turn named, (source, session, text); a closed session's is in `todos`.
fn slips_now(pets: &[crate::hub::PetView], nexts: &[(String, String, String)], todos: &[crate::todo::Todo], now: u64) -> Vec<Slip> {
    let mut out = vec![];
    for v in pets {
        let camp = v.camp.clone().unwrap_or_else(|| v.id.clone());
        let pick = |want: &dyn Fn(State) -> bool| v.sessions.iter().filter(|s| want(s.state)).max_by_key(|s| s.updated_at);
        if let Some(s) = pick(&|s| s == State::Attention) {
            out.push(Slip { pet: v.id.clone(), kind: "wait".into(), text: String::new(), pid: s.pid, project: s.project.clone() });
            continue;
        }
        if let Some(s) = pick(&failed) {
            out.push(Slip { pet: v.id.clone(), kind: "error".into(), text: String::new(), pid: s.pid, project: s.project.clone() });
            continue;
        }
        // The next step its agent named last, in a session still open...
        let live = v
            .sessions
            .iter()
            .filter_map(|s| nexts.iter().find(|(src, id, _)| *src == s.source && *id == s.session).map(|n| (s, &n.2)))
            .max_by_key(|(s, _)| s.updated_at);
        if let Some((s, text)) = live {
            out.push(Slip { pet: v.id.clone(), kind: "next".into(), text: text.trim_end_matches(['。', '.', '；', ';']).to_string(), pid: s.pid, project: s.project.clone() });
            continue;
        }
        // ...or left today by one that has closed, and still open.
        let next = todos
            .iter()
            .filter(|t| t.open() && t.from == camp && now.saturating_sub(t.at) < 18 * HOUR_MS)
            .max_by_key(|t| t.at);
        if let Some(t) = next {
            let project = t.project.clone().unwrap_or_default();
            let s = v.sessions.iter().filter(|s| project.is_empty() || s.project == project).max_by_key(|s| s.updated_at);
            out.push(Slip {
                pet: v.id.clone(),
                kind: "next".into(),
                text: t.text.trim_end_matches(['。', '.', '；', ';']).to_string(),
                pid: s.map(|s| s.pid).unwrap_or(0),
                project: s.map(|s| s.project.clone()).unwrap_or(project),
            });
        }
    }
    out.sort_by_key(|s| rank(&s.kind));
    out
}

/// The one line for the morning.
pub fn line(slip: &Slip) -> String {
    let agent = crate::config::agent_tag(&slip.pet);
    match slip.kind.as_str() {
        "wait" => crate::tr!("{agent} 昨晚停下来等你回话，一直没动。过去？", "{agent} stopped last night to wait for your answer, and hasn't moved. Go over?"),
        "error" => crate::tr!("{agent} 昨晚停在一个错误上。过去看看？", "{agent} stopped on an error last night. Go and look?"),
        _ => {
            let text = &slip.text;
            crate::tr!("{agent} 昨晚停在这儿：{text}。过去？", "{agent} stopped here last night: {text}. Go over?")
        }
    }
}

/// A long next step, said in a few words by the local model when there is one; else as it was written.
fn shorten(home: &std::path::Path, text: &str) -> String {
    if text.chars().count() <= 24 || !crate::local_llm::is_ready(home) {
        return text.to_string();
    }
    let system = crate::tr!(
        "把下面这件待办改写成一句不超过二十个字的话：事情停在哪、还差什么。不要标点结尾，不要解释，只输出这句话。",
        "Rewrite the to-do below as one short phrase of at most twelve words: where the work stopped and what is left. No explanation; output only the phrase."
    );
    match crate::local_llm::generate_local(home, &system, text) {
        Some(s) => {
            let s = s.lines().next().unwrap_or("").trim().trim_matches(['"', '「', '」', '“', '”']).trim_end_matches(['。', '.']).to_string();
            if s.is_empty() || s.chars().count() > 32 {
                text.to_string()
            } else {
                s
            }
        }
        None => text.to_string(),
    }
}

// ---------------------------------------------------------------- each tick

pub struct Seen<'a> {
    pub now: u64,
    pub present: bool,
    pub idle_ms: u64,
    pub hour: u8,
    /// Focus mode, or chatter set to quiet.
    pub quiet: bool,
    /// Something else is being said this tick.
    pub hold: bool,
    pub pets: &'a [crate::hub::PetView],
}

fn ask(sh: &crate::server::Shared, pet: &str, text: &str, why: &str, offer: &str, slip: Option<&Slip>) {
    let _ = sh.ws_tx.send(crate::msg(
        "pet.act",
        &serde_json::json!({ "pet": pet, "act": "offer", "text": text, "why": why, "offer": offer,
            "pid": slip.map(|s| s.pid), "project": slip.map(|s| s.project.clone()) }),
    ));
}

pub fn tick(sh: &crate::server::Shared, s: &Seen) {
    let now = s.now;
    let win = window(sh, now);
    let m = eve_min(now);
    let in_win = win.is_some_and(|(a, b)| m >= a && m <= b);
    // From a little before the window (or, unlearned, from nine) until the small hours.
    let late = match win {
        // Ten hours from half an hour before the window opens.
        Some((a, _)) => (m + 1440 + 30 - a) % 1440 < 600,
        None => s.hour >= 21 || s.hour < 5,
    };
    let busy = s.pets.iter().any(|v| working(v.state));
    let waiting = s.pets.iter().any(|v| v.state == State::Attention);

    let lamp = in_win && s.present && busy;
    LAMP.store(lamp, Ordering::Relaxed);
    // Since when no agent has been at work or waiting on you.
    static STILL: Mutex<Option<u64>> = Mutex::new(None);
    let still_for = {
        let mut st = STILL.lock().unwrap();
        if busy || waiting {
            *st = None;
        }
        now.saturating_sub(*st.get_or_insert(now))
    };

    let mut e = load(sh);
    let today = eve_day(now);
    if e.day != today && e.left.is_none() {
        e = Eve { day: today.clone(), ..Default::default() };
        save(sh, &e);
    }

    // Every agent has stopped, you are still sitting there, in your window: the day's tune.
    if in_win && !e.song && s.present && s.idle_ms < MIN_MS && still_for >= STILL_MS && !s.quiet && !s.hold && e.day == today {
        let turns = sh.db.turns_since(now.saturating_sub(18 * HOUR_MS));
        let tonight: Vec<_> = turns.iter().filter(|t| eve_day(t.started_at) == today).collect();
        let last = tonight.iter().max_by_key(|t| t.ended_at);
        if let Some(last) = last.filter(|_| tonight.len() >= crate::song::MIN_TURNS) {
            // The one whose agent stopped last asks, if it is about.
            let asker = s.pets.iter().find(|v| v.id == last.source && !matches!(v.state, State::Offline)).or(s.pets.iter().find(|v| !matches!(v.state, State::Offline | State::Attention)));
            if let Some(v) = asker {
                e.song = true;
                save(sh, &e);
                let who = crate::cast::by_id(&v.skin).map(|f| f.id).unwrap_or("zimeng");
                ask(sh, &v.id, &crate::voice::line(who, "offer_song", 0), "song", &format!("song:{}", last.day), None);
            }
        }
    }

    // Gone for the night: each pet writes down where its agent stopped.
    if late && e.left.is_none() && !s.present && s.idle_ms >= GONE_MS {
        let tonight = sh.db.turns_since(now.saturating_sub(18 * HOUR_MS)).into_iter().filter(|t| eve_day(t.started_at) == today).count();
        if tonight >= FULL {
            e.left = Some(now.saturating_sub(s.idle_ms));
            let nexts = sh.world.lock().unwrap().next_steps();
            e.slips = slips_now(s.pets, &nexts, &crate::todo::all(&sh.db), now);
            e.told = false;
            save(sh, &e);
            // A long next step is put in a few words, off the loop.
            if e.slips.iter().any(|x| x.kind == "next" && x.text.chars().count() > 24) {
                let sh = sh.clone();
                std::thread::spawn(move || {
                    let home = sh.paths.home.clone();
                    let mut e = load(&sh);
                    for x in e.slips.iter_mut().filter(|x| x.kind == "next") {
                        x.text = shorten(&home, &x.text);
                    }
                    save(&sh, &e);
                });
            }
        }
    }

    // Back again.
    if let (Some(left), true) = (e.left, s.present) {
        let gone = now.saturating_sub(left);
        if gone < BREAK_MS && !e.told {
            // Only a break: the evening goes on.
            e.left = None;
            e.slips.clear();
            save(sh, &e);
        } else if gone >= NIGHT_MS && !e.told && s.idle_ms < MIN_MS && s.hour >= 5 && !s.quiet {
            e.told = true;
            // A wait that was answered in the night is no longer one.
            let pick = e.slips.iter().find(|x| x.kind != "wait" || s.pets.iter().any(|v| v.id == x.pet && v.state == State::Attention)).cloned();
            if let Some(x) = pick {
                ask(sh, &x.pet, &line(&x), "pickup", "pickup", Some(&x));
                sh.db.kv_set("evening:said", &now.to_string());
            }
            e.slips.clear();
            e.left = None;
            e.day = today.clone();
            save(sh, &e);
        }
    }

    let holding: Vec<&str> = if e.left.is_some() { e.slips.iter().map(|x| x.pet.as_str()).collect() } else { vec![] };
    let _ = sh.ws_tx.send(crate::msg("desk", &serde_json::json!({ "away": !s.present, "lamp": lamp, "night": late && !s.present, "slips": holding })));
}

/// The morning line was said a moment ago: the night's own line waits.
pub fn just_said(sh: &crate::server::Shared, now: u64) -> bool {
    sh.db.kv_get("evening:said").and_then(|v| v.parse::<u64>().ok()).is_some_and(|t| now.saturating_sub(t) < AFTER_PICKUP_MS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_window_is_where_you_usually_stop() {
        // Seven evenings ending 23:40..23:58 (evening clock: 700..718).
        let v = [700, 712, 718, 705, 709, 716, 703];
        assert_eq!(window_of(&v), Some((703 - EARLY_MIN, 716 + LATE_MIN)));
        // Too few evenings: not learned yet.
        assert_eq!(window_of(&v[..3]), None);
        // The odd all-nighter at 02:30 (870) doesn't drag it.
        let w = window_of(&[700, 712, 718, 705, 870, 716, 703]).unwrap();
        assert!(w.1 < 760, "{w:?}");
    }

    #[test]
    fn the_evening_clock_runs_from_noon() {
        use chrono::{Local, TimeZone};
        let at = |h, m| Local.with_ymd_and_hms(2026, 11, 13, h, m, 0).unwrap().timestamp_millis() as u64;
        assert_eq!(eve_min(at(23, 50)), 710);
        assert_eq!(eve_min(at(0, 30)), 750);
        assert_eq!(eve_min(at(12, 0)), 0);
        // Half past midnight still belongs to last night.
        assert_eq!(eve_day(at(0, 30)), "2026-11-12");
        assert_eq!(eve_day(at(23, 50)), "2026-11-13");
    }

    #[test]
    fn only_full_evenings_count_and_each_ends_with_its_last_turn() {
        use chrono::{Local, TimeZone};
        let at = |d, h, m| Local.with_ymd_and_hms(2026, 11, d, h, m, 0).unwrap().timestamp_millis() as u64;
        let row = |s: u64| crate::db::TurnRow { day: String::new(), source: "claude-code".into(), project: String::new(), started_at: s, ended_at: s + 60_000, result: "ok".into(), tool_errors: 0 };
        // The 10th: six turns, the last one past midnight. The 11th: two turns.
        let mut t: Vec<_> = (0..5).map(|k| row(at(10, 20, k * 10))).collect();
        t.push(row(at(11, 0, 20)));
        t.push(row(at(11, 21, 0)));
        t.push(row(at(11, 22, 0)));
        assert_eq!(ends(&t), vec![741]);
    }

    fn pet(id: &str, state: State, sessions: Vec<(State, u32, &str)>) -> crate::hub::PetView {
        crate::hub::PetView {
            id: id.into(),
            state,
            since: 0,
            camp: Some(id.into()),
            marker: None,
            attention_kind: None,
            bubble: None,
            online: sessions.len(),
            waiting: 0,
            sessions: sessions
                .into_iter()
                .enumerate()
                .map(|(k, (st, pid, project))| crate::hub::SessionCard {
                    key: format!("{id}:{k}"),
                    source: id.into(),
                    session: k.to_string(),
                    project: project.into(),
                    pid,
                    state: st,
                    since: 0,
                    started_at: 0,
                    updated_at: k as u64,
                    tool: None,
                    file: None,
                })
                .collect(),
            activity: None,
            size: 1.0,
            skin: "paopao".into(),
        }
    }

    #[test]
    fn each_pet_writes_where_its_agent_stopped_and_a_wait_comes_first() {
        let now = 10 * DAY_MS;
        let db = crate::db::Db::open(std::path::Path::new(":memory:")).unwrap();
        crate::todo::add(&db, "给登录补上超时的测试", "claude-code", Some("api"), Some("claude-code"), None, now - HOUR_MS);
        // An old next step from two days ago is not tonight's.
        crate::todo::add(&db, "旧的一件", "codex", Some("web"), Some("codex"), None, now - 2 * DAY_MS);
        let pets = vec![
            pet("claude-code", State::Done, vec![(State::Done, 11, "api")]),
            pet("codex", State::Attention, vec![(State::Attention, 22, "web")]),
            pet("gemini", State::Done, vec![(State::Done, 33, "x")]),
        ];
        let s = slips_now(&pets, &[], &crate::todo::all(&db), now);
        assert_eq!(s.iter().map(|x| (x.pet.as_str(), x.kind.as_str())).collect::<Vec<_>>(), [("codex", "wait"), ("claude-code", "next")]);
        assert_eq!((s[1].pid, s[1].text.as_str()), (11, "给登录补上超时的测试"));
        assert!(line(&s[1]).contains("给登录补上超时的测试"));
        // A session still open: the next step its last turn named, and that very session.
        let live = vec![("gemini".to_string(), "0".to_string(), "把目录页的链接修好。".to_string())];
        let s = slips_now(&pets, &live, &crate::todo::all(&db), now);
        let g = s.iter().find(|x| x.pet == "gemini").unwrap();
        assert_eq!((g.kind.as_str(), g.text.as_str(), g.pid), ("next", "把目录页的链接修好", 33));
    }
}
