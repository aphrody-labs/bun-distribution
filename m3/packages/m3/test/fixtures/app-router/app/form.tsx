"use client";
import { useActionState } from "react";
import { greet } from "./actions";

export function Form() {
  const [message, action] = useActionState(greet, "");
  return (
    <form action={action}>
      <input name="name" />
      <output id="greeting">{message}</output>
    </form>
  );
}
