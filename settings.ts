import { App, PluginSettingTab, Setting, debounce } from "obsidian";
import type WritingHeatmapPlugin from "./main";
import { t } from "./i18n";

// ============================================================================
// Settings interface & defaults
// ============================================================================

export interface WritingHeatmapSettings {
	/** Glob patterns to exclude from tracking. One per entry. */
	excludePatterns: string[];
	/** Whitelist glob patterns. If non-empty, only matched files are tracked. */
	includePatterns: string[];
	/** Whether to include code block characters in word count. */
	includeCodeBlocks: boolean;
	/** Heatmap cell colouring dimension. */
	colorBy: "words" | "notes";
	/**
	 * Folders counted by the panel's note number. Empty — the default — means
	 * the whole vault. Independent of excludePatterns, which only govern the
	 * heatmap.
	 */
	statsFolders: string[];
}

export const DEFAULT_SETTINGS: WritingHeatmapSettings = {
	excludePatterns: [],
	includePatterns: [],
	includeCodeBlocks: false,
	colorBy: "words",
	statsFolders: [],
};

// ============================================================================
// Settings tab
// ============================================================================

/** Split a textarea value into trimmed, non-empty lines. */
function splitLines(v: string): string[] {
	return v
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean);
}

export class WritingHeatmapSettingTab extends PluginSettingTab {
	plugin: WritingHeatmapPlugin;

	/**
	 * The pattern textareas fire onChange per keystroke, and each rebuild
	 * re-reads every tracked file. Wait for a pause in typing before doing it.
	 */
	private saveWithRebuild = debounce(
		() => { void this.plugin.saveSettings({ rebuild: true }); },
		800,
		true
	);

	constructor(app: App, plugin: WritingHeatmapPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		const s = t();
		containerEl.empty();

		// --- Folders behind the panel's note count ---
		new Setting(containerEl)
			.setName(s.setStatsFolders)
			.setDesc(s.setStatsFoldersDesc)
			.addTextArea((ta) => {
				ta.setPlaceholder("Journal\nNotes")
					.setValue(this.plugin.settings.statsFolders.join("\n"))
					.onChange(async (v) => {
						this.plugin.settings.statsFolders = splitLines(v);
						await this.plugin.saveSettings({ rebuild: false });
					});
				ta.inputEl.rows = 4;
				ta.inputEl.cols = 40;
			});

		// --- Exclude patterns ---
		new Setting(containerEl)
			.setName(s.setExclude)
			.setDesc(s.setExcludeDesc)
			.addTextArea((ta) => {
				ta.setPlaceholder("Templates/**\n**/archive/**")
					.setValue(this.plugin.settings.excludePatterns.join("\n"))
					.onChange((v) => {
						this.plugin.settings.excludePatterns = splitLines(v);
						this.saveWithRebuild();
					});
				ta.inputEl.rows = 4;
				ta.inputEl.cols = 40;
			});

		// --- Include patterns (whitelist) ---
		new Setting(containerEl)
			.setName(s.setInclude)
			.setDesc(s.setIncludeDesc)
			.addTextArea((ta) => {
				ta.setPlaceholder("Journal/**\nNotes/**")
					.setValue(this.plugin.settings.includePatterns.join("\n"))
					.onChange((v) => {
						this.plugin.settings.includePatterns = splitLines(v);
						this.saveWithRebuild();
					});
				ta.inputEl.rows = 4;
				ta.inputEl.cols = 40;
			});

		// --- Code blocks toggle ---
		new Setting(containerEl)
			.setName(s.setCodeBlocks)
			.setDesc(s.setCodeBlocksDesc)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.includeCodeBlocks)
					.onChange(async (v) => {
						this.plugin.settings.includeCodeBlocks = v;
						await this.plugin.saveSettings();
					})
			);

		// --- Color by ---
		new Setting(containerEl)
			.setName(s.setColorBy)
			.setDesc(s.setColorByDesc)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("words", s.colorByWords)
					.addOption("notes", s.colorByNotes)
					.setValue(this.plugin.settings.colorBy)
					.onChange(async (v) => {
						this.plugin.settings.colorBy = v as "words" | "notes";
						await this.plugin.saveSettings({ rebuild: false });
					})
			);

		// --- Rebuild button ---
		new Setting(containerEl)
			.setName(s.setRebuild)
			.setDesc(s.setRebuildDesc)
			.addButton((button) =>
				button
					.setButtonText(s.btnRebuild)
					.setCta()
					.onClick(() => {
						button.setButtonText(s.btnRebuilding).setDisabled(true);
						void this.plugin.tracker.rebuild().then(() => {
							this.plugin.refreshUI();
							button.setButtonText(s.btnRebuilt).setDisabled(false);
							window.setTimeout(() => {
								button.setButtonText(s.btnRebuild);
							}, 2000);
						});
					})
			);
	}
}
