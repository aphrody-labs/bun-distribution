import { Button, IconButton } from "@mui/material";
import Add from "@mui/icons-material/Add";

export const A = () => (
  <div>
    <Button startIcon={<Add />} endIcon={<Add />} />
    <Button startIcon="x">s</Button>
    <Button endIcon={<Add />}>fin</Button>
    <IconButton aria-label="add">
      <Add />
    </IconButton>
  </div>
);
