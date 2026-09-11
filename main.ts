import { Plugin, TFile, WorkspaceLeaf, debounce } from "obsidian";
import {
	DEFAULT_SETTINGS,
	WritingHeatmapSettings,
	WritingHeatmapSettingTab,
} from "./settings";
import { Tracker, TrackerData } from "./tracker";
import { StatsProvider } from "./stats";
import { destroyTooltip, removeStaleTooltips } from "./heatmap";
import { VIEW_TYPE_WRITING_HEATMAP, WritingHeatmapView } from "./view";
import { formatDate } from "./utils";

// ============================================================================
// Persisted data shape (settings + tracker state in one data.json)
// ============================================================================

interface PluginData {
	settings: WritingHeatmapSettings;
	tracker: TrackerData;
	/** Schema version of `tracker`. Bump to force a rebuild on upgrade. */
	dataVersion?: number;
}

/**
 * 2 — notes are bucketed by the date in their own name / frontmatter instead
 * of by `ctime`, so every cached record from version 1 is on the wrong day.
 */
const DATA_VERSION = 2;

// ============================================================================
// Plugin
// ============================================================================

export default class WritingHeatmapPlugin extends Plugin {
	settings: WritingHeatmapSettings = DEFAULT_SETTINGS;
	tracker!: Tracker;
	stats!: StatsProvider;

	private statusBarEl!: HTMLElement;

	async onload(): Promise<void> {
		removeStaleTooltips();

		// --- Load persisted data ---
		const raw: PluginData | null = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw?.settings);

		// --- Aggregation engines ---
		this.tracker = new Tracker(this.app, this.settings, () => {
			void this.persistData();
		});
		this.tracker.onUpdate = () => this.refreshUI();
		this.stats = new StatsProvider(this.app, this.settings, () =>
			this.tracker.getEarliestDate()
		);

		// --- The sidebar view is the only place the heatmap is drawn ---
		this.registerView(
			VIEW_TYPE_WRITING_HEATMAP,
			(leaf: WorkspaceLeaf) => new WritingHeatmapView(leaf, this)
		);

