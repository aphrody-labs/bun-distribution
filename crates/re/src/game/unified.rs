// SPDX-License-Identifier: Apache-2.0
//! Deep unification of Dragon Ball Xenoverse 2 state:
//! Combines Player Save Data, Extracted Game Assets, Binary RE Symbol Analysis,
//! and Live Memory Inspection via Wine into a cohesive model.

use serde::{Deserialize, Serialize};

use crate::game::formats::{
    bac::BacFile,
    bdm::BdmFile,
    cus::CusFile,
    msg::MsgFile,
    sav::{Dxbv2Cac, Dxbv2Save},
};
use crate::game::live::process::{LiveBattleCharacter, WineProcessMemory};

/// A resolved skill combining save ID with CUS/BAC/BDM/MSG metadata.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ResolvedSkill {
    pub id: u32,
    pub name: String,
    pub category: String,
    pub ki_cost: u32,
    pub total_hits: usize,
    pub base_damage: f32,
}

/// An enriched character profile uniting save stats and asset assets.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UnifiedCharacterProfile {
    pub cac: Dxbv2Cac,
    pub super_skills: Vec<ResolvedSkill>,
    pub ultimate_skills: Vec<ResolvedSkill>,
    pub evasive_skills: Vec<ResolvedSkill>,
    pub awoken_skill: Option<ResolvedSkill>,
    pub live_status: Option<LiveBattleCharacter>,
}

/// A reverse-engineered binary function entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BinaryFunctionEntry {
    pub va: String,
    pub name: String,
    pub return_type: String,
    pub size: usize,
}

/// Unified Xenoverse 2 state snapshot across storage, assets, static RE, and live execution.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Dbxv2UnifiedState {
    pub game_title: String,
    pub steam_app_id: u32,
    pub timestamp: String,
    pub save_overview: Option<SaveOverview>,
    pub characters: Vec<UnifiedCharacterProfile>,
    pub binary_re: Option<BinaryReOverview>,
    pub live_wine: Option<LiveWineOverview>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SaveOverview {
    pub signature: String,
    pub zeni: u32,
    pub tp_medals: u32,
    pub total_cacs: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BinaryReOverview {
    pub executable_path: String,
    pub size_bytes: usize,
    pub is_pe: bool,
    pub header_entropy: f64,
    pub total_analyzed_functions: usize,
    pub sample_functions: Vec<BinaryFunctionEntry>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LiveWineOverview {
    pub pid: u32,
    pub process_name: String,
    pub base_address: String,
    pub mapped_regions_count: usize,
    pub active_combatant: Option<LiveBattleCharacter>,
}

impl Dbxv2UnifiedState {
    /// Creates a unified state from individual components.
    pub fn build(
        save: Option<&Dxbv2Save>,
        cus: Option<&CusFile>,
        bac: Option<&BacFile>,
        bdm: Option<&BdmFile>,
        msg: Option<&MsgFile>,
        wine_mem: Option<&WineProcessMemory>,
        live_char: Option<&LiveBattleCharacter>,
    ) -> Self {
        let save_overview = save.map(|s| SaveOverview {
            signature: s.signature.clone(),
            zeni: s.zeni,
            tp_medals: s.tp_medals,
            total_cacs: s.cacs.len(),
        });

        let mut characters = Vec::new();
        if let Some(s) = save {
            for cac in &s.cacs {
                let mut profile = UnifiedCharacterProfile {
                    cac: cac.clone(),
                    super_skills: Vec::new(),
                    ultimate_skills: Vec::new(),
                    evasive_skills: Vec::new(),
                    awoken_skill: None,
                    live_status: None,
                };

                if let Some(c) = cus {
                    // Match top skills from CUS
                    for skill in c.skills.iter().take(4) {
                        let total_hits = bac.map(|b| b.moves.len()).unwrap_or(1);
                        let base_damage = bdm
                            .and_then(|b| b.entries.first())
                            .map(|e| e.base_damage as f32)
                            .unwrap_or(100.0);
                        let skill_name = msg
                            .and_then(|m| m.entries.iter().find(|e| e.id == skill.name_id))
                            .and_then(|e| e.lines.first().cloned())
                            .unwrap_or_else(|| format!("Skill #{:04}", skill.id));

                        profile.super_skills.push(ResolvedSkill {
                            id: skill.id,
                            name: skill_name,
                            category: format!("{:?}", skill.category),
                            ki_cost: skill.ki_cost,
                            total_hits,
                            base_damage,
                        });
                    }
                }

                if cac.slot == 0 {
                    profile.live_status = live_char.cloned();
                }

                characters.push(profile);
            }
        }

        let live_wine = wine_mem.map(|m| LiveWineOverview {
            pid: m.pid,
            process_name: m.process_name.clone(),
            base_address: format!("0x{:x}", m.base_address),
            mapped_regions_count: m.regions.len(),
            active_combatant: live_char.cloned(),
        });

        Self {
            game_title: "Dragon Ball Xenoverse 2".into(),
            steam_app_id: 454650,
            timestamp: "2026-10-07T23:30:00Z".into(),
            save_overview,
            characters,
            binary_re: None,
            live_wine,
        }
    }

    /// Attaches reverse engineering metadata to the unified snapshot.
    pub fn with_binary_re(mut self, binary_re: BinaryReOverview) -> Self {
        self.binary_re = Some(binary_re);
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_unified_state_build_empty() {
        let state = Dbxv2UnifiedState::build(None, None, None, None, None, None, None);
        assert_eq!(state.game_title, "Dragon Ball Xenoverse 2");
        assert_eq!(state.steam_app_id, 454650);
        assert!(state.save_overview.is_none());
        assert!(state.characters.is_empty());
        assert!(state.live_wine.is_none());
        assert!(state.binary_re.is_none());
    }

    #[test]
    fn test_unified_state_with_binary_re() {
        let state = Dbxv2UnifiedState::build(None, None, None, None, None, None, None)
            .with_binary_re(BinaryReOverview {
                executable_path: "DBXV2.exe".into(),
                size_bytes: 25_000_000,
                is_pe: true,
                header_entropy: 6.42,
                total_analyzed_functions: 1215,
                sample_functions: vec![BinaryFunctionEntry {
                    va: "0x1419e5310".into(),
                    name: "entry".into(),
                    return_type: "undefined".into(),
                    size: 5,
                }],
            });

        assert!(state.binary_re.is_some());
        let re = state.binary_re.unwrap();
        assert_eq!(re.total_analyzed_functions, 1215);
        assert_eq!(re.sample_functions.len(), 1);
    }
}
