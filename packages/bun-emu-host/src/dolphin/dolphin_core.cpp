// Dolphin core plugin: boots GameCube/Wii content through Dolphin's own
// BootManager (as DolphinNoGUI does), runs the CPU in single-core mode and
// advances exactly one VI field per bun_emu_run_frame by breaking the CPU at
// the end of each field. The screen is the external framebuffer the emulated
// Video Interface scans out of main RAM (XFB copies are forced to RAM), so it
// is CPU-readable with every video backend.
//
// Config keys (set before load_content):
//   video_backend  "Software Renderer" (default), "Vulkan", "D3D", "D3D12", "OGL", "Null"
//   cpu_core       "interpreter" (default, deterministic), "cached", "jit"
//   frame_timeout_ms  per-field wall-clock limit (default 30000)
//   wii            "1" boots DOL/ELF content as Wii software
#include "../host/core.hpp"

#include "Common/CommonTypes.h"
#include "Common/Config/Config.h"
#include "Common/HookableEvent.h"
#include "Common/Logging/Log.h"
#include "Common/Logging/LogManager.h"
#include "Common/WindowSystemInfo.h"
#include "AudioCommon/Mixer.h"
#include "AudioCommon/SoundStream.h"
#include "Core/Boot/Boot.h"
#include "Core/BootManager.h"
#include "Core/Config/GraphicsSettings.h"
#include "Core/Config/MainSettings.h"
#include "Core/Core.h"
#include "Core/HW/CPU.h"
#include "Core/HW/GCPad.h"
#include "Core/HW/GCPadEmu.h"
#include "Core/HW/HW.h"
#include "Core/HW/Memmap.h"
#include "Core/HW/MMIO.h"
#include "Core/HW/Wiimote.h"
#include "Core/HW/WiimoteEmu/WiimoteEmu.h"
#include "Core/Host.h"
#include "Core/Movie.h"
#include "Core/PowerPC/PowerPC.h"
#include "Core/System.h"
#include "Common/ChunkFile.h"
#include "InputCommon/ControllerEmu/ControllerEmu.h"
#include "InputCommon/InputConfig.h"
#include "UICommon/UICommon.h"
#include "VideoCommon/VideoBackendBase.h"
#include "VideoCommon/VideoEvents.h"

#ifdef _WIN32
#include <Windows.h>
#endif

#include <algorithm>
#include <array>
#include <map>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <thread>

namespace bun::emu {
namespace {

std::atomic<bool> g_instance_alive{false};
Host* g_log_host = nullptr;

// Dolphin log lines -> host log; OSReport lines -> guest console.
class HostLogListener final : public Common::Log::LogListener {
 public:
  void Log(Common::Log::LogLevel level, const char* msg) override {
    Host* host = g_log_host;
    if (!host || !msg) return;
    std::string_view text(msg);
    if (text.find("[OSREPORT") != std::string_view::npos) {
      // "<time> <file>:<line> N[OSREPORT]: text" -> "text"
      auto colon = text.find("]: ");
      host->console(colon == std::string_view::npos ? text : text.substr(colon + 3));
    }
    int32_t mapped = level == Common::Log::LogLevel::LERROR     ? BUN_EMU_LOG_ERROR
                     : level == Common::Log::LogLevel::LWARNING ? BUN_EMU_LOG_WARN
                     : level == Common::Log::LogLevel::LDEBUG   ? BUN_EMU_LOG_DEBUG
                                                                : BUN_EMU_LOG_INFO;
    host->log(mapped, text);
  }
};

#ifdef _WIN32
// The software renderer presents through WGL, which needs a window: an
// invisible one is enough and nothing is ever shown.
HWND create_hidden_window() {
  static const wchar_t* cls = L"BunEmuHostDolphin";
  static std::once_flag once;
  std::call_once(once, [] {
    WNDCLASSEXW wc{};
    wc.cbSize = sizeof wc;
    wc.style = CS_OWNDC;
    wc.lpfnWndProc = DefWindowProcW;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = cls;
    RegisterClassExW(&wc);
  });
  return CreateWindowExW(0, cls, L"bun-emu-host", WS_OVERLAPPEDWINDOW, 0, 0, 640, 528, nullptr, nullptr,
                         GetModuleHandleW(nullptr), nullptr);
}
#endif

class DolphinCore final : public Core {
 public:
  explicit DolphinCore(Host& host) : Core(host) {
    if (g_instance_alive.exchange(true))
      fail(BUN_EMU_E_STATE, "Dolphin keeps process-wide state: one instance per process");
    g_log_host = &host;
  }

