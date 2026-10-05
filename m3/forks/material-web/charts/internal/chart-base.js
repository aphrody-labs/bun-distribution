/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { isServer, LitElement } from "lit";
import { property, state } from "lit/decorators.js";
/** The default Material 3 tonal palette used when a series has no colour. */
export const M3_PALETTE = [
    "var(--md-sys-color-primary, #6750a4)",
    "var(--md-sys-color-secondary, #625b71)",
    "var(--md-sys-color-tertiary, #7d5260)",
    "var(--md-sys-color-error, #b3261e)",
    "var(--md-sys-color-primary-container, #eaddff)",
    "var(--md-sys-color-secondary-container, #e8def8)",
    "var(--md-sys-color-tertiary-container, #ffd8e4)",
    "var(--md-sys-color-inverse-primary, #d0bcff)",
];
/** Resolve a colour for series index `i`, honouring overrides. */
export function colorAt(colors, series, i) {
    if (series?.color) {
        return series.color;
    }
    const palette = colors && colors.length ? colors : M3_PALETTE;
    return palette[i % palette.length];
}
/** "Nice" axis bounds + tick count for a numeric range. */
export function niceScale(min, max, ticks = 5) {
    if (min === max) {
        // Avoid a zero-height range.
        max = min + 1;
        min = min - 1;
    }
    const range = max - min;
    const rawStep = range / Math.max(1, ticks);
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / mag;
    let niceStep;
    if (norm < 1.5) {
        niceStep = 1;
    }
    else if (norm < 3) {
        niceStep = 2;
    }
    else if (norm < 7) {
        niceStep = 5;
    }
    else {
        niceStep = 10;
    }
    niceStep *= mag;
    const niceMin = Math.floor(min / niceStep) * niceStep;
    const niceMax = Math.ceil(max / niceStep) * niceStep;
    return { min: niceMin, max: niceMax, step: niceStep };
}
/** Build an SVG path `d` for a polyline / smooth curve through points. */
export function linePath(points, smooth = false) {
    if (!points.length) {
        return "";
    }
    if (!smooth || points.length < 3) {
        return points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");
    }
    // Catmull-Rom -> cubic Bézier smoothing.
    let d = `M${points[0][0]},${points[0][1]}`;
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i === 0 ? 0 : i - 1];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[i + 2 < points.length ? i + 2 : i + 1];
        const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
        const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
        const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
        const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
        d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0]},${p2[1]}`;
    }
    return d;
}
/** Format a number compactly for axis ticks / labels. */
export function fmt(n) {
    if (!isFinite(n)) {
        return "";
    }
    if (Math.abs(n) >= 1000) {
        return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
    }
    return String(Math.round(n * 100) / 100);
}
/**
 * Base class for all charts. Provides declarative sizing, a ResizeObserver for
 * responsive width, the shared `series`/`colors`/`legend`/`tooltip` API and an
 * a11y label. Subclasses implement `renderChart()`.
 */
export class ChartBase extends LitElement {
    constructor() {
        super(...arguments);
        /** Data series. Set via the `.series` property (not an attribute). */
        this.series = [];
        /** Category labels for the X axis (bar / line / area). */
        this.categories = [];
        /** Chart height in px. */
        this.height = 300;
        /**
         * Chart width in px. When unset (0), the chart fills its container width and
         * tracks it with a ResizeObserver.
         */
        this.width = 0;
        /** Show the legend. */
        this.legend = true;
        /** Enable the hover tooltip. */
        this.tooltip = true;
        /** Accessible label describing the chart. */
        this.ariaLabelText = "";
        /** Measured container width (px) used when `width` is 0. */
        this.measuredWidth = 600;
    }
    /** Effective render width. */
    get renderWidth() {
        return this.width > 0 ? this.width : this.measuredWidth;
    }
    connectedCallback() {
        super.connectedCallback();
        if (!isServer && typeof ResizeObserver !== "undefined") {
            this.resizeObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    const w = entry.contentRect.width;
                    if (w > 0 && Math.abs(w - this.measuredWidth) > 1) {
                        this.measuredWidth = w;
                    }
                }
            });
            this.resizeObserver.observe(this);
        }
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        this.resizeObserver?.disconnect();
        this.resizeObserver = undefined;
    }
    /** A11y description built from the series / categories. */
    describe() {
        if (this.ariaLabelText) {
            return this.ariaLabelText;
        }
        const names = this.series.map((s) => s.label).filter(Boolean);
        if (names.length) {
            return `Chart with series: ${names.join(", ")}.`;
        }
        return "Chart.";
    }
}
__decorate([
    property({ attribute: false })
], ChartBase.prototype, "series", void 0);
__decorate([
    property({ attribute: false })
], ChartBase.prototype, "categories", void 0);
__decorate([
    property({ attribute: false })
], ChartBase.prototype, "colors", void 0);
__decorate([
    property({ type: Number })
], ChartBase.prototype, "height", void 0);
__decorate([
    property({ type: Number })
], ChartBase.prototype, "width", void 0);
__decorate([
    property({ type: Boolean })
], ChartBase.prototype, "legend", void 0);
__decorate([
    property({ type: Boolean })
], ChartBase.prototype, "tooltip", void 0);
__decorate([
    property({ attribute: "aria-label" })
], ChartBase.prototype, "ariaLabelText", void 0);
__decorate([
    state()
], ChartBase.prototype, "measuredWidth", void 0);
//# sourceMappingURL=chart-base.js.map