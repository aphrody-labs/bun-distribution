// SPDX-License-Identifier: Apache-2.0
// This consumer intentionally uses stage 3 decorators and verbatim imports, unlike the fork's source compiler.
// eslint-disable-next-line import/no-unassigned-import -- Importing the catalog registers the public custom elements.
import "@aphrody/material-web/all.js";
import { MdFilledButton } from "@aphrody/material-web/button/filled-button.js";
import { MdOutlinedTextField } from "@aphrody/material-web/textfield/outlined-text-field.js";
import type { M3Canvas3D } from "@aphrody/material-web/canvas3d/canvas-3d.js";

const button = new MdFilledButton();
button.disabled = true;
const field: HTMLElementTagNameMap["md-outlined-text-field"] = new MdOutlinedTextField();
field.value = "Production consumer";
const canvas = null as M3Canvas3D | null;
void canvas?.requestRender();
