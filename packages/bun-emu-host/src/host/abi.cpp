// The exported C ABI: argument checking, error capture and lifecycle around one Core.
#include "core.hpp"

#include <QCoreApplication>
#include <QDir>
#include <QStandardPaths>

#include <algorithm>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <exception>
#include <filesystem>
#include <fstream>
#include <iterator>

using bun::emu::Core;
using bun::emu::Error;
using bun::emu::Host;

struct bun_emu {
  Host host;
  std::unique_ptr<Core> core;
  bool loaded = false;
  bool stopped = false;
  uint64_t frames = 0;
  std::string error;
  std::vector<uint8_t> state;
};

namespace bun::emu {

Host::Host() = default;
Host::~Host() = default;

void Host::log(int32_t level, std::string_view message) {
  bun_emu_log_fn fn;
  void* user;
  {
    std::lock_guard lock(mutex_);
    fn = log_fn_;
    user = log_user_;
  }
  if (fn) {
    fn(user, level, message.data(), message.size());
  } else if (level >= BUN_EMU_LOG_WARN || config_flag("verbose", false)) {
    std::fwrite(message.data(), 1, message.size(), stderr);
    if (message.empty() || message.back() != '\n') std::fputc('\n', stderr);
  }
}

void Host::logf(int32_t level, const char* fmt, ...) {
  char buf[2048];
  va_list args;
  va_start(args, fmt);
  int n = std::vsnprintf(buf, sizeof buf, fmt, args);
  va_end(args);
  if (n < 0) return;
  log(level, std::string_view(buf, std::min<size_t>(static_cast<size_t>(n), sizeof buf - 1)));
}

void Host::console(std::string_view text) {
  std::lock_guard lock(mutex_);
  // Bounded: keep the most recent 1 MiB when nobody drains it.
  if (console_.size() + text.size() > (1u << 20)) console_.erase(0, console_.size() + text.size() - (1u << 20));
  console_.append(text);
}

size_t Host::drain_console(char* out, size_t cap) {
  std::lock_guard lock(mutex_);
  size_t n = std::min(cap, console_.size());
  if (n) std::memcpy(out, console_.data(), n);
  console_.erase(0, n);
  return n;
}

void Host::set_log(bun_emu_log_fn fn, void* user) {
  std::lock_guard lock(mutex_);
  log_fn_ = fn;
  log_user_ = user;
}

void Host::set_config(std::string key, std::string value) {
  std::lock_guard lock(mutex_);
  config_[std::move(key)] = std::move(value);
}

std::optional<std::string> Host::config(const std::string& key) const {
  std::lock_guard lock(mutex_);
  auto it = config_.find(key);
  if (it == config_.end()) return std::nullopt;
  return it->second;
}

std::string Host::config_or(const std::string& key, std::string fallback) const {
  return config(key).value_or(std::move(fallback));
}

bool Host::config_flag(const std::string& key, bool fallback) const {
  auto v = config(key);
  if (!v) return fallback;
  return *v == "1" || *v == "true" || *v == "yes" || *v == "on";
}

int64_t Host::config_int(const std::string& key, int64_t fallback) const {
  auto v = config(key);
  if (!v || v->empty()) return fallback;
  try {
    return std::stoll(*v, nullptr, 0);
  } catch (...) {
    return fallback;
  }
}

std::string Host::user_dir() const {
  QString dir;
  if (auto configured = config("user_dir")) {
    dir = QString::fromStdString(*configured);
  } else {
    dir = QDir(QStandardPaths::writableLocation(QStandardPaths::TempLocation))
              .filePath(QStringLiteral("bun-emu-host/%1-%2")
                            .arg(QString::fromUtf8(core_info().name))
                            .arg(QCoreApplication::applicationPid()));
  }
  QDir().mkpath(dir);
  return QDir(dir).absolutePath().toStdString();
}

}  // namespace bun::emu

