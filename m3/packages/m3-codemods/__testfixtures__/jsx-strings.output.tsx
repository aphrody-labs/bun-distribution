import { MdFilledButton, MdOutlinedButton } from "@aphrody/m3-react";

const s = "<Button>not jsx</Button>";
const _t = `<Button variant="outlined">${s}</Button>`;
// <Button sx={{}}> in a comment

export function Q() {
  return (
    <p>
      Don't click: <MdOutlinedButton>l'action</MdOutlinedButton> c'est ok
      {/* MIGRATION-TODO: prop `sx` retiree : convertir en classes Tailwind (host/layout) + tokens --md-sys-* (le shadow DOM n-est pas atteignable par Tailwind, cf. §6). */}
      <MdFilledButton title="it's">{"<Button>"}</MdFilledButton>
    </p>
  );
}
