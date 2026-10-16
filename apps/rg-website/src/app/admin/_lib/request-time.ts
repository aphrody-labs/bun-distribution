import { connection } from "next/server";

/** Capture the clock only after a real server request has arrived. */
export async function getRequestTime(): Promise<Date> {
  await connection();
  return new Date();
}
