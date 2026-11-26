//! User actions shared by /pet, the HTTP API, the tray and the right-click
//! menu: settings, a kegel set, a performance, hiding and showing.

use crate::config::{self, Config};
use crate::server::Shared;
use crate::Control;
use serde_yaml::Value;

/// Reload config.yaml into the hub. Keeps the old config on a parse error.
pub fn reload_config(sh: &Shared) {
    let res = Config::load(&sh.paths.config());
    let mut hub = sh.hub.lock().unwrap();
    let mut lang_changed = false;
    match res {
        Ok(c) => {
            lang_changed = crate::i18n::set_from(&c.language);
            hub.cfg = c;
            hub.cfg_error = None;
        }
        Err(e) => {
            if hub.cfg_error.as_deref() != Some(e.as_str()) {
                sh.paths.log(&e);
            }
            hub.cfg_error = Some(e);
        }
    }
    drop(hub);
    // Config changes can affect the global wardrobe and size even when no
    // source session changed. Publish the canonical companion view so every
    // open page follows it immediately.
    let desktop = sh.hub.lock().unwrap().desktop_pet();
    let _ = sh.ws_tx.send(crate::msg("pet.state", &desktop));
    let _ = sh.ws_tx.send(crate::msg("settings.changed", &settings(sh)));
    if lang_changed {
        // Data files carry both languages; reload them.
        sh.world.lock().unwrap().t = crate::balance::Tables::load(&sh.paths.home);
        let _ = sh.ws_tx.send(crate::msg(
            "lang",
            &serde_json::json!({ "lang": crate::i18n::code() }),
        ));
    }
    let _ = sh.control.send(Control::ConfigChanged);
    sh.urgent.notify_one();
}

/// `language:` in config.yaml (auto | zh | en).
pub fn set_language(sh: &Shared, lang: &str) -> Result<String, String> {
    let l = match lang.to_ascii_lowercase().as_str() {
        "auto" => "auto",
        "zh" | "cn" | "中文" => "zh",
        "en" | "english" => "en",
        _ => {
            return Err(crate::tr!(
                "语言只能是 auto、zh、en",
                "Language must be auto, zh or en"
            ))
        }
    };
    save(sh, |m| {
        m.insert("language".into(), Value::String(l.into()));
        Ok(())
    })?;
    Ok(crate::tr!("界面语言：{l}", "UI language: {l}"))
}

fn save(
    sh: &Shared,
    f: impl FnOnce(&mut serde_yaml::Mapping) -> Result<(), String>,
) -> Result<(), String> {
    config::edit(&sh.paths.config(), f)?;
    reload_config(sh);
    Ok(())
}

/// Pet size: s / m / l.
pub fn set_size(sh: &Shared, size: &str) -> Result<String, String> {
    let s = match size {
        "s" | "S" => "s",
        "m" | "M" => "m",
        "l" | "L" => "l",
        _ => return Err(crate::tr!("大小只能是 s、m、l", "Size must be s, m or l")),
    };
    save(sh, |m| {
        config::child(m, "features").insert("size".into(), Value::String(s.into()));
        Ok(())
    })?;
    Ok(crate::tr!(
        "宠物大小改为 {}。",
        "Pet size set to {}.",
        s.to_uppercase()
    ))
}

/// `features.chatter`: how much the pets say and do on their own.
pub fn set_chatter(sh: &Shared, level: &str) -> Result<String, String> {
    let l = match level {
        "quiet" | "normal" | "lively" => level,
        _ => {
            return Err(crate::tr!(
                "只能是 quiet、normal、lively",
                "Must be quiet, normal or lively"
            ))
        }
    };
    save(sh, |m| {
        config::child(m, "features").insert("chatter".into(), Value::String(l.into()));
        Ok(())
    })?;
    Ok(match l {
        "quiet" => crate::tr!(
            "安静：不吐槽，每小时最多互动一次。",
            "Quiet: no quips, one interaction an hour at most."
        ),
        "lively" => crate::tr!(
            "活泼：吐槽和互动都放开。",
            "Lively: quips and interactions at full pace."
        ),
        _ => crate::tr!("正常：偶尔说两句。", "Normal: a line now and then."),
    })
}

