// SPDX-License-Identifier: Apache-2.0
//! Gameplay formats of the dbxv2 `parse` pass: BAC, BCM, BCS, BDM, BSA, EAN, EMM and ESK.
//!
//! A faithful port of the `pyxenoverse` readers (KyonkoYuuki, used by the dbxv2 Python CLI):
//! every structure the Python loader reads is read here at the same offsets with the same
//! `struct` layouts, so a file loads, is skipped (wrong signature) or fails exactly when it does
//! in Python, and the JSON matches the dbxv2 `to_serial` output: the top-level object, its
//! header record and the field records of its top-level lists.

use serde_json::{Map, Value, json};

/// Outcome of loading one gameplay file.
pub enum Loaded {
    /// The loader accepted the file; the value is its JSON document.
    Json(Value),
    /// The loader rejected the signature (`load()` returned `False`).
    Skipped,
}

/// Loader failure (any Python exception: short read, bad UTF-8, unknown sub-entry type...).
#[derive(Debug)]
pub struct LoadError(pub String);

type Load<T> = std::result::Result<T, LoadError>;

fn error(message: impl Into<String>) -> LoadError {
    LoadError(message.into())
}

/// One unpacked `struct` value.
#[derive(Debug, Clone)]
enum Py {
    Int(i128),
    Float(f64),
    Bytes(Vec<u8>),
}

impl Py {
    fn int(&self) -> i128 {
        match self {
            Self::Int(value) => *value,
            Self::Float(value) => *value as i128,
            Self::Bytes(_) => 0,
        }
    }

    fn usize(&self) -> usize {
        usize::try_from(self.int()).unwrap_or(usize::MAX)
    }

    fn json(&self) -> Value {
        match self {
            Self::Int(value) => {
                i64::try_from(*value).map(Value::from).unwrap_or_else(|_| Value::from(*value as u64))
            },
            // Python writes NaN/Infinity tokens; JSON has no such literal, so they become null.
            Self::Float(value) => serde_json::Number::from_f64(*value).map_or(Value::Null, Value::Number),
            Self::Bytes(bytes) => Value::String(hex::encode(bytes)),
        }
    }
}

/// A `recordclass` instance: field names and values.
#[derive(Debug, Clone)]
struct Record {
    fields: &'static [&'static str],
    values: Vec<Py>,
}

impl Record {
    fn get(&self, name: &str) -> &Py {
        let index = self.fields.iter().position(|field| *field == name).expect("known field");
        &self.values[index]
    }

    fn zero(fields: &'static [&'static str]) -> Self {
        Self { fields, values: vec![Py::Int(0); fields.len()] }
    }

    fn json(&self) -> Value {
        Value::Object(
            self.fields.iter().zip(&self.values).map(|(name, value)| ((*name).to_owned(), value.json())).collect(),
        )
    }
}

/// Python file object semantics over a byte slice: seeks anywhere, reads come back short at EOF.
struct File<'a> {
    data: &'a [u8],
    position: usize,
    big_endian: bool,
}

impl<'a> File<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, position: 0, big_endian: false }
    }

    fn seek(&mut self, position: i128) -> Load<()> {
        self.position = usize::try_from(position).map_err(|_| error("negative seek"))?;
        Ok(())
    }

    fn tell(&self) -> usize {
        self.position
    }

    fn read(&mut self, size: usize) -> &'a [u8] {
        // Past EOF a Python read returns nothing and leaves the position where it was.
        if self.position >= self.data.len() {
            return &[];
        }
        let start = self.position;
        let end = start.saturating_add(size).min(self.data.len());
        self.position = end;
        &self.data[start..end]
    }

    /// `struct.unpack(endian + format, f.read(size))`, failing like `struct.error` on short data.
    fn unpack(&mut self, format: &str) -> Load<Vec<Py>> {
        let size = calcsize(format);
        let bytes = self.read(size);
        if bytes.len() != size {
            return Err(error(format!("unpack requires a buffer of {size} bytes")));
        }
        Ok(unpack(format, bytes, self.big_endian))
    }

    fn record(&mut self, fields: &'static [&'static str], format: &str) -> Load<Record> {
        let values = self.unpack(format)?;
        debug_assert_eq!(values.len(), fields.len(), "{format}");
        Ok(Record { fields, values })
    }

    fn u32(&mut self) -> Load<i128> {
        Ok(self.unpack("I")?[0].int())
    }

    /// `pyxenoverse.read_name`: bytes up to NUL, strict UTF-8.
    fn read_name(&mut self, offset: Option<i128>) -> Load<String> {
        if let Some(offset) = offset.filter(|offset| *offset != 0) {
            self.seek(offset)?;
        }
        let start = self.position.min(self.data.len());
        let Some(length) = self.data[start..].iter().position(|&byte| byte == 0) else {
            return Err(error("unterminated name at end of file"));
        };
        self.position = start + length + 1;
        String::from_utf8(self.data[start..start + length].to_vec()).map_err(|_| error("invalid UTF-8 name"))
    }
}

