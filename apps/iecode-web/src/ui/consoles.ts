type ConsoleId = "dust" | "wii" | "switch" | "ctr";

const consoleStatus: Record<
  Exclude<ConsoleId, "dust" | "wii">,
  { title: string; message: string }
> = {
  switch: {
    title: "Switch",
    message: "Not available yet.",
  },
  ctr: {
    title: "3DS",
    message: "Not available yet.",
  },
};

export function installConsoleSwitcher(suspendDust: () => void): void {
  const status = document.getElementById("console-status") as HTMLElement;
  const title = document.getElementById("console-status-title") as HTMLElement;
  const message = document.getElementById("console-status-message") as HTMLElement;
  const canvas = document.getElementById("canvas-container") as HTMLElement;
  const menu = document.getElementById("menu-container") as HTMLElement;
  const wii = document.getElementById("wii-frame") as HTMLIFrameElement;
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-console-target]");

  for (const button of buttons) {
    button.addEventListener("click", () => {
      const selected = button.dataset["consoleTarget"] as ConsoleId;
      if (selected !== "dust" && selected !== "wii" && !(selected in consoleStatus)) return;
      if (selected !== "dust") suspendDust();

      document.body.dataset["console"] = selected;
      for (const item of buttons) {
        item.setAttribute("aria-pressed", String(item === button));
      }

      const dustSelected = selected === "dust";
      canvas.hidden = !dustSelected;
      menu.hidden = !dustSelected;
      canvas.inert = !dustSelected;
      menu.inert = !dustSelected;
      const wiiSelected = selected === "wii";
      wii.hidden = !wiiSelected;
      wii.inert = !wiiSelected;
      if (wiiSelected && !wii.hasAttribute("src")) wii.src = "wii/index.html";
      if (!wiiSelected && wii.hasAttribute("src")) wii.removeAttribute("src");
      status.hidden = dustSelected || wiiSelected;
      if (selected !== "dust" && selected !== "wii") {
        title.textContent = consoleStatus[selected].title;
        message.textContent = consoleStatus[selected].message;
      }
    });
  }
}
