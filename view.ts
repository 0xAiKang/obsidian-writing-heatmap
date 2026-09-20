import { ItemView, WorkspaceLeaf, debounce } from "obsidian";
import type WritingHeatmapPlugin from "./main";
import { HeatmapRenderer, hideTooltip, renderLegend } from "./heatmap";
import { formatDate } from "./utils";
import { t } from "./i18n";

export const VIEW_TYPE_WRITING_HEATMAP = "writing-heatmap-view";

/** Horizontal padding inside the panel, subtracted before sizing the grid. */
const PANEL_PADDING = 24;

// ============================================================================
// WritingHeatmapView — the always-on sidebar panel
// ============================================================================

export class WritingHeatmapView extends ItemView {
	private renderer: HeatmapRenderer;
	private resizeObserver: ResizeObserver | null = null;
	private lastWeeks = -1;

	// Element handles, filled in by build()
	private statsEl!: HTMLElement;
	private gridEl!: HTMLElement;
	private legendEl!: HTMLElement;
	private todayEl!: HTMLElement;
	private footnoteEl!: HTMLElement;

	constructor(leaf: WorkspaceLeaf, private plugin: WritingHeatmapPlugin) {
		super(leaf);
		this.renderer = new HeatmapRenderer(plugin);
	}

	getViewType(): string {
		return VIEW_TYPE_WRITING_HEATMAP;
	}

	getDisplayText(): string {
		return t().panelTitle;
	}

	getIcon(): string {
		return "bar-chart-2";
	}

	async onOpen(): Promise<void> {
		this.build();
		this.refresh();

		// The sidebar is resizable, so the number of weeks that fit changes.
		// Repaint only when that number actually moves.
		const onResize = debounce(() => { this.renderGridIfReflowed(); }, 120, true);
		this.resizeObserver = new ResizeObserver(() => { onResize(); });
		this.resizeObserver.observe(this.contentEl);
	}

	async onClose(): Promise<void> {
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		hideTooltip();
	}

	// ----------------------------------------------------------------
	// DOM scaffold — built once, then refreshed in place
	// ----------------------------------------------------------------

	private build(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("wh-view");

		const panel = root.createDiv("wh-panel");

		this.statsEl = panel.createDiv("wh-stats");
		this.todayEl = panel.createDiv("wh-today");

		const card = panel.createDiv("wh-card");
		const head = card.createDiv("wh-card-head");
		head.createSpan({ cls: "wh-card-title", text: t().panelTitle });
		head.createSpan({ cls: "wh-card-meta" });
		this.gridEl = card.createDiv("wh-grid");

		// Footnote and legend share one row; a stacked sidebar is short and
		// every saved row keeps the panel scroll-free.
		const foot = card.createDiv("wh-card-foot");
		this.footnoteEl = foot.createDiv("wh-footnote");
		this.legendEl = foot.createDiv("wh-legend");
		renderLegend(this.legendEl);
	}

	// ----------------------------------------------------------------
	// Refresh
	// ----------------------------------------------------------------

	/** Redraw everything: headline numbers, grid, today's row. */
	refresh(): void {
		if (!this.statsEl) return;
		this.renderStats();
		this.renderGrid();
		this.renderToday();
	}

	/** Redraw only the headline numbers (cheap; used on metadata churn). */
	refreshStats(): void {
		if (!this.statsEl) return;
		this.renderStats();
	}

	private renderStats(): void {
		const stats = this.plugin.stats.get();
		this.statsEl.empty();

		const s = t();
		this.addStat(stats.noteCount, s.statNotes, this.noteCountTooltip());
		this.addStat(stats.tagCount, s.statTags, s.tipTags);
		this.addStat(
			stats.usageDays,
			s.statDays,
			stats.firstDate
				? s.tipDays(stats.firstDate, stats.usageDays)
				: s.tipDaysEmpty
		);
	}

	private addStat(value: number, label: string, tooltip: string): void {
		const item = this.statsEl.createDiv("wh-stat");
		item.setAttr("aria-label", tooltip);
		item.createDiv({
			cls: "wh-stat-num",
			text: value.toLocaleString(),
		});
		item.createDiv({ cls: "wh-stat-label", text: label });
	}

	private noteCountTooltip(): string {
		const folders = this.plugin.settings.statsFolders;
		if (folders.length === 0) return t().tipNotesVault;
		return t().tipNotesFolders(folders);
	}

	/** Repaint only if the container width now fits a different column count. */
	private renderGridIfReflowed(): void {
		if (!this.gridEl) return;
		const weeks = this.renderer.weeksForWidth(this.availableWidth());
		if (weeks === this.lastWeeks && this.gridEl.firstChild) return;
		this.renderGrid();
	}

	private availableWidth(): number {
		const width = this.gridEl.clientWidth || this.contentEl.clientWidth;
		return Math.max(width - PANEL_PADDING, 0);
	}

	private renderGrid(): void {
		if (!this.gridEl) return;

		const available = this.availableWidth();
		this.lastWeeks = this.renderer.weeksForWidth(available);

		const totals = this.renderer.render(this.gridEl, available);

		const s = t();
		const meta = this.contentEl.querySelector(".wh-card-meta");
		if (meta instanceof HTMLElement) {
			meta.setText(
				this.plugin.settings.colorBy === "words"
					? s.colorByWords
					: s.colorByNotes
			);
		}

		this.footnoteEl.setText(
			s.footnote(totals.weeks, totals.created, totals.words)
		);
		this.footnoteEl.setAttr(
			"aria-label",
			s.footnoteAria(totals.weeks, totals.created, totals.words)
		);
	}

	private renderToday(): void {
		const day = this.plugin.tracker.getDay(formatDate(new Date()));
		this.todayEl.empty();

		const s = t();
		this.todayEl.createSpan({ cls: "wh-today-label", text: s.today });
		this.todayEl.createSpan({
			cls: "wh-today-num",
			text: day.created.toLocaleString(),
		});
		this.todayEl.createSpan({ cls: "wh-today-label", text: s.unitNotes });
		this.todayEl.createSpan({ cls: "wh-today-sep", text: "·" });
		this.todayEl.createSpan({
			cls: "wh-today-num",
			text: day.totalWords.toLocaleString(),
		});
		this.todayEl.createSpan({ cls: "wh-today-label", text: s.unitWords });
	}
}