fn calcsize(format: &str) -> usize {
    let mut size = 0;
    let mut count = String::new();
    for code in format.chars() {
        if code.is_ascii_digit() {
            count.push(code);
            continue;
        }
        if code == ' ' {
            continue;
        }
        let repeat = count.parse::<usize>().unwrap_or(1);
        count.clear();
        size += repeat
            * match code {
                'x' | 'c' | 'b' | 'B' | '?' | 's' => 1,
                'h' | 'H' | 'e' => 2,
                'i' | 'I' | 'l' | 'L' | 'f' => 4,
                'q' | 'Q' | 'd' => 8,
                other => panic!("unsupported struct code {other}"),
            };
    }
    size
}

fn unpack(format: &str, bytes: &[u8], big_endian: bool) -> Vec<Py> {
    let mut values = Vec::new();
    let mut cursor = 0;
    let mut count = String::new();
    let take = |cursor: &mut usize, size: usize| -> [u8; 8] {
        let mut raw = [0u8; 8];
        let slice = &bytes[*cursor..*cursor + size];
        if big_endian {
            for (index, byte) in slice.iter().rev().enumerate() {
                raw[index] = *byte;
            }
        } else {
            raw[..size].copy_from_slice(slice);
        }
        *cursor += size;
        raw
    };
    for code in format.chars() {
        if code.is_ascii_digit() {
            count.push(code);
            continue;
        }
        if code == ' ' {
            continue;
        }
        let repeat = count.parse::<usize>().unwrap_or(1);
        count.clear();
        if code == 's' {
            values.push(Py::Bytes(bytes[cursor..cursor + repeat].to_vec()));
            cursor += repeat;
            continue;
        }
        for _ in 0..repeat {
            let value = match code {
                'x' => {
                    cursor += 1;
                    continue;
                },
                'b' => Py::Int(i128::from(take(&mut cursor, 1)[0] as i8)),
                'B' | 'c' | '?' => Py::Int(i128::from(take(&mut cursor, 1)[0])),
                'h' => Py::Int(i128::from(i16::from_le_bytes(take(&mut cursor, 2)[..2].try_into().unwrap()))),
                'H' => Py::Int(i128::from(u16::from_le_bytes(take(&mut cursor, 2)[..2].try_into().unwrap()))),
                'i' | 'l' => Py::Int(i128::from(i32::from_le_bytes(take(&mut cursor, 4)[..4].try_into().unwrap()))),
                'I' | 'L' => Py::Int(i128::from(u32::from_le_bytes(take(&mut cursor, 4)[..4].try_into().unwrap()))),
                'q' => Py::Int(i128::from(i64::from_le_bytes(take(&mut cursor, 8)))),
                'Q' => Py::Int(i128::from(u64::from_le_bytes(take(&mut cursor, 8)))),
                'e' => Py::Float(half_to_f64(u16::from_le_bytes(take(&mut cursor, 2)[..2].try_into().unwrap()))),
                'f' => Py::Float(f64::from(f32::from_le_bytes(take(&mut cursor, 4)[..4].try_into().unwrap()))),
                'd' => Py::Float(f64::from_le_bytes(take(&mut cursor, 8))),
                other => panic!("unsupported struct code {other}"),
            };
            values.push(value);
        }
    }
    values
}

fn half_to_f64(bits: u16) -> f64 {
    let sign = if bits & 0x8000 != 0 { -1.0 } else { 1.0 };
    let exponent = i32::from((bits >> 10) & 0x1F);
    let mantissa = f64::from(bits & 0x3FF);
    match exponent {
        0 => sign * mantissa * 2f64.powi(-24),
        31 if mantissa == 0.0 => sign * f64::INFINITY,
        31 => f64::NAN,
        _ => sign * (1.0 + mantissa / 1024.0) * 2f64.powi(exponent - 15),
    }
}

/// Python `bytes.decode()` (strict UTF-8).
fn decode(value: &Py) -> Load<String> {
    match value {
        Py::Bytes(bytes) => String::from_utf8(bytes.clone()).map_err(|_| error("invalid UTF-8 field")),
        other => Ok(other.int().to_string()),
    }
}

fn top(entries: Vec<(&str, Value)>) -> Value {
    Value::Object(entries.into_iter().map(|(key, value)| (key.to_owned(), value)).collect::<Map<_, _>>())
}

