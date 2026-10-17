// melonDS::Platform implemented on Qt Core, following melonDS's own Qt
// frontend (src/frontend/qt_sdl/Platform.cpp): QFile for files, QThread,
// QSemaphore and QMutex for the renderer threads, QElapsedTimer for clocks and
// QLibrary for optional dynamic libraries. Saves, firmware writes and RTC
// changes stay in memory; local multiplayer, network, camera and microphone
// report "no device".
#include "melonds_platform.hpp"

#include "../host/core.hpp"

#include "Platform.h"
#include "SPI_Firmware.h"

#include <QDir>
#include <QElapsedTimer>
#include <QFile>
#include <QLibrary>
#include <QMutex>
#include <QSemaphore>
#include <QString>
#include <QTemporaryFile>
#include <QThread>

#include <algorithm>
#include <atomic>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <mutex>

namespace bun::emu::melonds_platform {
namespace {
std::mutex registry_mutex;
Host* last_host = nullptr;
void* last_core = nullptr;

QElapsedTimer& clock() {
  static QElapsedTimer timer = [] {
    QElapsedTimer t;
    t.start();
    return t;
  }();
  return timer;
}
}  // namespace

void attach(Host& host, void* core) {
  std::lock_guard lock(registry_mutex);
  last_host = &host;
  last_core = core;
}

void detach(void* core) {
  std::lock_guard lock(registry_mutex);
  if (last_core == core) {
    last_core = nullptr;
    last_host = nullptr;
  }
}

static Host* host() {
  std::lock_guard lock(registry_mutex);
  return last_host;
}
}  // namespace bun::emu::melonds_platform