/// Everything the settings page shows.
pub fn settings(sh: &Shared) -> serde_json::Value {
    let hub = sh.hub.lock().unwrap();
    let (c, f) = (&hub.cfg, &hub.cfg.features);
    serde_json::json!({
        "language": c.language,
        "size": f.size.to_lowercase(),
        "chatter": match f.chatter.as_str() { "quiet" => "quiet", "lively" => "lively", _ => "normal" },
        "focus_mode": f.focus_mode,
        "sounds": f.sounds,
        "ambience_auto": f.ambience_auto,
        "ambience_volume": f.ambience_volume.min(100),
        "pet_mode": f.pet_mode,
        "kegel_reps": f.kegel_reps.clamp(1, 30),
        "approve": f.approve,
        "approve_wait_s": f.approve_wait_s.clamp(5, 120),
        "night": f.night,
        "config_error": hub.cfg_error,
        "pets": crate::cast::json(c),
        "usage": crate::usage::current(crate::now_ms() / 1000),
    })
}

/// One setting from the settings page: `key` is a field of `settings()`.
pub fn set_setting(sh: &Shared, key: &str, value: &serde_json::Value) -> Result<String, String> {
    let text = || {
        value
            .as_str()
            .ok_or_else(|| crate::tr!("{key} 需要一个文字值", "{key} takes a text value"))
    };
    let flag = || {
        value
            .as_bool()
            .ok_or_else(|| crate::tr!("{key} 需要 true 或 false", "{key} takes true or false"))
    };
    // Compatibility for older settings pages. A source-specific wardrobe
    // choice now changes the one global companion instead of creating a
    // source-owned pet. Keep accepting the key so an old page can migrate
    // without silently doing nothing.
    if let Some(_source) = key.strip_prefix("companion:") {
        let pet = text()?;
        let f = crate::cast::by_id(pet).ok_or_else(|| crate::tr!("没有这只宠物：{pet}", "No such pet: {pet}"))?;
        if !f.here {
            return Err(crate::tr!("{} 还没来。", "{} has not arrived yet.", f.name()));
        }
        save(sh, |m| {
            m.insert(Value::String("main_skin".into()), Value::String(pet.into()));
            Ok(())
        })?;
        let name = f.name();
        return Ok(crate::tr!(
            "已把桌宠换成 {name}。",
            "The desktop companion is now {name}.",
        ));
    }
    match key {
        "main_skin" => {
            let id = text()?;
            let f = crate::cast::by_id(id).ok_or_else(|| crate::tr!("没有这只宠物：{id}", "No such pet: {id}"))?;
            if !f.here {
                return Err(crate::tr!("{} 还没来。", "{} has not arrived yet.", f.name()));
            }
            save(sh, |m| {
                m.insert(Value::String("main_skin".into()), Value::String(id.into()));
                Ok(())
            })?;
            Ok(crate::tr!("桌宠换成 {} 了。", "The desktop companion is now {}.", f.name()))
        }
        "language" => set_language(sh, text()?),
        "size" => set_size(sh, text()?),
        "chatter" => set_chatter(sh, text()?),
        "focus_mode" => set_focus(sh, flag()?),
        "pet_mode" => {
            let mode = text()?;
            if !matches!(mode, "auto" | "quiet" | "settle" | "work" | "waiting" | "wind_down") {
                return Err(crate::tr!("没有这个陪伴模式", "Unknown companion mode"));
            }
            save(sh, |m| {
                config::child(m, "features").insert(key.into(), Value::String(mode.into()));
                Ok(())
            })?;
            Ok(crate::tr!("陪伴模式已更新。", "Companion mode updated."))
        }
        "ambience_volume" => {
            let n = value.as_u64().filter(|n| *n <= 100)
                .ok_or_else(|| crate::tr!("音量应在 0–100 之间", "Volume must be between 0 and 100"))?;
            save(sh, |m| {
                config::child(m, "features").insert(key.into(), Value::Number(n.into()));
                Ok(())
            })?;
            Ok(crate::tr!("环境声音量 {n}%。", "Ambience volume: {n}%."))
        }
        "kegel_reps" => {
            let n = value
                .as_u64()
                .filter(|n| (1..=30).contains(n))
                .ok_or_else(|| {
                    crate::tr!("每组要在 1 到 30 下之间", "A set is between 1 and 30 reps")
                })?;
            save(sh, |m| {
                config::child(m, "features").insert("kegel_reps".into(), Value::Number(n.into()));
                Ok(())
            })?;
            Ok(crate::tr!("每组 {n} 下。", "{n} reps a set."))
        }
        "approve_wait_s" => {
            let n = value
                .as_u64()
                .filter(|n| (5..=120).contains(n))
                .ok_or_else(|| {
                    crate::tr!(
                        "等待时间要在 5 到 120 秒之间",
                        "The wait must be between 5 and 120 seconds"
                    )
                })?;
            save(sh, |m| {
                config::child(m, "features")
                    .insert("approve_wait_s".into(), Value::Number(n.into()));
                Ok(())
            })?;
            Ok(crate::tr!(
                "卡片会等 {n} 秒。",
                "The card waits {n} seconds."
            ))
        }
        "sounds" | "approve" | "night" | "ambience_auto" => {
            let on = flag()?;
            save(sh, |m| {
                config::child(m, "features").insert(key.into(), Value::Bool(on));
                Ok(())
            })?;
            Ok(match (key, on) {
                ("sounds", true) => crate::tr!("音效已打开。", "Sounds on."),
                ("sounds", false) => crate::tr!("音效已关闭。", "Sounds off."),
                ("ambience_auto", true) => crate::tr!("已开启自动环境声。", "Automatic ambience on."),
                ("ambience_auto", false) => crate::tr!("已关闭自动环境声。仍可手动试听。", "Automatic ambience off. Manual playback is available."),
                ("night", true) => crate::tr!("已打开：你晚上离开后，它会把能放回的先收拾好，第二天告诉你。", "On: once you leave in the evening, it tidies what can be undone and tells you the next day."),
                ("night", false) => crate::tr!("已关闭：晚上只看不动，第二天告诉你看到了什么。", "Off: at night it only looks, and tells you the next day what it saw."),
                (_, true) => crate::tr!(
                    "已打开：Claude Code 要权限时，宠物上方会弹出卡片。",
                    "On: when Claude Code asks for permission, a card opens above the pet."
                ),
                (_, false) => crate::tr!(
                    "已关闭：权限照旧在终端里问。",
                    "Off: permissions are asked in the terminal as before."
                ),
            })
        }
        _ => Err(crate::tr!("没有这个设置：{key}", "No such setting: {key}")),
    }
}