		// --- Secondary entry points ---
		this.addRibbonIcon("bar-chart-2", "写作热力图", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open-writing-heatmap",
			name: "打开写作热力图面板",
			callback: () => {
				void this.activateView();
			},
		});

		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.addClass("wh-statusbar");
		this.statusBarEl.addEventListener("click", () => {
			void this.activateView();
		});

		this.addSettingTab(new WritingHeatmapSettingTab(this.app, this));

		// --- Initialise tracker + register events after layout is ready ---
		this.app.workspace.onLayoutReady(async () => {
			// A stale schema version means the cached day buckets were built by
			// older, different rules; passing null forces a full rescan.
			const cached =
				raw?.dataVersion === DATA_VERSION ? raw?.tracker ?? null : null;
			await this.tracker.initialize(cached);
			// usageDays reads the tracker, which only just filled up.
			this.stats.invalidate();
			this.refreshStatusBar();

			// Obsidian restores sidebar leaves from the saved workspace, so
			// this only fires on first run (or after the user closes the view).
			await this.activateView({ reveal: false });
			this.refreshView();

			this.registerVaultEvents();
		});
	}

	onunload(): void {
		destroyTooltip();
		this.tracker.flush();
	}

	// ----------------------------------------------------------------
	// View management
	// ----------------------------------------------------------------

	/**
	 * Make sure exactly one heatmap view exists in the right sidebar.
	 * Existing views are reused; `reveal` brings it to the front.
	 */
	async activateView(opts: { reveal?: boolean } = {}): Promise<void> {
		const reveal = opts.reveal ?? true;
		const { workspace } = this.app;

		const existing = workspace.getLeavesOfType(VIEW_TYPE_WRITING_HEATMAP);
		if (existing.length > 0) {
			// Reloading the plugin (updates, or a developer reload) can leave
			// the previous leaf behind, so drop any extras before reusing one.
			for (let i = 1; i < existing.length; i++) existing[i].detach();
			if (reveal) await workspace.revealLeaf(existing[0]);
			return;
		}

		const leaf = workspace.getRightLeaf(false);
		if (!leaf) return;

		await leaf.setViewState({
			type: VIEW_TYPE_WRITING_HEATMAP,
			active: false,
		});
		if (reveal) await workspace.revealLeaf(leaf);
	}

	private getView(): WritingHeatmapView | null {
		const leaves = this.app.workspace.getLeavesOfType(
			VIEW_TYPE_WRITING_HEATMAP
		);
		for (const leaf of leaves) {
			if (leaf.view instanceof WritingHeatmapView) return leaf.view;
		}
		return null;
	}

	// ----------------------------------------------------------------
	// Vault events
	// ----------------------------------------------------------------

	private registerVaultEvents(): void {
		const isMarkdown = (f: unknown): f is TFile =>
			f instanceof TFile && f.extension === "md";

		this.registerEvent(
			this.app.vault.on("create", (f) => {
				if (!isMarkdown(f)) return;
				this.tracker.onCreate(f);
				this.invalidateStats();
			})
		);
		this.registerEvent(
			this.app.vault.on("modify", (f) => {
				if (isMarkdown(f)) this.tracker.onModify(f);
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (f) => {
				if (!isMarkdown(f)) return;
				this.tracker.onDelete(f);
				this.invalidateStats();
			})
		);
		this.registerEvent(
			this.app.vault.on("rename", (f, oldPath) => {
				if (!isMarkdown(f)) return;
				this.tracker.onRename(f, oldPath);
				this.invalidateStats();
			})
		);

		// Tag counts follow the metadata cache, which changes on every edit.
		this.registerEvent(
			this.app.metadataCache.on("changed", () => {
				this.invalidateStats();
			})
		);
	}

	// ----------------------------------------------------------------
	// UI refresh
	// ----------------------------------------------------------------

	refreshUI(): void {
		this.refreshStatusBar();
		this.refreshViewDebounced();
	}

	private refreshView(): void {
		this.getView()?.refresh();
	}

	/**
	 * Writing fires tracker updates continuously; repainting the panel on each
	 * one is wasted work, so coalesce them.
	 */
	private refreshViewDebounced = debounce(
		() => { this.refreshView(); },
		500,
		false
	);

	/**
	 * Drop the cached headline numbers and repaint them shortly after. The
	 * recompute itself is in-memory, but there is no reason to run it once per
	 * keystroke while a note is being edited.
	 */
	private invalidateStats(): void {
		this.stats.invalidate();
		this.refreshStatsDebounced();
	}

	private refreshStatsDebounced = debounce(
		() => { this.getView()?.refreshStats(); },
		1500,
		false
	);

	refreshStatusBar(): void {
		const day = this.tracker.getDay(formatDate(new Date()));
		this.statusBarEl.setText(
			`\u{1F4DD} ${day.created} · ✍️ ${day.totalWords.toLocaleString()}`
		);
	}

	// ----------------------------------------------------------------
	// Settings save
	// ----------------------------------------------------------------

	/**
	 * `rebuild` re-reads every tracked file, so it is reserved for settings
	 * that change what counts as writing. Display-only settings skip it.
	 */
	async saveSettings(opts: { rebuild?: boolean } = {}): Promise<void> {
		await this.persistData();
		this.stats.invalidate();
		if (opts.rebuild ?? true) await this.tracker.rebuild();
		this.refreshStatusBar();
		this.refreshView();
	}

	// ----------------------------------------------------------------
	// Persistence
	// ----------------------------------------------------------------

	private async persistData(): Promise<void> {
		const data: PluginData = {
			settings: this.settings,
			tracker: this.tracker.serialize(),
			dataVersion: DATA_VERSION,
		};
		await this.saveData(data);
	}
}
