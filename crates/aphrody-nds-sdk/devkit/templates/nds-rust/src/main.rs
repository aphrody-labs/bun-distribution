//! Rust Nintendo DS homebrew on BlocksDS libnds: text on the bottom screen and the key state.
#![no_std]
#![no_main]

use aphrody_nds_sys::{irq, key, keysHeld, scanKeys, swiWaitForVBlank, irqInit, irqEnable, consoleDemoInit, printf};

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    loop {}
}

#[unsafe(no_mangle)]
pub extern "C" fn main() -> i32 {
    unsafe {
        irqInit();
        irqEnable(irq::VBLANK);
        consoleDemoInit();
        printf(c"Hello from Rust on the DS\n".as_ptr());
        loop {
            scanKeys();
            let held = keysHeld();
            if held & key::START != 0 {
                printf(c"START held\n".as_ptr());
            }
            swiWaitForVBlank();
        }
    }
}
