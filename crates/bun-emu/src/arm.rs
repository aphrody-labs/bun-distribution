//! AArch64 firmware machine on the in-tree `rdynarmic` JIT.
//!
//! The board follows QEMU's `virt` map where it matters for firmware: RAM at 0x4000_0000, a
//! PL011 UART at 0x0900_0000. The image is loaded at the base of RAM and entered at its first
//! byte, so U-Boot, UEFI payloads and bare-metal images that target `virt` boot unchanged.

use std::sync::{Arc, Mutex};

use rdynarmic::{
    A64Jit,
    interface::a64::config::{Exception, UserCallbacks, UserConfig, Vector},
};

use crate::{Machine, Screen, Step};

pub const RAM_BASE: u64 = 0x4000_0000;
pub const UART_BASE: u64 = 0x0900_0000;
const UART_FR: u64 = UART_BASE + 0x18;
const TICKS_PER_FRAME: u64 = 1_000_000;

struct Bus {
    ram: Vec<u8>,
    uart: Vec<u8>,
    ticks_left: u64,
    ticks_total: u64,
    stopped: bool,
}

impl Bus {
    fn read(&self, addr: u64, len: usize) -> u64 {
        if addr == UART_FR {
            // TXFE | RXFE: transmitter idle, no input pending.
            return 0x90;
        }
        let Some(off) = addr.checked_sub(RAM_BASE).map(|o| o as usize) else { return 0 };
        match self.ram.get(off..off + len) {
            Some(bytes) => bytes.iter().rev().fold(0, |acc, b| acc << 8 | u64::from(*b)),
            None => 0,
        }
    }

    fn write(&mut self, addr: u64, len: usize, value: u64) {
        if addr == UART_BASE {
            self.uart.push(value as u8);
            return;
        }
        let Some(off) = addr.checked_sub(RAM_BASE).map(|o| o as usize) else { return };
        if let Some(bytes) = self.ram.get_mut(off..off + len) {
            for (i, b) in bytes.iter_mut().enumerate() {
                *b = (value >> (8 * i)) as u8;
            }
        }
    }
}

struct Callbacks(Arc<Mutex<Bus>>);

impl Callbacks {
    fn bus(&self) -> std::sync::MutexGuard<'_, Bus> {
        self.0.lock().expect("bus lock")
    }
}

impl UserCallbacks for Callbacks {
    fn memory_read_8(&self, vaddr: u64) -> u8 {
        self.bus().read(vaddr, 1) as u8
    }
    fn memory_read_16(&self, vaddr: u64) -> u16 {
        self.bus().read(vaddr, 2) as u16
    }
    fn memory_read_32(&self, vaddr: u64) -> u32 {
        self.bus().read(vaddr, 4) as u32
    }
    fn memory_read_64(&self, vaddr: u64) -> u64 {
        self.bus().read(vaddr, 8)
    }
    fn memory_read_128(&self, vaddr: u64) -> Vector {
        let bus = self.bus();
        [bus.read(vaddr, 8), bus.read(vaddr + 8, 8)]
    }

    fn memory_write_8(&mut self, vaddr: u64, value: u8) {
        self.bus().write(vaddr, 1, value.into());
    }
    fn memory_write_16(&mut self, vaddr: u64, value: u16) {
        self.bus().write(vaddr, 2, value.into());
    }
    fn memory_write_32(&mut self, vaddr: u64, value: u32) {
        self.bus().write(vaddr, 4, value.into());
    }
    fn memory_write_64(&mut self, vaddr: u64, value: u64) {
        self.bus().write(vaddr, 8, value);
    }
    fn memory_write_128(&mut self, vaddr: u64, value: Vector) {
        let mut bus = self.bus();
        bus.write(vaddr, 8, value[0]);
        bus.write(vaddr + 8, 8, value[1]);
    }

    fn call_svc(&mut self, _swi: u32) {
        self.stop();
    }

    fn exception_raised(&mut self, _pc: u64, exception: Exception) {
        match exception {
            Exception::Yield | Exception::SendEvent | Exception::SendEventLocal => {}
            _ => self.stop(),
        }
    }

    fn add_ticks(&mut self, ticks: u64) {
        let mut bus = self.bus();
        bus.ticks_left = bus.ticks_left.saturating_sub(ticks);
        bus.ticks_total += ticks;
    }

    fn get_ticks_remaining(&self) -> u64 {
        self.bus().ticks_left
    }

    fn get_cntpct(&self) -> u64 {
        self.bus().ticks_total
    }
}

impl Callbacks {
    /// Stops the guest at the next tick check: wait-for-interrupt, supervisor call or a fault.
    fn stop(&mut self) {
        let mut bus = self.bus();
        bus.stopped = true;
        bus.ticks_left = 0;
    }
}

pub struct ArmFirmware {
    jit: A64Jit,
    bus: Arc<Mutex<Bus>>,
}

impl ArmFirmware {
    pub fn from_image(image: &[u8], ram_mib: usize) -> Result<Self, String> {
        let mut ram = vec![0; ram_mib << 20];
        let Some(dst) = ram.get_mut(..image.len()) else {
            return Err(format!("the image ({} bytes) does not fit in {ram_mib} MiB of RAM", image.len()));
        };
        dst.copy_from_slice(image);
        let bus = Arc::new(Mutex::new(Bus {
            ram,
            uart: Vec::new(),
            ticks_left: 0,
            ticks_total: 0,
            stopped: false,
        }));
        let mut config = UserConfig::new(Box::new(Callbacks(bus.clone())));
        config.hook_hint_instructions = true;
        config.enable_cycle_counting = true;
        let mut jit = A64Jit::new(config)?;
        jit.set_pc(RAM_BASE);
        Ok(Self { jit, bus })
    }

    /// Bytes the guest wrote to the UART since the last call.
    pub fn take_console(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.bus.lock().expect("bus lock").uart)
    }

    pub fn pc(&self) -> u64 {
        self.jit.get_pc()
    }

    pub fn register(&self, index: usize) -> u64 {
        self.jit.get_register(index)
    }
}

impl Machine for ArmFirmware {
    fn name(&self) -> &'static str {
        "aarch64-virt"
    }

    fn run_frame(&mut self) -> Step {
        {
            let mut bus = self.bus.lock().expect("bus lock");
            if bus.stopped {
                return Step::Shutdown;
            }
            bus.ticks_left = TICKS_PER_FRAME;
        }
        self.jit.run();
        if self.bus.lock().expect("bus lock").stopped { Step::Shutdown } else { Step::Frame }
    }

    fn screens(&self) -> Vec<Screen> {
        Vec::new()
    }

    fn console(&mut self) -> Vec<u8> {
        self.take_console()
    }
}
