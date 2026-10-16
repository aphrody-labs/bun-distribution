// En-tete de licence
"use client";
"use strict";
import { MdSwitch } from "@aphrody/m3-react";
import { useState } from "react";

export function S() {
  const [on, setOn] = useState(false);
  return (
    /* MIGRATION-TODO: onChange(e, value) MUI -> material-web emet (input/change) natifs : lire e.target.value (le 2e parametre disparait). */
    <MdSwitch checked={on} onChange={(e, v) => setOn(v)} />
  );
}
