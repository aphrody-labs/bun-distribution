"use client";

import { useSyncExternalStore } from "react";

const permissionChanged = "rg-notification-permission";
const snapshot = (): NotificationPermission =>
  typeof Notification === "undefined" ? "default" : Notification.permission;
const serverSnapshot = (): NotificationPermission => "default";
function subscribe(listener: () => void) {
  let disposed = false;
  let status: PermissionStatus | undefined;
  window.addEventListener("focus", listener);
  window.addEventListener(permissionChanged, listener);
  if (navigator.permissions) {
    void navigator.permissions
      .query({ name: "notifications" })
      .then((permission) => {
        if (disposed) return;
        status = permission;
        status.addEventListener("change", listener);
        listener();
      })
      .catch(() => {});
  }
  return () => {
    disposed = true;
    status?.removeEventListener("change", listener);
    window.removeEventListener("focus", listener);
    window.removeEventListener(permissionChanged, listener);
  };
}
export function useNotificationPermission(): NotificationPermission {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
export function refreshNotificationPermission(): void {
  window.dispatchEvent(new Event(permissionChanged));
}
