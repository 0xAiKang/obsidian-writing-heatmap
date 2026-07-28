import { App, PluginSettingTab, Setting, debounce } from "obsidian";
import type WritingHeatmapPlugin from "./main";

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
	 * Folders counted by the panel's "笔记" number. Empty means the whole vault.
	 * Independent of excludePatterns, which only govern the heatmap.
	 */
	statsFolders: string[];
}

/** Aikang's four writing pillars — the folders that hold actual notes. */
export const DEFAULT_STATS_FOLDERS = [
	"00 INDEX·收件箱",
	"01 RIVER·河流",
	"03 GEMS·晶石",
	"04 MOUNTAINS·山脉",
];

export const DEFAULT_SETTINGS: WritingHeatmapSettings = {
	excludePatterns: [],
	includePatterns: [],
	includeCodeBlocks: false,
	colorBy: "words",
	statsFolders: [...DEFAULT_STATS_FOLDERS],
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
		containerEl.empty();

		// --- Stats folders (panel header) ---
		new Setting(containerEl)
			.setName("Stats folders")
			.setDesc(
				"侧栏面板顶部「笔记」数字只统计这些目录。每行一个目录路径，留空表示统计全库。" +
					"标签数与使用天数始终按全库计算。"
			)
			.addTextArea((ta) => {
				ta.setPlaceholder(DEFAULT_STATS_FOLDERS.join("\n"))
					.setValue(this.plugin.settings.statsFolders.join("\n"))
					.onChange(async (v) => {
						this.plugin.settings.statsFolders = splitLines(v);
						await this.plugin.saveSettings({ rebuild: false });
					});
				ta.inputEl.rows = 5;
				ta.inputEl.cols = 40;
			})
			.addExtraButton((b) =>
				b
					.setIcon("rotate-ccw")
					.setTooltip("恢复默认四个目录")
					.onClick(() => {
						this.plugin.settings.statsFolders = [
							...DEFAULT_STATS_FOLDERS,
						];
						void this.plugin
							.saveSettings({ rebuild: false })
							.then(() => { this.display(); });
					})
			);

		// --- Exclude patterns ---
		new Setting(containerEl)
			.setName("Exclude patterns")
			.setDesc(
				"不参与统计的文件 / 文件夹。每行一个，支持 glob（如 templates/**、**/archive/**）。" +
					"Templates 核心插件配置的模板文件夹会自动排除。"
			)
			.addTextArea((ta) => {
				ta.setPlaceholder("Templates/**\n**/archive/**")
					.setValue(this.plugin.settings.excludePatterns.join("\n"))
					.onChange((v) => {
						this.plugin.settings.excludePatterns = splitLines(v);
						this.saveWithRebuild();
					});
				ta.inputEl.rows = 5;
				ta.inputEl.cols = 40;
			});

		// --- Include patterns (whitelist) ---
		new Setting(containerEl)
			.setName("Include patterns")
			.setDesc(
				"如果填写了，则只统计匹配这些模式的文件。留空表示不启用白名单。每行一个 glob。"
			)
			.addTextArea((ta) => {
				ta.setPlaceholder("Journal/**\nnotes/**")
					.setValue(this.plugin.settings.includePatterns.join("\n"))
					.onChange((v) => {
						this.plugin.settings.includePatterns = splitLines(v);
						this.saveWithRebuild();
					});
				ta.inputEl.rows = 5;
				ta.inputEl.cols = 40;
			});

		// --- Code blocks toggle ---
		new Setting(containerEl)
			.setName("Count code blocks")
			.setDesc(
				"是否把代码块（```…```）和行内代码（`code`）里的内容计入字数统计。"
			)
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.includeCodeBlocks)
					.onChange(async (v) => {
						this.plugin.settings.includeCodeBlocks = v;
						await this.plugin.saveSettings();
					})
			);

		// --- Color by ---
		new Setting(containerEl)
			.setName("Color by")
			.setDesc("方格颜色深浅反映每日笔记数还是字数。")
			.addDropdown((d) =>
				d
					.addOption("words", "字数 (words)")
					.addOption("notes", "笔记数 (notes)")
					.setValue(this.plugin.settings.colorBy)
					.onChange(async (v) => {
						this.plugin.settings.colorBy = v as "words" | "notes";
						await this.plugin.saveSettings({ rebuild: false });
					})
			);

		// --- Rebuild button ---
		new Setting(containerEl)
			.setName("Rebuild index")
			.setDesc(
				"如果数据不准确，点击此按钮强制重新扫描所有文件。"
			)
			.addButton((b) =>
				b
					.setButtonText("Rebuild")
					.setCta()
					.onClick(() => {
						b.setButtonText("Rebuilding…").setDisabled(true);
						void this.plugin.tracker.rebuild().then(() => {
							this.plugin.refreshUI();
							b.setButtonText("Done!").setDisabled(false);
							window.setTimeout(() => { b.setButtonText("Rebuild"); }, 2000);
						});
					})
			);
	}
}