  ~DolphinCore() override {
    shutdown();
    g_log_host = nullptr;
    g_instance_alive = false;
  }

  void load_firmware(std::string_view kind, std::span<const uint8_t> data) override {
    // GameCube IPL (BIOS) dumps go to the user directory where Dolphin looks
    // for them; without one, Dolphin's high-level BS2 boots content directly.
    if (kind != "gc_ipl_ntsc" && kind != "gc_ipl_pal" && kind != "gc_ipl_jap")
      fail(BUN_EMU_E_UNSUPPORTED, "unknown Dolphin firmware kind " + std::string(kind));
    const char* region = kind == "gc_ipl_ntsc" ? "USA" : kind == "gc_ipl_pal" ? "EUR" : "JAP";
    ipl_[region].assign(data.begin(), data.end());
  }

  void load_content(const std::string& name, std::vector<uint8_t> data, const std::string& path) override {
    shutdown();
    content_path_ = path;
    if (content_path_.empty()) {
      // Dolphin boots from files: stage in-memory content in the user directory.
      content_path_ = host_.user_dir() + "/" + name;
      std::ofstream(content_path_, std::ios::binary).write(reinterpret_cast<const char*>(data.data()),
                                                           static_cast<std::streamsize>(data.size()));
    }
    boot();
  }

  void reset() override {
    shutdown();
    boot();
  }

  int32_t run_frame() override {
    if (!booted_) return BUN_EMU_STOPPED;
    auto& system = ::Core::System::GetInstance();
    if (::Core::GetState(system) == ::Core::State::Uninitialized) return BUN_EMU_STOPPED;
    uint64_t target;
    {
      std::lock_guard lock(field_mutex_);
      target = fields_ + 1;
      target_ = target;
    }
    system.GetCPU().SetStepping(false);
    if (!wait_for_field(target)) return BUN_EMU_STOPPED;
    ::Core::HostDispatchJobs(system);
    capture();
    pull_audio();
    return BUN_EMU_FRAME;
  }

  uint32_t screen_count() const override { return 1; }

  std::optional<Screen> screen(uint32_t index) const override {
    if (index != 0 || frame_.empty()) return std::nullopt;
    return Screen{width_, height_, width_ * 4, BUN_EMU_PIXEL_RGBX8888, frame_.data()};
  }

  uint32_t audio_rate() const override { return audio_rate_; }

  size_t audio(int16_t* out, size_t max_frames) override {
    size_t n = std::min(max_frames, audio_.size() / 2);
    std::memcpy(out, audio_.data(), n * 4);
    audio_.erase(audio_.begin(), audio_.begin() + static_cast<std::ptrdiff_t>(n * 2));
    return n;
  }

  void set_buttons(uint32_t port, uint64_t buttons) override {
    if (port < 4) buttons_[port] = buttons;
  }

  void set_analog(uint32_t port, uint32_t axis, int32_t value) override {
    if (port < 4 && axis < 6) analog_[port][axis] = value;
  }

  std::vector<uint8_t> save_state() override {
    require_booted();
    auto& system = ::Core::System::GetInstance();
    const ::Core::CPUThreadGuard guard(system);
    std::vector<uint8_t> buffer(64u << 20);
    for (;;) {
      u8* ptr = buffer.data();
      PointerWrap p(&ptr, buffer.size(), PointerWrap::Mode::Write);
      do_state(system, p);
      const size_t used = static_cast<size_t>(ptr - buffer.data());
      if (p.IsWriteMode()) {
        buffer.resize(used);
        return buffer;
      }
      if (used <= buffer.size()) fail(BUN_EMU_E_CORE, "Dolphin failed to serialize its state");
      buffer.resize(used);
    }
  }