fn endian_of(file: &mut File<'_>) -> &'static str {
    file.seek(4).ok();
    let little = file.read(2) == b"\xFE\xFF";
    file.big_endian = !little;
    if little { "<" } else { ">" }
}

// ----------------------------------------------------------------------------------- EMM ----

const EMM_HEADER: &[&str] = &["endianess_check", "u_06", "num_entries", "material_base_address"];
const EMM_MATERIAL: &[&str] = &["name", "shader_name", "param_count", "u_42"];

fn emm(data: &[u8], filename: &str) -> Load<Loaded> {
    if !data.starts_with(b"#EMM") {
        return Ok(Loaded::Skipped);
    }
    let mut file = File::new(data);
    let endian = endian_of(&mut file);
    file.seek(4)?;
    let header = file.record(EMM_HEADER, "HHII")?;
    let base = header.get("material_base_address").int();
    file.seek(base)?;
    let count = file.u32()?;
    let offsets: Vec<i128> = (0..count).map(|_| file.u32()).collect::<Load<_>>()?;
    let mut materials = Vec::with_capacity(offsets.len());
    for offset in offsets {
        file.seek(base + offset)?;
        let material = file.record(EMM_MATERIAL, "32s32sHH")?;
        let name = decode(material.get("name"))?.trim_end_matches('\0').to_owned();
        let shader = decode(material.get("shader_name"))?.trim_end_matches('\0').to_owned();
        for _ in 0..material.get("param_count").int() {
            let parameter = file.unpack("32sIf")?;
            decode(&parameter[0])?;
        }
        let mut object = material.json();
        object["name"] = Value::String(name);
        object["shader_name"] = Value::String(shader);
        materials.push(object);
    }
    Ok(Loaded::Json(top(vec![
        ("header", header.json()),
        ("endian", Value::from(endian)),
        ("filename", Value::from(filename)),
        ("mat_count", Value::from(count as u64)),
        ("materials", Value::Array(materials)),
    ])))
}

// ----------------------------------------------------------------------------------- ESK ----

const ESK_HEADER: &[&str] = &[
    "bone_count",
    "flag",
    "bone_indices_offset",
    "bone_names_offset",
    "skinning_matrix_offset",
    "transform_matrix_offset",
    "unknown_offset_0",
    "unknown_offset_1",
    "unknown_offset_2",
    "unknown_offset_3",
];

/// `ESK.read` at the current position; returns the header and the bone names.
fn esk_read(file: &mut File<'_>) -> Load<(Record, Vec<String>)> {
    let base = file.tell() as i128;
    let header = file.record(ESK_HEADER, "HHIIIIIIII")?;
    let mut names = Vec::new();
    for index in 0..header.get("bone_count").int() {
        file.seek(base + header.get("bone_indices_offset").int() + index * 8)?;
        file.unpack("HHHH")?;
        file.seek(base + header.get("bone_names_offset").int() + index * 4)?;
        let address = file.u32()?;
        file.seek(base + address)?;
        names.push(file.read_name(None)?);
        file.seek(base + header.get("skinning_matrix_offset").int() + index * 48)?;
        file.unpack("12f")?;
        if header.get("transform_matrix_offset").int() != 0 {
            file.seek(base + header.get("transform_matrix_offset").int() + index * 64)?;
            file.unpack("16f")?;
        }
    }
    file.seek(base + header.get("unknown_offset_0").int())?;
    let big = std::mem::replace(&mut file.big_endian, false);
    file.unpack("I")?;
    file.big_endian = big;
    Ok((header, names))
}

fn esk(data: &[u8]) -> Load<Loaded> {
    if !data.starts_with(b"#ESK") {
        return Ok(Loaded::Skipped);
    }
    // pyxenoverse compares the endian bytes with an int, so ESK files always load little-endian.
    let mut file = File::new(data);
    file.seek(16)?;
    let address = file.u32()?;
    file.seek(address)?;
    let (header, _) = esk_read(&mut file)?;
    Ok(Loaded::Json(header.json()))
}

// ----------------------------------------------------------------------------------- EAN ----

const EAN_HEADER: &[&str] = &[
    "endianess_check",
    "unk_06",
    "unknown_total",
    "unk_0c",
    "unk_10",
    "animation_type",
    "animation_count",
    "skeleton_offset",
    "animation_keyframes_offset",
    "animation_names_offset",
];

fn ean(data: &[u8]) -> Load<Loaded> {
    if !data.starts_with(b"#EAN") {
        return Ok(Loaded::Skipped);
    }
    let mut file = File::new(data);
    endian_of(&mut file);
    file.seek(4)?;
    let header = file.record(EAN_HEADER, "HHIIBBHIII")?;
    file.seek(header.get("skeleton_offset").int())?;
    let (_, bones) = esk_read(&mut file)?;
    for index in 0..header.get("animation_count").int() {
        file.seek(header.get("animation_keyframes_offset").int() + index * 4)?;
        let address = file.u32()?;
        file.seek(address)?;
        let animation_base = file.tell() as i128;
        let animation = file.unpack("HBBIII")?;
        let (index_size, float_size) = (animation[1].int(), animation[2].int());
        for node_index in 0..animation[4].int() {
            file.seek(animation_base + animation[5].int() + node_index * 4)?;
            let node_address = file.u32()?;
            file.seek(animation_base + node_address)?;
            let node_base = file.tell() as i128;
            let node = file.unpack("HHI")?;
            if node[0].usize() >= bones.len() {
                return Err(error("animation node bone index out of range"));
            }
            for keyframed_index in 0..node[1].int() {
                file.seek(node_base + node[2].int() + keyframed_index * 4)?;
                let keyframed_address = file.u32()?;
                file.seek(node_base + keyframed_address)?;
                let keyframed_base = file.tell() as i128;
                let big = std::mem::replace(&mut file.big_endian, false);
                file.unpack("I")?;
                file.big_endian = big;
                let keyframed = file.unpack("III")?;
                let count = keyframed[0].int();
                file.seek(keyframed_base + keyframed[1].int())?;
                for _ in 0..count {
                    match index_size {
                        0 => drop(file.unpack("B")?),
                        1 => drop(file.unpack("H")?),
                        _ => {},
                    }
                }
                file.seek(keyframed_base + keyframed[2].int())?;
                for _ in 0..count {
                    file.unpack(if float_size == 1 { "4e" } else { "4f" })?;
                }
            }
        }
        file.seek(header.get("animation_names_offset").int() + index * 4)?;
        let name_address = file.u32()?;
        file.seek(name_address)?;
        file.read_name(None)?;
    }
    Ok(Loaded::Json(header.json()))
}

// ----------------------------------------------------------------------------------- BDM ----

const BDM_HEADER: &[&str] = &["endianess_check", "u_06", "num_entries", "data_start"];
const BDM_TYPE0: &str = "HHHHfHHHHHHHHHHHHHHffHHHHHHffffHHHHHHHHHHHHHHhHhhHHHHff";
const BDM_TYPE1: &str = "HHHHfhhhhhHhhhHffHHHHHHffffHHfHHHHHHHHHHHhHhhH";

/// `to_serial` of the pyxenoverse `Type0`/`Type1` sub-entry classes, as written by dbxv2.
fn bdm_type_json(type1: bool) -> Value {
    let record = if type1 { "BDMType1" } else { "BDMType0" };
    let fields: &[&str] = if type1 { BDM_TYPE1_FIELDS } else { BDM_TYPE0_FIELDS };
    let descriptors: Map<String, Value> = fields
        .iter()
        .map(|field| ((*field).to_owned(), Value::String(format!("<member '{field}' of '{record}' objects>"))))
        .collect();
    // `vars(Type0)` also holds the `convert_type1_to_type0` method, serialized as `{}`.
    if type1 {
        json!({ "bac_record": descriptors, "byte_order": BDM_TYPE1, "size": 108 })
    } else {
        json!({
            "bac_record": descriptors,
            "byte_order": BDM_TYPE0,
            "size": 128,
            "convert_type1_to_type0": {},
        })
    }
}

const BDM_TYPE0_FIELDS: &[&str] = &[
    "damage_type", "u_02", "damage_amount", "u_06", "f_08", "sound_type", "sound_id",
    "effect_1_eepk_id", "effect_1_skill_id", "effect_1_skill_type", "u_16", "effect_2_eepk_id",
    "effect_2_skill_id", "effect_2_skill_type", "u_1e", "effect_3_eepk_id", "effect_3_skill_id",
    "effect_3_skill_type", "u_26", "pushback_speed", "pushback_acceleration_percent", "user_stun",
    "victim_stun", "knockback_duration", "knockback_recovery_after_impact_time",
    "knockback_ground_impact_time", "u_3a", "knockback_strength_x", "knockback_strength_y",
    "knockback_strength_z", "knockback_drag_y", "u_4c", "knockback_gravity_time",
    "victim_invincibility_time", "u_52", "transformation_type", "ailment_type", "u_58_1", "u_58_2",
    "u_58_3", "damage_special", "u_60_1", "damage_special2", "stumble_type", "secondary_type",
    "camera_shake_type", "camera_shake_time", "user_screen_flash_transparency",
    "victim_screen_flash_transparency", "stamina_broken_bdm_id_override",
    "time_before_z_vanish_enabled", "user_animation_time", "victim_animation_time",
    "user_animation_speed", "victim_animation_speed",
];

const BDM_TYPE1_FIELDS: &[&str] = &[
    "damage_type", "u_02", "damage_amount", "u_06", "f_08", "sound_type", "sound_id",
    "effect_1_eepk_id", "effect_1_skill_id", "effect_1_skill_type", "u_16", "effect_2_eepk_id",
    "effect_2_skill_id", "effect_2_skill_type", "u_1e", "pushback_speed",
    "pushback_acceleration_percent", "user_stun", "victim_stun", "knockback_duration",
    "knockback_recovery_after_impact_time", "knockback_ground_impact_time", "u_32",
    "knockback_strength_x", "knockback_strength_y", "knockback_strength_z", "knockback_drag_y",
    "u_44", "knockback_gravity_time", "victim_invincibility_time", "u_4a", "transformation_type",
    "ailment_type", "u_50_1", "u_50_2", "u_50_3", "damage_special", "u_58_1", "u_58_2",
    "stumble_type", "secondary_type", "camera_shake_type", "camera_shake_time",
    "user_screen_flash_transparency", "victim_screen_flash_transparency", "u_68",
];

fn bdm(data: &[u8], filename: &str) -> Load<Loaded> {
    if !data.starts_with(b"#BDM") {
        return Ok(Loaded::Skipped);
    }
    let mut file = File::new(data);
    let endian = endian_of(&mut file);
    file.seek(4)?;
    let header = file.record(BDM_HEADER, "HHII")?;
    let read_entries = |file: &mut File<'_>, layout: &str| -> Load<Vec<Value>> {
        file.seek(header.get("data_start").int())?;
        let mut ids = Vec::new();
        for _ in 0..header.get("num_entries").int() {
            let id = file.unpack("I")?[0].json();
            for _ in 0..10 {
                file.unpack(layout)?;
            }
            ids.push(json!({ "id": id }));
        }
        Ok(ids)
    };
    let (entries, type1) = match read_entries(&mut file, BDM_TYPE0) {
        Ok(entries) => (entries, false),
        // Only `struct.error` triggers the Type1 retry; a Type1 failure propagates.
        Err(_) => (read_entries(&mut file, BDM_TYPE1)?, true),
    };
    Ok(Loaded::Json(top(vec![
        ("header", header.json()),
        ("endian", Value::from(endian)),
        ("entries", Value::Array(entries)),
        ("type", bdm_type_json(type1)),
        ("filename", Value::from(filename)),
    ])))
}

