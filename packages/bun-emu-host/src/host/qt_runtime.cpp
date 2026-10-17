// Process-wide Qt adapter. Cores run inside the caller's thread; this owns the
// QCoreApplication (or a QGuiApplication on the offscreen platform) that Qt
// types such as QSettings, QThread event loops and timers expect, without any
// window system.
#include "core.hpp"

#include <QCoreApplication>
#include <QThread>
#ifdef BUN_EMU_HOST_QT_GUI
#include <QGuiApplication>
#endif

#include <cstdlib>
#include <mutex>

namespace bun::emu::qt {
namespace {
std::once_flag once;
int argc = 1;
char arg0[] = "bun-emu-host";
char* argv[] = {arg0, nullptr};
QThread* owner = nullptr;
}  // namespace

void ensure_application(bool gui) {
  std::call_once(once, [gui] {
    if (QCoreApplication::instance()) {
      owner = QCoreApplication::instance()->thread();
      return;
    }
    // The application object lives for the rest of the process: Qt does not
    // support re-creating it, and the plugin may be loaded by several hosts.
#ifdef BUN_EMU_HOST_QT_GUI
    if (gui) {
      if (!std::getenv("QT_QPA_PLATFORM")) qputenv("QT_QPA_PLATFORM", "offscreen");
      new QGuiApplication(argc, argv);
    } else {
      new QCoreApplication(argc, argv);
    }
#else
    (void)gui;
    new QCoreApplication(argc, argv);
#endif
    QCoreApplication::setOrganizationName(QStringLiteral("Bun OS"));
    QCoreApplication::setApplicationName(QStringLiteral("bun-emu-host"));
    owner = QThread::currentThread();
  });
}

void pump_events() {
  if (owner && QThread::currentThread() == owner) QCoreApplication::processEvents(QEventLoop::AllEvents, 0);
}

}  // namespace bun::emu::qt
