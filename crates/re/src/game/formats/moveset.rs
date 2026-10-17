// SPDX-License-Identifier: Apache-2.0
//! Dragon Ball Xenoverse 2 Moveset Frame Data Synthesis.
//!
//! Synthesizes BAC (Battle Action Code) move animations and BDM (Battle Damage Matrix)
//! hit properties into structured fighting-game style frame data:
//! - Startup, Active, Recovery frames
//! - On-Hit and On-Block frame advantage
//! - Hitstun, Blockstun, Knockdown, Stamina damage
//! - Invincibility (I-frames) and Super Armor windows

use crate::game::formats::bac::{BacFile, BacMove};
use crate::game::formats::bdm::{BdmFile, DamageType};
use serde::{Deserialize, Serialize};

/// High-level combat frame data for a single attack or skill.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoveFrameData {
    pub move_id: u32,
    pub name: String,
    pub total_frames: u16,
    pub startup_frames: u16,
    pub active_frames: u16,
    pub recovery_frames: u16,
    /// Advantage on hit (positive = attacker recovers first, negative = defender recovers first).
    pub hit_advantage: i16,
    /// Advantage on block (positive = safe/plus on block, negative = unsafe/punishable).
    pub block_advantage: i16,
    pub base_damage: u32,
    pub stamina_damage: u16,
    pub damage_type: DamageType,
    pub knockback_strength: f32,
    pub is_invincible: bool,
    pub has_super_armor: bool,
}

/// Complete moveset analysis for a character.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterMoveset {
    pub character_code: String,
    pub moves: Vec<MoveFrameData>,
}

impl CharacterMoveset {
    /// Synthesizes complete character moveset frame data from BAC and BDM files.
    pub fn synthesize(character_code: &str, bac: &BacFile, bdm: Option<&BdmFile>) -> Self {
        let mut moves = Vec::with_capacity(bac.moves.len());

        for m in &bac.moves {
            let fd = calculate_move_frame_data(m, bdm);
            moves.push(fd);
        }

        Self {
            character_code: character_code.to_string(),
            moves,
        }
    }

    /// Finds a move by its ID.
    pub fn find_move(&self, move_id: u32) -> Option<&MoveFrameData> {
        self.moves.iter().find(|m| m.move_id == move_id)
    }

    /// Returns all moves that are safe on block (block advantage >= -2).
    pub fn safe_on_block_moves(&self) -> Vec<&MoveFrameData> {
        self.moves
            .iter()
            .filter(|m| m.block_advantage >= -2)
            .collect()
    }
}

fn calculate_move_frame_data(m: &BacMove, bdm: Option<&BdmFile>) -> MoveFrameData {
    let mut total_dmg = 0;
    let mut total_stm = 0;
    let mut max_hitstun = 0;
    let mut max_blockstun = 0;
    let mut damage_type = DamageType::Strike;
    let mut knockback = 0.0f32;

    let active_frames = if let Some(first_hit) = m.hitboxes.first() {
        let last_hit = m.hitboxes.last().unwrap_or(first_hit);
        last_hit
            .end_frame
            .saturating_sub(first_hit.start_frame)
            .max(1)
    } else {
        0
    };

    if let Some(bdm_file) = bdm {
        for hit in &m.hitboxes {
            total_dmg += hit.damage;
            if let Some(entry) = bdm_file
                .entries
                .iter()
                .find(|e| e.id == hit.bdm_entry_id as u32)
            {
                total_dmg = total_dmg.max(entry.base_damage);
                total_stm += entry.stamina_damage;
                max_hitstun = max_hitstun.max(entry.hitstun_frames);
                max_blockstun = max_blockstun.max(entry.blockstun_frames);
                damage_type = entry.damage_type;
                knockback = knockback.max(entry.knockback_strength);
            }
        }
    } else {
        for hit in &m.hitboxes {
            total_dmg += hit.damage;
        }
        max_hitstun = m.recovery_frames.saturating_add(4);
        max_blockstun = m.recovery_frames.saturating_sub(2);
    }

    let hit_advantage = (max_hitstun as i16) - (m.recovery_frames as i16);
    let block_advantage = (max_blockstun as i16) - (m.recovery_frames as i16);

    MoveFrameData {
        move_id: m.move_id,
        name: format!("Move_{:04}", m.move_id),
        total_frames: m.total_frames,
        startup_frames: m.startup_frames,
        active_frames,
        recovery_frames: m.recovery_frames,
        hit_advantage,
        block_advantage,
        base_damage: total_dmg,
        stamina_damage: total_stm,
        damage_type,
        knockback_strength: knockback,
        is_invincible: m.startup_frames > 20, // Super/Ult startup threshold
        has_super_armor: m.recovery_frames > 30,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::formats::bac::BacHitbox;
    use crate::game::formats::bdm::BdmEntry;

    #[test]
    fn test_moveset_synthesis() {
        let bac = BacFile {
            moves: vec![BacMove {
                move_id: 100,
                total_frames: 30,
                startup_frames: 8,
                recovery_frames: 14,
                hitboxes: vec![BacHitbox {
                    start_frame: 8,
                    end_frame: 12,
                    damage: 250,
                    bdm_entry_id: 1,
                    knockback_type: 0,
                }],
            }],
        };

        let bdm = BdmFile {
            entries: vec![BdmEntry {
                id: 1,
                damage_type: DamageType::Strike,
                base_damage: 250,
                stamina_damage: 50,
                hitstun_frames: 18,
                blockstun_frames: 12,
                knockback_type: 0,
                knockback_strength: 1.5,
                pushback_distance: 0.5,
                camera_shake: 0,
            }],
        };

        let moveset = CharacterMoveset::synthesize("GOK", &bac, Some(&bdm));
        assert_eq!(moveset.moves.len(), 1);

        let m = &moveset.moves[0];
        assert_eq!(m.move_id, 100);
        assert_eq!(m.startup_frames, 8);
        assert_eq!(m.active_frames, 4);
        assert_eq!(m.recovery_frames, 14);
        // hit_adv: 18 - 14 = +4
        assert_eq!(m.hit_advantage, 4);
        // block_adv: 12 - 14 = -2
        assert_eq!(m.block_advantage, -2);
        assert_eq!(m.base_damage, 250);
        assert_eq!(m.stamina_damage, 50);
    }
}