// ----------------------------------------------------------------------------------- BCM ----

const BCM_HEADER: &[&str] = &["endianess_check", "u_06", "num_entries", "data_start"];
const BCM_ENTRY: &[&str] = &[
    "address", "u_00", "directional_input", "button_input", "hold_down_conditions",
    "opponent_size_conditions", "minimum_loop_duration", "maximum_loop_duration",
    "primary_activator_conditions", "activator_state", "bac_entry_primary", "bac_entry_charge",
    "u_24", "bac_entry_user_connect", "bac_entry_victim_connect", "bac_entry_airborne",
    "bac_entry_unknown", "random_flag", "sibling", "child", "parent", "root", "ki_cost", "u_44",
    "u_48", "receiver_link_id", "u_50", "stamina_cost", "u_58", "ki_required", "health_required",
    "trans_stage", "cus_aura", "u_68", "u_6a", "u_6c",
];

fn bcm(data: &[u8], filename: &str) -> Load<Loaded> {
    if !data.starts_with(b"#BCM") {
        return Ok(Loaded::Skipped);
    }
    let mut file = File::new(data);
    let endian = endian_of(&mut file);
    file.seek(4)?;
    let header = file.record(BCM_HEADER, "HHII")?;
    file.seek(header.get("data_start").int())?;
    let mut entries = Vec::new();
    for index in 0..header.get("num_entries").int() {
        let address = if index == 0 { 0 } else { file.tell() as i128 };
        let mut values = vec![Py::Int(address)];
        values.extend(file.unpack("IIIIIhhIIHHHHHHHHIIIIIIIIIIIIfhhHHI")?);
        entries.push(Record { fields: BCM_ENTRY, values }.json());
    }
    Ok(Loaded::Json(top(vec![
        ("header", header.json()),
        ("endian", Value::from(endian)),
        ("entries", Value::Array(entries)),
        ("filename", Value::from(filename)),
    ])))
}