  void load_state(std::span<const uint8_t> data) override {
    require_booted();
    auto& system = ::Core::System::GetInstance();
    const ::Core::CPUThreadGuard guard(system);
    std::vector<uint8_t> copy(data.begin(), data.end());
    u8* ptr = copy.data();
    PointerWrap p(&ptr, copy.size(), PointerWrap::Mode::Read);
    do_state(system, p);
    if (!p.IsReadMode()) fail(BUN_EMU_E_INVALID, "Dolphin rejected the savestate");
    capture();
  }

  void read_memory(uint64_t address, std::span<uint8_t> out) override {
    require_booted();
    auto& system = ::Core::System::GetInstance();
    const ::Core::CPUThreadGuard guard(system);
    // Physical address space (MEM1 at 0, MEM2 at 0x10000000); 0x80000000/0xC0000000 mirrors.
    u32 phys = static_cast<u32>(address) & 0x3FFFFFFF;
    auto& memory = system.GetMemory();
    if (!memory.GetPointerForRange(phys, out.size())) fail(BUN_EMU_E_INVALID, "address outside guest RAM");
    memory.CopyFromEmu(out.data(), phys, out.size());
  }

 private:
  void require_booted() const {
    if (!booted_) fail(BUN_EMU_E_STATE, "no content loaded");
  }

  // Mirrors State::DoState (Core/State.cpp) without the movie/achievement
  // bookkeeping that only applies to UI-driven savestates.
  static void do_state(::Core::System& system, PointerWrap& p) {
    auto& memory = system.GetMemory();
    u32 mem1 = memory.GetRamSizeReal();
    u32 mem2 = memory.GetExRamSizeReal();
    p.Do(mem1);
    p.Do(mem2);
    if (mem1 != memory.GetRamSizeReal() || mem2 != memory.GetExRamSizeReal()) {
      p.SetMeasureMode();
      return;
    }
    g_video_backend->DoState(p);
    p.DoMarker("video_backend");
    system.GetCoreTiming().DoState(p);
    p.DoMarker("CoreTiming");
    HW::DoState(system, p);
    p.DoMarker("HW");
    system.GetPowerPC().DoState(p);
    p.DoMarker("PowerPC");
  }

  void configure() {
    const std::string backend = host_.config_or("video_backend", "Software Renderer");
    const std::string cpu = host_.config_or("cpu_core", "interpreter");
    Config::SetBase(Config::MAIN_GFX_BACKEND, backend);
    Config::SetBase(Config::MAIN_CPU_CORE, cpu == "jit"      ? PowerPC::DefaultCPUCore()
                                           : cpu == "cached" ? PowerPC::CPUCore::CachedInterpreter
                                                             : PowerPC::CPUCore::Interpreter);
    Config::SetBase(Config::MAIN_CPU_THREAD, false);  // single core: GPU work on the CPU thread
    Config::SetBase(Config::MAIN_DSP_HLE, true);
    Config::SetBase(Config::MAIN_SKIP_IPL, ipl_.empty());
    Config::SetBase(Config::MAIN_AUDIO_BACKEND, std::string("No Audio Output"));
    Config::SetBase(Config::MAIN_EMULATION_SPEED, 0.0f);  // unthrottled
    Config::SetBase(Config::MAIN_INPUT_BACKGROUND_INPUT, true);
    Config::SetBase(Config::MAIN_USE_PANIC_HANDLERS, false);
    Config::SetBase(Config::MAIN_OSD_MESSAGES, false);
    Config::SetBase(Config::MAIN_ENABLE_CHEATS, false);
    // XFB copies must reach emulated RAM: the VI scans them out from there.
    Config::SetBase(Config::GFX_HACK_SKIP_XFB_COPY_TO_RAM, false);
    Config::SetBase(Config::GFX_HACK_SKIP_EFB_COPY_TO_RAM, false);
    Config::SetBase(Config::GFX_HACK_DEFER_EFB_COPIES, false);
    Config::SetBase(Config::GFX_HACK_IMMEDIATE_XFB, false);
    Config::SetBase(Config::GFX_WAIT_FOR_SHADERS_BEFORE_STARTING, true);
  }

