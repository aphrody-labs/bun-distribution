import { MdType } from "@aphrody/m3-react";
import { Fade, Zoom } from "@mui/material";

export function G() {
  return (
    <>
      {/* MIGRATION-TODO: Container (layout) -> <div> : reporter spacing/direction/grid sur des utilitaires Tailwind (cf. §6). */}
      <div maxWidth="sm">
        {/* MIGRATION-TODO: Grid (layout) -> <div> : reporter spacing/direction/grid sur des utilitaires Tailwind (cf. §6). */}
        <div container spacing={2}>
          {/* MIGRATION-TODO: Grid (layout) -> <div> : reporter spacing/direction/grid sur des utilitaires Tailwind (cf. §6). */}
          <div item xs={6}>
            <MdType>a</MdType>
          </div>
          {/* MIGRATION-TODO: Grid (layout) -> <div> : reporter spacing/direction/grid sur des utilitaires Tailwind (cf. §6). */}
          <div item xs={6}>
            {/* MIGRATION-TODO: prop `color` retiree : pas d-equivalent direct md (gerer via tokens/density/theme). */}
            <MdType>b</MdType>
          </div>
        </div>
      </div>
      {/* MIGRATION-TODO: Fade : transition (gap) -> @aphrody/m3-motion + motion tokens. Aucune transformation auto (cf. 05-gap-analysis.md). */}
      <Fade in>
        <span>f</span>
      </Fade>
      {/* MIGRATION-TODO: Zoom : transition (gap) -> @aphrody/m3-motion + motion tokens. Aucune transformation auto (cf. 05-gap-analysis.md). */}
      <Zoom in>
        <span>z</span>
      </Zoom>
    </>
  );
}
