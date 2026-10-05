/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html, nothing, svg } from "lit";
import { property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
import { ChartBase, colorAt, fmt, niceScale } from "./chart-base.js";
const TAU = Math.PI * 2;
/**
 * A Material 3 radar (spider / web) chart. Each category becomes a spoke laid
 * out evenly around a circle; each series is drawn as a closed polygon over the
 * spokes. Includes a concentric grid, spoke axes, value tick labels, a
 * clickable legend and a hover tooltip.
 *
 * Self-contained (no external chart library) — everything is inline SVG so it
 * themes from the `--md-sys-*` tokens inside a shadow root.
 */
export class RadarChart extends ChartBase {
    constructor() {
        super(...arguments);
        /** Radar series. Set via the `.radarSeries` property. */
        this.radarSeries = [];
        /** Fill opacity for each polygon (0 disables the fill). */
        this.fillOpacity = 0.18;
        /** Show value markers at every vertex. */
        this.showMarkers = true;
        /** Hidden series indices (toggled via the legend). */
        this.hiddenSeries = new Set();
        this.hover = null;
        this.height = 320;
        /**
         * Memoised geometry. Recomputed in `willUpdate` whenever inputs change so
         * `render()` stays pure and free of scale math.
         */
        this.layout = {
            w: 0,
            h: 0,
            cx: 0,
            cy: 0,
            radius: 0,
            axisCount: 0,
            min: 0,
            max: 1,
            step: 1,
            rings: [],
        };
    }
    willUpdate(changed) {
        super.willUpdate?.(changed);
        this.layout = this.computeLayout();
    }
    computeLayout() {
        const w = this.renderWidth;
        const h = this.height;
        // Leave room for the spoke labels around the perimeter.
        const radius = Math.max(0, Math.min(w, h) / 2 - 36);
        const axisCount = this.maxAxisCount();
        let hi = -Infinity;
        this.radarSeries.forEach((s, i) => {
            if (this.hiddenSeries.has(i)) {
                return;
            }
            for (const v of s.data) {
                if (v > hi)
                    hi = v;
            }
        });
        if (!isFinite(hi)) {
            hi = 1;
        }
        // Radar axes start at zero (the centre) and grow outward.
        const { min, max, step } = niceScale(0, Math.max(hi, 0));
        const rings = [];
        for (let t = min; t <= max + step / 2; t += step) {
            rings.push(Math.round(t * 1e6) / 1e6);
        }
        return {
            w,
            h,
            cx: w / 2,
            cy: h / 2,
            radius,
            axisCount,
            min,
            max,
            step,
            rings,
        };
    }
    maxAxisCount() {
        let n = this.categories.length;
        for (const s of this.radarSeries) {
            n = Math.max(n, s.data.length);
        }
        return n;
    }
    /** Angle (radians, clockwise from 12 o'clock) for axis index `i`. */
    angleAt(i) {
        const n = this.layout.axisCount || 1;
        return (i / n) * TAU - Math.PI / 2;
    }
    /** Cartesian point for a value along axis `i`. */
    pointAt(i, value) {
        const { cx, cy, radius, min, max } = this.layout;
        const frac = (value - min) / (max - min || 1);
        const r = Math.max(0, Math.min(1, frac)) * radius;
        const a = this.angleAt(i);
        return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    }
    render() {
        const { w, h } = this.layout;
        return html `
      <div
        class="chart"
        role="img"
        aria-label=${this.describe()}
        @pointerleave=${this.onPointerLeave}
      >
        <svg viewBox="0 0 ${w} ${h}" width=${w} height=${h} aria-hidden="true">
          ${this.renderGrid()} ${this.renderSpokes()} ${this.renderAxisLabels()}
          ${this.renderSeries()}
        </svg>
        ${this.renderTooltip()} ${this.legend ? this.renderLegend() : nothing} ${this.renderTable()}
      </div>
    `;
    }
    ringPath(value) {
        const { axisCount } = this.layout;
        if (axisCount <= 0) {
            return "";
        }
        const pts = [];
        for (let i = 0; i < axisCount; i++) {
            const [x, y] = this.pointAt(i, value);
            pts.push(`${i === 0 ? "M" : "L"}${x},${y}`);
        }
        return pts.join(" ") + " Z";
    }
    renderGrid() {
        const { rings } = this.layout;
        return svg `
      <g class="grid radar-grid">
        ${rings.map((t) => svg `<path class="radar-ring" d=${this.ringPath(t)}></path>`)}
      </g>
    `;
    }
    renderSpokes() {
        const { cx, cy, axisCount, max } = this.layout;
        return svg `
      <g class="axis radar-spokes">
        ${Array.from({ length: axisCount }, (_, i) => i).map((i) => {
            const [x, y] = this.pointAt(i, max);
            return svg `<line
            class="domain"
            x1=${cx}
            y1=${cy}
            x2=${x}
            y2=${y}
          ></line>`;
        })}
      </g>
    `;
    }
    renderAxisLabels() {
        const { axisCount, radius, cx, cy } = this.layout;
        return svg `${Array.from({ length: axisCount }, (_, i) => i).map((i) => {
            const a = this.angleAt(i);
            const lx = cx + (radius + 16) * Math.cos(a);
            const ly = cy + (radius + 16) * Math.sin(a);
            const cos = Math.cos(a);
            const anchor = cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";
            return svg `<text
        class="tick-label"
        x=${lx}
        y=${ly + 4}
        text-anchor=${anchor}
      >${this.categories[i] ?? `Axis ${i + 1}`}</text>`;
        })}`;
    }
    renderSeries() {
        const { axisCount } = this.layout;
        return svg `${this.radarSeries.map((s, si) => {
            if (this.hiddenSeries.has(si)) {
                return nothing;
            }
            const color = colorAt(this.colors, s, si);
            const verts = [];
            for (let i = 0; i < axisCount; i++) {
                verts.push(this.pointAt(i, s.data[i] ?? 0));
            }
            if (!verts.length) {
                return nothing;
            }
            const d = verts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ") + " Z";
            const markers = this.showMarkers
                ? svg `${verts.map((p, i) => {
                    const isHover = this.hover && this.hover.seriesIndex === si && this.hover.axisIndex === i;
                    return svg `<circle
              class="radar-marker"
              cx=${p[0]}
              cy=${p[1]}
              r=${isHover ? 5 : 3}
              fill=${color}
              @pointerenter=${() => {
                        this.hover = {
                            x: p[0],
                            y: p[1],
                            value: s.data[i] ?? 0,
                            seriesIndex: si,
                            axisIndex: i,
                        };
                    }}
            ></circle>`;
                })}`
                : nothing;
            return svg `
        <path
          class="radar-area"
          d=${d}
          fill=${color}
          fill-opacity=${this.fillOpacity}
          stroke=${color}
        ></path>
        ${markers}
      `;
        })}`;
    }
    renderTooltip() {
        if (!this.tooltip || !this.hover) {
            return nothing;
        }
        const { w } = this.layout;
        const v = this.hover;
        const s = this.radarSeries[v.seriesIndex];
        const color = colorAt(this.colors, s, v.seriesIndex);
        const cat = this.categories[v.axisIndex] ?? `Axis ${v.axisIndex + 1}`;
        const left = Math.min(Math.max(v.x, 8), w - 8);
        const top = Math.max(v.y - 12, 8);
        const flip = left > w * 0.7;
        return html `
      <div
        class="tooltip"
        data-visible
        style=${styleMap({
            left: `${left}px`,
            top: `${top}px`,
            transform: `translate(${flip ? "-100%" : "0"}, -100%)`,
        })}
      >
        <div class="tooltip-title">${cat}</div>
        <div class="tooltip-row">
          <span class="tooltip-swatch" style=${styleMap({ background: color })}></span>
          ${s?.label ?? `Series ${v.seriesIndex + 1}`}: ${fmt(v.value)}
        </div>
      </div>
    `;
    }
    renderLegend() {
        if (!this.radarSeries.some((s) => s.label)) {
            return nothing;
        }
        return html `
      <div class="legend" role="list">
        ${this.radarSeries.map((s, i) => {
            const color = colorAt(this.colors, s, i);
            const off = this.hiddenSeries.has(i);
            return html `<span
            class=${classMap({ "legend-item": true, "legend-item--off": off })}
            role="listitem"
            @click=${() => this.toggleSeries(i)}
          >
            <span class="legend-swatch" style=${styleMap({ background: color })}></span>
            ${s.label ?? `Series ${i + 1}`}
          </span>`;
        })}
      </div>
    `;
    }
    renderTable() {
        const n = this.maxAxisCount();
        return html `
      <table class="sr-only">
        <caption>
          ${this.describe()}
        </caption>
        <thead>
          <tr>
            <th>Category</th>
            ${this.radarSeries.map((s, i) => html `<th>${s.label ?? `Series ${i + 1}`}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${Array.from({ length: n }, (_, ai) => ai).map((ai) => html `<tr>
              <th>${this.categories[ai] ?? `Axis ${ai + 1}`}</th>
              ${this.radarSeries.map((s) => html `<td>${s.data[ai] ?? ""}</td>`)}
            </tr>`)}
        </tbody>
      </table>
    `;
    }
    describe() {
        if (this.ariaLabelText) {
            return this.ariaLabelText;
        }
        const names = this.radarSeries.map((s) => s.label).filter(Boolean);
        if (names.length) {
            return `Radar chart with series: ${names.join(", ")}.`;
        }
        return "Radar chart.";
    }
    onPointerLeave() {
        this.hover = null;
    }
    toggleSeries(i) {
        const next = new Set(this.hiddenSeries);
        if (next.has(i)) {
            next.delete(i);
        }
        else {
            next.add(i);
        }
        this.hiddenSeries = next;
    }
}
__decorate([
    property({ attribute: false })
], RadarChart.prototype, "radarSeries", void 0);
__decorate([
    property({ type: Number, attribute: "fill-opacity" })
], RadarChart.prototype, "fillOpacity", void 0);
__decorate([
    property({ type: Boolean, attribute: "show-markers" })
], RadarChart.prototype, "showMarkers", void 0);
__decorate([
    state()
], RadarChart.prototype, "hiddenSeries", void 0);
__decorate([
    state()
], RadarChart.prototype, "hover", void 0);
//# sourceMappingURL=radar-chart.js.map