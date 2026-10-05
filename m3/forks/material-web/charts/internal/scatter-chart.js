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
/**
 * A Material 3 scatter chart. Renders one or more series of {x, y} points as
 * SVG circles against numeric X/Y axes, with a grid, a clickable legend and a
 * hover tooltip. Point sizes are configurable per chart, per series or per
 * point.
 *
 * Self-contained (no external chart library) — everything is inline SVG so it
 * themes from the `--md-sys-*` tokens inside a shadow root.
 */
export class ScatterChart extends ChartBase {
    constructor() {
        super(...arguments);
        /** Scatter series. Set via the `.scatterSeries` property. */
        this.scatterSeries = [];
        /** Default point radius (px). */
        this.pointSize = 4;
        /** X-axis title. */
        this.xAxisLabel = "";
        /** Y-axis title. */
        this.yAxisLabel = "";
        /** Hidden series indices (toggled via the legend). */
        this.hiddenSeries = new Set();
        this.hover = null;
        /** Layout margins. */
        this.margin = { top: 16, right: 16, bottom: 36, left: 48 };
        /**
         * Memoised geometry. Recomputed in `willUpdate` whenever inputs change so
         * `render()` stays pure and free of scale math.
         */
        this.layout = {
            w: 0,
            h: 0,
            plotW: 0,
            plotH: 0,
            xMin: 0,
            xMax: 1,
            xStep: 1,
            xTicks: [],
            yMin: 0,
            yMax: 1,
            yStep: 1,
            yTicks: [],
        };
    }
    willUpdate(changed) {
        super.willUpdate?.(changed);
        this.layout = this.computeLayout();
    }
    /** Map a data X value to a pixel using the current layout. */
    xToPx(v) {
        const { xMin, xMax, plotW } = this.layout;
        return this.margin.left + ((v - xMin) / (xMax - xMin || 1)) * plotW;
    }
    /** Map a data Y value to a pixel using the current layout. */
    yToPx(v) {
        const { yMin, yMax, plotH } = this.layout;
        return this.margin.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
    }
    computeLayout() {
        const w = this.renderWidth;
        const h = this.height;
        const plotW = Math.max(0, w - this.margin.left - this.margin.right);
        const plotH = Math.max(0, h - this.margin.top - this.margin.bottom);
        let xLo = Infinity;
        let xHi = -Infinity;
        let yLo = Infinity;
        let yHi = -Infinity;
        this.scatterSeries.forEach((s, i) => {
            if (this.hiddenSeries.has(i)) {
                return;
            }
            for (const p of s.data) {
                if (p.x < xLo)
                    xLo = p.x;
                if (p.x > xHi)
                    xHi = p.x;
                if (p.y < yLo)
                    yLo = p.y;
                if (p.y > yHi)
                    yHi = p.y;
            }
        });
        if (!isFinite(xLo) || !isFinite(xHi)) {
            xLo = 0;
            xHi = 1;
        }
        if (!isFinite(yLo) || !isFinite(yHi)) {
            yLo = 0;
            yHi = 1;
        }
        const xScale = niceScale(xLo, xHi);
        const yScale = niceScale(yLo, yHi);
        return {
            w,
            h,
            plotW,
            plotH,
            xMin: xScale.min,
            xMax: xScale.max,
            xStep: xScale.step,
            xTicks: this.buildTicks(xScale.min, xScale.max, xScale.step),
            yMin: yScale.min,
            yMax: yScale.max,
            yStep: yScale.step,
            yTicks: this.buildTicks(yScale.min, yScale.max, yScale.step),
        };
    }
    buildTicks(min, max, step) {
        const ticks = [];
        for (let t = min; t <= max + step / 2; t += step) {
            ticks.push(Math.round(t * 1e6) / 1e6);
        }
        return ticks;
    }
    render() {
        const { w, h } = this.layout;
        return html `
      <div
        class="chart"
        role="img"
        aria-label=${this.describe()}
        @pointermove=${this.onPointerMove}
        @pointerleave=${this.onPointerLeave}
      >
        <svg
          viewBox="0 0 ${w} ${h}"
          width=${w}
          height=${h}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          ${this.renderGrid()} ${this.renderAxes()} ${this.renderPoints()}
        </svg>
        ${this.renderTooltip()} ${this.legend ? this.renderLegend() : nothing} ${this.renderTable()}
      </div>
    `;
    }
    renderGrid() {
        const { yTicks, xTicks, plotW, plotH } = this.layout;
        const baseY = this.margin.top + plotH;
        return svg `
      <g class="grid">
        ${yTicks.map((t) => svg `
          <line
            x1=${this.margin.left}
            x2=${this.margin.left + plotW}
            y1=${this.yToPx(t)}
            y2=${this.yToPx(t)}
          ></line>`)}
        ${xTicks.map((t) => svg `
          <line
            x1=${this.xToPx(t)}
            x2=${this.xToPx(t)}
            y1=${this.margin.top}
            y2=${baseY}
          ></line>`)}
      </g>
    `;
    }
    renderAxes() {
        const { yTicks, xTicks, plotW, plotH } = this.layout;
        const baseY = this.margin.top + plotH;
        return svg `
      <g class="axis">
        <line
          class="domain"
          x1=${this.margin.left}
          y1=${this.margin.top}
          x2=${this.margin.left}
          y2=${baseY}
        ></line>
        <line
          class="domain"
          x1=${this.margin.left}
          y1=${baseY}
          x2=${this.margin.left + plotW}
          y2=${baseY}
        ></line>
        ${yTicks.map((t) => svg `
          <text
            class="tick-label"
            x=${this.margin.left - 6}
            y=${this.yToPx(t) + 4}
            text-anchor="end"
          >${fmt(t)}</text>`)}
        ${xTicks.map((t) => svg `
          <text
            class="tick-label"
            x=${this.xToPx(t)}
            y=${baseY + 16}
            text-anchor="middle"
          >${fmt(t)}</text>`)}
        ${this.yAxisLabel
            ? svg `<text
                class="axis-title"
                transform="translate(12 ${this.margin.top + plotH / 2}) rotate(-90)"
                text-anchor="middle"
              >${this.yAxisLabel}</text>`
            : nothing}
        ${this.xAxisLabel
            ? svg `<text
                class="axis-title"
                x=${this.margin.left + plotW / 2}
                y=${baseY + 32}
                text-anchor="middle"
              >${this.xAxisLabel}</text>`
            : nothing}
      </g>
    `;
    }
    renderPoints() {
        return svg `${this.scatterSeries.map((s, si) => {
            if (this.hiddenSeries.has(si)) {
                return nothing;
            }
            const color = s.color ?? colorAt(this.colors, undefined, si);
            const defaultR = s.size ?? this.pointSize;
            return svg `${s.data.map((p, pi) => {
                const isHover = this.hover && this.hover.seriesIndex === si && this.hover.pointIndex === pi;
                const r = (p.size ?? defaultR) + (isHover ? 2 : 0);
                return svg `<circle
          class="scatter-point"
          cx=${this.xToPx(p.x)}
          cy=${this.yToPx(p.y)}
          r=${r}
          fill=${color}
          fill-opacity=${isHover ? 1 : 0.78}
        ></circle>`;
            })}`;
        })}`;
    }
    renderTooltip() {
        if (!this.tooltip || !this.hover) {
            return nothing;
        }
        const { w } = this.layout;
        const p = this.hover;
        const s = this.scatterSeries[p.seriesIndex];
        const color = s?.color ?? colorAt(this.colors, undefined, p.seriesIndex);
        const left = Math.min(Math.max(p.x, 8), w - 8);
        const top = Math.max(p.y - 12, 8);
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
        <div class="tooltip-title">${s?.label ?? `Series ${p.seriesIndex + 1}`}</div>
        <div class="tooltip-row">
          <span class="tooltip-swatch" style=${styleMap({ background: color })}></span>
          (${fmt(p.dataX)}, ${fmt(p.dataY)})
        </div>
      </div>
    `;
    }
    renderLegend() {
        if (!this.scatterSeries.some((s) => s.label)) {
            return nothing;
        }
        return html `
      <div class="legend" role="list">
        ${this.scatterSeries.map((s, i) => {
            const color = s.color ?? colorAt(this.colors, undefined, i);
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
        return html `
      <table class="sr-only">
        <caption>
          ${this.describe()}
        </caption>
        <thead>
          <tr>
            <th>Series</th>
            <th>X</th>
            <th>Y</th>
          </tr>
        </thead>
        <tbody>
          ${this.scatterSeries.map((s, si) => s.data.map((p) => html `<tr>
                <th>${s.label ?? `Series ${si + 1}`}</th>
                <td>${p.x}</td>
                <td>${p.y}</td>
              </tr>`))}
        </tbody>
      </table>
    `;
    }
    describe() {
        if (this.ariaLabelText) {
            return this.ariaLabelText;
        }
        const names = this.scatterSeries.map((s) => s.label).filter(Boolean);
        if (names.length) {
            return `Scatter chart with series: ${names.join(", ")}.`;
        }
        return "Scatter chart.";
    }
    onPointerMove(event) {
        if (!this.tooltip || !this.scatterSeries.length) {
            return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        // Nearest point by Euclidean pixel distance.
        let best = null;
        let bestDist = Infinity;
        this.scatterSeries.forEach((s, si) => {
            if (this.hiddenSeries.has(si)) {
                return;
            }
            s.data.forEach((p, pi) => {
                const sx = this.xToPx(p.x);
                const sy = this.yToPx(p.y);
                const dist = Math.hypot(sx - px, sy - py);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = {
                        x: sx,
                        y: sy,
                        dataX: p.x,
                        dataY: p.y,
                        r: p.size ?? s.size ?? this.pointSize,
                        seriesIndex: si,
                        pointIndex: pi,
                    };
                }
            });
        });
        // Only show within a reasonable hit radius.
        this.hover = best && bestDist <= 24 ? best : null;
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
], ScatterChart.prototype, "scatterSeries", void 0);
__decorate([
    property({ type: Number, attribute: "point-size" })
], ScatterChart.prototype, "pointSize", void 0);
__decorate([
    property({ attribute: "x-axis-label" })
], ScatterChart.prototype, "xAxisLabel", void 0);
__decorate([
    property({ attribute: "y-axis-label" })
], ScatterChart.prototype, "yAxisLabel", void 0);
__decorate([
    state()
], ScatterChart.prototype, "hiddenSeries", void 0);
__decorate([
    state()
], ScatterChart.prototype, "hover", void 0);
//# sourceMappingURL=scatter-chart.js.map