// ----------------------------------------------------------------------------------- BSA ----

const BSA_HEADER: &[&str] = &["endianess_check", "header_size", "i_08", "i_12", "i_16", "num_entries", "data_start"];
const BSA_ENTRY: &[&str] = &[
    "i_00", "collision_count", "expiration_count", "collision_offset", "expiration_offset",
    "impact_properties", "i_17", "i_18", "lifetime", "i_24", "expires", "impact_projectile",
    "impact_enemy", "impact_ground", "sub_entry_count", "sub_entry_offset", "i_40", "i_44", "i_48",
];

/// BSA item sizes per sub-entry type; `None` marks the `Collision`/`Expiration` classes, whose
/// constructors reject the item index (a `TypeError` in Python as soon as such a group has items).
fn bsa_item_size(kind: i128) -> Option<Option<usize>> {
    Some(match kind {
        -2 | -1 => None,
        0 => Some(16),
        1 => Some(48),
        2 | 7 | 10 => Some(8),
        3 => Some(64),
        4 => Some(56),
        6 | 8 => Some(24),
        12 => Some(20),
        13 => Some(32),
        _ => return None,
    })
}

fn bsa(data: &[u8], filename: &str) -> Load<Loaded> {
    if !data.starts_with(b"#BSA") {
        return Ok(Loaded::Skipped);
    }
    let mut file = File::new(data);
    let endian = endian_of(&mut file);
    file.seek(4)?;
    let header = file.record(BSA_HEADER, "HHIIHHI")?;
    let offsets: Vec<i128> = (0..header.get("num_entries").int()).map(|_| file.u32()).collect::<Load<_>>()?;
    let mut entries = Vec::new();
    for offset in offsets.into_iter().filter(|offset| *offset != 0) {
        file.seek(offset)?;
        let current = file.tell() as i128;
        let entry = file.record(BSA_ENTRY, "IHHIIBBIHHHHHHHIIII")?;
        file.seek(current + entry.get("collision_offset").int())?;
        for _ in 0..entry.get("collision_count").int() {
            file.unpack("HHIIIII")?;
        }
        file.seek(current + entry.get("expiration_offset").int())?;
        for _ in 0..entry.get("expiration_count").int() {
            file.unpack("HHHH")?;
        }
        file.seek(current + entry.get("sub_entry_offset").int())?;
        let mut sub_entries = Vec::new();
        for _ in 0..entry.get("sub_entry_count").int() {
            let position = file.tell() as i128;
            sub_entries.push((position, file.unpack("HHHHII")?));
        }
        for (position, sub_entry) in sub_entries {
            let kind = sub_entry[0].int();
            let size = bsa_item_size(kind).ok_or_else(|| error(format!("unknown BSA item type {kind}")))?;
            let count = sub_entry[3].int();
            if count == 0 {
                continue;
            }
            let size = size.ok_or_else(|| error("BSA collision/expiration items take no index"))?;
            file.seek(position + sub_entry[5].int())?;
            for _ in 0..count {
                let bytes = file.read(size);
                if bytes.len() != size {
                    return Err(error("short BSA item"));
                }
            }
            file.seek(position + sub_entry[4].int())?;
            for _ in 0..count {
                file.unpack("HH")?;
            }
        }
        entries.push(entry.json());
    }
    Ok(Loaded::Json(top(vec![
        ("header", header.json()),
        ("endian", Value::from(endian)),
        ("entries", Value::Array(entries)),
        ("has_comments", Value::Bool(false)),
        ("filename", Value::from(filename)),
    ])))
}

