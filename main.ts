import {
	Plugin,
	TFile,
	WorkspaceLeaf,
	WorkspaceSidedock,
	debounce,
} from "obsidian";
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
import { t } from "./i18n";

// ============================================================================
// Persisted data shape (settings + tracker state in one data.json)
// ============================================================================

interface PluginData {
	settings: WritingHeatmapSettings;
	tracker: TrackerData;
	/** Schema version of `tracker`. Bump to force a rebuild on upgrade. */
	dataVersion?: number;
	/**
	 * Set once the panel has been put in the sidebar for the first time.
	 * After that the saved workspace owns it, and the plugin never creates
	 * another one behind the user's back.
	 */
	panelCreated?: boolean;
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
	private panelCreated = false;
	private firstRunTimer: number | null = null;

	async onload(): Promise<void> {
		removeStaleTooltips();

		// --- Load persisted data ---
		const raw: PluginData | null = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw?.settings);
		this.panelCreated = raw?.panelCreated ?? false;

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
		this.addRibbonIcon("bar-chart-2", t().panelTitle, () => {
			void this.togglePanel();
		});

		this.addCommand({
			id: "toggle-panel",
			name: t().togglePanel,
			callback: () => {
				void this.togglePanel();
			},
		});

		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.addClass("wh-statusbar");
		this.statusBarEl.setAttr("aria-label", t().panelTitle);
		this.registerDomEvent(this.statusBarEl, "click", () => {
			void this.togglePanel();
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

			this.refreshView();
			this.openPanelOnFirstRun();

			this.registerVaultEvents();
		});
	}

	onunload(): void {
		if (this.firstRunTimer != null) {
			window.clearTimeout(this.firstRunTimer);
			this.firstRunTimer = null;
		}
		destroyTooltip();
		this.tracker.dispose();
	}

	// ----------------------------------------------------------------
	// View management
	// ----------------------------------------------------------------

	/**
	 * Put the panel in the right sidebar, reusing one that is already there.
	 * `reveal` brings it to the front of its tab group.
	 */
	async activateView(opts: { reveal?: boolean } = {}): Promise<void> {
		const reveal = opts.reveal ?? true;
		const { workspace } = this.app;

		const existing = this.getLeaf();
		if (existing) {
			if (reveal) await workspace.revealLeaf(existing);
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

	/**
	 * Open the panel once, on the very first load, and never again.
	 *
	 * Obsidian restores sidebar leaves from the saved workspace, but it does
	 * so a beat after `onLayoutReady` fires — which is why opening the panel
	 * on every load used to leave a second copy behind on each plugin reload.
	 * A persisted flag makes this a genuine one-off, so an upgrade cannot
	 * duplicate the panel and closing it stays closed.
	 */
	private openPanelOnFirstRun(): void {
		if (this.panelCreated) return;

		this.firstRunTimer = window.setTimeout(() => {
			this.firstRunTimer = null;
			this.panelCreated = true;
			if (!this.getLeaf()) void this.activateView({ reveal: false });
			void this.persistData();
		}, 1000);
	}

	/**
	 * Ribbon / command / status bar entry point.
	 *
	 * Revealing an already-visible panel is a no-op, which reads as a dead
	 * button, so a click on a panel that is already in front collapses the
	 * sidebar it lives in instead. Every other state — collapsed sidebar,
	 * another tab in front, no panel at all — brings it back.
	 *
	 * `isShown()` answers "is this leaf the one on screen", which covers both
	 * a collapsed dock and a sibling tab in front, but it reads layout. The
	 * `collapsed` check in front of it is the cheap, synchronous half.
	 */
	async togglePanel(): Promise<void> {
		const { workspace } = this.app;
		const leaf = this.getLeaf();
		if (!leaf) {
			await this.activateView();
			return;
		}

		const root = leaf.getRoot();
		const dock =
			root === workspace.rightSplit || root === workspace.leftSplit
				? (root as WorkspaceSidedock)
				: null;

		if (dock && !dock.collapsed && leaf.view.containerEl.isShown()) {
			dock.collapse();
			return;
		}

		await workspace.revealLeaf(leaf);
	}

	private getLeaf(): WorkspaceLeaf | null {
		return (
			this.app.workspace.getLeavesOfType(VIEW_TYPE_WRITING_HEATMAP)[0] ??
			null
		);
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
			panelCreated: this.panelCreated,
		};
		await this.saveData(data);
	}
}
