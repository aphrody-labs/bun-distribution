import { Close as X, Delete, Facebook, NotARealIconZzz, Unused } from "@mui/icons-material";
import Settings from "@mui/icons-material/Settings";
import AccountCircleOutlined from "@mui/icons-material/AccountCircleOutlined";
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
