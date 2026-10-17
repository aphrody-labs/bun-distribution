// SPDX-License-Identifier: Apache-2.0
// Studio bridge: typed calls to the native Studio commands of the desktop app (crates/ui/app/src/studio.rs).
import { invoke } from "@aphrody/tauri/api/core";
import { isTauri } from "./tauri-bridge";

async function studio<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!isTauri()) throw new Error("Cette vue nécessite l’application Aphrody.");
  return invoke<T>(command, args);
}

export interface GoogleDriveGrant {
  access_token: string;
  refresh_token: string;
  client_id: string;
  client_secret: string;
}

/** Google OAuth loopback consent with the Aphrody OAuth client; tokens kept in the private store. */
export const authorizeGoogleDrive = () => studio<GoogleDriveGrant>("studio_google_drive_authorize");
