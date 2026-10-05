/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html, nothing, svg } from "lit";
import { property } from "lit/decorators.js";
import { ChartBase, colorAt, linePath } from "./chart-base.js";
/**
 * A Material 3 sparkline: a compact, axis-free inline trend line for a single
 * data set. Renders an SVG polyline (optionally smooth / filled) with an
 * optional end-point marker. Inherits `data` from the first series or the
 * `values` property. Self-contained on the `--md-sys-*` tokens.
 */
export class Sparkline extends ChartBase {
    constructor() {
        super(...arguments);
        /** Data values (alternative to `series`). */
        this.values = [];
        /** Render as a smooth curve. */
        this.smooth = false;
        /** Fill the area beneath the line. */
        this.area = false;
        /** Render as bars rather than a line. */
        this.bars = false;
        /** Show a marker on the last point. */
        this.showEndpoint = true;
        /** Sparklines are compact by default. */
        this.height = 40;
        this.width = 120;
        this.legend = false;
        this.tooltip = false;
        /** Memoised geometry; recomputed only in `willUpdate`. */
        this.layout = { w: 0, h: 0, pad: 3, data: [], innerW: 1, innerH: 1, lo: 0, range: 1 };
    }
    get points() {
        if (this.values.length) {
            return this.values;
        }
        return this.series[0]?.data ?? [];
    }
    willUpdate(changed) {
        super.willUpdate?.(changed);
        const w = this.renderWidth || 120;
        const h = this.height;
        const pad = 3;
        const data = this.points;
        const lo = data.length ? Math.min(...data) : 0;
        const hi = data.length ? Math.max(...data) : 1;
        this.layout = {
            w,
            h,
            pad,
            data,
            innerW: Math.max(1, w - pad * 2),
            innerH: Math.max(1, h - pad * 2),
            lo,
            range: hi - lo || 1,
        };
    }
    /** Map a data index to an X pixel. */
    xAt(i) {
        const { pad, data, innerW } = this.layout;
        return pad + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
    }
    /** Map a value to a Y pixel. */
    yAt(v) {
        const { pad, innerH, lo, range } = this.layout;
        return pad + innerH - ((v - lo) / range) * innerH;
    }
    render() {
        const { w, h, pad, data } = this.layout;
        const color = colorAt(this.colors, this.series[0], 0);
        if (!data.length) {
            return html `<div role="img" aria-label=${this.describe()}>
        <svg viewBox="0 0 ${w} ${h}" width=${w} height=${h} aria-hidden="true"></svg>
      </div>`;
        }
        return html `
      <div role="img" aria-label=${this.describe()}>
        <svg
          viewBox="0 0 ${w} ${h}"
          width=${w}
          height=${h}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          ${this.bars
            ? this.renderBars(data, h - pad, color)
            : this.renderLine(data, h - pad, color)}
        </svg>
      </div>
    `;
    }
    renderLine(data, baseline, color) {
        const pts = data.map((v, i) => [this.xAt(i), this.yAt(v)]);
        const d = linePath(pts, this.smooth);
        const last = pts[pts.length - 1];
        return svg `
      ${this.area
            ? svg `<path
              d=${d + ` L${last[0]},${baseline} L${pts[0][0]},${baseline} Z`}
              fill=${color}
              fill-opacity="0.2"
              stroke="none"
            ></path>`
            : nothing}
      <path class="series-line" d=${d} stroke=${color}></path>
      ${this.showEndpoint
            ? svg `<circle
              class="series-marker"
              cx=${last[0]}
              cy=${last[1]}
              r="2.5"
              fill=${color}
            ></circle>`
            : nothing}
    `;
    }
    renderBars(data, baseline, color) {
        const bw = Math.max(1, (this.layout.innerW / data.length) * 0.7);
        return svg `${data.map((v, i) => {
            const y = this.yAt(v);
            return svg `<rect
        x=${this.xAt(i) - bw / 2}
        y=${y}
        width=${bw}
        height=${Math.max(0, baseline - y)}
        rx="1"
        fill=${color}
      ></rect>`;
        })}`;
    }
    describe() {
        if (this.ariaLabelText) {
            return this.ariaLabelText;
        }
        const data = this.points;
        if (!data.length) {
            return "Sparkline.";
        }
        return `Sparkline trend from ${data[0]} to ${data[data.length - 1]}.`;
    }
}
__decorate([
    property({ attribute: false })
], Sparkline.prototype, "values", void 0);
__decorate([
    property({ type: Boolean })
], Sparkline.prototype, "smooth", void 0);
__decorate([
    property({ type: Boolean })
], Sparkline.prototype, "area", void 0);
__decorate([
    property({ type: Boolean })
], Sparkline.prototype, "bars", void 0);
__decorate([
    property({ type: Boolean, attribute: "show-endpoint" })
], Sparkline.prototype, "showEndpoint", void 0);
//# sourceMappingURL=sparkline.js.map