/// Start a guided kegel set now on `pet` (default: the main pet).
pub fn kegel_now(sh: &Shared, pet: Option<&str>) -> Result<String, String> {
    let (views, reps) = {
        let hub = sh.hub.lock().unwrap();
        (hub.pets(), hub.cfg.features.kegel_reps)
    };
    let m = crate::world::kegel_script(&views, pet, reps)
        .ok_or_else(|| crate::tr!("现在没有显示的宠物", "No pet is showing right now"))?;
    sh.db
        .log_event(crate::now_ms(), "kegel", "", reps.clamp(1, 30) as i64);
    kegel_began(sh, crate::now_ms(), reps);
    let _ = sh.ws_tx.send(m);
    Ok(crate::tr!(
        "开始提肛，跟着宠物做 {reps} 组。",
        "Kegel set started: {reps} reps with your pet."
    ))
}

/// Fish you can earn yourself in a day. (What the agents' turns land is not counted.)
const EARN_CAP: u32 = 6;
/// The room's game: this many caught in a round earns one, at most `CATCH_CAP` a day.
pub const CATCH_GOAL: u32 = 20;
const CATCH_CAP: u32 = 2;

/// A kegel set has begun: finishing it earns a fish (see `earn_fish`).
pub fn kegel_began(sh: &Shared, now: u64, reps: u32) {
    sh.db
        .kv_set("kegel:began", &format!("{now}:{}", reps.clamp(1, 30)));
}

