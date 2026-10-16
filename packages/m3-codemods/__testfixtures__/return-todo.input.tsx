// En-tete de licence
"use client";
"use strict";
import { Switch } from "@mui/material";
import { useState } from "react";

export function S() {
  const [on, setOn] = useState(false);
  return <Switch checked={on} onChange={(e, v) => setOn(v)} />;
}
