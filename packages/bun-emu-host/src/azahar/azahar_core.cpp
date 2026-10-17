// Azahar (3DS) core plugin: Core::System driven headless with the software
// PICA renderer, one bun_emu_run_frame = System::RunLoop until the renderer
// ends a frame (it calls EmuWindow::PollEvents from RendererBase::EndFrame, as
// Azahar's own libretro frontend relies on). Screens are read straight out of
// RendererSoftware's CPU-side screen buffers.
//
// Config keys (before load_content): cpu_jit (default 1), new_3ds (default 1),
// region (-1 auto), fixed_time (unix seconds; default 946681277 = 2000-01-01).
#include "../host/core.hpp"

#include "common/file_util.h"
#include "common/logging/backend.h"
#include "common/param_package.h"
#include "common/settings.h"
#include "core/core.h"
#include "core/frontend/applets/default_applets.h"
#include "core/frontend/emu_window.h"
#include "core/frontend/input.h"
#include "core/hle/kernel/kernel.h"
#include "core/hle/kernel/process.h"
#include "core/memory.h"
#include "video_core/gpu.h"
#include "video_core/renderer_software/renderer_software.h"

#include <array>
#include <atomic>
#include <chrono>
#include <cstring>
#include <mutex>
#include <utility>
#include <fstream>

namespace bun::emu {
namespace {

std::atomic<bool> g_instance_alive{false};

// Live controller state read by Azahar's HID service through the "bun" engine.
struct PadState {
  std::atomic<uint64_t> buttons{0};
  std::array<std::atomic<int32_t>, 6> axes{};
};
PadState g_pad;

class BunButton final : public Input::ButtonDevice {
 public:
  explicit BunButton(uint64_t mask) : mask_(mask) {}
  bool GetStatus() const override { return (g_pad.buttons.load() & mask_) != 0; }

 private:
  uint64_t mask_;
};

class BunButtonFactory final : public Input::Factory<Input::ButtonDevice> {
 public:
  std::unique_ptr<Input::ButtonDevice> Create(const Common::ParamPackage& params) override {
    return std::make_unique<BunButton>(1ull << params.Get("bit", 0));
  }
};

class BunStick final : public Input::AnalogDevice {
 public:
  BunStick(uint32_t x, uint32_t y) : x_(x), y_(y) {}
  std::tuple<float, float> GetStatus() const override {
    return {g_pad.axes[x_].load() / 32767.0f, -g_pad.axes[y_].load() / 32767.0f};
  }

 private:
  uint32_t x_, y_;
};

class BunStickFactory final : public Input::Factory<Input::AnalogDevice> {
 public:
  std::unique_ptr<Input::AnalogDevice> Create(const Common::ParamPackage& params) override {
    return std::make_unique<BunStick>(params.Get("x", 0), params.Get("y", 1));
  }
};

// Headless window: no surface, software presentation, frame-end detection.
class HeadlessWindow final : public Frontend::EmuWindow {
 public:
  HeadlessWindow() {
    window_info.type = Frontend::WindowSystemType::Headless;
    UpdateCurrentFramebufferLayout(::Core::kScreenTopWidth, ::Core::kScreenTopHeight + ::Core::kScreenBottomHeight);
  }
  void PollEvents() override { frame_ended_ = true; }
  bool take_frame() { return std::exchange(frame_ended_, false); }

