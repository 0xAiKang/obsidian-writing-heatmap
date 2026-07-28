import type WritingHeatmapPlugin from "./main";
import { addDays, formatDate, openDailyNote, startOfDay } from "./utils";

// ============================================================================
// Geometry
// ============================================================================

const CELL_SIZE = 10;
const GUTTER = 3;
const CELL_STEP = CELL_SIZE + GUTTER;
const MONTH_LABEL_H = 14;
const DAY_LABEL_W = 20;

/** Bounds on how much history to draw, in weeks. */
const MIN_WEEKS = 8;
const MAX_WEEKS = 53;
const FALLBACK_WEEKS = 20;

const MONTHS = [
	"1月",
	"2月",
	"3月",
	"4月",
	"5月",
	"6月",
	"7月",
	"8月",
	"9月",
	"10月",
	"11月",
	"12月",
];
const DAY_LABELS: [number, string][] = [
	[1, "一"],
	[3, "三"],
	[5, "五"],
];

const SVG_NS = "http://www.w3.org/2000/svg";

// ============================================================================
// Colour-level scaling — quartile-based to adapt to any range of values
// ============================================================================

export type DayDatum = { date: string; created: number; totalWords: number };

function computeLevelFn(days: DayDatum[], key: "totalWords" | "created") {
	const nonZero = days
		.map((d) => d[key])
		.filter((v) => v > 0)
		.sort((a, b) => a - b);

	if (nonZero.length === 0) return () => 0;

	const q1 = nonZero[Math.floor(nonZero.length * 0.25)];
	const q2 = nonZero[Math.floor(nonZero.length * 0.5)];
	const q3 = nonZero[Math.floor(nonZero.length * 0.75)];

	return (val: number): number => {
		if (val <= 0) return 0;
		if (val >= q3) return 4;
		if (val >= q2) return 3;
		if (val >= q1) return 2;
		return 1;
	};
}

// ============================================================================
// Tooltip (shared singleton)
// ============================================================================

let tooltipEl: HTMLElement | null = null;

function showTooltip(e: MouseEvent, day: DayDatum): void {
	if (!tooltipEl) {
		tooltipEl = document.body.createDiv("wh-tooltip");
	}
	tooltipEl.empty();
	tooltipEl.createDiv({ cls: "wh-tooltip-date", text: day.date });
	const row = tooltipEl.createDiv({ cls: "wh-tooltip-row" });
	row.createSpan({ text: `${day.created} 篇` });
	row.createSpan({ cls: "wh-tooltip-sep", text: "·" });
	row.createSpan({ text: `${day.totalWords.toLocaleString()} 字` });
	tooltipEl.addClass("wh-tooltip--visible");
	positionTooltip(e);
}

function positionTooltip(e: MouseEvent): void {
	if (!tooltipEl) return;
	const rect = tooltipEl.getBoundingClientRect();
	// Flip to the left of the cursor when the tooltip would leave the window.
	const left = Math.min(e.clientX + 12, window.innerWidth - rect.width - 8);
	const top = Math.max(e.clientY - rect.height - 10, 8);
	tooltipEl.style.left = `${Math.max(left, 8)}px`;
	tooltipEl.style.top = `${top}px`;
}

export function hideTooltip(): void {
	if (tooltipEl) tooltipEl.removeClass("wh-tooltip--visible");
}

export function destroyTooltip(): void {
	if (tooltipEl) {
		tooltipEl.remove();
		tooltipEl = null;
	}
}

/**
 * Drop tooltip nodes left on `document.body` by a previous load of the plugin.
 * Versions before 2.0.0 never removed theirs on unload, so upgrading — or any
 * developer reload — would otherwise leave dead nodes behind.
 */
export function removeStaleTooltips(): void {
	for (const node of Array.from(document.querySelectorAll(".wh-tooltip"))) {
		if (node !== tooltipEl) node.remove();
	}
}

// ============================================================================
// HeatmapRenderer — builds the SVG grid
// ============================================================================

export class HeatmapRenderer {
	constructor(private plugin: WritingHeatmapPlugin) {}

	/**
	 * How many weeks fit in `availableWidth` pixels. The sidebar is narrow and
	 * resizable, so the grid is sized to the container rather than fixed.
	 */
	weeksForWidth(availableWidth: number): number {
		const usable = availableWidth - DAY_LABEL_W;
		if (!Number.isFinite(usable) || usable <= 0) return FALLBACK_WEEKS;
		const fit = Math.floor(usable / CELL_STEP);
		return Math.max(MIN_WEEKS, Math.min(MAX_WEEKS, fit));
	}

