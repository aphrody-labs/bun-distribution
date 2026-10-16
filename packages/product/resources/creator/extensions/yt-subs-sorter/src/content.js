/* SPDX-License-Identifier: Apache-2.0 */
/*
 * YouTube Subs Sorter - content script (thin DOM glue; the decisions live in core.js).
 * No network call, no remote code, no background page. State: storage.local["yss"].
 */
(function () {
  "use strict";

  const core = globalThis.YSS;
  if (!core || globalThis.__yssLoaded) return;
  globalThis.__yssLoaded = true;

  const api = typeof browser !== "undefined" ? browser : chrome;
  const STORE_KEY = "yss";
  const THROTTLE_MS = 250;

  const T = {
    groups: "Groupes",
    all: "Tous",
    none: "Sans groupe",
    hideShorts: "Masquer les Shorts",
    hideWatched: "Masquer les vues",
    sort: "Tri",
    sortDefault: "YouTube",
    sortAlpha: "A → Z",
    sortGroup: "Par groupe",
    assign: "Groupes",
    newGroup: "Nouveau groupe",
    create: "Ajouter",
    errors: {
      "name-empty": "Nom vide.",
      "name-duplicate": "Ce groupe existe déjà.",
      "too-many-groups": "Trop de groupes.",
    },
  };

  /*
   * Every YouTube selector lives here. Status (checked 2026-10-06):
   *   V = seen in a real Chromium 153 render of logged-out youtube.com pages (search, channel, watch)
   *   B = element/class names found in the current production bundle (kevlar_base JS + CSS), not seen rendered
   *   ? = best effort, depends on the logged-in feed that could not be rendered here
   */
  const selectors = Object.freeze({
    // active page = the [role=main] child of ytd-page-manager, inactive ones carry [hidden] (V: home, search, watch)
    // browse page: ytd-browse > ytd-two-column-browse-results-renderer > #primary (V, home page)
    browsePrimary: "ytd-page-manager > ytd-browse:not([hidden]) #primary",
    browse: "ytd-page-manager > ytd-browse:not([hidden])",
    activePage: 'ytd-page-manager > [role="main"]:not([hidden])',
    // /feed/subscriptions
    feedItem:
      "ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer", // B (rich, grid) + V (ytd-video-renderer); ? for the real feed
    shortsShelf: "ytd-rich-shelf-renderer[is-shorts], ytd-reel-shelf-renderer", // B
    shortsSection: "ytd-rich-section-renderer", // B
    shortLink: 'a[href^="/shorts/"]', // V
    shortLockup:
      "ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2, ytd-reel-item-renderer", // V
    progressOverlay:
      "ytw-thumbnail-overlay-resume-playback-renderer, ytd-thumbnail-overlay-resume-playback-renderer, yt-thumbnail-overlay-progress-bar-view-model", // B
    progressFill:
      ".ytwThumbnailOverlayResumePlaybackRendererThumbnailOverlayResumePlaybackProgress, .ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment, #progress", // B
    channelLink:
      'a[href^="/@"], a[href^="/channel/UC"], a[href^="/c/"], a[href^="/user/"]', // V
    channelName:
      "ytd-channel-name #text, ytd-channel-name a, #channel-title, .ytContentMetadataViewModelMetadataText", // V (ytd-channel-name), ? for lockups in the feed
    // /feed/channels
    channelRow: "ytd-channel-renderer", // V
    // channel page
    channelActions: "yt-flexible-actions-view-model", // V
    channelActionsLegacy:
      "#channel-header-container #buttons, ytd-c4-tabbed-header-renderer #buttons", // ?
    // watch page
    watchOwner: "ytd-watch-metadata #owner", // V
    watchOwnerRenderer: "ytd-video-owner-renderer", // V
  });

  let state = core.emptyState();
  let loaded = false;
  let observer = null;
  let observed = null;
  let timer = 0;
  let lastRun = 0;
  let picker = null;
  const pendingPairs = new Map();

  // ------------------------------------------------------------------ storage

  async function load() {
    const res = await api.storage.local.get(STORE_KEY);
    return core.normalizeState(res && res[STORE_KEY]).state;
  }

  /** Read-modify-write on fresh storage content, so two tabs do not overwrite each other with stale data. */
  async function mutate(fn) {
    try {
      const current = await load();
      const next = fn(current);
      if (next !== current) await api.storage.local.set({ [STORE_KEY]: next });
      state = next;
      schedule();
      renderPicker();
    } catch (err) {
      console.warn("[yt-subs-sorter]", err);
    }
  }

  const setSetting = (key, value) =>
    mutate((s) => ({ ...s, settings: { ...s.settings, [key]: value } }));

  // ------------------------------------------------------------------ small DOM helpers

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === false || v === null || v === undefined) continue;
      if (k === "style")
        for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    el.append(
      ...kids
        .flat()
        .filter((x) => x !== null && x !== undefined && x !== false),
    );
    return el;
  }

  const dot = (color) =>
    h("span", { class: "yss-dot", style: { background: color } });
  const groupById = (id) => state.groups.find((g) => g.id === id);

  function textOf(el) {
    if (!el) return "";
    return (el.getAttribute("title") || el.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function keysIn(root) {
    const keys = [];
    for (const a of root.querySelectorAll(selectors.channelLink)) {
      const ref = core.parseChannelRef(a.getAttribute("href"));
      if (ref && !keys.includes(ref.key)) keys.push(ref.key);
    }
    return keys;
  }

  /** One element showing a handle and a channel id is the same channel: remember it (batched per pass). */
  function notePair(keys) {
    const pair = core.pairForAlias(keys);
    if (
      pair &&
      core.resolveKey(state, pair.handle) !== core.resolveKey(state, pair.id)
    )
      pendingPairs.set(pair.handle + "|" + pair.id, pair);
  }

  function flushPairs() {
    if (!pendingPairs.size) return;
    const batch = [...pendingPairs.values()];
    pendingPairs.clear();
    mutate((s) =>
      batch.reduce((acc, p) => core.learnAlias(acc, p.handle, p.id), s),
    );
  }

  function mark(el, reason) {
    if (reason) {
      if (el.getAttribute("data-yss-hidden") !== reason)
        el.setAttribute("data-yss-hidden", reason);
    } else if (el.hasAttribute("data-yss-hidden")) {
      el.removeAttribute("data-yss-hidden");
    }
  }

  // ------------------------------------------------------------------ group picker (popover)

  function closePicker() {
    if (!picker) return;
    picker.el.remove();
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    picker = null;
  }

  function onOutside(ev) {
    if (
      picker &&
      !picker.el.contains(ev.target) &&
      !picker.anchor.contains(ev.target)
    )
      closePicker();
  }

  function onKey(ev) {
    if (ev.key === "Escape") closePicker();
  }

  function openPicker(anchor, ctx) {
    closePicker();
    picker = {
      anchor,
      ctx,
      error: "",
      el: h("div", {
        class: "yss-ui yss-pop",
        role: "dialog",
        "aria-label": T.assign,
      }),
    };
    document.body.append(picker.el);
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
    renderPicker();
    const r = anchor.getBoundingClientRect();
    const width = picker.el.offsetWidth || 280;
    picker.el.style.top = `${Math.round(r.bottom + window.scrollY + 6)}px`;
    picker.el.style.left = `${Math.round(Math.max(8, Math.min(r.left + window.scrollX, window.innerWidth - width - 8)))}px`;
  }

  const withAlias = (s, keys) => {
    const pair = core.pairForAlias(keys);
    return pair ? core.learnAlias(s, pair.handle, pair.id) : s;
  };

  function renderPicker() {
    if (!picker) return;
    const { ctx, el } = picker;
    const current = core.groupsOfAny(state, ctx.keys);
    const list = state.groups.map((g) =>
      h(
        "label",
        { class: "yss-pop-item" },
        h("input", {
          type: "checkbox",
          checked: current.includes(g.id),
          onchange: () =>
            mutate((s) =>
              core.toggleChannelGroup(
                withAlias(s, ctx.keys),
                ctx.keys,
                ctx.name,
                g.id,
              ),
            ),
        }),
        dot(g.color),
        h("span", { class: "yss-pop-name" }, g.name),
      ),
    );
    const nameInput = h("input", {
      type: "text",
      maxlength: "40",
      placeholder: T.newGroup,
      "aria-label": T.newGroup,
      class: "yss-input",
    });
    const colorInput = h("input", {
      type: "color",
      value: core.PALETTE[state.groups.length % core.PALETTE.length],
      "aria-label": "Couleur",
      class: "yss-color",
    });
    const create = async () => {
      let error = "";
      await mutate((s) => {
        const res = core.addGroup(s, nameInput.value, colorInput.value);
        if (!res.group) {
          error = res.error || "";
          return s;
        }
        return core.toggleChannelGroup(
          withAlias(res.state, ctx.keys),
          ctx.keys,
          ctx.name,
          res.group.id,
        );
      });
      if (picker) {
        picker.error = error ? T.errors[error] || error : "";
        renderPicker();
      }
    };
    for (const type of ["keydown", "keyup", "keypress"]) {
      nameInput.addEventListener(type, (ev) => {
        if (type === "keydown" && ev.key === "Enter") create();
        ev.stopPropagation(); // YouTube binds single-key shortcuts on the page
      });
    }
    el.replaceChildren(
      h("div", { class: "yss-pop-title" }, ctx.name || T.assign),
      ...list,
      h(
        "div",
        { class: "yss-pop-new" },
        nameInput,
        colorInput,
        h(
          "button",
          { class: "yss-btn yss-btn-sm", type: "button", onclick: create },
          T.create,
        ),
      ),
      ...(picker.error
        ? [h("div", { class: "yss-pop-error", role: "alert" }, picker.error)]
        : []),
    );
  }

  /** Button showing the groups of one channel; opens the picker. */
  function assignButton(ctx, extraClass) {
    const groups = core
      .groupsOfAny(state, ctx.keys)
      .map(groupById)
      .filter(Boolean);
    const label = groups.length
      ? groups.length > 1
        ? `${groups[0].name} +${groups.length - 1}`
        : groups[0].name
      : T.assign;
    return h(
      "button",
      {
        type: "button",
        class: `yss-ui yss-btn ${extraClass || ""}`.trim(),
        title: T.assign,
        onclick: (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          openPicker(ev.currentTarget, ctx);
        },
      },
      ...groups.slice(0, 3).map((g) => dot(g.color)),
      h("span", { class: "yss-btn-label" }, label),
    );
  }

  // ------------------------------------------------------------------ filter bar (feed and channel list)

  function renderBar(kind, { el: host, floating }) {
    let bar = document.getElementById("yss-bar");
    if (!bar) bar = h("div", { id: "yss-bar", class: "yss-ui yss-bar" });
    if (floating) {
      if (bar.parentElement !== document.body) document.body.append(bar);
    } else if (host.firstElementChild !== bar) {
      host.prepend(bar);
    }
    bar.toggleAttribute("data-floating", floating);
    const s = state.settings;
    const sig = JSON.stringify([kind, floating, state.groups, s]);
    if (bar.getAttribute("data-sig") === sig) return;
    bar.setAttribute("data-sig", sig);
    const filterKey = kind === "feed" ? "feedFilter" : "listFilter";
    const chip = (value, label, color) =>
      h(
        "button",
        {
          type: "button",
          class: "yss-chip",
          "aria-pressed": String(s[filterKey] === value),
          onclick: () => setSetting(filterKey, value),
        },
        color ? dot(color) : null,
        label,
      );
    const toggle = (key, label) =>
      h(
        "button",
        {
          type: "button",
          class: "yss-chip yss-toggle",
          "aria-pressed": String(s[key]),
          onclick: () => setSetting(key, !s[key]),
        },
        label,
      );
    const parts = [
      h("span", { class: "yss-bar-label" }, T.groups),
      chip("all", T.all),
      ...state.groups.map((g) => chip(g.id, g.name, g.color)),
      chip("none", T.none),
    ];
    if (kind === "feed")
      parts.push(
        h("span", { class: "yss-sep" }),
        toggle("hideShorts", T.hideShorts),
        toggle("hideWatched", T.hideWatched),
      );
    else {
      const select = h(
        "select",
        {
          class: "yss-select",
          "aria-label": T.sort,
          onchange: (ev) => setSetting("sort", ev.currentTarget.value),
        },
        ...[
          ["default", T.sortDefault],
          ["alpha", T.sortAlpha],
          ["group", T.sortGroup],
        ].map(([value, label]) =>
          h("option", { value, selected: s.sort === value }, label),
        ),
      );
      parts.push(
        h("span", { class: "yss-sep" }),
        h("label", { class: "yss-bar-label" }, `${T.sort} `, select),
      );
    }
    bar.replaceChildren(...parts);
  }

  // ------------------------------------------------------------------ pages

  function watchedPct(el) {
    const overlay = el.querySelector(selectors.progressOverlay);
    if (!overlay) return null;
    const fill = overlay.querySelector(selectors.progressFill);
    const pct = fill
      ? core.parsePercent(fill.style.width || fill.getAttribute("style") || "")
      : null;
    return pct === null ? 100 : pct; // overlay present but unreadable: counted as watched
  }

  function renderBadge(el, groupIds) {
    const want = state.settings.badges
      ? groupIds.map(groupById).filter(Boolean)
      : [];
    let badge = Array.from(el.children).find((c) =>
      c.classList.contains("yss-badge"),
    );
    if (!want.length) {
      if (badge) badge.remove();
      return;
    }
    const sig = JSON.stringify([want]);
    if (badge && badge.getAttribute("data-sig") === sig) return;
    if (!badge) badge = h("div", { class: "yss-ui yss-badge" });
    badge.setAttribute("data-sig", sig);
    badge.replaceChildren(
      ...want
        .slice(0, 3)
        .map((g) =>
          h(
            "span",
            { class: "yss-pill", style: { background: g.color } },
            g.name,
          ),
        ),
    );
    el.setAttribute("data-yss-host", "");
    el.append(badge);
  }

  /** Normal place: top of the browse page. Fallback when YouTube changes it: a floating bar. */
  function barHost() {
    const browse =
      document.querySelector(selectors.browsePrimary) ||
      document.querySelector(selectors.browse);
    if (browse) return { el: browse, floating: false };
    const page = document.querySelector(selectors.activePage);
    return page ? { el: page, floating: true } : null;
  }

  function applyFeed() {
    const host = barHost();
    if (host) renderBar("feed", host);
    const s = state.settings;
    for (const shelf of document.querySelectorAll(selectors.shortsShelf))
      mark(
        shelf.closest(selectors.shortsSection) || shelf,
        s.hideShorts ? "short" : null,
      );
    for (const el of document.querySelectorAll(selectors.feedItem)) {
      if (el.parentElement && el.parentElement.closest(selectors.feedItem))
        continue;
      const keys = keysIn(el);
      notePair(keys);
      let groupIds = core.groupsOfAny(state, keys);
      if (!keys.length) {
        const byName = core.resolveByName(
          state,
          textOf(el.querySelector(selectors.channelName)),
        );
        if (byName) groupIds = core.groupsOf(state, byName);
      }
      const isShort = Boolean(
        el.querySelector(selectors.shortLink) ||
        el.querySelector(selectors.shortLockup) ||
        el.closest(selectors.shortsShelf),
      );
      const decision = core.decideFeedItem(
        { isShort, watchedPct: watchedPct(el) },
        s,
        groupIds,
      );
      mark(el, decision.hide ? decision.reason : null);
      renderBadge(el, groupIds);
    }
  }

  function applyChannelList() {
    const host = barHost();
    if (host) renderBar("list", host);
    const s = state.settings;
    const rows = Array.from(document.querySelectorAll(selectors.channelRow));
    const items = rows.map((row) => {
      const keys = keysIn(row);
      notePair(keys);
      return {
        row,
        keys,
        name: textOf(row.querySelector(selectors.channelName)),
      };
    });
    const ranks = core.sortRanks(
      items.map((i) => ({ key: core.bestKey(i.keys), name: i.name })),
      s.sort,
      state,
    );
    const parents = new Set();
    items.forEach((item, index) => {
      const { row, keys, name } = item;
      mark(
        row,
        core.matchesFilter(s.listFilter, core.groupsOfAny(state, keys))
          ? null
          : "group",
      );
      if (ranks) row.style.order = String(ranks[index]);
      else if (row.style.order) row.style.removeProperty("order");
      if (row.parentElement) parents.add(row.parentElement);
      const ctx = { keys, name };
      let ui = Array.from(row.children).find((c) =>
        c.classList.contains("yss-row"),
      );
      const sig = JSON.stringify([
        keys,
        name,
        state.groups,
        core.groupsOfAny(state, keys),
      ]);
      if (ui && ui.getAttribute("data-sig") === sig) return;
      if (!ui) ui = h("div", { class: "yss-ui yss-row" });
      ui.setAttribute("data-sig", sig);
      ui.replaceChildren(...(keys.length ? [assignButton(ctx)] : []));
      row.append(ui);
    });
    for (const parent of parents) {
      // `order` only works in a flex/grid container (YouTube's #grid-container already is one: B)
      const display = getComputedStyle(parent).display;
      if (ranks && !/flex|grid/.test(display)) {
        parent.style.display = "flex";
        parent.style.flexDirection = "column";
        parent.setAttribute("data-yss-flex", "");
      } else if (!ranks && parent.hasAttribute("data-yss-flex")) {
        parent.style.removeProperty("display");
        parent.style.removeProperty("flex-direction");
        parent.removeAttribute("data-yss-flex");
      }
    }
  }

  /** Put (or refresh) one button into `host`; falls back to a floating button when the host is missing. */
  function placeButton(page, ctx, host) {
    const old = document.querySelector(`.yss-btn[data-yss-page="${page}"]`);
    const sig = JSON.stringify([
      ctx.keys,
      ctx.name,
      core.groupsOfAny(state, ctx.keys),
      state.groups,
    ]);
    if (
      old &&
      old.getAttribute("data-sig") === sig &&
      (host ? old.parentElement === host : old.classList.contains("yss-fixed"))
    )
      return;
    if (old) old.remove();
    const btn = assignButton(ctx, host ? "" : "yss-fixed");
    btn.setAttribute("data-yss-page", page);
    btn.setAttribute("data-sig", sig);
    (host || document.body).append(btn);
  }

  function pageTitleName() {
    return document.title
      .replace(/^\(\d+\)\s*/, "")
      .replace(/\s*-\s*YouTube$/, "")
      .trim();
  }

  /** The canonical link only counts when it is fresh (the title still matches og:title after an SPA navigation). */
  function freshCanonicalId() {
    const link = document.querySelector('link[rel="canonical"]');
    const og = document.querySelector('meta[property="og:title"]');
    const ref = link && core.parseChannelRef(link.getAttribute("href"));
    return ref &&
      ref.kind === "id" &&
      og &&
      og.getAttribute("content") === pageTitleName()
      ? ref.key
      : null;
  }

  function applyChannelPage() {
    const own = core.parseChannelRef(location.pathname);
    if (!own) return;
    const keys = [own.key];
    const id = freshCanonicalId();
    if (id && id !== own.key) keys.push(id);
    notePair(keys);
    const host =
      document.querySelector(selectors.channelActions) ||
      document.querySelector(selectors.channelActionsLegacy);
    placeButton("channel", { keys, name: pageTitleName() }, host);
  }

  function applyWatchPage() {
    const host = document.querySelector(selectors.watchOwner);
    const owner = host && host.querySelector(selectors.watchOwnerRenderer);
    const keys = owner ? keysIn(owner) : [];
    if (!owner || !keys.length) {
      const old = document.querySelector('.yss-btn[data-yss-page="watch"]');
      if (old) old.remove();
      return;
    }
    notePair(keys);
    placeButton(
      "watch",
      { keys, name: textOf(owner.querySelector(selectors.channelName)) },
      host,
    );
  }

  // ------------------------------------------------------------------ scheduling

  function apply() {
    if (!loaded) return;
    const route = core.routeOf(location.pathname);
    if (route !== "feed" && route !== "channels") {
      const bar = document.getElementById("yss-bar");
      if (bar) bar.remove();
    }
    for (const page of ["channel", "watch"]) {
      if (route !== page) {
        const stale = document.querySelector(
          `.yss-btn[data-yss-page="${page}"]`,
        );
        if (stale) stale.remove();
      }
    }
    if (route !== "channel" && route !== "watch") closePicker();
    if (route === "feed") applyFeed();
    else if (route === "channels") applyChannelList();
    else if (route === "channel") applyChannelPage();
    else if (route === "watch") applyWatchPage();
    flushPairs();
    if (observer) observer.takeRecords(); // our own DOM changes must not wake us up again
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(
      () => {
        timer = 0;
        lastRun = Date.now();
        apply();
      },
      Math.max(0, THROTTLE_MS - (Date.now() - lastRun)),
    );
  }

  function attachObserver() {
    const target = document.querySelector("ytd-page-manager") || document.body;
    if (!target || target === observed) return;
    if (observer) observer.disconnect();
    observed = target;
    observer = new MutationObserver(schedule);
    observer.observe(target, { childList: true, subtree: true });
  }

  // ------------------------------------------------------------------ start

  document.addEventListener("yt-navigate-finish", () => {
    attachObserver();
    schedule();
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STORE_KEY]) return;
    state = core.normalizeState(changes[STORE_KEY].newValue).state;
    schedule();
    renderPicker();
  });

  (async () => {
    try {
      state = await load();
      loaded = true;
      attachObserver();
      schedule();
    } catch (err) {
      console.warn("[yt-subs-sorter]", err);
    }
  })();
})();