/// You earned a fish yourself. `why`: "kegel" (the set that began was done to
/// the end) or "break" (you got up after a long sit). Returns what the pet
/// `who` says about it, or None when there is nothing to give: no set was
/// under way, or today's fish have all been earned. `note` is the diary line.
pub fn earn_fish(sh: &Shared, why: &str, who: &str, note: String) -> Option<String> {
    let now = crate::now_ms();
    if why == "kegel" {
        // Only a set that was really started, and lasted about as long as it takes (6 s a rep).
        let began = sh.db.kv_get("kegel:began")?;
        let (at, reps) = began.split_once(':')?;
        let (at, reps) = (at.parse::<u64>().ok()?, reps.parse::<u64>().ok()?);
        sh.db.kv_set("kegel:began", "");
        let took = now.saturating_sub(at);
        if took < reps * 5_000 || took > reps * 6_000 + 120_000 {
            return None;
        }
    }
    if why == "catch" {
        let key = format!("earned:catch:{}", crate::db::day_of(now));
        let n = sh
            .db
            .kv_get(&key)
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);
        if n >= CATCH_CAP {
            return None;
        }
        sh.db.kv_set(&key, &(n + 1).to_string());
    }
    let key = format!("earned:{}", crate::db::day_of(now));
    let so_far = sh
        .db
        .kv_get(&key)
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(0);
    if so_far >= EARN_CAP {
        return None;
    }
    sh.db.kv_set(&key, &(so_far + 1).to_string());
    sh.world.lock().unwrap().earn(why, now, &sh.db);
    sh.db.log_event(now, "noticed", &note, 1);
    Some(crate::voice::line(
        who,
        match why {
            "kegel" => "earn_kegel",
            "catch" => "earn_catch",
            _ => "earn_break",
        },
        0,
    ))
}

/// The pet performs because it was asked to: `act` is "dance" or "play" (its
/// piece on its own instrument; "piano" means the same). With two pets up the
/// other one takes part, as it does when they decide for themselves.
pub fn perform(sh: &Shared, pet: &str, act: &str) -> String {
    use crate::think::{self, Act};
    let now = crate::now_ms();
    let what = if act == "dance" {
        Act::Dance
    } else {
        Act::Play
    };
    let obs = think::look(sh, now);
    let target = if pet == "main" {
        obs.pets
            .iter()
            .max_by_key(|p| p.state.priority())
            .map(|p| p.id.as_str())
            .unwrap_or("main")
    } else {
        pet
    };
    match think::asked(&obs, target, what) {
        Some(plan) => think::stage(sh, &plan, now, obs.kegel_reps),
        // Not showing: say so to whoever is listening for it, and let the window decide.
        None => {
            let _ = sh.ws_tx.send(crate::msg(
                "pet.act",
                &serde_json::json!({ "pet": "main", "act": what.as_str(), "text": null, "why": "asked" }),
            ));
        }
    }
    format!("act {} on {pet}", what.as_str())
}

/// Focus mode: status and "waiting for you" only; the pets do nothing on their own.
pub fn set_focus(sh: &Shared, on: bool) -> Result<String, String> {
    save(sh, |m| {
        config::child(m, "features").insert("focus_mode".into(), Value::Bool(on));
        Ok(())
    })?;
    Ok(if on {
        crate::tr!(
            "专注模式已开启：只保留状态显示和提醒。",
            "Focus mode on: only status and reminders."
        )
    } else {
        crate::tr!("专注模式已关闭。", "Focus mode off.")
    })
}

