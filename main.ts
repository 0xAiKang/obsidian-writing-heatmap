import { Plugin, TFile } from "obsidian";
import {
	DEFAULT_SETTINGS,
	WritingHeatmapSettings,
	WritingHeatmapSettingTab,
} from "./settings";
import { Tracker, TrackerData } from "./tracker";
import { HeatmapPopover } from "./heatmap";
import { formatDate } from "./utils";

// ============================================================================
// Persisted data shape (settings + tracker state in one data.json)
// ============================================================================

interface PluginData {
	settings: WritingHeatmapSettings;
	tracker: TrackerData;
}

// ============================================================================
// Plugin
// ============================================================================

export default class WritingHeatmapPlugin extends Plugin {
	settings: WritingHeatmapSettings = DEFAULT_SETTINGS;
	tracker!: Tracker;

	private statusBarEl!: HTMLElement;
	private ribbonEl!: HTMLElement;
	private popover: HeatmapPopover | null = null;

	async onload(): Promise<void> {
		// --- Load persisted data ---
		const raw: PluginData | null = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw?.settings);

		// --- Tracker ---
		this.tracker = new Tracker(this.app, this.settings, () => {
			void this.persistData();
		});
		this.tracker.onUpdate = () => this.refreshUI();

		// --- UI: status bar ---
		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.addClass("wh-statusbar");
		this.statusBarEl.addEventListener("click", () =>
			this.togglePopover()
		);

		// --- UI: ribbon icon ---
		this.ribbonEl = this.addRibbonIcon(
			"bar-chart-2",
			"Writing heatmap",
			() => this.togglePopover()
		);

		// --- Settings tab ---
		this.addSettingTab(new WritingHeatmapSettingTab(this.app, this));

		// --- Initialise tracker + register events after layout is ready ---
		this.app.workspace.onLayoutReady(async () => {
			await this.tracker.initialize(raw?.tracker ?? null);
			this.refreshStatusBar();

			// Register vault events
			this.registerEvent(
				this.app.vault.on("create", (f) => {
					if (f instanceof TFile && f.extension === "md")
						this.tracker.onCreate(f);
				})
			);
			this.registerEvent(
				this.app.vault.on("modify", (f) => {
					if (f instanceof TFile && f.extension === "md")
						this.tracker.onModify(f);
				})
			);
			this.registerEvent(
				this.app.vault.on("delete", (f) => {
					if (f instanceof TFile && f.extension === "md")
						this.tracker.onDelete(f);
				})
			);
			this.registerEvent(
				this.app.vault.on("rename", (f, oldPath) => {
					if (f instanceof TFile && f.extension === "md")
						this.tracker.onRename(f, oldPath);
				})
			);
		});
	}

	onunload(): void {
		if (this.popover) {
			this.popover.close();
			this.popover = null;
		}
		this.tracker.flush();
	}

	// ----------------------------------------------------------------
	// UI refresh
	// ----------------------------------------------------------------

	refreshUI(): void {
		this.refreshStatusBar();
		if (this.popover?.isOpen) this.popover.update();
	}

	refreshStatusBar(): void {
		const today = formatDate(new Date());
		const day = this.tracker.getDay(today);
		this.statusBarEl.setText(
			`\u{1F4DD} ${day.created} \u00B7 \u270D\uFE0F ${day.totalWords.toLocaleString()}`
		);
	}

	// ----------------------------------------------------------------
	// Popover toggle
	// ----------------------------------------------------------------

	private togglePopover(): void {
		if (this.popover?.isOpen) {
			this.popover.close();
			this.popover = null;
		} else {
			this.popover = new HeatmapPopover(
				this,
				this.ribbonEl,
				() => {
					this.popover = null;
				}
			);
			this.popover.open();
		}
	}

	// ----------------------------------------------------------------
	// Settings save
	// ----------------------------------------------------------------

	async saveSettings(): Promise<void> {
		await this.persistData();
		await this.tracker.rebuild();
		this.refreshUI();
	}

	// ----------------------------------------------------------------
	// Persistence
	// ----------------------------------------------------------------

	private async persistData(): Promise<void> {
		const data: PluginData = {
			settings: this.settings,
			tracker: this.tracker.serialize(),
		};
		await this.saveData(data);
	}
}