// ----------------------------------------------------------------------------------- BAC ----

const BAC_HEADER: &[&str] = &[
    "endianess_check", "u_06", "num_entries", "u_0c", "data_start", "u_14", "u_18", "u_1c",
    "f_20", "f_24", "f_28", "f_2c", "f_30", "f_34", "f_38", "f_3c", "f_40", "f_44", "f_48",
    "f_4c", "u_50", "u_54", "u_58", "u_5c",
];
const BAC_ENTRY: &[&str] = &["flags", "num_sub_entries", "unk_06", "sub_entry_offset", "unk_0C"];

/// BAC item sizes per sub-entry type (type 17 grows by 12 bytes unless the file uses the small form).
fn bac_item_size(kind: i128, type17_small: bool) -> Option<usize> {
    Some(match kind {
        0 | 2 | 28 => 36,
        1 | 9 | 23 => 64,
        3 | 4 | 7 | 12 | 13 | 14 => 12,
        5 | 6 | 11 | 19 | 25 => 16,
        8 | 20 | 22 | 30 => 48,
        10 => 76,
        15 | 16 | 18 | 21 => 32,
        17 => {
            if type17_small {
                20
            } else {
                32
            }
        },
        24 => 56,
        26 => 80,
        27 => 24,
        29 => 60,
        _ => return None,
    })
}

fn bac(data: &[u8], filename: &str) -> Load<Loaded> {
    if !data.starts_with(b"#BAC") {
        return Ok(Loaded::Skipped);
    }
    let mut file = File::new(data);
    let endian = endian_of(&mut file);
    file.seek(4)?;
    let header = file.record(BAC_HEADER, "HHIIIIIIffffffffffffIIII")?;
    let mut entries = Vec::new();
    for index in 0..header.get("num_entries").int() {
        file.seek(header.get("data_start").int() + index * 16)?;
        entries.push(file.record(BAC_ENTRY, "IHHII")?);
    }
    let sub_entry_offset = entries
        .iter()
        .map(|entry| entry.get("sub_entry_offset").int())
        .find(|offset| *offset != 0)
        .ok_or_else(|| error("BAC has no sub-entry table (IndexError)"))?;
    let total: i128 = entries.iter().map(|entry| entry.get("num_sub_entries").int()).sum();
    let mut type17_small = false;
    let mut owner = 0usize;
    let mut filled = vec![0i128; entries.len()];
    for index in 0..total {
        file.seek(sub_entry_offset + index * 16)?;
        let sub_entry = file.unpack("HHIII")?;
        let (kind, count, offset) = (sub_entry[0].int(), sub_entry[1].int(), sub_entry[3].int());
        if !type17_small && kind == 17 && count > 0 {
            let size = if index < total - 1 {
                let next = file.unpack("HHIII")?;
                ((next[3].int() - offset) as f64 / count as f64).trunc() as i128
            } else {
                ((data.len() as i128 - offset) as f64 / count as f64).trunc() as i128
            };
            if size == 0x14 {
                type17_small = true;
            }
        }
        for item in 0..count {
            let size = bac_item_size(kind, type17_small)
                .ok_or_else(|| error(format!("unknown BAC item type {kind} (KeyError)")))?;
            file.seek(offset + size as i128 * item)?;
            let base = if kind == 17 { 20 } else { size };
            if file.read(base).len() != base {
                return Err(error("short BAC item"));
            }
            if kind == 17 && !type17_small && file.read(12).len() != 12 {
                return Err(error("short BAC throw displacement"));
            }
        }
        while filled.get(owner).ok_or_else(|| error("BAC sub-entry owner overflow (IndexError)"))?
            >= &entries[owner].get("num_sub_entries").int()
        {
            owner += 1;
            if owner >= entries.len() {
                return Err(error("BAC sub-entry owner overflow (IndexError)"));
            }
        }
        filled[owner] += 1;
    }
    Ok(Loaded::Json(top(vec![
        ("header", header.json()),
        ("endian", Value::from(endian)),
        ("entries", Value::Array(entries.iter().map(Record::json).collect())),
        ("has_comments", Value::Bool(false)),
        ("filename", Value::from(filename)),
    ])))
}

