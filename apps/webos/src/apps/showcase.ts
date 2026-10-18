// SPDX-License-Identifier: Apache-2.0
// Component gallery: every md-* element of @aphrody/material-web (see m3-all.ts) with states and a copyable snippet.
// Each demo's HTML is both rendered live and shown as the code, so the two cannot drift.
import { h } from "../dom";
import "./m3-all";
import css from "./showcase.css" with { type: "text" };

type El = HTMLElement & Record<string, any>;
interface Demo {
  group: string;
  title: string;
  html: string;
  tags: string[];
  /** Contain position:fixed descendants (bars, steppers) inside the card. */
  frame?: boolean;
  setup?: (root: HTMLElement) => void;
}
const I = (n: string, slot = "") =>
  `<span ${slot ? `slot="${slot}" ` : ""}class="mi material-symbols-rounded">${n}</span>`;
const $ = (root: HTMLElement, sel: string) => root.querySelector<El>(sel)!;

const NAV_ITEMS = ["home", "search", "settings"]
  .map(n => `<md-navigation-rail-item label="${n}">${I(n, "icon")}</md-navigation-rail-item>`)
  .join("");

const DEMOS: Demo[] = [
  {
    group: "Actions",
    title: "Buttons",
    tags: ["md-filled-button", "md-filled-tonal-button", "md-outlined-button", "md-elevated-button", "md-text-button"],
    html: `<md-filled-button>Filled</md-filled-button>
<md-filled-tonal-button>Tonal</md-filled-tonal-button>
<md-outlined-button>Outlined</md-outlined-button>
<md-elevated-button>Elevated</md-elevated-button>
<md-text-button>Text</md-text-button>
<md-filled-button disabled>Disabled</md-filled-button>
<md-outlined-button>${I("add", "icon")}With icon</md-outlined-button>
<md-filled-button trailing-icon>Trailing${I("arrow_forward", "icon")}</md-filled-button>`,
  },
  {
    group: "Actions",
    title: "Icon buttons",
    tags: ["md-icon-button", "md-filled-icon-button", "md-filled-tonal-icon-button", "md-outlined-icon-button"],
    html: `<md-icon-button aria-label="Standard">${I("favorite")}</md-icon-button>
<md-filled-icon-button aria-label="Filled">${I("favorite")}</md-filled-icon-button>
<md-filled-tonal-icon-button aria-label="Tonal">${I("favorite")}</md-filled-tonal-icon-button>
<md-outlined-icon-button aria-label="Outlined">${I("favorite")}</md-outlined-icon-button>
<md-icon-button toggle aria-label="Toggle">${I("bookmark")}${I("bookmark_added", "selected")}</md-icon-button>
<md-filled-icon-button disabled aria-label="Disabled">${I("favorite")}</md-filled-icon-button>`,
  },
  {
    group: "Actions",
    title: "FAB and FAB menu",
    tags: ["md-fab", "md-branded-fab", "md-fab-menu", "md-fab-menu-item"],
    html: `<md-fab aria-label="Add">${I("add", "icon")}</md-fab>
<md-fab size="small" variant="secondary" aria-label="Edit">${I("edit", "icon")}</md-fab>
<md-fab size="large" variant="tertiary" label="Compose" aria-label="Compose">${I("edit", "icon")}</md-fab>
<md-branded-fab aria-label="Branded"></md-branded-fab>`,
  },
  {
    group: "Actions",
    title: "Button group and segmented buttons",
    tags: ["md-button-group", "md-outlined-segmented-button-set", "md-outlined-segmented-button"],
    html: `<md-button-group><md-outlined-button>One</md-outlined-button><md-outlined-button>Two</md-outlined-button><md-outlined-button>Three</md-outlined-button></md-button-group>
<md-outlined-segmented-button-set><md-outlined-segmented-button label="Day"></md-outlined-segmented-button><md-outlined-segmented-button label="Week" selected></md-outlined-segmented-button><md-outlined-segmented-button label="Month"></md-outlined-segmented-button></md-outlined-segmented-button-set>`,
  },
  {
    group: "Selection",
    title: "Switch, checkbox, radio",
    tags: ["md-switch", "md-checkbox", "md-radio"],
    html: `<md-switch aria-label="Off"></md-switch>
<md-switch selected aria-label="On"></md-switch>
<md-switch icons selected aria-label="Icons"></md-switch>
<md-switch disabled aria-label="Disabled"></md-switch>
<md-checkbox aria-label="Unchecked"></md-checkbox>
<md-checkbox checked aria-label="Checked"></md-checkbox>
<md-checkbox indeterminate aria-label="Indeterminate"></md-checkbox>
<md-checkbox disabled checked aria-label="Disabled"></md-checkbox>
<md-radio name="g" value="a" checked aria-label="A"></md-radio>
<md-radio name="g" value="b" aria-label="B"></md-radio>
<md-radio name="g" value="c" disabled aria-label="Disabled"></md-radio>`,
  },
  {
    group: "Selection",
    title: "Slider and rating",
    tags: ["md-slider", "md-rating"],
    html: `<md-slider labeled value="40" aria-label="Slider"></md-slider>
<md-slider labeled range value-start="20" value-end="70" aria-label="Range"></md-slider>
<md-slider ticks step="10" value="30" labeled aria-label="Ticks"></md-slider>
<md-slider disabled value="50" aria-label="Disabled"></md-slider>
<md-rating value="3" aria-label="Rating"></md-rating>
<md-rating value="4" readonly aria-label="Read only"></md-rating>`,
  },
  {
    group: "Selection",
    title: "Chips",
    tags: ["md-chip-set", "md-assist-chip", "md-filter-chip", "md-input-chip", "md-suggestion-chip"],
    html: `<md-chip-set>
<md-assist-chip label="Assist"></md-assist-chip>
<md-filter-chip label="Filter" selected></md-filter-chip>
<md-filter-chip label="Filter"></md-filter-chip>
<md-input-chip label="Input" removable></md-input-chip>
<md-suggestion-chip label="Suggestion"></md-suggestion-chip>
<md-assist-chip label="Disabled" disabled></md-assist-chip>
</md-chip-set>`,
  },
  {
    group: "Selection",
    title: "Select",
    tags: ["md-filled-select", "md-outlined-select", "md-select-option"],
    html: `<md-outlined-select label="Outlined" value="b"><md-select-option value="a"><div slot="headline">Alpha</div></md-select-option><md-select-option value="b"><div slot="headline">Beta</div></md-select-option></md-outlined-select>
<md-filled-select label="Filled"><md-select-option value="a"><div slot="headline">Alpha</div></md-select-option><md-select-option value="b"><div slot="headline">Beta</div></md-select-option></md-filled-select>
<md-outlined-select label="Disabled" disabled></md-outlined-select>`,
  },
  {
    group: "Inputs",
    title: "Text fields",
    tags: ["md-filled-text-field", "md-outlined-text-field", "md-filled-field", "md-outlined-field"],
    html: `<md-filled-text-field label="Filled" value="Hello"></md-filled-text-field>
<md-outlined-text-field label="Outlined" value="Hello"></md-outlined-text-field>
<md-outlined-text-field label="Error" error error-text="Required" value=""></md-outlined-text-field>
<md-outlined-text-field label="Supporting" supporting-text="Helper text"></md-outlined-text-field>
<md-outlined-text-field label="Disabled" disabled value="Locked"></md-outlined-text-field>
<md-outlined-text-field label="Multiline" type="textarea" rows="3"></md-outlined-text-field>`,
  },
  {
    group: "Inputs",
    title: "Autocomplete, search, pickers",
    tags: ["md-autocomplete", "md-search-bar", "md-date-picker", "md-date-range-picker", "md-date-time-picker", "md-time-picker"],
    html: `<md-search-bar placeholder="Search apps"></md-search-bar>
<md-autocomplete label="Autocomplete"></md-autocomplete>
<md-date-picker></md-date-picker>
<md-time-picker></md-time-picker>`,
    setup: root => {
      const ac = root.querySelector<El>("md-autocomplete");
      if (ac) ac.options = ["Files", "Terminal", "Browser", "Calculator"];
    },
  },
  {
    group: "Containment",
    title: "Cards",
    tags: ["md-card", "md-elevated-card", "md-filled-card", "md-outlined-card", "md-surface", "md-elevation"],
    html: `<md-card variant="elevated" style="padding:16px">Elevated</md-card>
<md-card variant="filled" style="padding:16px">Filled</md-card>
<md-card variant="outlined" style="padding:16px">Outlined</md-card>
<md-card variant="outlined" clickable style="padding:16px">Clickable</md-card>`,
  },
  {
    group: "Containment",
    title: "Dialog",
    tags: ["md-dialog"],
    html: `<md-filled-tonal-button id="open">Open dialog</md-filled-tonal-button>
<md-dialog id="dlg"><div slot="headline">Discard draft?</div><form slot="content" method="dialog" id="f">This cannot be undone.</form>
<div slot="actions"><md-text-button form="f" value="cancel">Cancel</md-text-button><md-text-button form="f" value="ok">Discard</md-text-button></div></md-dialog>`,
    setup: r => $(r, "#open").addEventListener("click", () => $(r, "#dlg").show()),
  },
  {
    group: "Containment",
    title: "Sheets and snackbar",
    tags: ["md-bottom-sheet", "md-side-sheet", "md-snackbar", "md-backdrop", "md-popover"],
    html: `<md-filled-tonal-button id="bs">Bottom sheet</md-filled-tonal-button>
<md-filled-tonal-button id="ss">Side sheet</md-filled-tonal-button>
<md-filled-tonal-button id="sn">Snackbar</md-filled-tonal-button>
<md-bottom-sheet id="bsh"><div style="padding:16px">Bottom sheet content</div></md-bottom-sheet>
<md-side-sheet id="ssh"><div style="padding:16px">Side sheet content</div></md-side-sheet>
<md-snackbar id="snk" message="Saved" action="Undo" closeable></md-snackbar>`,
    setup: r => {
      $(r, "#bs").addEventListener("click", () => ($(r, "#bsh").open = true));
      $(r, "#ss").addEventListener("click", () => ($(r, "#ssh").open = true));
      $(r, "#sn").addEventListener("click", () => ($(r, "#snk").open = true));
    },
  },
  {
    group: "Containment",
    title: "Menu and tooltip",
    tags: ["md-menu", "md-menu-item", "md-sub-menu", "md-tooltip"],
    html: `<span style="position:relative"><md-filled-button id="mb">Menu</md-filled-button>
<md-menu id="mn" anchor="mb"><md-menu-item><div slot="headline">Cut</div></md-menu-item><md-menu-item><div slot="headline">Copy</div></md-menu-item><md-menu-item disabled><div slot="headline">Paste</div></md-menu-item></md-menu></span>
<span style="position:relative"><md-icon-button id="tt" aria-label="Info" aria-describedby="tip">${I("info")}</md-icon-button><md-tooltip id="tip" anchor="tt">Tooltip text</md-tooltip></span>`,
    setup: r => $(r, "#mb").addEventListener("click", () => ($(r, "#mn").open = !$(r, "#mn").open)),
  },
  {
    group: "Containment",
    title: "Divider, expansion panels, accordion",
    tags: ["md-divider", "md-expansion-panel", "md-accordion"],
    html: `<md-accordion><md-expansion-panel><div slot="header">Panel one</div>Content one</md-expansion-panel><md-expansion-panel expanded><div slot="header">Panel two</div>Content two</md-expansion-panel></md-accordion>
<md-divider style="width:100%"></md-divider>`,
  },
  {
    group: "Navigation",
    title: "Tabs",
    tags: ["md-tabs", "md-primary-tab", "md-secondary-tab"],
    html: `<md-tabs><md-primary-tab>Video</md-primary-tab><md-primary-tab>Photos</md-primary-tab><md-primary-tab>Audio</md-primary-tab></md-tabs>
<md-tabs><md-secondary-tab>Flights</md-secondary-tab><md-secondary-tab>Trips</md-secondary-tab></md-tabs>`,
  },
  {
    group: "Navigation",
    title: "Navigation rail, bar, drawer",
    tags: ["md-navigation-rail", "md-navigation-rail-item", "md-navigation-bar", "md-navigation-tab", "md-navigation-drawer", "md-navigation-drawer-modal"],
    html: `<md-navigation-rail>${NAV_ITEMS}</md-navigation-rail>
<md-navigation-bar>${["home", "search", "settings"].map(n => `<md-navigation-tab label="${n}">${I(n, "inactive-icon")}${I(n, "active-icon")}</md-navigation-tab>`).join("")}</md-navigation-bar>`,
  },
  {
    group: "Navigation",
    title: "App bars and toolbar",
    tags: ["md-top-app-bar", "md-bottom-app-bar", "md-toolbar"],
    frame: true,
    html: `<md-top-app-bar style="width:100%"><md-icon-button slot="leading" aria-label="Menu">${I("menu")}</md-icon-button>Title<md-icon-button slot="trailing" aria-label="Search">${I("search")}</md-icon-button></md-top-app-bar>
<md-toolbar style="width:100%">${I("menu")}<span>Toolbar</span></md-toolbar>
<md-bottom-app-bar style="width:100%"><md-icon-button aria-label="Check">${I("check_box")}</md-icon-button><md-icon-button aria-label="Edit">${I("edit")}</md-icon-button><md-fab slot="fab" aria-label="Add">${I("add","icon")}</md-fab></md-bottom-app-bar>`,
  },
  {
    group: "Navigation",
    title: "Link, paginator, steppers",
    frame: true,
    tags: ["md-breadcrumbs", "md-link", "md-paginator", "md-stepper", "md-step", "md-mobile-stepper"],
    html: `<md-link href="#">Link</md-link>
<md-paginator length="100" page-size="10"></md-paginator>
<md-stepper selected-index="1"><md-step label="Account" completed></md-step><md-step label="Profile"></md-step><md-step label="Done"></md-step></md-stepper>
<md-mobile-stepper position="static" steps="5" active-step="2"></md-mobile-stepper>`,
  },
  {
    group: "Lists and data",
    title: "List",
    tags: ["md-list", "md-list-item"],
    html: `<md-list style="width:280px"><md-list-item>${I("folder", "start")}<div slot="headline">Documents</div><div slot="supporting-text">12 items</div></md-list-item>
<md-list-item type="button">${I("image", "start")}<div slot="headline">Pictures</div></md-list-item>
<md-list-item disabled><div slot="headline">Disabled</div></md-list-item></md-list>`,
  },
  {
    group: "Lists and data",
    title: "Tree, table, grid list",
    tags: ["md-tree", "md-tree-item", "md-table", "md-grid-list", "md-grid-tile"],
    html: `<md-tree><md-tree-item label="src" expanded><md-tree-item label="main.ts"></md-tree-item><md-tree-item label="dom.ts"></md-tree-item></md-tree-item><md-tree-item label="package.json"></md-tree-item></md-tree>
<md-grid-list cols="3" style="width:260px"><md-grid-tile>1</md-grid-tile><md-grid-tile>2</md-grid-tile><md-grid-tile>3</md-grid-tile></md-grid-list>`,
  },
  {
    group: "Lists and data",
    title: "Carousel",
    tags: ["md-carousel", "md-carousel-item"],
    html: `<md-carousel style="width:360px">${[1, 2, 3, 4]
      .map(
        n =>
          `<md-carousel-item><div style="height:120px;display:grid;place-items:center;background:var(--md-sys-color-primary-container);color:var(--md-sys-color-on-primary-container)">${n}</div></md-carousel-item>`,
      )
      .join("")}</md-carousel>`,
  },
  {
    group: "Feedback",
    title: "Progress and loading",
    tags: ["md-linear-progress", "md-circular-progress", "md-loading-indicator", "md-skeleton"],
    html: `<md-linear-progress value="0.6" style="width:200px"></md-linear-progress>
<md-linear-progress indeterminate style="width:200px"></md-linear-progress>
<md-circular-progress value="0.6"></md-circular-progress>
<md-circular-progress indeterminate></md-circular-progress>
<md-loading-indicator aria-label="Loading"></md-loading-indicator>
<md-skeleton variant="text" width="160"></md-skeleton>
<md-skeleton variant="circular" width="40" height="40"></md-skeleton>`,
  },
  {
    group: "Feedback",
    title: "Alert, banner, badge, avatar",
    tags: ["md-alert", "md-banner", "md-badge", "md-avatar", "md-avatar-group"],
    html: `<md-alert severity="info">Information</md-alert>
<md-alert severity="success">Success</md-alert>
<md-alert severity="warning" closeable>Warning</md-alert>
<md-alert severity="error">Error</md-alert>
<md-banner open>Banner message${I("info", "icon")}</md-banner>
<md-badge value="3"></md-badge> <md-badge dot></md-badge>
<md-avatar alt="Ada Lovelace"></md-avatar>
<md-avatar-group max="3"><md-avatar alt="A"></md-avatar><md-avatar alt="B"></md-avatar><md-avatar alt="C"></md-avatar><md-avatar alt="D"></md-avatar></md-avatar-group>`,
  },
  {
    group: "Charts",
    title: "Charts",
    tags: ["md-sparkline", "md-gauge", "md-line-chart", "md-area-chart", "md-bar-chart", "md-pie-chart", "md-radar-chart", "md-scatter-chart"],
    html: `<md-sparkline id="sp"></md-sparkline>
<md-gauge id="ga" value="65"></md-gauge>
<md-bar-chart id="bc"></md-bar-chart>
<md-pie-chart id="pc"></md-pie-chart>
<md-line-chart id="lc"></md-line-chart>`,
    setup: r => {
      const series = [
        { label: "A", data: [3, 7, 4, 9, 6] },
        { label: "B", data: [5, 2, 8, 3, 7] },
      ];
      const cats = ["Mon", "Tue", "Wed", "Thu", "Fri"];
      $(r, "#sp").values = [3, 7, 4, 9, 6, 8];
      for (const id of ["#bc", "#lc"]) Object.assign($(r, id), { series, categories: cats });
      $(r, "#pc").data = [
        { label: "A", value: 40 },
        { label: "B", value: 30 },
        { label: "C", value: 30 },
      ];
    },
  },
  {
    group: "Foundations",
    title: "Typography, icon, ripple, link",
    tags: ["md-type", "md-icon", "md-ripple", "md-link"],
    html: `<md-type scale="display-small" block>Display small</md-type>
<md-type scale="headline-medium" block>Headline medium</md-type>
<md-type scale="title-medium" block>Title medium</md-type>
<md-type scale="body-medium" block>Body medium with <md-link href="#">a link</md-link></md-type>
<md-type scale="label-large" block>Label large</md-type>`,
  },
];