namespace {

template <typename F>
int32_t guarded(bun_emu* emu, F&& f) {
  if (!emu) return BUN_EMU_E_INVALID;
  emu->error.clear();
  try {
    return f();
  } catch (const Error& e) {
    emu->error = e.message;
    emu->host.log(BUN_EMU_LOG_ERROR, e.message);
    return e.status;
  } catch (const std::exception& e) {
    emu->error = e.what();
    emu->host.log(BUN_EMU_LOG_ERROR, emu->error);
    return BUN_EMU_E_CORE;
  } catch (...) {
    emu->error = "unknown C++ exception";
    return BUN_EMU_E_CORE;
  }
}

}  // namespace

extern "C" {

BUN_EMU_API const bun_emu_core_info* bun_emu_core(void) { return &bun::emu::core_info(); }

BUN_EMU_API bun_emu* bun_emu_create(void) {
  try {
    bun::emu::qt::ensure_application((bun::emu::core_info().flags & BUN_EMU_CAP_NEEDS_QT_GUI) != 0);
    auto emu = std::make_unique<bun_emu>();
    emu->core = bun::emu::make_core(emu->host);
    return emu.release();
  } catch (const std::exception& e) {
    std::fprintf(stderr, "bun_emu_create: %s\n", e.what());
  } catch (const Error& e) {
    std::fprintf(stderr, "bun_emu_create: %s\n", e.message.c_str());
  }
  return nullptr;
}

BUN_EMU_API void bun_emu_destroy(bun_emu* emu) {
  if (!emu) return;
  try {
    emu->core.reset();
  } catch (...) {
  }
  delete emu;
}

BUN_EMU_API const char* bun_emu_last_error(const bun_emu* emu) { return emu ? emu->error.c_str() : "null instance"; }

BUN_EMU_API void bun_emu_set_log(bun_emu* emu, bun_emu_log_fn fn, void* user) {
  if (emu) emu->host.set_log(fn, user);
}

BUN_EMU_API int32_t bun_emu_set_config(bun_emu* emu, const char* key, const char* value) {
  if (!key || !value) return BUN_EMU_E_INVALID;
  return guarded(emu, [&] {
    emu->host.set_config(key, value);
    return BUN_EMU_OK;
  });
}

BUN_EMU_API int64_t bun_emu_get_config(const bun_emu* emu, const char* key, char* out, size_t cap) {
  if (!emu || !key) return -1;
  auto v = emu->host.config(key);
  if (!v) return -1;
  if (out && cap) {
    size_t n = std::min(cap - 1, v->size());
    std::memcpy(out, v->data(), n);
    out[n] = 0;
  }
  return static_cast<int64_t>(v->size());
}

BUN_EMU_API int32_t bun_emu_load_firmware(bun_emu* emu, const char* kind, const uint8_t* data, size_t len) {
  if (!kind || (!data && len)) return BUN_EMU_E_INVALID;
  return guarded(emu, [&] {
    emu->core->load_firmware(kind, std::span<const uint8_t>(data, len));
    return BUN_EMU_OK;
  });
}

BUN_EMU_API int32_t bun_emu_load_content_path(bun_emu* emu, const char* path) {
  if (!path) return BUN_EMU_E_INVALID;
  return guarded(emu, [&] {
    std::ifstream in(std::filesystem::path(reinterpret_cast<const char8_t*>(path)), std::ios::binary);
    if (!in) bun::emu::fail(BUN_EMU_E_IO, std::string("cannot open ") + path);
    std::vector<uint8_t> data((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    std::string p(path);
    auto slash = p.find_last_of("/\\");
    emu->core->load_content(slash == std::string::npos ? p : p.substr(slash + 1), std::move(data), p);
    emu->loaded = true;
    emu->stopped = false;
    emu->frames = 0;
    return BUN_EMU_OK;
  });
}

BUN_EMU_API int32_t bun_emu_load_content(bun_emu* emu, const char* name_hint, const uint8_t* data, size_t len) {
  if (!data || !len) return BUN_EMU_E_INVALID;
  return guarded(emu, [&] {
    std::string name = name_hint ? name_hint : "content";
    emu->core->load_content(name, std::vector<uint8_t>(data, data + len), std::string{});
    emu->loaded = true;
    emu->stopped = false;
    emu->frames = 0;
    return BUN_EMU_OK;
  });
}

BUN_EMU_API int32_t bun_emu_reset(bun_emu* emu) {
  return guarded(emu, [&] {
    if (!emu->loaded) bun::emu::fail(BUN_EMU_E_STATE, "no content loaded");
    emu->core->reset();
    emu->stopped = false;
    emu->frames = 0;
    return BUN_EMU_OK;
  });
}

BUN_EMU_API int32_t bun_emu_run_frame(bun_emu* emu) {
  return guarded(emu, [&] {
    if (!emu->loaded) bun::emu::fail(BUN_EMU_E_STATE, "no content loaded");
    if (emu->stopped) return BUN_EMU_STOPPED;
    bun::emu::qt::pump_events();
    int32_t r = emu->core->run_frame();
    if (r == BUN_EMU_FRAME) ++emu->frames;
    if (r == BUN_EMU_STOPPED) emu->stopped = true;
    return r;
  });
}

BUN_EMU_API uint64_t bun_emu_frame_count(const bun_emu* emu) { return emu ? emu->frames : 0; }

BUN_EMU_API uint32_t bun_emu_screen_count(const bun_emu* emu) { return emu ? emu->core->screen_count() : 0; }

BUN_EMU_API int32_t bun_emu_get_screen(const bun_emu* emu, uint32_t index, bun_emu_screen* out) {
  if (!emu || !out) return BUN_EMU_E_INVALID;
  try {
    auto s = emu->core->screen(index);
    if (!s || !s->pixels) return BUN_EMU_E_INVALID;
    *out = bun_emu_screen{s->width, s->height, s->stride, s->format, s->pixels};
    return BUN_EMU_OK;
  } catch (...) {
    return BUN_EMU_E_CORE;
  }
}

BUN_EMU_API uint32_t bun_emu_audio_rate(const bun_emu* emu) { return emu ? emu->core->audio_rate() : 0; }

BUN_EMU_API size_t bun_emu_audio(bun_emu* emu, int16_t* out, size_t max_frames) {
  if (!emu || !out || !max_frames) return 0;
  try {
    return emu->core->audio(out, max_frames);
  } catch (...) {
    return 0;
  }
}

BUN_EMU_API void bun_emu_set_buttons(bun_emu* emu, uint32_t port, uint64_t buttons) {
  if (emu) emu->core->set_buttons(port, buttons);
}

BUN_EMU_API void bun_emu_set_touch(bun_emu* emu, int32_t pressed, uint32_t x, uint32_t y) {
  if (emu) emu->core->set_touch(pressed != 0, x, y);
}

BUN_EMU_API void bun_emu_set_analog(bun_emu* emu, uint32_t port, uint32_t axis, int32_t value) {
  if (emu) emu->core->set_analog(port, axis, value);
}

BUN_EMU_API int32_t bun_emu_save_state(bun_emu* emu, const uint8_t** data, size_t* len) {
  if (!data || !len) return BUN_EMU_E_INVALID;
  return guarded(emu, [&] {
    if (!emu->loaded) bun::emu::fail(BUN_EMU_E_STATE, "no content loaded");
    emu->state = emu->core->save_state();
    *data = emu->state.data();
    *len = emu->state.size();
    return BUN_EMU_OK;
  });
}

BUN_EMU_API int32_t bun_emu_load_state(bun_emu* emu, const uint8_t* data, size_t len) {
  if (!data || !len) return BUN_EMU_E_INVALID;
  return guarded(emu, [&] {
    if (!emu->loaded) bun::emu::fail(BUN_EMU_E_STATE, "no content loaded");
    emu->core->load_state(std::span<const uint8_t>(data, len));
    emu->stopped = false;
    return BUN_EMU_OK;
  });
}

BUN_EMU_API int32_t bun_emu_read_memory(bun_emu* emu, uint64_t address, uint8_t* out, size_t len) {
  if (!out && len) return BUN_EMU_E_INVALID;
  return guarded(emu, [&] {
    if (!emu->loaded) bun::emu::fail(BUN_EMU_E_STATE, "no content loaded");
    emu->core->read_memory(address, std::span<uint8_t>(out, len));
    return BUN_EMU_OK;
  });
}

BUN_EMU_API size_t bun_emu_console(bun_emu* emu, char* out, size_t cap) {
  if (!emu || !out || !cap) return 0;
  return emu->host.drain_console(out, cap);
}

}  // extern "C"
