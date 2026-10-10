/* SPDX-License-Identifier: Apache-2.0 */
/* YouTube Subs Sorter - popup: groups, settings, JSON backup. Same storage key as the content script. */
const $ = (id) => document.getElementById(id);

(function () {
  "use strict";

  const core = globalThis.YSS;
  const api = typeof browser !== "undefined" ? browser : chrome;
  const STORE_KEY = "yss";

  const ERRORS = {
    "name-empty": "Le nom est vide.",
    "name-duplicate": "Ce groupe existe déjà.",
    "too-many-groups": "Trop de groupes.",
    "color-invalid": "Couleur invalide.",
    "group-unknown": "Groupe introuvable.",
  };

  let state = core.emptyState();

  async function load() {
    const res = await api.storage.local.get(STORE_KEY);
    return core.normalizeState(res && res[STORE_KEY]).state;
  }

  async function mutate(fn) {
    const current = await load();
    const next = fn(current);
    if (next !== current) await api.storage.local.set({ [STORE_KEY]: next });
    state = next;
    render();
  }

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === false || v === null || v === undefined) continue;
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    el.append(...kids.flat().filter((x) => x !== null && x !== undefined));
    return el;
  }

  function showGroupError(code) {
    const el = $("group-error");
    el.hidden = !code;
    el.textContent = code ? ERRORS[code] || code : "";
  }

  function renderGroups() {
    const { counts, assigned } = core.countByGroup(state);
    $("groups").replaceChildren(
      ...state.groups.map((g) => {
        const color = h("input", {
          type: "color",
          value: g.color,
          "aria-label": `Couleur de ${g.name}`,
        });
        color.addEventListener("change", () =>
          mutate((s) => core.updateGroup(s, g.id, { color: color.value }).state),
        );
        const name = h("input", {
          type: "text",
          value: g.name,
          maxlength: "40",
          "aria-label": "Nom du groupe",
        });
        name.addEventListener("change", () =>
          mutate((s) => {
            const res = core.updateGroup(s, g.id, { name: name.value });
            showGroupError(res.error);
            return res.state;
          }),
        );
        const del = h("button", { type: "button", "aria-label": `Supprimer ${g.name}` }, "✕");
        let armed = 0;
        del.addEventListener("click", () => {
          if (!armed) {
            armed = setTimeout(() => {
              armed = 0;
              del.removeAttribute("data-armed");
              del.textContent = "✕";
            }, 3000);
            del.setAttribute("data-armed", "");
            del.textContent = "Confirmer ?";
            return;
          }
          clearTimeout(armed);
          mutate((s) => core.deleteGroup(s, g.id));
        });
        const n = counts[g.id] || 0;
        return h(
          "li",
          null,
          color,
          name,
          h("span", { class: "count" }, `${n} chaîne${n > 1 ? "s" : ""}`),
          del,
        );
      }),
    );
    $("empty").hidden = state.groups.length > 0;
    $("summary").textContent =
      `${assigned} chaîne${assigned > 1 ? "s" : ""} classée${assigned > 1 ? "s" : ""}. Les groupes se choisissent depuis YouTube (liste des abonnements, page chaîne, page vidéo).`;
    const next = core.PALETTE[state.groups.length % core.PALETTE.length];
    if (document.activeElement !== $("new-color")) $("new-color").value = next;
  }

  function renderSettings() {
    const s = state.settings;
    $("hideShorts").checked = s.hideShorts;
    $("hideWatched").checked = s.hideWatched;
    $("badges").checked = s.badges;
    $("threshold").value = String(s.watchedThreshold);
    $("threshold-out").textContent = `${s.watchedThreshold} %`;
    $("sort").value = s.sort;
  }

  function render() {
    renderGroups();
    renderSettings();
  }

  const setSetting = (key, value) =>
    mutate((s) => ({
      ...s,
      settings: core.normalizeSettings({ ...s.settings, [key]: value }, s.groups),
    }));

  function status(text, isError) {
    const el = $("io-status");
    el.textContent = text;
    el.className = isError ? "error" : "dim";
  }

  function exportText() {
    return JSON.stringify(core.exportState(state), null, 2);
  }

  function bind() {
    $("add-group").addEventListener("submit", (ev) => {
      ev.preventDefault();
      mutate((s) => {
        const res = core.addGroup(s, $("new-name").value, $("new-color").value);
        showGroupError(res.error);
        if (res.group) $("new-name").value = "";
        return res.state;
      });
    });
    for (const id of ["hideShorts", "hideWatched", "badges"])
      $(id).addEventListener("change", (ev) => setSetting(id, ev.currentTarget.checked));
    $("threshold").addEventListener("input", (ev) => {
      $("threshold-out").textContent = `${ev.currentTarget.value} %`;
    });
    $("threshold").addEventListener("change", (ev) =>
      setSetting("watchedThreshold", Number(ev.currentTarget.value)),
    );
    $("sort").addEventListener("change", (ev) => setSetting("sort", ev.currentTarget.value));

    $("export").addEventListener("click", () => {
      $("json").value = exportText();
      status("Sauvegarde générée ci-dessus.");
    });
    $("download").addEventListener("click", () => {
      const url = URL.createObjectURL(new Blob([exportText()], { type: "application/json" }));
      const a = h("a", {
        href: url,
        download: `yt-subs-sorter-${new Date().toISOString().slice(0, 10)}.json`,
      });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      status("Fichier téléchargé.");
    });
    $("copy").addEventListener("click", async () => {
      const text = exportText();
      $("json").value = text;
      try {
        await navigator.clipboard.writeText(text);
        status("Sauvegarde copiée dans le presse-papiers.");
      } catch {
        $("json").select();
        status("Copie auto refusée : texte sélectionné, fais Ctrl+C.", true);
      }
    });
    $("file").addEventListener("change", async (ev) => {
      const file = ev.currentTarget.files && ev.currentTarget.files[0];
      if (!file) return;
      $("json").value = await file.text();
      status(`${file.name} chargé : clique sur Importer.`);
    });
    $("import").addEventListener("click", async () => {
      const res = core.validateImport($("json").value);
      if (!res.ok) {
        status(`Import refusé : ${res.errors.join(" ; ")}`, true);
        return;
      }
      const mode = document.querySelector('input[name="mode"]:checked').value;
      await mutate((s) => core.mergeImport(s, res.state, mode));
      const warn = res.warnings.length ? ` (${res.warnings.length} entrée(s) ignorée(s))` : "";
      status(
        `Import terminé (${mode === "replace" ? "remplacement" : "fusion"}) : ${res.state.groups.length} groupe(s), ${Object.keys(res.state.channels).length} chaîne(s)${warn}.`,
      );
    });
  }

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STORE_KEY]) return;
    state = core.normalizeState(changes[STORE_KEY].newValue).state;
    render();
  });

  bind();
  (async () => {
    try {
      state = await load();
      render();
    } catch (err) {
      status(`Lecture du stockage impossible : ${err && err.message}`, true);
    }
  })();
})();
