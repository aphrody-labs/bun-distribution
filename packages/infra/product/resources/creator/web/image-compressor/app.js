/* Compresseur d'images 100 % local : tout se passe dans le navigateur, rien n'est envoyé. */
(function () {
  "use strict";

  var $ = document.getElementById.bind(document);
  var state = { items: [], runId: 0, formats: {} };

  var MIME = { webp: "image/webp", jpeg: "image/jpeg", png: "image/png", avif: "image/avif" };
  var EXT = { webp: ".webp", jpeg: ".jpg", png: ".png", avif: ".avif" };

  function formatBytes(n) {
    if (n < 1024) return n + " o";
    if (n < 1048576) return (n / 1024).toFixed(1) + " Ko";
    return (n / 1048576).toFixed(2) + " Mo";
  }

  function toBlob(canvas, type, quality) {
    return new Promise(function (resolve) {
      canvas.toBlob(resolve, type, quality);
    });
  }

  /** Which output formats this browser can really encode (AVIF/WebP vary by browser). */
  function detectFormats() {
    var probe = document.createElement("canvas");
    probe.width = probe.height = 2;
    var names = ["jpeg", "png", "webp", "avif"];
    return Promise.all(
      names.map(function (name) {
        return toBlob(probe, MIME[name], 0.8).then(function (blob) {
          state.formats[name] = !!blob && blob.type === MIME[name];
          return;
        });
      }),
    );
  }

  function sourceFormat(file) {
    if (/png/i.test(file.type)) return "png";
    if (/webp/i.test(file.type)) return "webp";
    if (/avif/i.test(file.type)) return "avif";
    return "jpeg";
  }

  function options() {
    return {
      format: $("format").value,
      quality: Number($("quality").value) / 100,
      maxSide: Number($("maxSide").value) || 0,
    };
  }

  function compress(file, opts) {
    var target = opts.format === "keep" ? sourceFormat(file) : opts.format;
    if (!state.formats[target]) target = state.formats.webp ? "webp" : "jpeg";
    return createImageBitmap(file, { imageOrientation: "from-image" }).then(function (bitmap) {
      var scale =
        opts.maxSide && Math.max(bitmap.width, bitmap.height) > opts.maxSide
          ? opts.maxSide / Math.max(bitmap.width, bitmap.height)
          : 1;
      var width = Math.max(1, Math.round(bitmap.width * scale));
      var height = Math.max(1, Math.round(bitmap.height * scale));
      var canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      var ctx = canvas.getContext("2d");
      if (target === "jpeg") {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, width, height);
      }
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      return toBlob(canvas, MIME[target], opts.quality).then(function (blob) {
        var sameFormat = target === sourceFormat(file);
        var keepOriginal = !blob || (sameFormat && scale === 1 && blob.size >= file.size);
        return {
          blob: keepOriginal ? file : blob,
          format: keepOriginal ? sourceFormat(file) : target,
          width: width,
          height: height,
          keptOriginal: keepOriginal,
        };
      });
    });
  }

  function baseName(name) {
    return name.replace(/\.[^.]+$/, "");
  }

  function render() {
    var list = $("results");
    list.textContent = "";
    var before = 0;
    var after = 0;
    state.items.forEach(function (item) {
      before += item.file.size;
      var row = document.createElement("li");
      var thumb = document.createElement("img");
      thumb.alt = "";
      if (item.result) {
        item.url = item.url || URL.createObjectURL(item.result.blob);
        thumb.src = item.url;
        after += item.result.blob.size;
      } else {
        after += item.file.size;
      }
      var info = document.createElement("div");
      var name = document.createElement("strong");
      name.textContent = item.file.name;
      var detail = document.createElement("span");
      if (item.error) detail.textContent = "Erreur : " + item.error;
      else if (!item.result) detail.textContent = "Traitement…";
      else {
        var saved = Math.round((1 - item.result.blob.size / item.file.size) * 100);
        detail.textContent =
          formatBytes(item.file.size) +
          " → " +
          formatBytes(item.result.blob.size) +
          (item.result.keptOriginal
            ? " (original conservé : pas de gain)"
            : " (−" + saved + " %)") +
          " · " +
          item.result.width +
          "×" +
          item.result.height;
      }
      info.append(name, detail);
      row.append(thumb, info);
      if (item.result) {
        var link = document.createElement("a");
        link.href = item.url;
        link.download = item.outName;
        link.textContent = "Télécharger";
        row.append(link);
      }
      list.append(row);
    });
    $("summary").textContent = state.items.length
      ? state.items.length +
        " image(s) : " +
        formatBytes(before) +
        " → " +
        formatBytes(after) +
        " (" +
        formatBytes(Math.max(0, before - after)) +
        " économisés)"
      : "";
    $("zip").disabled = !state.items.some(function (i) {
      return i.result;
    });
  }

  function process() {
    var run = (state.runId += 1);
    var opts = options();
    var used = {};
    state.items.forEach(function (item) {
      if (item.url) URL.revokeObjectURL(item.url);
      item.url = item.result = item.error = undefined;
    });
    render();
    return state.items.reduce(function (chain, item) {
      return chain.then(function () {
        if (run !== state.runId) return;
        return compress(item.file, opts)
          .then(function (result) {
            var out = baseName(item.file.name) + EXT[result.format];
            var n = 1;
            while (used[out.toLowerCase()]) {
              n += 1;
              out = baseName(item.file.name) + "-" + n + EXT[result.format];
            }
            used[out.toLowerCase()] = true;
            item.result = result;
            item.outName = out;
            return;
          })
          .catch(function (error) {
            item.error = error && error.message ? error.message : String(error);
            return;
          })
          .then(function () {
            if (run === state.runId) render();
            return;
          });
      });
    }, Promise.resolve());
  }

  function addFiles(files) {
    Array.prototype.forEach.call(files, function (file) {
      if (file.type.startsWith("image/")) state.items.push({ file: file });
    });
    process();
  }

  function downloadZip() {
    var done = state.items.filter(function (i) {
      return i.result;
    });
    Promise.all(
      done.map(function (i) {
        return i.result.blob.arrayBuffer().then(function (buf) {
          return { name: i.outName, data: new Uint8Array(buf) };
        });
      }),
    ).then(function (files) {
      var blob = new Blob([window.MiniZip.buildZip(files)], { type: "application/zip" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "images-compressees.zip";
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
      }, 10000);
      return;
    });
  }

  function init() {
    detectFormats().then(function () {
      Array.prototype.forEach.call($("format").options, function (option) {
        if (option.value !== "keep" && !state.formats[option.value]) option.disabled = true;
      });
      if (state.formats.webp) $("format").value = "webp";
      $("note").textContent = state.formats.avif
        ? ""
        : "AVIF indisponible dans ce navigateur (Chrome/Edge récents l'ont).";
      return;
    });
    $("quality").addEventListener("input", function () {
      $("qualityValue").textContent = $("quality").value;
    });
    ["format", "quality", "maxSide"].forEach(function (id) {
      $(id).addEventListener("change", process);
    });
    $("pick").addEventListener("click", function () {
      $("file").click();
    });
    $("file").addEventListener("change", function () {
      addFiles($("file").files);
      $("file").value = "";
    });
    $("clear").addEventListener("click", function () {
      state.runId += 1;
      state.items.forEach(function (i) {
        if (i.url) URL.revokeObjectURL(i.url);
      });
      state.items = [];
      render();
    });
    $("zip").addEventListener("click", downloadZip);
    var drop = $("drop");
    ["dragenter", "dragover"].forEach(function (type) {
      drop.addEventListener(type, function (e) {
        e.preventDefault();
        drop.classList.add("over");
      });
    });
    ["dragleave", "drop"].forEach(function (type) {
      drop.addEventListener(type, function (e) {
        e.preventDefault();
        drop.classList.remove("over");
      });
    });
    drop.addEventListener("drop", function (e) {
      addFiles(e.dataTransfer.files);
    });
    document.addEventListener("paste", function (e) {
      addFiles(e.clipboardData ? e.clipboardData.files : []);
    });
  }

  if (typeof document !== "undefined") init();
})();
