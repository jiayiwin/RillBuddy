//! External source snapshots for the universal workbench.
//!
//! Agent sessions are owned by `Hub`; calendar, mail, project, Git and CI
//! adapters can publish the same small snapshot shape through the local API.
//! The store is intentionally in memory for now: source adapters own their
//! own persistence and can replay after daemon restart.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkItem {
    pub id: String,
    pub title: String,
    pub state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<serde_json::Value>,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Snapshot {
    pub kind: String,
    pub id: String,
    pub name: String,
    pub state: String,
    pub since: u64,
    pub needs_you: usize,
    pub items: Vec<WorkItem>,
    pub updated_at: u64,
}

#[derive(Debug, Default)]
pub struct Store {
    values: BTreeMap<(String, String), Snapshot>,
}

impl Store {
    pub fn from_json(value: Option<&str>) -> Self {
        let values: Vec<Snapshot> = value
            .and_then(|v| serde_json::from_str(v).ok())
            .unwrap_or_default();
        let mut store = Self::default();
        for snapshot in values { store.upsert(snapshot); }
        store
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(&self.list()).unwrap_or_else(|_| "[]".into())
    }

    pub fn upsert(&mut self, snapshot: Snapshot) {
        self.values
            .insert((snapshot.kind.clone(), snapshot.id.clone()), snapshot);
    }

    pub fn list(&self) -> Vec<Snapshot> {
        self.values.values().cloned().collect()
    }

    pub fn apply_action(&mut self, kind: &str, id: &str, item_id: &str, action: &str) -> Option<Snapshot> {
        let snapshot = self.values.get_mut(&(kind.to_string(), id.to_string()))?;
        let item = snapshot.items.iter_mut().find(|i| i.id == item_id)?;
        match action {
            "done" | "complete" => item.state = "done".into(),
            "park" | "snooze" => item.state = "parked".into(),
            "needs_you" => item.state = "needs_you".into(),
            _ => return None,
        }
        snapshot.needs_you = snapshot.items.iter().filter(|i| i.state == "needs_you").count();
        snapshot.state = if snapshot.needs_you > 0 {
            "needs_you".into()
        } else if snapshot.items.iter().any(|i| matches!(i.state.as_str(), "working" | "waiting" | "blocked")) {
            "working".into()
        } else if snapshot.items.iter().all(|i| i.state == "done") {
            "done".into()
        } else {
            "parked".into()
        };
        snapshot.updated_at = crate::now_ms();
        Some(snapshot.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshots_replace_by_kind_and_id() {
        let mut s = Store::default();
        let make = |state: &str| Snapshot {
            kind: "git".into(),
            id: "repo".into(),
            name: "Git".into(),
            state: state.into(),
            since: 1,
            needs_you: 0,
            items: vec![],
            updated_at: 2,
        };
        s.upsert(make("working"));
        s.upsert(make("needs_you"));
        assert_eq!(s.list().len(), 1);
        assert_eq!(s.list()[0].state, "needs_you");
        let restored = Store::from_json(Some(&s.to_json()));
        assert_eq!(restored.list(), s.list());
    }

    #[test]
    fn actions_update_external_work_items() {
        let mut s = Store::default();
        s.upsert(Snapshot { kind: "git".into(), id: "repo".into(), name: "Git".into(), state: "needs_you".into(), since: 1, needs_you: 1, items: vec![WorkItem { id: "build".into(), title: "Build failed".into(), state: "needs_you".into(), source: None, project: None, action: None, updated_at: 2 }], updated_at: 2 });
        let r = s.apply_action("git", "repo", "build", "done").unwrap();
        assert_eq!(r.items[0].state, "done");
        assert_eq!(r.needs_you, 0);
        assert_eq!(r.state, "done");
    }

    #[test]
    fn parking_the_last_open_item_does_not_claim_the_source_is_working() {
        let mut s = Store::default();
        s.upsert(Snapshot {
            kind: "mail".into(), id: "inbox".into(), name: "Mail".into(),
            state: "needs_you".into(), since: 1, needs_you: 1,
            items: vec![WorkItem { id: "m1".into(), title: "Reply".into(), state: "needs_you".into(), source: None, project: None, action: None, updated_at: 2 }], updated_at: 2,
        });
        let r = s.apply_action("mail", "inbox", "m1", "park").unwrap();
        assert_eq!(r.state, "parked");
    }
}

