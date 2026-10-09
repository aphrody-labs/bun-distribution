import { MdCard, MdOutlinedButton, MdType } from "@aphrody/m3-react";
import { Modal, ThemeProvider } from "@mui/material";
import React from "react";

export function Page() {
  return (
    <ThemeProvider theme={t}>
      {/* MIGRATION-TODO: prop `sx` retiree : convertir en classes Tailwind (host/layout) + tokens --md-sys-* (le shadow DOM n-est pas atteignable par Tailwind, cf. §6). */}
      {/* MIGRATION-TODO: Box (layout) -> <div> : reporter spacing/direction/grid sur des utilitaires Tailwind (cf. §6). */}
      <div className="wrap">
        {/* MIGRATION-TODO: Stack (layout) -> <div> : reporter spacing/direction/grid sur des utilitaires Tailwind (cf. §6). */}
        <div direction="row" spacing={2}>
          <MdType variant="h1">Titre</MdType>
          <MdOutlinedButton>Go</MdOutlinedButton>
        </div>
        {/* MIGRATION-TODO: Modal : primitive (gap) -> md-dialog (modal) + md-backdrop pour le scrim. Aucune transformation auto (cf. 05-gap-analysis.md). */}
        <Modal open={open}>
          <div>contenu</div>
        </Modal>
        <MdCard>carte</MdCard>
      </div>
    </ThemeProvider>
  );
}
