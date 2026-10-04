// SPDX-License-Identifier: Apache-2.0
import "m3:symbols.css";
import "m3:fonts.css";
import logo from "./logo.svg?url";
import prism from "./prism.scss?url";

const root = document.getElementById("root");
if (root) root.dataset.logo = logo;
document.head.dataset.prism = prism;
