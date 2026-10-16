// oxlint-disable-next-line import/no-unassigned-import -- Registers md-icon used by the migrated JSX.
import "@aphrody/material-web/icon/icon.js";

import { MdFilledButton, MdIconButton } from "@aphrody/m3-react";
import Add from "@mui/icons-material/Add";

export const A = () => (
  <div>
    {/* MIGRATION-TODO: endIcon -> md-button n-a qu-un slot "icon" : repositionner manuellement (slot trailing). */}
    <MdFilledButton />
    <MdFilledButton>s</MdFilledButton>
    {/* MIGRATION-TODO: endIcon -> md-button n-a qu-un slot "icon" : repositionner manuellement (slot trailing). */}
    <MdFilledButton>
      <md-icon slot="icon">{<Add />}</md-icon>fin
    </MdFilledButton>
    <MdIconButton aria-label="add">
      <Add />
    </MdIconButton>
  </div>
);