  void install_input_overrides() {
    for (int port = 0; port < 4; ++port) {
      Pad::GetConfig()->GetController(port)->SetInputOverrideFunction(
          [this, port](std::string_view group, std::string_view control,
                       ControlState) -> std::optional<ControlState> { return gc_override(port, group, control); });
      Wiimote::GetConfig()->GetController(port)->SetInputOverrideFunction(
          [this, port](std::string_view group, std::string_view control,
                       ControlState) -> std::optional<ControlState> { return wii_override(port, group, control); });
    }
  }

  std::optional<ControlState> gc_override(int port, std::string_view group, std::string_view control) const {
    const uint64_t b = buttons_[port].load();
    auto bit = [&](uint64_t mask) -> std::optional<ControlState> { return (b & mask) ? 1.0 : 0.0; };
    auto axis = [&](uint32_t a, bool invert) -> std::optional<ControlState> {
      double v = analog_[port][a].load() / 32767.0;
      return std::clamp(invert ? -v : v, -1.0, 1.0);
    };
    if (group == GCPad::BUTTONS_GROUP) {
      if (control == GCPad::A_BUTTON) return bit(BUN_EMU_BTN_A);
      if (control == GCPad::B_BUTTON) return bit(BUN_EMU_BTN_B);
      if (control == GCPad::X_BUTTON) return bit(BUN_EMU_BTN_X);
      if (control == GCPad::Y_BUTTON) return bit(BUN_EMU_BTN_Y);
      if (control == GCPad::Z_BUTTON) return bit(BUN_EMU_BTN_Z);
      if (control == GCPad::START_BUTTON) return bit(BUN_EMU_BTN_START);
    } else if (group == GCPad::DPAD_GROUP) {
      if (control == DIRECTION_UP) return bit(BUN_EMU_BTN_UP);
      if (control == DIRECTION_DOWN) return bit(BUN_EMU_BTN_DOWN);
      if (control == DIRECTION_LEFT) return bit(BUN_EMU_BTN_LEFT);
      if (control == DIRECTION_RIGHT) return bit(BUN_EMU_BTN_RIGHT);
    } else if (group == GCPad::TRIGGERS_GROUP) {
      if (control == GCPad::L_DIGITAL) return bit(BUN_EMU_BTN_L);
      if (control == GCPad::R_DIGITAL) return bit(BUN_EMU_BTN_R);
      if (control == GCPad::L_ANALOG) return (b & BUN_EMU_BTN_L) ? 1.0 : analog_[port][BUN_EMU_AXIS_LT] / 32767.0;
      if (control == GCPad::R_ANALOG) return (b & BUN_EMU_BTN_R) ? 1.0 : analog_[port][BUN_EMU_AXIS_RT] / 32767.0;
    } else if (group == GCPad::MAIN_STICK_GROUP) {
      if (control == "X") return axis(BUN_EMU_AXIS_LX, false);
      if (control == "Y") return axis(BUN_EMU_AXIS_LY, true);
    } else if (group == GCPad::C_STICK_GROUP) {
      if (control == "X") return axis(BUN_EMU_AXIS_RX, false);
      if (control == "Y") return axis(BUN_EMU_AXIS_RY, true);
    }
    return std::nullopt;
  }

