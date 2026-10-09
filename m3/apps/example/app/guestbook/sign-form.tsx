"use client";
// SPDX-License-Identifier: Apache-2.0
import { useActionState } from "react";
import { type SignState, sign } from "./actions";

const INITIAL: SignState = {};

export function SignForm() {
  const [state, action, pending] = useActionState(sign, INITIAL);
  return (
    <form action={action} className="flex flex-col gap-2 max-w-md">
      <input name="name" placeholder="Name" required className="h-10 px-4 rounded-full border border-outline-variant" />
      <textarea
        name="message"
        placeholder="Message"
        required
        className="p-4 rounded-xl border border-outline-variant"
      />
      <button type="submit" disabled={pending} className="self-start h-10 px-6 rounded-full bg-primary text-on-primary">
        Sign
      </button>
      {state.error && <p role="alert">{state.error}</p>}
      {state.signed && <p id="signed">Thanks, {state.signed}!</p>}
    </form>
  );
}
