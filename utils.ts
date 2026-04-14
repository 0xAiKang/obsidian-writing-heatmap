import { App, TFile, Notice, normalizePath } from "obsidian";
import type { WritingHeatmapSettings } from "./settings";

// Minimal types for Obsidian internal APIs not exposed in the public type definitions
interface ObsidianInternalPlugin {
	enabled: boolean;
	instance?: {
		options?: Record<string, string>;
	};
}

type AppWithInternals = App & {
	internalPlugins?: {
		plugins?: Record<string, ObsidianInternalPlugin>;
	};
};

type WindowWithMoment = Window &
	typeof globalThis & {
		moment?: (date: string, format?: string) => { format: (fmt: string) => string };
	};

// ============================================================================
// Date helpers
// ============================================================================

/** Format a Date as YYYY-MM-DD in local time. */
export function formatDate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD as a local Date at 00:00. */
export function parseDate(s: string): Date {
	const [y, m, d] = s.split("-").map(Number);
	return new Date(y, m - 1, d);
}

/** Return a Date representing the start of the same day (local time). */
export function startOfDay(d: Date): Date {
	const out = new Date(d);
	out.setHours(0, 0, 0, 0);
	return out;
}

/** Add N days (may be negative). Returns a new Date. */
export function addDays(d: Date, n: number): Date {
	const out = new Date(d);
	out.setDate(out.getDate() + n);
	return out;
}

// ============================================================================
// Glob matching (simple, no external dependency)
// ============================================================================

/**
 * Convert a glob pattern to a regex.
 * Supports: `*` (any chars except /), `**` (any chars including /), `?` (single char).
 */
function globToRegex(pattern: string): RegExp {
	let re = "^";
	let i = 0;
	while (i < pattern.length) {
		const c = pattern[i];
		if (c === "*") {
			if (pattern[i + 1] === "*") {
				re += ".*";
				i += 2;
				if (pattern[i] === "/") i++;
			} else {
				re += "[^/]*";
				i++;
			}
		} else if (c === "?") {
			re += "[^/]";
			i++;
		} else if (".+^${}()|[]\\".includes(c)) {
			re += "\\" + c;
			i++;
		} else {
			re += c;
			i++;
		}
	}
	re += "$";
	return new RegExp(re);
}

/**
 * Check if a file path matches any pattern in a list.
 * A pattern can be:
 *  - A plain folder path (e.g. "templates") → matches the folder and everything under it.
 *  - A glob containing `*` or `?` (e.g. "**​/archive/**") → regex-matched.
 *  - An exact file path (e.g. "archive/notes.md") → exact-matched.
 */
export function matchesAny(filePath: string, patterns: string[]): boolean {
	for (const raw of patterns) {
		const p = raw.trim();
		if (!p) continue;
		if (filePath === p) return true;
		if (filePath.startsWith(p + "/")) return true;
		if (p.includes("*") || p.includes("?")) {
			if (globToRegex(p).test(filePath)) return true;
		}
	}
	return false;
}

// ============================================================================
// File matcher: combines exclude list, whitelist, and auto template folder
// ============================================================================

export class FileMatcher {
	private templateFolder: string | null = null;

	constructor(private app: App, private settings: WritingHeatmapSettings) {
		this.refresh();
	}

	/** Re-read template folder setting from the Templates core plugin. */
	refresh(): void {
		const internals = (this.app as AppWithInternals).internalPlugins?.plugins;
		const templates = internals?.templates;
		if (templates?.enabled && templates.instance?.options?.folder) {
			this.templateFolder = normalizePath(templates.instance.options.folder);
		} else {
			this.templateFolder = null;
		}
	}

	/** True if the file should NOT be counted. */
	isExcluded(filePath: string): boolean {
		// Whitelist mode: if patterns exist, file must match at least one
		if (this.settings.includePatterns.length > 0) {
			if (!matchesAny(filePath, this.settings.includePatterns)) {
				return true;
			}
		}

		// Auto-exclude template folder
		if (
			this.templateFolder &&
			(filePath === this.templateFolder ||
				filePath.startsWith(this.templateFolder + "/"))
		) {
			return true;
		}

		// User exclude patterns
		if (matchesAny(filePath, this.settings.excludePatterns)) {
			return true;
		}

		return false;
	}
}

// ============================================================================
// Word count — strip markdown, count characters
// ============================================================================

/**
 * Count characters in markdown text after stripping syntax.
 *
 * Strategy: remove frontmatter, (optionally) code blocks, images, link URLs,
 * HTML, markdown symbols, and all whitespace. What remains is the "writing".
 *
 * Chinese characters count as 1 each; English letters count as 1 each.
 * This is the simplest, fastest approach and behaves sensibly for Chinese-first
 * notes with occasional English.
 */
export function countWords(text: string, includeCodeBlocks: boolean): number {
	let t = text;

	// Remove frontmatter (--- at start of file)
	t = t.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");

	if (!includeCodeBlocks) {
		// Fenced code blocks (``` or ~~~)
		t = t.replace(/```[\s\S]*?```/g, "");
		t = t.replace(/~~~[\s\S]*?~~~/g, "");
		// Inline code
		t = t.replace(/`[^`\n]*`/g, "");
	}

	// Obsidian embeds ![[...]]  and images ![alt](url)
	t = t.replace(/!\[\[[^\]]*\]\]/g, "");
	t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, "");

	// Wiki links [[text]] or [[page|display]] → keep the display text
	t = t.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a, b) => b || a);

	// Markdown links [text](url) → keep the link text
	t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

	// HTML tags
	t = t.replace(/<[^>]+>/g, "");

	// Markdown symbols (headers, emphasis, lists, quotes, tables, etc.)
	t = t.replace(/[#*_~>|`\-+=[\](){}<>/\\!]/g, "");

	// All whitespace (spaces, tabs, newlines)
	t = t.replace(/\s+/g, "");

	return t.length;
}

// ============================================================================
// Daily note integration
// ============================================================================

/**
 * Open the daily note for the given YYYY-MM-DD date.
 * Reads folder + filename format from the Daily Notes core plugin.
 */
export async function openDailyNote(app: App, dateStr: string): Promise<void> {
	const dailyNotes = (app as AppWithInternals).internalPlugins?.plugins?.["daily-notes"];
	if (!dailyNotes?.enabled) {
		new Notice("Daily Notes core plugin is not enabled");
		return;
	}

	const options = dailyNotes.instance?.options || {};
	const folder: string = options.folder || "";
	const format: string = options.format || "YYYY-MM-DD";

	// Obsidian ships moment.js on window
	const moment = (window as WindowWithMoment).moment;
	if (!moment) {
		new Notice("moment.js not available");
		return;
	}

	const m = moment(dateStr, "YYYY-MM-DD");
	const filename = m.format(format);
	const path = normalizePath(
		folder ? `${folder}/${filename}.md` : `${filename}.md`
	);

	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) {
		await app.workspace.getLeaf(false).openFile(existing);
	} else {
		new Notice(`该日没有日记：${dateStr}`);
	}
}