  std::optional<ControlState> wii_override(int port, std::string_view group, std::string_view control) const {
    using WiimoteEmu::Wiimote;
    const uint64_t b = buttons_[port].load();
    auto bit = [&](uint64_t mask) -> std::optional<ControlState> { return (b & mask) ? 1.0 : 0.0; };
    if (group == Wiimote::BUTTONS_GROUP) {
      if (control == Wiimote::A_BUTTON) return bit(BUN_EMU_BTN_A);
      if (control == Wiimote::B_BUTTON) return bit(BUN_EMU_BTN_B);
      if (control == Wiimote::ONE_BUTTON) return bit(BUN_EMU_BTN_X);
      if (control == Wiimote::TWO_BUTTON) return bit(BUN_EMU_BTN_Y);
      if (control == Wiimote::PLUS_BUTTON) return bit(BUN_EMU_BTN_START);
      if (control == Wiimote::MINUS_BUTTON) return bit(BUN_EMU_BTN_SELECT);
      if (control == Wiimote::HOME_BUTTON) return bit(BUN_EMU_BTN_HOME);
    } else if (group == Wiimote::DPAD_GROUP) {
      if (control == DIRECTION_UP) return bit(BUN_EMU_BTN_UP);
      if (control == DIRECTION_DOWN) return bit(BUN_EMU_BTN_DOWN);
      if (control == DIRECTION_LEFT) return bit(BUN_EMU_BTN_LEFT);
      if (control == DIRECTION_RIGHT) return bit(BUN_EMU_BTN_RIGHT);
    }
    return std::nullopt;
  }

  void boot() {
    auto& system = ::Core::System::GetInstance();
    if (!ui_ready_) {
      UICommon::SetUserDirectory(host_.user_dir() + "/dolphin");
      UICommon::CreateDirectories();
      UICommon::Init();
      auto* logs = Common::Log::LogManager::GetInstance();
      logs->RegisterListener(Common::Log::LogListener::LOG_WINDOW_LISTENER, std::make_unique<HostLogListener>());
      logs->EnableListener(Common::Log::LogListener::LOG_WINDOW_LISTENER, true);
      logs->EnableListener(Common::Log::LogListener::CONSOLE_LISTENER, false);
      logs->SetEnable(Common::Log::LogType::OSREPORT, true);
      logs->SetEnable(Common::Log::LogType::OSREPORT_HLE, true);
      logs->SetEnable(Common::Log::LogType::BOOT, true);
      logs->SetEnable(Common::Log::LogType::CORE, true);
      logs->SetConfigLogLevel(host_.config_flag("verbose", false) ? Common::Log::LogLevel::LINFO
                                                                    : Common::Log::LogLevel::LNOTICE);
      ui_ready_ = true;
    }
    configure();
    for (auto& [region, image] : ipl_) {
      auto ipl_dir = std::filesystem::path(host_.user_dir()) / "dolphin" / "GC" / region;
      std::filesystem::create_directories(ipl_dir);
      std::ofstream(ipl_dir / "IPL.bin", std::ios::binary)
          .write(reinterpret_cast<const char*>(image.data()), static_cast<std::streamsize>(image.size()));
    }

    wsi_ = WindowSystemInfo{};
#ifdef _WIN32
    if (Config::Get(Config::MAIN_GFX_BACKEND) == "Software Renderer" ||
        Config::Get(Config::MAIN_GFX_BACKEND) == "OGL") {
      if (!window_) window_ = create_hidden_window();
      wsi_ = WindowSystemInfo(WindowSystemType::Windows, nullptr, window_, window_);
    }
#endif
    if (!controllers_ready_) {
      UICommon::InitControllers(wsi_);
      install_input_overrides();
      controllers_ready_ = true;
    }

    {
      std::lock_guard lock(field_mutex_);
      fields_ = 0;
      target_ = 1;  // break at the end of the first field
    }
    field_hook_ = system.GetVideoEvents().vi_end_field_event.Register([this] { on_field(); });

    auto params = BootParameters::GenerateFromFile(content_path_);
    if (!params) fail(BUN_EMU_E_INVALID, "Dolphin cannot boot " + content_path_);
    if (!BootManager::BootCore(system, std::move(params), wsi_))
      fail(BUN_EMU_E_CORE, "Dolphin failed to boot " + content_path_);
    booted_ = true;
    if (!wait_for_field(1)) fail(BUN_EMU_E_CORE, "Dolphin stopped before its first video field");
    audio_rate_ = system.GetSoundStream() ? system.GetSoundStream()->GetMixer()->GetSampleRate() : 0;
    capture();
  }

  // CPU thread, end of every VI field.
  void on_field() {
    std::lock_guard lock(field_mutex_);
    ++fields_;
    if (fields_ >= target_) {
      ::Core::System::GetInstance().GetCPU().Break();
      field_cv_.notify_all();
    }
  }

