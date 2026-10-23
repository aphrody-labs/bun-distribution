// SPDX-License-Identifier: Apache-2.0
// Notifications and screen-reader hints. Any app dispatches
//   dispatchEvent(new CustomEvent("aph:notify", { detail: { title: "Saved", body: "notes.md" } }))
// and the shell shows a toast (unless notifications are off or Do not disturb is on), plays the notify cue and,
// when allowed and the tab is hidden, a system notification. announce() speaks a short status through a live
// region when the "a11y.announce" preference is on.
import { h, icon } from "./dom";
import { prefs } from "./prefs";
import { playSound } from "./sounds";

export interface NotifyDetail {
  title: string;
  body?: string;
  /** Shell icon name (dom.ts). */
  icon?: string;
}

const tray = h("section", {
  class: "toasts",
  "aria-label": "Notifications",
  role: "region",
});
const live = h("div", {
  class: "sr-only",
  role: "status",
  "aria-live": "polite",
});

/** Speak a short status to screen readers (window opened, workspace changed, setting applied). */
export function announce(text: string) {
  if (!prefs.get("a11y.announce")) return;
  live.textContent = "";
  // A fresh text node after a frame makes repeated messages speak again.
  requestAnimationFrame(() => (live.textContent = text));
}

/** Show a notification now, honouring the notification preferences. */
export function notify(detail: NotifyDetail) {
  if (!prefs.get("notify.enabled") || prefs.get("notify.dnd")) return;
  playSound("notify");
  if (
    prefs.get("notify.system") &&
    document.hidden &&
    "Notification" in window &&
    Notification.permission === "granted"
  ) {
    new Notification(detail.title, {
      body: detail.body,
      icon: "/brand/128.png",
    });
    return;
  }
  const close = () => {
    toast.classList.add("leaving");
    setTimeout(() => toast.remove(), 200);
  };
  const toast = h(
    "div",
    { class: "toast", role: "status" },
    icon(detail.icon ?? "info"),
    h(
      "div",
      { class: "toast-text" },
      h("strong", {}, detail.title),
      detail.body ? h("span", {}, detail.body) : null,
    ),
    h(
      "button",
      { class: "tbtn", "aria-label": "Dismiss notification", onclick: close },
      icon("close"),
    ),
  );
  tray.append(toast);
  setTimeout(close, prefs.get("notify.duration") * 1000);
}

/** Ask the browser for system notifications; returns the resulting permission. */
export async function requestSystemNotifications(): Promise<
  NotificationPermission | "unsupported"
> {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission === "default"
    ? Notification.requestPermission()
    : Notification.permission;
}

export function installNotifications() {
  document.body.append(tray, live);
  addEventListener("aph:notify", (e) => {
    const d = (e as CustomEvent<Partial<NotifyDetail> | undefined>).detail;
    notify({ title: d?.title ?? "Notification", body: d?.body, icon: d?.icon });
  });
}
