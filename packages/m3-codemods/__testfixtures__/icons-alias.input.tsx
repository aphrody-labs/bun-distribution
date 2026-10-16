// oxlint-disable-next-line eslint/no-unused-vars -- fixture : Unused est conservé volontairement (nom MUI sans mapping) par le transform.
import {
  Close as X,
  Delete,
  Facebook,
  NotARealIconZzz,
  Unused,
} from "@mui/icons-material";
import Settings from "@mui/icons-material/Settings";
import AccountCircleOutlined from "@mui/icons-material/AccountCircleOutlined";
// oxlint-disable-next-line import/no-unassigned-import -- effet de bord voulu : enregistre le custom element md-icon.
import "@aphrody/material-web/icon/icon.js";

export function I(props) {
  return (
    <nav>
      <X {...props} />
      <Delete color="error">texte</Delete>
      <Facebook />
      <NotARealIconZzz />
      <Settings></Settings>
      <AccountCircleOutlined />
      {props.ok && <Settings sx={{ fontSize: 12 }} />}
    </nav>
  );
}