 private:
  bool frame_ended_ = false;
};

// BUN_EMU_BTN_* bit for each Settings::NativeButton.
constexpr std::array<int, Settings::NativeButton::NumButtons> kButtonBits = [] {
  std::array<int, Settings::NativeButton::NumButtons> b{};
  using namespace Settings::NativeButton;
  b[A] = 0;
  b[B] = 1;
  b[X] = 10;
  b[Y] = 11;
  b[Up] = 6;
  b[Down] = 7;
  b[Left] = 5;
  b[Right] = 4;
  b[L] = 9;
  b[R] = 8;
  b[Start] = 3;
  b[Select] = 2;
  b[Debug] = 19;
  b[Gpio14] = 18;
  b[ZL] = 12;
  b[ZR] = 13;
  b[Home] = 15;
  b[Power] = 63;
  return b;
}();

class AzaharCore final : public Core {
 public:
  explicit AzaharCore(Host& host) : Core(host) {
    if (g_instance_alive.exchange(true))
      fail(BUN_EMU_E_STATE, "Azahar keeps process-wide state: one instance per process");
    static std::once_flag once;
    std::call_once(once, [&host] {
      FileUtil::SetUserPath(host.user_dir() + "/azahar/");
      Common::Log::Initialize("azahar.log");
      Common::Log::Start();
      Input::RegisterFactory<Input::ButtonDevice>("bun", std::make_shared<BunButtonFactory>());
      Input::RegisterFactory<Input::AnalogDevice>("bun", std::make_shared<BunStickFactory>());
    });
    log_path_ = FileUtil::GetUserPath(FileUtil::UserPath::LogDir) + "azahar.log";
  }

  ~AzaharCore() override {
    auto& system = ::Core::System::GetInstance();
    if (system.IsPoweredOn()) system.Shutdown();
    window_.reset();
    g_instance_alive = false;
  }

  void load_firmware(std::string_view kind, std::span<const uint8_t> data) override {
    // Decryption keys and seeds Azahar reads from its sysdata directory.
    std::string file;
    if (kind == "aes_keys")
      file = "aes_keys.txt";
    else if (kind == "seeddb")
      file = "seeddb.bin";
    else
      fail(BUN_EMU_E_UNSUPPORTED, "unknown Azahar firmware kind " + std::string(kind));
    const std::string dir = FileUtil::GetUserPath(FileUtil::UserPath::SysDataDir);
    FileUtil::CreateFullPath(dir);
    std::ofstream(dir + file, std::ios::binary)
        .write(reinterpret_cast<const char*>(data.data()), static_cast<std::streamsize>(data.size()));
  }

  void load_content(const std::string& name, std::vector<uint8_t> data, const std::string& path) override {
    content_path_ = path;
    if (content_path_.empty()) {
      content_path_ = host_.user_dir() + "/" + name;
      std::ofstream(content_path_, std::ios::binary)
          .write(reinterpret_cast<const char*>(data.data()), static_cast<std::streamsize>(data.size()));
    }
    boot();
  }

  void reset() override { boot(); }

  int32_t run_frame() override {
    auto& system = ::Core::System::GetInstance();
    if (!system.IsPoweredOn()) return BUN_EMU_STOPPED;
    window_->take_frame();
    const auto deadline = std::chrono::steady_clock::now() +
                          std::chrono::milliseconds(host_.config_int("frame_timeout_ms", 30000));
    while (!window_->take_frame()) {
      const auto result = system.RunLoop();
      if (result == ::Core::System::ResultStatus::ShutdownRequested) return stop("guest requested shutdown");
      if (result != ::Core::System::ResultStatus::Success)
        return stop("Azahar stopped: status " + std::to_string(static_cast<int>(result)) + " " +
                    system.GetStatusDetails());
      if (std::chrono::steady_clock::now() > deadline)
        fail(BUN_EMU_E_CORE, "Azahar did not finish a frame in time");
    }
    drain_log();
    return BUN_EMU_FRAME;
  }

  uint32_t screen_count() const override { return 2; }

  std::optional<Screen> screen(uint32_t index) const override {
    auto& system = ::Core::System::GetInstance();
    if (index >= 2 || !system.IsPoweredOn()) return std::nullopt;
    const auto& renderer = static_cast<const SwRenderer::RendererSoftware&>(system.GPU().Renderer());
    // ScreenInfo stores the portrait LCD column-major, which is the landscape
    // image row-major: info.height pixels per row, info.width rows, RGBA.
    const auto& info = renderer.Screen(index == 0 ? VideoCore::ScreenId::TopLeft : VideoCore::ScreenId::Bottom);
    if (info.pixels.empty()) return std::nullopt;
    return Screen{info.height, info.width, info.height * 4, BUN_EMU_PIXEL_RGBX8888, info.pixels.data()};
  }