// ----------------------------------------------------------------------------------- BCS ----

const BCS_HEADER: &[&str] = &[
    "endianess_check", "header_size", "u_08", "num_part_sets", "num_part_colors", "num_bodies",
    "num_additional_skeletons", "u_14", "part_sets_table_offset", "part_colors_table_offset",
    "bodies_table_offset", "additional_skeleton_table_offset", "skeleton_table_offset", "race",
    "gender", "u_2e", "f_30", "f_34", "f_38", "f_3c", "f_40", "f_44", "f_48",
];
const BCS_PART_SET: &[&str] = &[
    "u_00", "u_04", "u_08", "u_0c", "u_10", "num_parts", "table_start", "u_1c", "face_base_offset",
    "face_forehead_offset", "eye_base_offset", "nose_offset", "ear_offset", "hair_offset",
    "bust_offset", "pants_offset", "wrists_offset", "boots_offset",
];
const BCS_PART_COLOR: &[&str] = &["name_offset", "u_04", "u_08", "num", "colors_offset"];
const BCS_BODY: &[&str] = &["u_00", "num", "bone_scale_offset"];
const BCS_SKELETON: &[&str] = &["u_00", "num", "bones_offset"];
const BCS_PARTS: [&str; 10] = [
    "face_base_offset", "face_forehead_offset", "eye_base_offset", "nose_offset", "ear_offset",
    "hair_offset", "bust_offset", "pants_offset", "wrists_offset", "boots_offset",
];

fn bcs_names(file: &mut File<'_>, address: i128, offsets: &[i128]) -> Load<()> {
    for offset in offsets.iter().filter(|offset| **offset != 0) {
        file.read_name(Some(address + offset))?;
    }
    Ok(())
}

fn bcs_part(file: &mut File<'_>) -> Load<()> {
    let address = file.tell() as i128;
    let part = file.unpack("HHHHQHHIIIIffII4sIIIIHHIHHI")?;
    decode(&part[15])?;
    bcs_names(file, address, &[part[16].int(), part[17].int(), part[18].int(), part[19].int()])?;
    for index in 0..part[6].int() {
        file.seek(address + part[7].int() + index * 4)?;
        file.unpack("HH")?;
    }
    for index in 0..part[21].int() {
        file.seek(address + part[22].int() + index * 72)?;
        let physics_address = file.tell() as i128;
        let physics = file.unpack("HHHHQIIIII4sIIIIIIQ")?;
        decode(&physics[10])?;
        let offsets: Vec<i128> = physics[11..17].iter().map(Py::int).collect();
        bcs_names(file, physics_address, &offsets)?;
    }
    let unk3_count = part[24].int();
    if unk3_count != 0 {
        file.seek(address + part[25].int())?;
        let mut seen = 0;
        while seen < unk3_count {
            if file.u32()? == 8 {
                seen += 1;
            }
        }
        let mut value = file.u32()?;
        loop {
            let (low, high) = (value & 0xFFFF, value >> 16);
            value = file.u32()?;
            if low != high {
                break;
            }
        }
    }
    Ok(())
}

