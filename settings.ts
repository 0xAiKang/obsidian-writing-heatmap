import { App, PluginSettingTab, Setting } from "obsidian";
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
}

export const DEFAULT_SETTINGS: WritingHeatmapSettings = {
	excludePatterns: [],
	includePatterns: [],
	includeCodeBlocks: false,
	colorBy: "words",
};

// ============================================================================
// Settings tab
// ============================================================================

export class WritingHeatmapSettingTab extends PluginSettingTab {
	plugin: WritingHeatmapPlugin;

	constructor(app: App, plugin: WritingHeatmapPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

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
					.onChange(async (v) => {
						this.plugin.settings.excludePatterns = v
							.split("\n")
							.map((s) => s.trim())
							.filter(Boolean);
						await this.plugin.saveSettings();
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
					.onChange(async (v) => {
						this.plugin.settings.includePatterns = v
							.split("\n")
							.map((s) => s.trim())
							.filter(Boolean);
						await this.plugin.saveSettings();
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
						await this.plugin.saveSettings();
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