  void set_buttons(uint32_t port, uint64_t buttons) override {
    if (port == 0) g_pad.buttons = buttons;
  }

  void set_analog(uint32_t port, uint32_t axis, int32_t value) override {
    if (port == 0 && axis < 6) g_pad.axes[axis] = value;
  }

  void set_touch(bool pressed, uint32_t x, uint32_t y) override {
    if (!window_) return;
    const auto& rect = window_->GetFramebufferLayout().bottom_screen;
    if (pressed) {
      const unsigned fx = rect.left + std::min<uint32_t>(x, ::Core::kScreenBottomWidth - 1) * rect.GetWidth() /
                                          ::Core::kScreenBottomWidth;
      const unsigned fy = rect.top + std::min<uint32_t>(y, ::Core::kScreenBottomHeight - 1) * rect.GetHeight() /
                                         ::Core::kScreenBottomHeight;
      window_->TouchPressed(fx, fy);
    } else {
      window_->TouchReleased();
    }
  }

  std::vector<uint8_t> save_state() override {
    auto& system = ::Core::System::GetInstance();
    require_running(system);
    drain_async(system);
    return system.SaveStateBuffer();
  }

  void load_state(std::span<const uint8_t> data) override {
    auto& system = ::Core::System::GetInstance();
    require_running(system);
    drain_async(system);
    if (!system.LoadStateBuffer(std::vector<u8>(data.begin(), data.end())))
      fail(BUN_EMU_E_INVALID, "Azahar rejected the savestate");
  }

  void read_memory(uint64_t address, std::span<uint8_t> out) override {
    auto& system = ::Core::System::GetInstance();
    require_running(system);
    auto process = system.Kernel().GetCurrentProcess();
    const VAddr addr = static_cast<VAddr>(address);
    if (!system.Memory().IsValidVirtualAddress(*process, addr) ||
        !system.Memory().IsValidVirtualAddress(*process, addr + static_cast<VAddr>(out.size()) - 1))
      fail(BUN_EMU_E_INVALID, "address outside the current process");
    system.Memory().ReadBlock(*process, addr, out.data(), out.size());
  }

 private:
  static void require_running(::Core::System& system) {
    if (!system.IsPoweredOn()) fail(BUN_EMU_E_STATE, "no content loaded");
  }

  // Savestates are only consistent between kernel async operations (see
  // citra_libretro's DrainAsyncOperations).
  void drain_async(::Core::System& system) {
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
    while (system.KernelRunning() && system.Kernel().AreAsyncOperationsPending()) {
      if (std::chrono::steady_clock::now() > deadline) fail(BUN_EMU_E_CORE, "Azahar async operations pending");
      if (system.RunLoop() != ::Core::System::ResultStatus::Success) fail(BUN_EMU_E_CORE, "Azahar stopped");
    }
  }

  int32_t stop(std::string why) {
    host_.log(BUN_EMU_LOG_WARN, why);
    auto& system = ::Core::System::GetInstance();
    if (system.IsPoweredOn()) system.Shutdown();
    drain_log();
    return BUN_EMU_STOPPED;
  }