  bool wait_for_field(uint64_t target) {
    auto& system = ::Core::System::GetInstance();
    const auto timeout = std::chrono::milliseconds(host_.config_int("frame_timeout_ms", 30000));
    const auto deadline = std::chrono::steady_clock::now() + timeout;
    {
      std::unique_lock lock(field_mutex_);
      while (fields_ < target) {
        if (::Core::GetState(system) == ::Core::State::Uninitialized) return false;
        ::Core::HostDispatchJobs(system);
        if (std::chrono::steady_clock::now() > deadline)
          fail(BUN_EMU_E_CORE, "Dolphin did not reach the next video field in time");
        field_cv_.wait_for(lock, std::chrono::milliseconds(5));
      }
    }
    // Break() is asynchronous: wait for the CPU thread to park.
    while (!system.GetCPU().IsStepping()) {
      if (::Core::GetState(system) == ::Core::State::Uninitialized) return false;
      if (std::chrono::steady_clock::now() > deadline) fail(BUN_EMU_E_CORE, "Dolphin CPU did not pause");
      std::this_thread::yield();
    }
    return true;
  }

  u16 vi_reg(::Core::System& system, u32 offset) {
    return system.GetMemory().GetMMIOMapping()->Read<u16>(system, 0x0C002000 | offset);
  }

  // Scan the external framebuffer out of RAM like the VI does (Dolphin's
  // VideoInterfaceManager::OutputField with "force progressive").
  void capture() {
    auto& system = ::Core::System::GetInstance();
    const ::Core::CPUThreadGuard guard(system);
    const u16 vtr = vi_reg(system, 0x00);
    const u16 picture = vi_reg(system, 0x48);
    const u32 top = (u32(vi_reg(system, 0x1c)) << 16) | vi_reg(system, 0x1e);
    u32 wpl = (picture >> 8) & 0x7F;
    u32 std_words = picture & 0xFF;
    u32 lines = (vtr >> 4) & 0x3FF;
    u32 addr = top & 0xFFFFFF;
    if (top & (1u << 28)) addr <<= 5;  // POFF
    if (!addr || !wpl || !lines) {
      // The VI is not programmed (no IPL ran): scan the preset NTSC geometry
      // at physical 0, the convention of bun-engine's own GameCube machine.
      wpl = 40;
      std_words = 40;
      lines = 480;
      addr = 0;
    } else if (std_words == 2 * wpl) {
      std_words = wpl;  // interlaced XFB holding both fields: show the full frame
      lines *= 2;
    }
    width_ = wpl * 16;
    height_ = lines;
    const u32 stride = std_words * 32;
    std::vector<uint8_t> yuyv(static_cast<size_t>(stride) * height_);
    auto& memory = system.GetMemory();
    if (memory.GetPointerForRange(addr, yuyv.size())) memory.CopyFromEmu(yuyv.data(), addr, yuyv.size());
    frame_.assign(static_cast<size_t>(width_) * height_ * 4, 0);
    for (u32 y = 0; y < height_; ++y) {
      const uint8_t* row = yuyv.data() + static_cast<size_t>(y) * stride;
      uint8_t* out = frame_.data() + static_cast<size_t>(y) * width_ * 4;
      for (u32 x = 0; x + 1 < width_; x += 2) {
        const float y0 = row[x * 2] - 16.0f, cb = row[x * 2 + 1] - 128.0f;
        const float y1 = row[x * 2 + 2] - 16.0f, cr = row[x * 2 + 3] - 128.0f;
        for (int i = 0; i < 2; ++i) {
          const float yy = i ? y1 : y0;
          auto clamp8 = [](float v) { return static_cast<uint8_t>(std::clamp(v, 0.0f, 255.0f)); };
          uint8_t* px = out + (x + i) * 4;
          px[0] = clamp8(1.164f * yy + 1.596f * cr);
          px[1] = clamp8(1.164f * yy - 0.813f * cr - 0.391f * cb);
          px[2] = clamp8(1.164f * yy + 2.018f * cb);
          px[3] = 0xFF;
        }
      }
    }
  }

