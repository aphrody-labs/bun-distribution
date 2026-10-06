(function () {
  "use strict";
  fetch("/latest.json", { cache: "no-cache" })
    .then(function (response) {
      return response.json();
    })
    .then(function (release) {
      var pack = release.artifacts.find(function (a) {
        return a.kind === "pack" && a.platform === "windows-x64";
      });
      if (!pack) return;
      document.getElementById("download").href = pack.url;
      document.getElementById("meta").textContent =
        "v" + release.version + " · Windows · " + Math.round(pack.size / 1048576) + " Mo";
    })
    .catch(function () {});
})();
