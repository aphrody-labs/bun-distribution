//! ViGEmBus virtual Xbox 360 controller backend.
use serde_json::Value;
#[cfg(windows)]
use serde_json::json;

#[cfg(windows)]
mod native {
    use std::{
        sync::{Mutex, OnceLock},
        thread,
        time::Duration,
    };

    use vigem_rust::{Client, Ready, TargetHandle, X360Button, X360Report, Xbox360};

    use super::*;
    struct State {
        client: Option<Client>,
        pads: [Option<TargetHandle<Xbox360, Ready>>; 8],
    }
    impl Default for State {
        fn default() -> Self {
            Self {
                client: None,
                pads: std::array::from_fn(|_| None),
            }
        }
    }
    static STATE: OnceLock<Mutex<State>> = OnceLock::new();
    fn state() -> &'static Mutex<State> {
        STATE.get_or_init(|| Mutex::new(State::default()))
    }
    fn slot(value: i64, tool: &str) -> Result<usize, String> {
        usize::try_from(value)
            .ok()
            .filter(|n| *n < 8)
            .ok_or_else(|| format!("{tool} slot must be in [0, 7]"))
    }
    fn err(prefix: &str, error: impl std::fmt::Display) -> String {
        format!("{prefix}: {error}")
    }
    pub fn create(slot_index: i64) -> Result<Value, String> {
        let index = slot(slot_index, "gamepad_create_xbox360")?;
        let mut guard = state()
            .lock()
            .map_err(|_| "gamepad state poisoned".to_owned())?;
        if guard.pads[index].is_some() {
            return Err(format!("slot {index} already active; destroy it first"));
        }
        let client =
            guard.client.clone().map(Ok).unwrap_or_else(|| {
                Client::connect().map_err(|e| err("ViGEmBus connect failed", e))
            })?;
        guard.client = Some(client.clone());
        let pad = client
            .new_x360_target()
            .plug()
            .map_err(|e| err("ViGEm target plug failed", e))?
            .wait_for_ready()
            .map_err(|e| err("ViGEm target ready failed", e))?;
        guard.pads[index] = Some(pad);
        Ok(json!({"success":true,"slot":index,"vendorId":"045e","productId":"028e"}))
    }
    #[allow(
        clippy::too_many_arguments,
        reason = "Preserve the published gamepad API compatibility"
    )]
    pub fn send_state(
        slot_value: i64,
        buttons: i64,
        lx: i64,
        ly: i64,
        rx: i64,
        ry: i64,
        lt: i64,
        rt: i64,
    ) -> Result<Value, String> {
        let index = slot(slot_value, "gamepad_send_xbox360_state")?;
        let report = X360Report {
            buttons: X360Button::from_bits_retain(
                u16::try_from(buttons).map_err(|_| "buttons out of range [0, 65535]")?,
            ),
            thumb_lx: i16::try_from(lx).map_err(|_| "lx out of range")?,
            thumb_ly: i16::try_from(ly).map_err(|_| "ly out of range")?,
            thumb_rx: i16::try_from(rx).map_err(|_| "rx out of range")?,
            thumb_ry: i16::try_from(ry).map_err(|_| "ry out of range")?,
            left_trigger: u8::try_from(lt).map_err(|_| "lt out of range")?,
            right_trigger: u8::try_from(rt).map_err(|_| "rt out of range")?,
        };
        let pad = state()
            .lock()
            .map_err(|_| "gamepad state poisoned".to_owned())?
            .pads[index]
            .clone()
            .ok_or_else(|| format!("slot {index} not active"))?;
        pad.update(&report)
            .map_err(|e| err("ViGEm Xbox 360 update failed", e))?;
        Ok(
            json!({"success":true,"slot":index,"buttons":buttons,"lx":lx,"ly":ly,"rx":rx,"ry":ry,"lt":lt,"rt":rt}),
        )
    }
    pub fn press_button(slot: i64, mask: i64, hold_ms: i64) -> Result<Value, String> {
        let hold = hold_ms.clamp(1, 5000);
        send_state(slot, mask, 0, 0, 0, 0, 0, 0)?;
        thread::sleep(Duration::from_millis(hold as u64));
        send_state(slot, 0, 0, 0, 0, 0, 0, 0)?;
        Ok(json!({"success":true,"slot":slot,"buttonMask":mask,"holdMs":hold}))
    }
    pub fn destroy(slot_value: i64) -> Result<Value, String> {
        let index = slot(slot_value, "gamepad_destroy")?;
        let pad = state()
            .lock()
            .map_err(|_| "gamepad state poisoned".to_owned())?
            .pads[index]
            .take();
        if let Some(pad) = pad {
            pad.unplug().map_err(|e| err("ViGEm unplug failed", e))?;
            Ok(json!({"success":true,"slot":index}))
        } else {
            Ok(json!({"success":true,"slot":index,"note":"slot was not active"}))
        }
    }
    pub fn destroy_all() -> Result<Value, String> {
        let pads: [Option<TargetHandle<Xbox360, Ready>>; 8] = {
            let mut guard = state()
                .lock()
                .map_err(|_| "gamepad state poisoned".to_owned())?;
            std::array::from_fn(|i| guard.pads[i].take())
        };
        let mut destroyed = 0;
        for pad in pads.into_iter().flatten() {
            pad.unplug().map_err(|e| err("ViGEm unplug failed", e))?;
            destroyed += 1;
        }
        Ok(json!({"success":true,"destroyedSlots":destroyed}))
    }
}

#[cfg(not(windows))]
mod native {
    use super::*;
    fn unsupported() -> Result<Value, String> {
        Err("gamepad tools are Windows-only".into())
    }
    pub fn create(_: i64) -> Result<Value, String> {
        unsupported()
    }
    #[allow(
        clippy::too_many_arguments,
        reason = "Preserve the published gamepad API compatibility"
    )]
    pub fn send_state(
        _: i64,
        _: i64,
        _: i64,
        _: i64,
        _: i64,
        _: i64,
        _: i64,
        _: i64,
    ) -> Result<Value, String> {
        unsupported()
    }
    pub fn press_button(_: i64, _: i64, _: i64) -> Result<Value, String> {
        unsupported()
    }
    pub fn destroy(_: i64) -> Result<Value, String> {
        unsupported()
    }
    pub fn destroy_all() -> Result<Value, String> {
        unsupported()
    }
}
pub use native::{create, destroy, destroy_all, press_button, send_state};