namespace melonDS::Platform {

using bun::emu::melonds_platform::host;

void SignalStop(StopReason reason, void* userdata) {
  bun::emu::melonds_platform::signal_stop(userdata, static_cast<int>(reason));
}

static QIODevice::OpenMode qt_mode(FileMode mode) {
  QIODevice::OpenMode q = QIODevice::NotOpen;
  if (mode & FileMode::Read) q |= QIODevice::ReadOnly;
  if (mode & FileMode::Write) q |= QIODevice::WriteOnly;
  if (mode & FileMode::Append) q |= QIODevice::Append;
  if ((mode & FileMode::Write) && !(mode & FileMode::Preserve)) q |= QIODevice::Truncate;
  if (mode & FileMode::NoCreate) q |= QIODevice::ExistingOnly;
  if (mode & FileMode::Text) q |= QIODevice::Text;
  return q;
}

static QFile* qfile(FileHandle* f) { return reinterpret_cast<QFile*>(f); }

FileHandle* OpenFile(const std::string& path, FileMode mode) {
  if ((mode & (FileMode::ReadWrite | FileMode::Append)) == FileMode::None) return nullptr;
  auto* f = new QFile(QString::fromStdString(path));
  if (f->open(qt_mode(mode))) return reinterpret_cast<FileHandle*>(f);
  delete f;
  return nullptr;
}

std::string GetLocalFilePath(const std::string& filename) {
  QString q = QString::fromStdString(filename);
  if (QDir(q).isAbsolute()) return filename;
  std::string base = host() ? host()->user_dir() : QDir::tempPath().toStdString();
  return QDir(QString::fromStdString(base)).filePath(q).toStdString();
}

FileHandle* OpenLocalFile(const std::string& path, FileMode mode) { return OpenFile(GetLocalFilePath(path), mode); }

bool FileExists(const std::string& name) { return QFile::exists(QString::fromStdString(name)); }

bool LocalFileExists(const std::string& name) { return FileExists(GetLocalFilePath(name)); }

bool CheckFileWritable(const std::string& filepath) {
  if (FileHandle* f = OpenFile(filepath, FileMode::Read)) {
    CloseFile(f);
    f = OpenFile(filepath, FileMode::Append);
    if (!f) return false;
    CloseFile(f);
    return true;
  }
  return QTemporaryFile(QString::fromStdString(filepath)).open();
}

bool CheckLocalFileWritable(const std::string& filepath) { return CheckFileWritable(GetLocalFilePath(filepath)); }

bool CloseFile(FileHandle* file) {
  if (!file) return false;
  qfile(file)->close();
  delete qfile(file);
  return true;
}

bool IsEndOfFile(FileHandle* file) { return qfile(file)->atEnd(); }

bool FileReadLine(char* str, int count, FileHandle* file) { return qfile(file)->readLine(str, count) > 0; }

u64 FilePosition(FileHandle* file) { return static_cast<u64>(qfile(file)->pos()); }

bool FileSeek(FileHandle* file, s64 offset, FileSeekOrigin origin) {
  QFile* f = qfile(file);
  if (origin == FileSeekOrigin::Current)
    offset += f->pos();
  else if (origin == FileSeekOrigin::End)
    offset += f->size();
  return f->seek(offset);
}

void FileRewind(FileHandle* file) { qfile(file)->seek(0); }

u64 FileRead(void* data, u64 size, u64 count, FileHandle* file) {
  if (!size) return 0;
  qint64 n = qfile(file)->read(static_cast<char*>(data), static_cast<qint64>(size * count));
  return n > 0 ? static_cast<u64>(n) / size : 0;
}

bool FileFlush(FileHandle* file) { return qfile(file)->flush(); }

u64 FileWrite(const void* data, u64 size, u64 count, FileHandle* file) {
  if (!size) return 0;
  qint64 n = qfile(file)->write(static_cast<const char*>(data), static_cast<qint64>(size * count));
  return n > 0 ? static_cast<u64>(n) / size : 0;
}

u64 FileWriteFormatted(FileHandle* file, const char* fmt, ...) {
  if (!fmt) return 0;
  va_list args;
  va_start(args, fmt);
  const QByteArray text = QString::vasprintf(fmt, args).toUtf8();
  va_end(args);
  qfile(file)->write(text);
  return static_cast<u64>(text.size());
}

u64 FileLength(FileHandle* file) { return static_cast<u64>(qfile(file)->size()); }

void Log(LogLevel level, const char* fmt, ...) {
  if (!fmt) return;
  char buf[4096];
  va_list args;
  va_start(args, fmt);
  int n = std::vsnprintf(buf, sizeof buf, fmt, args);
  va_end(args);
  if (n <= 0) return;
  std::string_view text(buf, std::min<size_t>(static_cast<size_t>(n), sizeof buf - 1));
  auto* h = host();
  if (!h) {
    std::fwrite(text.data(), 1, text.size(), stderr);
    return;
  }
  // NDS::NocashPrint (guest debug-console output) logs exactly Log(Debug, "%s\n" or "%s", text).
  if (level == LogLevel::Debug && (std::strcmp(fmt, "%s\n") == 0 || std::strcmp(fmt, "%s") == 0)) {
    h->console(text);
    return;
  }
  int32_t mapped = level == LogLevel::Debug  ? BUN_EMU_LOG_DEBUG
                   : level == LogLevel::Info ? BUN_EMU_LOG_INFO
                   : level == LogLevel::Warn ? BUN_EMU_LOG_WARN
                                             : BUN_EMU_LOG_ERROR;
  h->log(mapped, text);
}

Thread* Thread_Create(std::function<void()> func) {
  QThread* t = QThread::create(std::move(func));
  t->start();
  return reinterpret_cast<Thread*>(t);
}

void Thread_Free(Thread* thread) {
  auto* t = reinterpret_cast<QThread*>(thread);
  t->terminate();
  t->wait();
  delete t;
}

void Thread_Wait(Thread* thread) { reinterpret_cast<QThread*>(thread)->wait(); }

Semaphore* Semaphore_Create() { return reinterpret_cast<Semaphore*>(new QSemaphore()); }
void Semaphore_Free(Semaphore* sema) { delete reinterpret_cast<QSemaphore*>(sema); }
void Semaphore_Reset(Semaphore* sema) {
  auto* s = reinterpret_cast<QSemaphore*>(sema);
  s->acquire(s->available());
}
void Semaphore_Wait(Semaphore* sema) { reinterpret_cast<QSemaphore*>(sema)->acquire(); }
bool Semaphore_TryWait(Semaphore* sema, int timeout_ms) {
  auto* s = reinterpret_cast<QSemaphore*>(sema);
  return timeout_ms ? s->tryAcquire(1, timeout_ms) : s->tryAcquire(1);
}
void Semaphore_Post(Semaphore* sema, int count) { reinterpret_cast<QSemaphore*>(sema)->release(count); }

Mutex* Mutex_Create() { return reinterpret_cast<Mutex*>(new QMutex()); }
void Mutex_Free(Mutex* mutex) { delete reinterpret_cast<QMutex*>(mutex); }
void Mutex_Lock(Mutex* mutex) { reinterpret_cast<QMutex*>(mutex)->lock(); }
void Mutex_Unlock(Mutex* mutex) { reinterpret_cast<QMutex*>(mutex)->unlock(); }
bool Mutex_TryLock(Mutex* mutex) { return reinterpret_cast<QMutex*>(mutex)->try_lock(); }

void Sleep(u64 usecs) { QThread::usleep(static_cast<unsigned long>(usecs)); }

u64 GetMSCount() { return static_cast<u64>(bun::emu::melonds_platform::clock().elapsed()); }
u64 GetUSCount() { return static_cast<u64>(bun::emu::melonds_platform::clock().nsecsElapsed() / 1000); }

// Saves live inside the emulated cartridge and travel with savestates.
void WriteNDSSave(const u8*, u32, u32, u32, void*) {}
void WriteGBASave(const u8*, u32, u32, u32, void*) {}
void WriteFirmware(const Firmware&, u32, u32, void*) {}
void WriteDateTime(int, int, int, int, int, int, void*) {}

// No local multiplayer peers: a lone console.
void MP_Begin(void*) {}
void MP_End(void*) {}
int MP_SendPacket(u8*, int len, u64, void*) { return len; }
int MP_RecvPacket(u8*, u64*, void*) { return 0; }
int MP_SendCmd(u8*, int len, u64, void*) { return len; }
int MP_SendReply(u8*, int len, u64, u16, void*) { return len; }
int MP_SendAck(u8*, int len, u64, void*) { return len; }
int MP_RecvHostPacket(u8*, u64*, void*) { return 0; }
u16 MP_RecvReplies(u8*, u64, u16, void*) { return 0; }

int Net_SendPacket(u8*, int len, void*) { return len; }
int Net_RecvPacket(u8*, void*) { return 0; }

void Camera_Start(int, void*) {}
void Camera_Stop(int, void*) {}
void Camera_CaptureFrame(int, u32* frame, int width, int height, bool, void*) {
  std::fill(frame, frame + width * height, 0u);
}

void Mic_Start(void*) {}
void Mic_Stop(void*) {}
int Mic_ReadInput(s16*, int, void*) { return 0; }

AACDecoder* AAC_Init() { return nullptr; }
void AAC_DeInit(AACDecoder*) {}
bool AAC_Configure(AACDecoder*, int, int) { return false; }
bool AAC_DecodeFrame(AACDecoder*, const void*, int, void*, int) { return false; }

bool Addon_KeyDown(KeyType, void*) { return false; }
void Addon_RumbleStart(u32, void*) {}
void Addon_RumbleStop(void*) {}
float Addon_MotionQuery(MotionQueryType type, void*) {
  // Resting console: gravity on Z only.
  return type == MotionAccelerationZ ? 1.0f : 0.0f;
}

DynamicLibrary* DynamicLibrary_Load(const char* lib) {
  auto* l = new QLibrary(QString::fromUtf8(lib));
  if (l->load()) return reinterpret_cast<DynamicLibrary*>(l);
  delete l;
  return nullptr;
}

void DynamicLibrary_Unload(DynamicLibrary* lib) {
  auto* l = reinterpret_cast<QLibrary*>(lib);
  l->unload();
  delete l;
}

void* DynamicLibrary_LoadFunction(DynamicLibrary* lib, const char* name) {
  return reinterpret_cast<void*>(reinterpret_cast<QLibrary*>(lib)->resolve(name));
}

}  // namespace melonDS::Platform
