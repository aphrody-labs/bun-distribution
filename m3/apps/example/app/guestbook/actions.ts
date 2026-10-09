"use server";
// SPDX-License-Identifier: Apache-2.0
import { revalidatePath } from "next/cache";
import { addEntry } from "../../lib/guestbook";

export interface SignState {
  error?: string;
  signed?: string;
}

export async function sign(_previous: SignState, form: FormData): Promise<SignState> {
  const name = String(form.get("name") ?? "").trim();
  const message = String(form.get("message") ?? "").trim();
  if (!name || !message) return { error: "Name and message are required." };
  addEntry(name, message);
  revalidatePath("/guestbook");
  return { signed: name };
}
