import type WritingHeatmapPlugin from "./main";
import { addDays, formatDate, openDailyNote, startOfDay } from "./utils";

// ============================================================================
// Constants
// ============================================================================

const NUM_WEEKS = 25;
const CELL_SIZE = 11;
const GUTTER = 3;
const CELL_STEP = CELL_SIZE + GUTTER;
const MONTH_LABEL_H = 16;
const DAY_LABEL_W = 28;

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];
const DAY_LABELS: [number, string][] = [
	[1, "Mon"],
	[3, "Wed"],
	[5, "Fri"],
];

const SVG_NS = "http://www.w3.org/2000/svg";

// ============================================================================
// Colour-level scaling — quartile-based to adapt to any range of values
// ============================================================================

type DayDatum = { date: string; created: number; totalWords: number };

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
	tooltipEl.addClass("wh-tooltip--visible");
	tooltipEl.empty();
	tooltipEl.createEl("strong").appendText(day.date);
	tooltipEl.appendText(` · 📝 ${day.created} 篇 · ✍️ ${day.totalWords.toLocaleString()} 字`);
	positionTooltip(e);
}

function positionTooltip(e: MouseEvent): void {
	if (!tooltipEl) return;
	tooltipEl.style.left = `${e.clientX + 12}px`;
	tooltipEl.style.top = `${e.clientY - 32}px`;
}

function hideTooltip(): void {
	if (tooltipEl) tooltipEl.removeClass("wh-tooltip--visible");
}

// ============================================================================
// HeatmapRenderer — builds the SVG
// ============================================================================

export class HeatmapRenderer {
	constructor(private plugin: WritingHeatmapPlugin) {}

	render(container: HTMLElement): void {
		container.empty();

		const today = startOfDay(new Date());
		const todayStr = formatDate(today);

		// Compute date range: ends on Saturday of the current week, starts NUM_WEEKS*7 days earlier
		const endOffset = 6 - today.getDay(); // days until Saturday
		const endDate = addDays(today, endOffset);
		const startDate = addDays(endDate, -(NUM_WEEKS * 7) + 1);
		// Snap startDate back to Sunday
		const startSunday = addDays(startDate, -startDate.getDay());

		const days = this.plugin.tracker.getRange(startSunday, endDate);
		const colorBy = this.plugin.settings.colorBy;
		const levelFn = computeLevelFn(
			days,
			colorBy === "words" ? "totalWords" : "created"
		);

		const numWeeks = Math.ceil(days.length / 7);
		const width = DAY_LABEL_W + numWeeks * CELL_STEP;
		const height = MONTH_LABEL_H + 7 * CELL_STEP;

		const svg = document.createElementNS(SVG_NS, "svg");
		svg.setAttribute("width", `${width}`);
		svg.setAttribute("height", `${height}`);
		svg.classList.add("wh-heatmap");

		// Day cells
		const app = this.plugin.app;
		for (let i = 0; i < days.length; i++) {
			const day = days[i];
			const week = Math.floor(i / 7);
			const dow = i % 7;
			const x = DAY_LABEL_W + week * CELL_STEP;
			const y = MONTH_LABEL_H + dow * CELL_STEP;
			const val =
				colorBy === "words" ? day.totalWords : day.created;
			const level = levelFn(val);

			const rect = document.createElementNS(SVG_NS, "rect");
			rect.setAttribute("x", `${x}`);
			rect.setAttribute("y", `${y}`);
			rect.setAttribute("width", `${CELL_SIZE}`);
			rect.setAttribute("height", `${CELL_SIZE}`);
			rect.setAttribute("rx", "2");
			rect.classList.add("wh-cell", `wh-level-${level}`);
			if (day.date === todayStr) rect.classList.add("wh-today");

			rect.addEventListener("mouseenter", (e) =>
				showTooltip(e, day)
			);
			rect.addEventListener("mousemove", (e) =>
				positionTooltip(e)
			);
			rect.addEventListener("mouseleave", hideTooltip);
			rect.addEventListener("click", () => { void openDailyNote(app, day.date); });

			svg.appendChild(rect);
		}

		// Month labels
		let prevMonth = -1;
		for (let w = 0; w < numWeeks; w++) {
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

		// Day labels (Mon, Wed, Fri)
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

		// Summary line
		const totals = days.reduce(
			(acc, d) => {
				acc.created += d.created;
				acc.words += d.totalWords;
				return acc;
			},
			{ created: 0, words: 0 }
		);

		const summary = container.createDiv("wh-summary");
		summary.setText(
			`过去 ${NUM_WEEKS} 周 · 新建 ${totals.created} 篇 · 写作 ${totals.words.toLocaleString()} 字`
		);
	}
}

// ============================================================================
// HeatmapPopover — floating panel near the ribbon icon
// ============================================================================

export class HeatmapPopover {
	private el: HTMLElement | null = null;
	private outsideHandler: ((e: MouseEvent) => void) | null = null;
	private renderer: HeatmapRenderer;

	constructor(
		private plugin: WritingHeatmapPlugin,
		private anchorEl: HTMLElement,
		private onClose: () => void
	) {
		this.renderer = new HeatmapRenderer(plugin);
	}

	open(): void {
		const el = document.body.createDiv("wh-popover");
		this.el = el;

		// Header
		const header = el.createDiv("wh-popover-header");
		header.createEl("span", {
			text: "Writing heatmap",
			cls: "wh-popover-title",
		});
		const closeBtn = header.createEl("span", {
			text: "\u00D7",
			cls: "wh-popover-close",
		});
		closeBtn.addEventListener("click", () => this.close());

		// Content
		const content = el.createDiv("wh-popover-content");
		this.renderer.render(content);

		// Position: right of ribbon icon, near the top
		const iconRect = this.anchorEl.getBoundingClientRect();
		el.style.left = `${iconRect.right + 10}px`;
		el.style.top = `${iconRect.top}px`;

		// Keep within viewport
		requestAnimationFrame(() => {
			if (!this.el) return;
			const popRect = this.el.getBoundingClientRect();
			if (popRect.right > window.innerWidth - 10) {
				this.el.style.left = `${window.innerWidth - popRect.width - 10}px`;
			}
			if (popRect.bottom > window.innerHeight - 10) {
				this.el.style.top = `${window.innerHeight - popRect.height - 10}px`;
			}
		});

		// Close on outside click (deferred to avoid self-triggering)
		const handler = (e: MouseEvent) => {
			if (!el.contains(e.target as Node)) {
				this.close();
			}
		};
		window.setTimeout(() => document.addEventListener("click", handler), 0);
		this.outsideHandler = handler;
	}

	update(): void {
		if (!this.el) return;
		const content = this.el.querySelector(".wh-popover-content") as HTMLElement;
		if (content) this.renderer.render(content);
	}

	close(): void {
		if (this.outsideHandler) {
			document.removeEventListener("click", this.outsideHandler);
			this.outsideHandler = null;
		}
		if (this.el) {
			this.el.remove();
			this.el = null;
		}
		hideTooltip();
		this.onClose();
	}

	get isOpen(): boolean {
		return this.el !== null;
	}
}
