// SPDX-License-Identifier: Apache-2.0
// oxlint-disable-next-line import/no-unassigned-import -- This bundler fixture must emit its virtual symbols stylesheet.
import "m3:symbols.css";
// oxlint-disable-next-line import/no-unassigned-import -- This bundler fixture must emit its virtual fonts stylesheet.
import "m3:fonts.css";
import logo from "./logo.svg?url";
import prism from "./prism.scss?url";

const root = document.getElementById("root");
if (root) root.dataset.logo = logo;
document.head.dataset.prism = prism;