const ALL_TAGS = DEMOS.flatMap(d => d.tags);
let injected = false;

export function showcaseApp(root: HTMLElement) {
  if (!injected) {
    injected = true;
    document.head.append(h("style", { id: "showcase-css" }, css));
  }
  root.classList.add("sc");
  const search = document.createElement("md-outlined-text-field") as El;
  search.setAttribute("label", "Filter components");
  const nav = h("nav", { class: "sc-nav" });
  const list = h("div", { class: "sc-list" });
  let group = "All";
  let query = "";

  const card = (d: Demo) => {
    const demo = h("div", { class: d.frame ? "sc-demo frame" : "sc-demo" });
    demo.innerHTML = d.html; // static, first-party markup defined in this file
    const code = h("pre", { class: "sc-code" }, h("code", {}, d.html));
    code.hidden = true;
    const toggle = h("button", { class: "sc-toggle", "aria-expanded": "false" }, "Code");
    toggle.addEventListener("click", () => {
      code.hidden = !code.hidden;
      toggle.setAttribute("aria-expanded", String(!code.hidden));
    });
    const copy = h("button", { class: "sc-toggle" }, "Copy");
    copy.addEventListener("click", () => {
      void navigator.clipboard?.writeText(d.html).then(() => {
        copy.textContent = "Copied";
        setTimeout(() => (copy.textContent = "Copy"), 1200);
      });
    });
    d.setup?.(demo);
    return h(
      "section",
      { class: "sc-card", id: `sc-${d.title.replace(/\W+/g, "-").toLowerCase()}` },
      h(
        "header",
        {},
        h("h3", {}, d.title),
        h("span", { class: "sc-tags muted" }, d.tags.join(" ")),
        h("span", { class: "sc-spacer" }),
        toggle,
        copy,
      ),
      demo,
      code,
    );
  };
  const cards = new Map(DEMOS.map(d => [d, card(d)]));

  const render = () => {
    const q = query.toLowerCase();
    const shown = DEMOS.filter(
      d =>
        (group === "All" || d.group === group) &&
        (!q || d.title.toLowerCase().includes(q) || d.tags.some(t => t.includes(q))),
    );
    const missing = ALL_TAGS.filter(t => !customElements.get(t));
    list.replaceChildren(
      ...shown.map(d => cards.get(d)!),
      h(
        "p",
        { class: "sc-foot muted" },
        `${ALL_TAGS.length} elements documented, ${ALL_TAGS.length - missing.length} registered. Unregistered: ${missing.join(", ") || "none"}.`,
      ),
    );
    nav.replaceChildren(
      ...["All", ...new Set(DEMOS.map(d => d.group))].map(g =>
        h(
          "button",
          {
            class: "sc-nav-btn",
            "aria-current": String(g === group),
            onclick: () => {
              group = g;
              render();
            },
          },
          g,
        ),
      ),
    );
  };
  search.addEventListener("input", () => {
    query = search.value;
    render();
  });
  root.append(h("aside", { class: "sc-side" }, search, nav), list);
  render();
}
