import { isTauri } from "@aphrody/tauri/api/core";
import { getName, getVersion } from "@aphrody/tauri/api/app";

const status = document.querySelector<HTMLParagraphElement>("#status")!;
if (isTauri()) {
  Promise.all([getName(), getVersion()])
    .then(([name, version]) => {
      status.textContent = `${name} ${version} — WebView Tauri Android`;
    })
    .catch((error) => {
      status.textContent = String(error);
    });
} else {
  status.textContent = "Interface Bun chargée.";
}