pub fn hide_pet(sh: &Shared, _id: &str) {
    // There is one desktop window now. The id is accepted for old callers,
    // but hiding always means hiding the global companion.
    sh.hub.lock().unwrap().hidden = true;
    let _ = sh.control.send(Control::Hide);
    sh.urgent.notify_one();
}

/// One beat of the guided show: which pet (0 = the lead), when, what it
/// plays, what it says, and the state the beat stands for.
struct Beat {
    who: usize,
    at: u64,
    ms: u64,
    action: &'static str,
    state: &'static str,
    zh: &'static str,
    en: &'static str,
}

const DEMO: &[Beat] = &[
    Beat {
        who: 0,
        at: 600,
        ms: 3600,
        action: "thinking",
        state: "thinking",
        zh: "它在想。我也跟着想一会儿",
        en: "It's thinking. I'll think along for a bit",
    },
    Beat {
        who: 0,
        at: 4400,
        ms: 3600,
        action: "tool",
        state: "tool",
        zh: "键盘响了。是它在敲，不是你",
        en: "Keys clicking. That's it typing, not you",
    },
    Beat {
        who: 1,
        at: 5200,
        ms: 3000,
        action: "reading",
        state: "tool",
        zh: "我这边在翻文件",
        en: "Over here I'm leafing through files",
    },
    Beat {
        who: 0,
        at: 8200,
        ms: 4200,
        action: "attention",
        state: "attention",
        zh: "它停下了。在等你点头",
        en: "It stopped. It's waiting for your nod",
    },
    Beat {
        who: 1,
        at: 12600,
        ms: 3400,
        action: "error",
        state: "error",
        zh: "……摔了一跤",
        en: "…tripped",
    },
    Beat {
        who: 0,
        at: 12800,
        ms: 3400,
        action: "done",
        state: "done",
        zh: "好了。它说好了",
        en: "Done. It says it's done",
    },
    Beat {
        who: 1,
        at: 16400,
        ms: 3200,
        action: "taunt",
        state: "rival",
        zh: "下次我先到",
        en: "Next time I get there first",
    },
    Beat {
        who: 0,
        at: 16800,
        ms: 3800,
        action: "wave",
        state: "rival",
        zh: "等它真的开工，我就不是演的了",
        en: "Once it really starts working, I won't be acting",
    },
];

/// A short guided show on the real pets: the states an agent goes through,
/// acted out with nothing behind them. Scripts only, so no turn or fish is
/// recorded. Returns the timeline for the window that narrates it.
pub fn demo(sh: &Shared) -> serde_json::Value {
    show_all(sh);
    let lead = sh.hub.lock().unwrap().desktop_pet();
    // The tour now demonstrates the state changes on the one companion. The
    // source roster remains available in the workbench while the desktop
    // scene stays single-actor.
    let cast = [Some(&lead), None];
    let mut beats = vec![];
    for b in DEMO {
        let bubble = crate::i18n::t(b.zh, b.en);
        if let Some(pet) = cast[b.who] {
            let _ = sh.ws_tx.send(crate::msg(
                "pet.script",
                &serde_json::json!({ "pet": pet.id, "rule": "demo", "action": b.action, "bubble": bubble, "ms": b.ms, "delay": b.at }),
            ));
        }
        beats.push(serde_json::json!({ "at": b.at, "ms": b.ms, "state": b.state, "who": b.who, "action": b.action, "bubble": bubble }));
    }
    serde_json::json!({ "beats": beats, "pets": cast.iter().flatten().count() })
}

pub fn show_all(sh: &Shared) {
    {
        let mut hub = sh.hub.lock().unwrap();
        hub.hidden = false;
        hub.hidden_pets.clear();
    }
    let _ = sh.control.send(Control::Show);
    sh.urgent.notify_one();
}

pub fn hide_all(sh: &Shared) {
    sh.hub.lock().unwrap().hidden = true;
    let _ = sh.control.send(Control::Hide);
}
