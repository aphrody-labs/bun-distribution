import { observeWindowClass } from "@aphrody/m3-front";

observeWindowClass((s) => {
  const el = document.getElementById("window-class");
  if (el)
    el.textContent = `${s.width} x ${s.height} (${s.navigation}, ${s.panes} pane${s.panes > 1 ? "s" : ""})`;
});
