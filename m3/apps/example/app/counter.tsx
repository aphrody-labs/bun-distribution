"use client";
// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button
      type="button"
      id="counter"
      className="self-start h-10 px-6 rounded-full bg-primary text-on-primary"
      onClick={() => setCount(c => c + 1)}
    >
      Clicked {count} times
    </button>
  );
}
