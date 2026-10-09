// oxlint-disable-next-line eslint/no-unused-vars -- fixture : Unused est conservé volontairement (nom MUI sans mapping) par le transform.
import { Facebook, NotARealIconZzz, Unused } from "@mui/icons-material";
// oxlint-disable-next-line import/no-unassigned-import -- effet de bord voulu : enregistre le custom element md-icon.
import "@aphrody/material-web/icon/icon.js";

export function I(props) {
  return (
    <nav>
      {/* MIGRATION-TODO: icone Close: props MUI (fontSize/color/sx) retirees -> piloter via --md-icon-size / --md-icon-fill / currentColor. */}
      <md-icon>close</md-icon>
      {/* MIGRATION-TODO: icone Delete: props MUI (fontSize/color/sx) retirees -> piloter via --md-icon-size / --md-icon-fill / currentColor. */}
      <md-icon>delete</md-icon>
      {/* MIGRATION-TODO: icone Facebook: logo de marque absent de Material Symbols -> garder en SVG (set de marque dedie). Slug suggere: facebook. */}
      <Facebook />
      {/* MIGRATION-TODO: icone NotARealIconZzz: nom Material Symbols non valide (devine: "not_a_real_icon_zzz") -> verifier sur fonts.google.com/icons puis <md-icon>nom</md-icon>. */}
      <NotARealIconZzz />
      <md-icon>settings</md-icon>
      <md-icon>account_circle</md-icon>
      {props.ok /* MIGRATION-TODO: icone Settings: props MUI (fontSize/color/sx) retirees -> piloter via --md-icon-size / --md-icon-fill / currentColor. */ && (
        <md-icon>settings</md-icon>
      )}
    </nav>
  );
}
