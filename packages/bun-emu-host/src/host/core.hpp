// Internal C++ contract between the C ABI (abi.cpp) and one emulator core.
#pragma once

#include "bun_emu_host.h"

#include <cstdint>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace bun::emu {

class Host;

struct Screen {
  uint32_t width = 0;
  uint32_t height = 0;
  uint32_t stride = 0;
  uint32_t format = BUN_EMU_PIXEL_BGRX8888;
  const uint8_t* pixels = nullptr;
};

// Thrown by cores; abi.cpp turns it into a status and last_error.
struct Error {
  int32_t status;
  std::string message;
};

[[noreturn]] inline void fail(int32_t status, std::string message) { throw Error{status, std::move(message)}; }

class Core {
 public:
  explicit Core(Host& host) : host_(host) {}
  virtual ~Core() = default;
  Core(const Core&) = delete;
  Core& operator=(const Core&) = delete;

  virtual void load_firmware(std::string_view kind, std::span<const uint8_t> data) = 0;
  virtual void load_content(const std::string& name, std::vector<uint8_t> data, const std::string& path) = 0;
  virtual void reset() = 0;
  // Returns BUN_EMU_FRAME or BUN_EMU_STOPPED.
  virtual int32_t run_frame() = 0;
  virtual uint32_t screen_count() const = 0;
  virtual std::optional<Screen> screen(uint32_t index) const = 0;
  virtual uint32_t audio_rate() const { return 0; }
  virtual size_t audio(int16_t* out, size_t max_frames) {
    (void)out;
    (void)max_frames;
    return 0;
  }
  virtual void set_buttons(uint32_t port, uint64_t buttons) = 0;
  virtual void set_touch(bool pressed, uint32_t x, uint32_t y) {
    (void)pressed;
    (void)x;
    (void)y;
  }
  virtual void set_analog(uint32_t port, uint32_t axis, int32_t value) {
    (void)port;
    (void)axis;
    (void)value;
  }
  virtual std::vector<uint8_t> save_state() { fail(BUN_EMU_E_UNSUPPORTED, "savestates are not supported by this core"); }
  virtual void load_state(std::span<const uint8_t> data) {
    (void)data;
    fail(BUN_EMU_E_UNSUPPORTED, "savestates are not supported by this core");
  }
  virtual void read_memory(uint64_t address, std::span<uint8_t> out) {
    (void)address;
    (void)out;
    fail(BUN_EMU_E_UNSUPPORTED, "memory access is not supported by this core");
  }

 protected:
  Host& host_;
};

// Per-instance services shared by every core: config, logging, guest console.
class Host {
 public:
  Host();
  ~Host();

  void log(int32_t level, std::string_view message);
  void logf(int32_t level, const char* fmt, ...);
  void console(std::string_view text);
  size_t drain_console(char* out, size_t cap);

  void set_log(bun_emu_log_fn fn, void* user);
  void set_config(std::string key, std::string value);
  std::optional<std::string> config(const std::string& key) const;
  std::string config_or(const std::string& key, std::string fallback) const;
  bool config_flag(const std::string& key, bool fallback) const;
  int64_t config_int(const std::string& key, int64_t fallback) const;

  // Directory for core-owned writable files (settings, NAND, user dirs), from
  // config "user_dir" or a per-process temporary directory.
  std::string user_dir() const;

 private:
  mutable std::mutex mutex_;
  std::map<std::string, std::string> config_;
  bun_emu_log_fn log_fn_ = nullptr;
  void* log_user_ = nullptr;
  std::string console_;
};

// Process-wide Qt adapter: owns the QCoreApplication (or a QGuiApplication on
// the offscreen platform) so cores that rely on Qt types, settings or an event
// loop run without a window system.
namespace qt {
void ensure_application(bool gui);
void pump_events();
}  // namespace qt

// Implemented by each core plugin.
const bun_emu_core_info& core_info();
std::unique_ptr<Core> make_core(Host& host);

}  // namespace bun::emu
