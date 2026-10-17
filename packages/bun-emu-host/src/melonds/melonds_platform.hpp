#pragma once

namespace bun::emu {
class Host;

// Glue between melonDS::Platform (process-global free functions) and the
// bun_emu instances that own melonDS::NDS objects.
namespace melonds_platform {
void attach(Host& host, void* core);
void detach(void* core);
// Implemented by the core: NDS::Stop forwarded through Platform::SignalStop.
void signal_stop(void* core, int reason);
}  // namespace melonds_platform
}  // namespace bun::emu