fn bcs(data: &[u8], filename: &str) -> Load<Loaded> {
    // pyxenoverse's BCS loader never rejects a file: a missing signature only keeps '<'.
    let mut file = File::new(data);
    let mut endian = "<";
    if data.starts_with(b"#BCS") {
        file.seek(4)?;
        if file.read(2) != b"\xFE\xFF" {
            endian = ">";
            file.big_endian = true;
        }
    }
    file.seek(4)?;
    let header = file.record(BCS_HEADER, "HHIHHHHIIIIIIBBHfffffff")?;

    let mut part_sets = Vec::new();
    if header.get("part_sets_table_offset").int() != 0 {
        for index in 0..header.get("num_part_sets").int() {
            file.seek(header.get("part_sets_table_offset").int() + index * 4)?;
            let offset = file.u32()?;
            let mut part_set = Record::zero(BCS_PART_SET);
            if offset != 0 {
                file.seek(offset)?;
                let address = file.tell() as i128;
                part_set = file.record(BCS_PART_SET, "18I")?;
                for name in BCS_PARTS {
                    let part_offset = part_set.get(name).int();
                    if part_offset != 0 {
                        file.seek(address + part_offset)?;
                        bcs_part(&mut file)?;
                    }
                }
            }
            part_sets.push(part_set.json());
        }
    }

    let mut part_colors = Vec::new();
    if header.get("part_colors_table_offset").int() != 0 {
        for index in 0..header.get("num_part_colors").int() {
            file.seek(header.get("part_colors_table_offset").int() + index * 4)?;
            let offset = file.u32()?;
            let mut part_color = Record::zero(BCS_PART_COLOR);
            if offset != 0 {
                file.seek(offset)?;
                let address = file.tell() as i128;
                part_color = file.record(BCS_PART_COLOR, "IIHHI")?;
                if part_color.get("name_offset").int() != 0 {
                    file.read_name(Some(address + part_color.get("name_offset").int()))?;
                }
                file.seek(address + part_color.get("colors_offset").int())?;
                for _ in 0..part_color.get("num").int() {
                    for value in file.unpack("20f")? {
                        // `int(value * 255.0)` raises on NaN and infinities.
                        if let Py::Float(float) = value
                            && !(float * 255.0).is_finite()
                        {
                            return Err(error("non-finite BCS color"));
                        }
                    }
                }
            }
            part_colors.push(part_color.json());
        }
    }

    let mut bodies = Vec::new();
    if header.get("bodies_table_offset").int() != 0 {
        for index in 0..header.get("num_bodies").int() {
            file.seek(header.get("bodies_table_offset").int() + index * 4)?;
            let offset = file.u32()?;
            let mut body = Record::zero(BCS_BODY);
            if offset != 0 {
                file.seek(offset)?;
                let address = file.tell() as i128;
                body = file.record(BCS_BODY, "HHI")?;
                for scale in 0..body.get("num").int() {
                    file.seek(address + body.get("bone_scale_offset").int() + scale * 16)?;
                    let scale_address = file.tell() as i128;
                    let values = file.unpack("fffI")?;
                    if values[3].int() != 0 {
                        file.read_name(Some(scale_address + values[3].int()))?;
                    }
                }
            }
            bodies.push(body.json());
        }
    }

    let mut skeletons = Vec::new();
    let mut read_skeleton = |file: &mut File<'_>, table: i128| -> Load<Option<Value>> {
        file.seek(table)?;
        let offset = file.u32()?;
        if offset == 0 {
            return Ok(None);
        }
        file.seek(offset)?;
        let address = file.tell() as i128;
        let skeleton = file.record(BCS_SKELETON, "HHI")?;
        for bone in 0..skeleton.get("num").int() {
            file.seek(address + skeleton.get("bones_offset").int() + bone * 52)?;
            let bone_address = file.tell() as i128;
            let values = file.unpack("IIIHHHHHHHHHHHHHHHHHHI")?;
            if values[21].int() != 0 {
                file.read_name(Some(bone_address + values[21].int()))?;
            }
        }
        Ok(Some(skeleton.json()))
    };
    if header.get("skeleton_table_offset").int() != 0
        && let Some(skeleton) = read_skeleton(&mut file, header.get("skeleton_table_offset").int())?
    {
        skeletons.push(skeleton);
    }
    if header.get("additional_skeleton_table_offset").int() != 0 {
        for _ in 0..header.get("num_additional_skeletons").int() {
            // pyxenoverse re-reads the first table slot for every additional skeleton.
            match read_skeleton(&mut file, header.get("additional_skeleton_table_offset").int())? {
                Some(skeleton) => skeletons.push(skeleton),
                None => skeletons.push(Record::zero(BCS_SKELETON).json()),
            }
        }
    }

    Ok(Loaded::Json(top(vec![
        ("header", header.json()),
        ("endian", Value::from(endian)),
        ("filename", Value::from(filename)),
        ("part_sets", Value::Array(part_sets)),
        ("part_colors", Value::Array(part_colors)),
        ("bodies", Value::Array(bodies)),
        ("skeletons", Value::Array(skeletons)),
    ])))
}

/// Formats of the parse pass.
pub const FORMATS: [&str; 8] = ["bac", "bcm", "bcs", "bdm", "bsa", "ean", "emm", "esk"];

/// Load one gameplay file the way the dbxv2 `parse` command does; `filename` is the path string
/// the Python loader records in its `filename` attribute.
pub fn load(extension: &str, data: &[u8], filename: &str) -> Option<Load<Loaded>> {
    Some(match extension {
        "bac" => bac(data, filename),
        "bcm" => bcm(data, filename),
        "bcs" => bcs(data, filename),
        "bdm" => bdm(data, filename),
        "bsa" => bsa(data, filename),
        "ean" => ean(data),
        "emm" => emm(data, filename),
        "esk" => esk(data),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::{calcsize, half_to_f64};

    #[test]
    fn struct_sizes_match_python() {
        assert_eq!(calcsize("IIIIIhhIIHHHHHHHHIIIIIIIIIIIIfhhHHI"), 112);
        assert_eq!(calcsize("I HH II BB IH HHHHHHIIII"), 52);
        assert_eq!(calcsize("HHHHQHHIIIIffII4sIIIIHHIHHI"), 88);
        assert_eq!(calcsize("HHIHHHHIIIIIIBBHfffffff"), 72);
        assert_eq!(calcsize(super::BDM_TYPE0), 128);
        assert_eq!(calcsize(super::BDM_TYPE1), 108);
    }

    #[test]
    fn half_floats_decode() {
        assert_eq!(half_to_f64(0x3C00), 1.0);
        assert_eq!(half_to_f64(0xC000), -2.0);
    }
}
