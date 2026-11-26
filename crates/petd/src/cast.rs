//! The five looks for the one desktop companion. Each is a whole skin of the
//! product (colours, room, letter paper, lines) and plays one instrument.
//! `companions:` is read only for migration from older releases; sources never
//! own a desktop pet in the current product model.

use crate::config::Config;

pub struct Fellow {
    pub id: &'static str,
    pub zh: &'static str,
    pub en: &'static str,
    /// What it plays: the windows pick the samples and the playing pose by this.
    pub instrument: &'static str,
    /// Cut, rigged and able to move. The others are drawn but still on their way.
    pub here: bool,
}

impl Fellow {
    pub fn name(&self) -> &'static str {
        crate::i18n::t(self.zh, self.en)
    }
}

pub const CAST: [Fellow; 5] = [
    Fellow {
        id: "zimeng",
        zh: "紫梦",
        en: "Zimeng",
        instrument: "piano",
        here: true,
    },
    Fellow {
        id: "mashu",
        zh: "麻薯",
        en: "Mashu",
        instrument: "cello",
        here: true,
    },
    Fellow {
        id: "paopao",
        zh: "泡泡",
        en: "Paopao",
        instrument: "flute",
        here: true,
    },
    Fellow {
        id: "gugu",
        zh: "菇菇",
        en: "Gugu",
        instrument: "xylophone",
        here: true,
    },
    Fellow {
        id: "rongrong",
        zh: "茸茸",
        en: "Rongrong",
        instrument: "harp",
        here: true,
    },
];

pub fn by_id(id: &str) -> Option<&'static Fellow> {
    CAST.iter().find(|f| f.id == id)
}

/// The pet called `name`, in either language (a letter is signed with it).
pub fn by_name(name: &str) -> Option<&'static Fellow> {
    CAST.iter().find(|f| f.zh == name || f.en == name)
}

/// Legacy source ids used only when reading an older config.
pub const AGENTS: [&str; 5] = ["claude-code", "codex", "gemini", "cursor", "opencode"];

/// Legacy fallback used while migrating an older config with no main skin.
fn default_for(source: &str) -> &'static Fellow {
    &CAST[AGENTS.iter().position(|a| *a == source).unwrap_or(0)]
}

/// Resolve the legacy skin for `source` while migrating old data.
pub fn of(cfg: &Config, source: &str) -> &'static Fellow {
    cfg.companions
        .get(source)
        .and_then(|id| by_id(id))
        .filter(|f| f.here)
        .unwrap_or_else(|| default_for(source))
}

/// The global skin of the one desktop companion. Empty legacy configs keep
/// their Claude companion skin until the user chooses a wardrobe item.
pub fn main(cfg: &Config) -> &'static Fellow {
    if cfg.main_skin.is_empty() {
        of(cfg, "claude-code")
    } else {
        by_id(&cfg.main_skin).unwrap_or_else(|| of(cfg, "claude-code"))
    }
}

/// Everything a window needs to draw the cast and the pairing.
pub fn json(cfg: &Config) -> serde_json::Value {
    serde_json::json!({
        "main": main(cfg).id,
        "cast": CAST.iter().map(|f| serde_json::json!({ "id": f.id, "name": f.name(), "instrument": f.instrument, "here": f.here })).collect::<Vec<_>>(),
    })
}

/// Legacy pairing helper. New callers should write `main_skin` instead.
pub fn pair(cfg: &Config, source: &str, pet: &str) -> Result<Vec<(String, String)>, String> {
    let f = by_id(pet).ok_or_else(|| crate::tr!("没有这只宠物：{pet}", "No such pet: {pet}"))?;
    if !f.here {
        return Err(crate::tr!(
            "{} 还没来。",
            "{} has not arrived yet.",
            f.name()
        ));
    }
    let mut out = vec![(source.to_string(), f.id.to_string())];
    if let Some(o) = AGENTS
        .iter()
        .find(|a| **a != source && of(cfg, a).id == f.id)
    {
        out.push((o.to_string(), of(cfg, source).id.to_string()));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_pair_and_swap() {
        let mut cfg = Config::default();
        assert_eq!(
            (
                of(&cfg, "claude-code").id,
                of(&cfg, "codex").id,
                of(&cfg, "gemini").id
            ),
            ("zimeng", "mashu", "paopao")
        );
        assert_eq!(
            (
                of(&cfg, "cursor").id,
                of(&cfg, "opencode").id,
                of(&cfg, "something-else").id
            ),
            ("gugu", "rongrong", "zimeng")
        );
        // Taking the other agent's pet swaps the two.
        let moves = pair(&cfg, "claude-code", "mashu").unwrap();
        assert_eq!(
            moves,
            vec![
                ("claude-code".to_string(), "mashu".to_string()),
                ("codex".to_string(), "zimeng".to_string())
            ]
        );
        for (s, p) in moves {
            cfg.companions.insert(s, p);
        }
        assert_eq!(
            (
                of(&cfg, "claude-code").id,
                of(&cfg, "codex").id,
                main(&cfg).id
            ),
            ("mashu", "zimeng", "mashu")
        );
        // Taking a third agent's pet swaps with that one, and leaves the others alone.
        let moves = pair(&cfg, "codex", "paopao").unwrap();
        assert_eq!(
            moves,
            vec![
                ("codex".to_string(), "paopao".to_string()),
                ("gemini".to_string(), "zimeng".to_string())
            ]
        );
        // An unknown pet cannot be chosen, and one in the file falls back.
        assert!(pair(&cfg, "codex", "nobody").is_err());
        cfg.companions.insert("codex".into(), "nobody".into());
        assert_eq!(of(&cfg, "codex").id, "mashu");
        // Every agent has a different pet by default.
        let mut ids: Vec<_> = AGENTS
            .iter()
            .map(|a| of(&Config::default(), a).id)
            .collect();
        ids.dedup();
        assert_eq!(ids.len(), 5);
    }
}