  void pull_audio() {
    auto& system = ::Core::System::GetInstance();
    auto* stream = system.GetSoundStream();
    if (!stream) return;
    std::array<s16, 4096 * 2> buf{};
    for (;;) {
      const size_t n = stream->GetMixer()->Mix(buf.data(), 4096);
      audio_.insert(audio_.end(), buf.begin(), buf.begin() + static_cast<std::ptrdiff_t>(n * 2));
      if (n < 4096) break;
    }
    const size_t max = static_cast<size_t>(audio_rate_ ? audio_rate_ : 48000) * 4;
    if (audio_.size() > max) audio_.erase(audio_.begin(), audio_.end() - static_cast<std::ptrdiff_t>(max));
  }

  void shutdown() {
    if (!booted_) return;
    auto& system = ::Core::System::GetInstance();
    ::Core::Stop(system);
    while (::Core::GetState(system) != ::Core::State::Uninitialized) {
      ::Core::HostDispatchJobs(system);
      std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    ::Core::Shutdown(system);
    field_hook_.reset();
    booted_ = false;
  }

  std::string content_path_;
  std::map<std::string, std::vector<uint8_t>> ipl_;
  bool ui_ready_ = false;
  bool controllers_ready_ = false;
  bool booted_ = false;
  WindowSystemInfo wsi_;
#ifdef _WIN32
  HWND window_ = nullptr;
#endif
  Common::EventHook field_hook_;
  std::mutex field_mutex_;
  std::condition_variable field_cv_;
  uint64_t fields_ = 0;
  uint64_t target_ = 1;
  std::array<std::atomic<uint64_t>, 4> buttons_{};
  std::array<std::array<std::atomic<int32_t>, 6>, 4> analog_{};
  uint32_t width_ = 0;
  uint32_t height_ = 0;
  std::vector<uint8_t> frame_;
  std::vector<int16_t> audio_;
  uint32_t audio_rate_ = 0;
};

}  // namespace

const bun_emu_core_info& core_info() {
  static const bun_emu_core_info info{
      BUN_EMU_ABI_VERSION,
      BUN_EMU_CAP_SAVESTATE | BUN_EMU_CAP_ANALOG | BUN_EMU_CAP_AUDIO | BUN_EMU_CAP_MEMORY,
      "dolphin",
      "2603 (aphrody-labs/dolphin 8d2ad1a6)",
      "gc,wii",
      ".dol,.elf,.iso,.gcm,.ciso,.gcz,.wbfs,.rvz,.wia,.wad",
      "gc_ipl_ntsc,gc_ipl_pal,gc_ipl_jap",
      1,
      0,
  };
  return info;
}

std::unique_ptr<Core> make_core(Host& host) { return std::make_unique<DolphinCore>(host); }

}  // namespace bun::emu

// Frontend hooks Dolphin's core calls (DolphinNoGUI implements the same set).
std::vector<std::string> Host_GetPreferredLocales() { return {}; }
void Host_PPCSymbolsChanged() {}
void Host_PPCBreakpointsChanged() {}
bool Host_UIBlocksControllerState() { return false; }
void Host_Message(HostMessageID) {}
void Host_UpdateTitle(const std::string&) {}
void Host_UpdateDisasmDialog() {}
void Host_JitCacheInvalidation() {}
void Host_JitProfileDataWiped() {}
void Host_RequestRenderWindowSize(int, int) {}
bool Host_RendererHasFocus() { return true; }
bool Host_RendererHasFullFocus() { return true; }
bool Host_RendererIsFullscreen() { return false; }
bool Host_TASInputHasFocus() { return false; }
void Host_YieldToUI() {}
void Host_TitleChanged() {}
void Host_UpdateDiscordClientID(const std::string&) {}
bool Host_UpdateDiscordPresenceRaw(const std::string&, const std::string&, const std::string&,
                                   const std::string&, const std::string&, const std::string&, const int64_t,
                                   const int64_t, const int, const int) {
  return false;
}
std::unique_ptr<GBAHostInterface> Host_CreateGBAHost(std::weak_ptr<HW::GBA::Core>) { return nullptr; }
