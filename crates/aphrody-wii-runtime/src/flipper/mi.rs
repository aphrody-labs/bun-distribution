pub mod regs;

#[derive(Clone, Copy)]
pub struct MemoryInterface {
    pub interrupt_mask: regs::MiInterruptMask,
}

impl Default for MemoryInterface {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryInterface {
    pub fn new() -> Self {
        Self {
            interrupt_mask: regs::MiInterruptMask::from_raw(0),
        }
    }
}

crate::mmio_device_dispatch! {
    read = mi_read,
    write = mi_write,
    registers = [
        regs::MiInterruptMask,
    ],
}
