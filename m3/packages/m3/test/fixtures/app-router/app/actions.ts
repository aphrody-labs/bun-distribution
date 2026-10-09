"use server";
import { redirect } from "next/navigation";

export async function greet(_previous: string, form: FormData): Promise<string> {
  return `Hello ${form.get("name")}`;
}

export async function add(a: number, b: number): Promise<number> {
  return a + b;
}

export async function goHome(): Promise<never> {
  redirect("/");
}
