// melonDS core plugin: drives melonDS::NDS headless with its software renderer,
// the FreeBIOS images bundled with melonDS and a generated firmware, one call
// to NDS::RunFrame per bun_emu_run_frame.
#include "../host/core.hpp"
#include "melonds_platform.hpp"

#include "Args.h"
#include "FATStorage.h"
#include "FreeBIOS.h"
#include "GPU.h"
#include "GPU_Soft.h"
#include "NDS.h"
#include "NDSCart.h"
#include "SPI_Firmware.h"
#include "Savestate.h"
#include "version.h"

#include <algorithm>
#include <cstring>

namespace bun::emu {
namespace {

using namespace melonDS;

constexpr uint32_t kWidth = 256;
constexpr uint32_t kHeight = 192;
constexpr double kAudioRate = 48000.0;

class MelonCore final : public Core {
 public:
  explicit MelonCore(Host& host) : Core(host) { melonds_platform::attach(host, this); }
  ~MelonCore() override {
    nds_.reset();
    melonds_platform::detach(this);
  }

  void load_firmware(std::string_view kind, std::span<const uint8_t> data) override {
    if (kind == "arm9_bios") {
      if (data.size() != ARM9BIOSSize) fail(BUN_EMU_E_INVALID, "arm9_bios must be 4096 bytes");
      arm9_bios_ = std::make_unique<ARM9BIOSImage>();
      std::memcpy(arm9_bios_->data(), data.data(), data.size());
    } else if (kind == "arm7_bios") {
      if (data.size() != ARM7BIOSSize) fail(BUN_EMU_E_INVALID, "arm7_bios must be 16384 bytes");
      arm7_bios_ = std::make_unique<ARM7BIOSImage>();
      std::memcpy(arm7_bios_->data(), data.data(), data.size());
    } else if (kind == "firmware") {
      firmware_.assign(data.begin(), data.end());
    } else {
      fail(BUN_EMU_E_UNSUPPORTED, "unknown melonDS firmware kind " + std::string(kind));
    }
  }

  void load_content(const std::string& name, std::vector<uint8_t> data, const std::string&) override {
    if (data.size() < 0x200) fail(BUN_EMU_E_INVALID, "not a DS ROM: shorter than its 512-byte header");
    rom_ = std::move(data);
    rom_name_ = name;
    boot();
  }

  void reset() override { boot(); }

  int32_t run_frame() override {
    if (stopped_ || !nds_) return BUN_EMU_STOPPED;
    nds_->SetKeyMask(key_mask_);
    if (lid_ != nds_->IsLidClosed()) nds_->SetLidClosed(lid_);
    if (touching_)
      nds_->TouchScreen(touch_x_, touch_y_);
    else
      nds_->ReleaseScreen();
    nds_->RunFrame();
    capture_frame();
    pull_audio();
    return stopped_ ? BUN_EMU_STOPPED : BUN_EMU_FRAME;
  }

  uint32_t screen_count() const override { return 2; }

  std::optional<Screen> screen(uint32_t index) const override {
    if (index >= 2 || !nds_) return std::nullopt;
    return Screen{kWidth, kHeight, kWidth * 4, BUN_EMU_PIXEL_BGRX8888,
                  reinterpret_cast<const uint8_t*>(frames_[index].data())};
  }

  uint32_t audio_rate() const override { return static_cast<uint32_t>(kAudioRate); }

  size_t audio(int16_t* out, size_t max_frames) override {
    size_t n = std::min(max_frames, audio_.size() / 2);
    std::memcpy(out, audio_.data(), n * 2 * sizeof(int16_t));
    audio_.erase(audio_.begin(), audio_.begin() + static_cast<std::ptrdiff_t>(n * 2));
    return n;
  }

