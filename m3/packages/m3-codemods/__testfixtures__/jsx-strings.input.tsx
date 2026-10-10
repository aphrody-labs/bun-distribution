import { Button } from "@mui/material";

const s = "<Button>not jsx</Button>";
const _t = `<Button variant="outlined">${s}</Button>`;
// <Button sx={{}}> in a comment

export function Q() {
  return (
    <p>
      Don't click: <Button variant="outlined">l'action</Button> c'est ok
      <Button title="it's" sx={{ a: "}" }}>
        {"<Button>"}
      </Button>
    </p>
  );
}
