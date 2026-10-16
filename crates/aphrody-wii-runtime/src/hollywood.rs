pub mod compat;
pub mod gpio;
pub mod ipc;
pub mod irq;
pub mod regs;

#[derive(Clone, Copy)]
pub struct Hollywood {
    pub compat: compat::Compat,
    pub gpio: gpio::Gpio,
    pub ipc: ipc::Ipc,
    pub irq: irq::Irq,
}

impl Default for Hollywood {
    fn default() -> Self {
        Self::new()
    }
}

impl Hollywood {
    pub fn new() -> Self {
        Hollywood {
            compat: compat::Compat::new(),
            gpio: gpio::Gpio::new(),
            ipc: ipc::Ipc::new(),
            irq: irq::Irq::new(),
        }
    }
}