  void set_buttons(uint32_t port, uint64_t buttons) override {
    if (port != 0) return;
    // NDS::SetKeyMask takes an active-low mask whose bits 0-11 are
    // A,B,Select,Start,Right,Left,Up,Down,R,L,X,Y: the BUN_EMU_BTN_* order.
    key_mask_ = ~static_cast<uint32_t>(buttons) & 0xFFF;
    lid_ = (buttons & BUN_EMU_BTN_LID) != 0;
  }

  void set_touch(bool pressed, uint32_t x, uint32_t y) override {
    touching_ = pressed;
    touch_x_ = static_cast<u16>(std::min<uint32_t>(x, kWidth - 1));
    touch_y_ = static_cast<u16>(std::min<uint32_t>(y, kHeight - 1));
  }

  std::vector<uint8_t> save_state() override {
    require_running();
    Savestate state;
    if (state.Error) fail(BUN_EMU_E_CORE, "cannot allocate the savestate buffer");
    if (!nds_->DoSavestate(&state) || state.Error) fail(BUN_EMU_E_CORE, "melonDS failed to write the savestate");
    state.Finish();
    auto* p = static_cast<const uint8_t*>(state.Buffer());
    return std::vector<uint8_t>(p, p + state.Length());
  }

  void load_state(std::span<const uint8_t> data) override {
    require_running();
    std::vector<uint8_t> copy(data.begin(), data.end());
    Savestate state(copy.data(), static_cast<u32>(copy.size()), false);
    if (state.Error) fail(BUN_EMU_E_INVALID, "not a melonDS savestate");
    if (!nds_->DoSavestate(&state) || state.Error) fail(BUN_EMU_E_CORE, "melonDS rejected the savestate");
    stopped_ = false;
    capture_frame();
  }

  void read_memory(uint64_t address, std::span<uint8_t> out) override {
    require_running();
    // ARM9 bus view; I/O registers are not read to avoid side effects.
    for (size_t i = 0; i < out.size(); ++i) {
      u32 a = static_cast<u32>(address + i);
      if ((a & 0xFF000000) == 0x04000000) fail(BUN_EMU_E_INVALID, "I/O registers are not readable through read_memory");
      out[i] = nds_->ARM9Read8(a);
    }
  }

  void on_stop(Platform::StopReason reason) {
    stopped_ = true;
    host_.logf(BUN_EMU_LOG_INFO, "melonDS stopped (reason %d)", static_cast<int>(reason));
  }

 private:
  void require_running() const {
    if (!nds_) fail(BUN_EMU_E_STATE, "no content loaded");
  }

  void boot() {
    if (rom_.empty()) fail(BUN_EMU_E_STATE, "no content loaded");
    nds_.reset();
    stopped_ = false;
    audio_.clear();

    NDSArgs args;
    if (arm9_bios_) args.ARM9BIOS = std::make_unique<ARM9BIOSImage>(*arm9_bios_);
    if (arm7_bios_) args.ARM7BIOS = std::make_unique<ARM7BIOSImage>(*arm7_bios_);
    if (!firmware_.empty()) {
      Firmware fw(firmware_.data(), static_cast<u32>(firmware_.size()));
      if (!fw.Buffer()) fail(BUN_EMU_E_INVALID, "firmware image rejected by melonDS");
      args.Firmware = std::move(fw);
    }
    // Otherwise NDSArgs keeps melonDS's generated firmware (deterministic defaults).
    args.JIT = std::nullopt;  // interpreter: deterministic and portable
    args.Interpolation = AudioInterpolation::None;
    args.BitDepth = AudioBitDepth::Auto;
    args.OutputSampleRate = kAudioRate;

    nds_ = std::make_unique<NDS>(std::move(args), static_cast<void*>(this));
    auto renderer = std::make_unique<SoftRenderer>(*nds_);
    RendererSettings settings{1, host_.config_flag("threaded_3d", false), false, false};
    renderer->SetRenderSettings(settings);
    nds_->SetRenderer(std::move(renderer));
    nds_->Reset();

    NDSCart::NDSCartArgs cart_args{};
    // Homebrew DLDI SD card: config "sd_dir" is synced into a FAT image
    // ("sd_image", default <user_dir>/dldi.bin; "sd_size" bytes, 0 = auto).
    if (auto dir = host_.config("sd_dir")) {
      cart_args.SDCard = FATStorageArgs{
          host_.config_or("sd_image", host_.user_dir() + "/dldi.bin"),
          static_cast<u64>(host_.config_int("sd_size", 0)),
          host_.config_flag("sd_readonly", false),
          *dir,
      };
    }
    auto cart = NDSCart::ParseROM(rom_.data(), static_cast<u32>(rom_.size()), static_cast<void*>(this),
                                  std::move(cart_args));
    if (!cart) fail(BUN_EMU_E_CORE, "melonDS could not parse " + rom_name_);
    nds_->SetNDSCart(std::move(cart));
    nds_->Reset();
    if (host_.config_flag("direct_boot", true) || nds_->NeedsDirectBoot()) nds_->SetupDirectBoot(rom_name_);
    nds_->Start();
    for (auto& f : frames_) std::fill(f.begin(), f.end(), 0xFF000000u);
  }

