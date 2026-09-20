/**
 * Two-locale string table.
 *
 * Obsidian keeps the interface language in `localStorage.language`; an unset
 * key means English. Anything Chinese uses the zh table, everything else en,
 * so the panel speaks the same language as the app around it and the plugin
 * needs no language setting of its own.
 */

export interface Strings {
	// --- Plugin-level ---
	panelTitle: string;
	togglePanel: string;

	// --- Headline numbers ---
	statNotes: string;
	statTags: string;
	statDays: string;
	tipNotesVault: string;
	tipNotesFolders: (folders: string[]) => string;
	tipTags: string;
	tipDays: (firstDate: string, days: number) => string;
	tipDaysEmpty: string;

	// --- Heatmap card ---
	colorByWords: string;
	colorByNotes: string;
	footnote: (weeks: number, notes: number, words: number) => string;
	footnoteAria: (weeks: number, notes: number, words: number) => string;
	legendLess: string;
	legendMore: string;
	months: string[];
	weekdays: [number, string][];

	// --- Today row + tooltip ---
	today: string;
	unitNotes: string;
	unitWords: string;

	// --- Notices ---
	noDailyNote: (date: string) => string;

	// --- Settings ---
	setStatsFolders: string;
	setStatsFoldersDesc: string;
	setExclude: string;
	setExcludeDesc: string;
	setInclude: string;
	setIncludeDesc: string;
	setCodeBlocks: string;
	setCodeBlocksDesc: string;
	setColorBy: string;
	setColorByDesc: string;
	setRebuild: string;
	setRebuildDesc: string;
	btnRebuild: string;
	btnRebuilding: string;
	btnRebuilt: string;
}

// ============================================================================
// English
// ============================================================================

const en: Strings = {
	panelTitle: "Writing heatmap",
	togglePanel: "Toggle panel",

	statNotes: "Notes",
	statTags: "Tags",
	statDays: "Days",
	tipNotesVault: "Every Markdown note in the vault",
	tipNotesFolders: (folders) => "Counted folders:\n" + folders.join("\n"),
	tipTags:
		"Distinct tags across the vault. Nested tags count by their full path; case is ignored.",
	tipDays: (firstDate, days) =>
		`${days} days since the first note, dated ${firstDate}`,
	tipDaysEmpty: "No notes in this vault yet",

	colorByWords: "By characters",
	colorByNotes: "By notes",
	footnote: (weeks, notes, words) =>
		`${weeks}w · ${notes.toLocaleString()} notes · ${compact(words, false)} chars`,
	footnoteAria: (weeks, notes, words) =>
		`${notes.toLocaleString()} notes and ${words.toLocaleString()} characters over the last ${weeks} weeks`,
	legendLess: "Less",
	legendMore: "More",
	months: [
		"Jan", "Feb", "Mar", "Apr", "May", "Jun",
		"Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
	],
	weekdays: [
		[1, "Mon"],
		[3, "Wed"],
		[5, "Fri"],
	],

	today: "Today",
	unitNotes: "notes",
	unitWords: "chars",

	noDailyNote: (date) => `No daily note for ${date}`,

	setStatsFolders: "Counted folders",
	setStatsFoldersDesc:
		"Folders behind the panel's note count, one path per line. Leave empty to count the whole vault. Tags and days are always vault-wide.",
	setExclude: "Exclude patterns",
	setExcludeDesc:
		"Files and folders kept out of the heatmap, one glob per line, for example templates/** or **/archive/**. The folder configured in the Templates core plugin is excluded automatically.",
	setInclude: "Include patterns",
	setIncludeDesc:
		"Whitelist. When this is not empty, only files matching one of these globs are tracked. One glob per line.",
	setCodeBlocks: "Count code blocks",
	setCodeBlocksDesc:
		"Count characters inside fenced code blocks and inline code towards the daily total.",
	setColorBy: "Color cells by",
	setColorByDesc: "Whether cell shade follows characters written or notes dated that day.",
	setRebuild: "Rebuild index",
	setRebuildDesc: "Rescan every file from scratch. Use this if the numbers look wrong.",
	btnRebuild: "Rebuild",
	btnRebuilding: "Rebuilding…",
	btnRebuilt: "Done",
};

// ============================================================================
// 简体中文
// ============================================================================

const zh: Strings = {
	panelTitle: "写作热力图",
	togglePanel: "开关面板",

	statNotes: "笔记",
	statTags: "标签",
	statDays: "天",
	tipNotesVault: "全库 Markdown 笔记总数",
	tipNotesFolders: (folders) => "统计目录：\n" + folders.join("\n"),
	tipTags: "全库去重后的标签总数。嵌套标签按完整路径计数，忽略大小写差异。",
	tipDays: (firstDate, days) => `自最早一篇笔记 ${firstDate} 算起，共 ${days} 天`,
	tipDaysEmpty: "库中还没有笔记",

	colorByWords: "按字数",
	colorByNotes: "按篇数",
	footnote: (weeks, notes, words) =>
		`${weeks} 周 · ${notes.toLocaleString()} 篇 · ${compact(words, true)} 字`,
	footnoteAria: (weeks, notes, words) =>
		`最近 ${weeks} 周共 ${notes.toLocaleString()} 篇笔记、${words.toLocaleString()} 字`,
	legendLess: "少",
	legendMore: "多",
	months: [
		"1月", "2月", "3月", "4月", "5月", "6月",
		"7月", "8月", "9月", "10月", "11月", "12月",
	],
	weekdays: [
		[1, "一"],
		[3, "三"],
		[5, "五"],
	],

	today: "今天",
	unitNotes: "篇",
	unitWords: "字",

	noDailyNote: (date) => `该日没有日记：${date}`,

	setStatsFolders: "统计目录",
	setStatsFoldersDesc:
		"面板顶部「笔记」数字只统计这些目录，每行一个路径。留空表示统计全库。标签数与使用天数始终按全库计算。",
	setExclude: "排除规则",
	setExcludeDesc:
		"不计入热力图的文件与文件夹，每行一个 glob，例如 templates/** 或 **/archive/**。Templates 核心插件配置的模板文件夹会自动排除。",
	setInclude: "白名单规则",
	setIncludeDesc:
		"填写后只统计匹配这些 glob 的文件，留空表示不启用白名单。每行一个 glob。",
	setCodeBlocks: "统计代码块",
	setCodeBlocksDesc: "是否把代码块与行内代码里的字符计入每日字数。",
	setColorBy: "配色依据",
	setColorByDesc: "方格深浅反映当天写下的字数，还是归到当天的笔记篇数。",
	setRebuild: "重建索引",
	setRebuildDesc: "从头重新扫描所有文件。数据看起来不对时用它。",
	btnRebuild: "重建",
	btnRebuilding: "重建中…",
	btnRebuilt: "完成",
};

// ============================================================================
// Number shortening — used by the footnote, where a full count wraps the line
// ============================================================================

export function compact(n: number, chinese: boolean): string {
	if (chinese) {
		if (n < 10_000) return n.toLocaleString();
		return `${(n / 10_000).toFixed(1)}万`;
	}
	if (n < 10_000) return n.toLocaleString();
	if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(1)}M`;
}

// ============================================================================
// Resolution
// ============================================================================

let cached: Strings | null = null;

/**
 * The active string table. Obsidian needs a restart to change language, so
 * resolving once per plugin load is enough.
 */
export function t(): Strings {
	if (cached) return cached;
	let lang = "";
	try {
		lang = window.localStorage.getItem("language") ?? "";
	} catch {
		lang = "";
	}
	cached = lang.toLowerCase().startsWith("zh") ? zh : en;
	return cached;
}