	/**
	 * Draw the grid into `container`, sized to `availableWidth`.
	 * Returns the totals for the drawn window so the caller can label it.
	 */
	render(
		container: HTMLElement,
		availableWidth: number
	): { weeks: number; created: number; words: number } {
		container.empty();

		const numWeeks = this.weeksForWidth(availableWidth);
		const today = startOfDay(new Date());
		const todayStr = formatDate(today);

		// The grid ends on the Saturday of the current week so today's column
		// is always the rightmost one, and starts on a Sunday numWeeks back.
		const endDate = addDays(today, 6 - today.getDay());
		const startDate = addDays(endDate, -(numWeeks * 7) + 1);
		const startSunday = addDays(startDate, -startDate.getDay());

		const days = this.plugin.tracker.getRange(startSunday, endDate);
		const colorBy = this.plugin.settings.colorBy;
		const levelFn = computeLevelFn(
			days,
			colorBy === "words" ? "totalWords" : "created"
		);

		const drawnWeeks = Math.ceil(days.length / 7);
		const width = DAY_LABEL_W + drawnWeeks * CELL_STEP - GUTTER;
		const height = MONTH_LABEL_H + 7 * CELL_STEP - GUTTER;

		const svg = document.createElementNS(SVG_NS, "svg");
		svg.setAttribute("width", `${width}`);
		svg.setAttribute("height", `${height}`);
		svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
		svg.classList.add("wh-heatmap");

		// --- Day cells ---
		const app = this.plugin.app;
		for (let i = 0; i < days.length; i++) {
			const day = days[i];
			const week = Math.floor(i / 7);
			const dow = i % 7;
			const x = DAY_LABEL_W + week * CELL_STEP;
			const y = MONTH_LABEL_H + dow * CELL_STEP;
			const val = colorBy === "words" ? day.totalWords : day.created;
			const level = levelFn(val);

			const rect = document.createElementNS(SVG_NS, "rect");
			rect.setAttribute("x", `${x}`);
			rect.setAttribute("y", `${y}`);
			rect.setAttribute("width", `${CELL_SIZE}`);
			rect.setAttribute("height", `${CELL_SIZE}`);
			rect.setAttribute("rx", "3");
			rect.classList.add("wh-cell", `wh-level-${level}`);
			if (day.date === todayStr) rect.classList.add("wh-cell-today");

			rect.addEventListener("mouseenter", (e) => { showTooltip(e, day); });
			rect.addEventListener("mousemove", (e) => { positionTooltip(e); });
			rect.addEventListener("mouseleave", hideTooltip);
			rect.addEventListener("click", () => {
				hideTooltip();
				void openDailyNote(app, day.date);
			});

			svg.appendChild(rect);
		}

		// --- Month labels ---
		let prevMonth = -1;
		for (let w = 0; w < drawnWeeks; w++) {
			const dayIndex = w * 7;
			if (dayIndex >= days.length) break;
			const d = new Date(days[dayIndex].date + "T00:00:00");
			const m = d.getMonth();
			if (m !== prevMonth) {
				const text = document.createElementNS(SVG_NS, "text");
				text.setAttribute("x", `${DAY_LABEL_W + w * CELL_STEP}`);
				text.setAttribute("y", `${MONTH_LABEL_H - 5}`);
				text.classList.add("wh-month-label");
				text.textContent = MONTHS[m];
				svg.appendChild(text);
				prevMonth = m;
			}
		}

		// --- Weekday labels ---
		for (const [row, label] of DAY_LABELS) {
			const text = document.createElementNS(SVG_NS, "text");
			text.setAttribute("x", "0");
			text.setAttribute(
				"y",
				`${MONTH_LABEL_H + row * CELL_STEP + CELL_SIZE - 1}`
			);
			text.classList.add("wh-day-label");
			text.textContent = label;
			svg.appendChild(text);
		}

		container.appendChild(svg);

		const totals = days.reduce(
			(acc, d) => {
				acc.created += d.created;
				acc.words += d.totalWords;
				return acc;
			},
			{ created: 0, words: 0 }
		);

		return { weeks: drawnWeeks, created: totals.created, words: totals.words };
	}
}

// ============================================================================
// Legend — the "少 ▢▢▢▢▢ 多" strip under the grid
// ============================================================================

export function renderLegend(container: HTMLElement): void {
	container.empty();
	container.createSpan({ cls: "wh-legend-label", text: "少" });
	const swatches = container.createDiv({ cls: "wh-legend-swatches" });
	for (let level = 0; level <= 4; level++) {
		swatches.createDiv({ cls: `wh-legend-swatch wh-level-${level}` });
	}
	container.createSpan({ cls: "wh-legend-label", text: "多" });
}