  void capture_frame() {
    void* top = nullptr;
    void* bottom = nullptr;
    if (!nds_->GPU.GetFramebuffers(&top, &bottom) || !top || !bottom) return;
    std::memcpy(frames_[0].data(), top, kWidth * kHeight * 4);
    std::memcpy(frames_[1].data(), bottom, kWidth * kHeight * 4);
  }

  void pull_audio() {
    int avail = nds_->SPU.GetOutputSize();
    if (avail <= 0) return;
    size_t base = audio_.size();
    audio_.resize(base + static_cast<size_t>(avail) * 2);
    int got = nds_->SPU.ReadOutput(audio_.data() + base, avail);
    audio_.resize(base + static_cast<size_t>(std::max(got, 0)) * 2);
    // Bound the queue to ~2 s when the caller does not drain audio.
    constexpr size_t kMax = static_cast<size_t>(kAudioRate) * 2 * 2;
    if (audio_.size() > kMax) audio_.erase(audio_.begin(), audio_.end() - kMax);
  }

  std::unique_ptr<NDS> nds_;
  std::unique_ptr<ARM9BIOSImage> arm9_bios_;
  std::unique_ptr<ARM7BIOSImage> arm7_bios_;
  std::vector<uint8_t> firmware_;
  std::vector<uint8_t> rom_;
  std::string rom_name_;
  std::array<std::vector<uint32_t>, 2> frames_{std::vector<uint32_t>(kWidth * kHeight, 0xFF000000u),
                                               std::vector<uint32_t>(kWidth * kHeight, 0xFF000000u)};
  std::vector<int16_t> audio_;
  uint32_t key_mask_ = 0xFFF;
  bool lid_ = false;
  bool touching_ = false;
  u16 touch_x_ = 0;
  u16 touch_y_ = 0;
  bool stopped_ = false;
};

}  // namespace

void melonds_platform::signal_stop(void* core, int reason) {
  if (core) static_cast<MelonCore*>(core)->on_stop(static_cast<melonDS::Platform::StopReason>(reason));
}

const bun_emu_core_info& core_info() {
  static const bun_emu_core_info info{
      BUN_EMU_ABI_VERSION,
      BUN_EMU_CAP_SAVESTATE | BUN_EMU_CAP_TOUCH | BUN_EMU_CAP_AUDIO | BUN_EMU_CAP_MEMORY,
      "melonds",
      MELONDS_VERSION,
      "nds",
      ".nds,.srl,.dsi",
      "arm9_bios,arm7_bios,firmware",
      2,
      0,
  };
  return info;
}

std::unique_ptr<Core> make_core(Host& host) { return std::make_unique<MelonCore>(host); }

}  // namespace bun::emu