  void configure() {
    auto& v = Settings::values;
    v.graphics_api.SetValue(Settings::GraphicsAPI::Software);
    v.output_type.SetValue(AudioCore::SinkType::Null);
    v.use_cpu_jit.SetValue(host_.config_flag("cpu_jit", true));
    v.is_new_3ds.SetValue(host_.config_flag("new_3ds", true));
    v.region_value.SetValue(static_cast<s32>(host_.config_int("region", Settings::REGION_VALUE_AUTO_SELECT)));
    v.init_clock.SetValue(Settings::InitClock::FixedTime);
    v.init_time.SetValue(static_cast<u64>(host_.config_int("fixed_time", 946681277)));
    v.frame_limit.SetValue(0);  // unthrottled
    v.use_vsync.SetValue(false);
    v.layout_option.SetValue(Settings::LayoutOption::Default);
    v.swap_screen.SetValue(false);
    v.lle_applets.SetValue(false);
    auto& profile = v.current_input_profile;
    for (int i = 0; i < Settings::NativeButton::NumButtons; ++i)
      profile.buttons[i] = "engine:bun,bit:" + std::to_string(kButtonBits[i]);
    profile.analogs[Settings::NativeAnalog::CirclePad] =
        "engine:bun,x:" + std::to_string(BUN_EMU_AXIS_LX) + ",y:" + std::to_string(BUN_EMU_AXIS_LY);
    profile.analogs[Settings::NativeAnalog::CStick] =
        "engine:bun,x:" + std::to_string(BUN_EMU_AXIS_RX) + ",y:" + std::to_string(BUN_EMU_AXIS_RY);
    profile.touch_device = "engine:emu_window";
    profile.motion_device = "";
  }

  void boot() {
    auto& system = ::Core::System::GetInstance();
    if (system.IsPoweredOn()) system.Shutdown();
    configure();
    window_ = std::make_unique<HeadlessWindow>();
    Frontend::RegisterDefaultApplets(system);
    system.ApplySettings();
    const auto result = system.Load(*window_, content_path_);
    if (result != ::Core::System::ResultStatus::Success)
      fail(BUN_EMU_E_CORE, "Azahar could not load " + content_path_ + ": status " +
                               std::to_string(static_cast<int>(result)) + " " + system.GetStatusDetails());
    system.RegisterCoreLoopThreadId();
    drain_log();
  }

  // Guest svcOutputDebugString lines are logged as Debug.Emulated: tail the
  // log file and forward them to the console.
  void drain_log() {
    std::ifstream in(log_path_, std::ios::binary);
    if (!in) return;
    in.seekg(0, std::ios::end);
    const std::streamoff end = in.tellg();
    if (end < log_offset_) log_offset_ = 0;
    in.seekg(log_offset_);
    std::string line;
    while (std::getline(in, line)) {
      if (in.eof()) break;  // keep a partially written line for next time
      log_offset_ = in.tellg();
      if (line.find("Debug.Emulated") != std::string::npos) {
        const auto colon = line.find(": ", line.find("Debug.Emulated"));
        host_.console(colon == std::string::npos ? line : line.substr(colon + 2));
        host_.console("\n");
      }
      host_.log(line.find("<Error>") != std::string::npos || line.find("<Critical>") != std::string::npos
                    ? BUN_EMU_LOG_ERROR
                : line.find("<Warning>") != std::string::npos ? BUN_EMU_LOG_WARN
                                                              : BUN_EMU_LOG_DEBUG,
                line);
    }
  }

  std::unique_ptr<HeadlessWindow> window_;
  std::string content_path_;
  std::string log_path_;
  std::streamoff log_offset_ = 0;
};

}  // namespace

const bun_emu_core_info& core_info() {
  static const bun_emu_core_info info{
      BUN_EMU_ABI_VERSION,
      BUN_EMU_CAP_SAVESTATE | BUN_EMU_CAP_TOUCH | BUN_EMU_CAP_ANALOG | BUN_EMU_CAP_MEMORY,
      "azahar",
      "aphrody-labs/azahar 73ed0e91",
      "3ds",
      ".3dsx,.cia,.cxi,.cci,.3ds,.app,.elf,.axf,.zcia,.zcxi,.zcci,.z3dsx",
      "aes_keys,seeddb",
      2,
      0,
  };
  return info;
}

std::unique_ptr<Core> make_core(Host& host) { return std::make_unique<AzaharCore>(host); }

}  // namespace bun::emu
