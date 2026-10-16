(function () {
  "use strict";
  (async function () {
    try {
      const response = await fetch("/latest.json", { cache: "no-cache" });
      const release = await response.json();
      const pack = release.artifacts.find(function (a) {
        return a.kind === "pack" && a.platform === "windows-x64";
      });
      if (!pack) return;
      document.getElementById("download").href = pack.url;
      document.getElementById("meta").textContent =
        "v" +
        release.version +
        " · Windows · " +
        Math.round(pack.size / 1048576) +
        " Mo";
    } catch {}
  })();
})();
