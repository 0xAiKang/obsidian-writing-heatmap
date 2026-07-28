import { App, getAllTags } from "obsidian";
import type { WritingHeatmapSettings } from "./settings";
import { formatDate } from "./utils";

// ============================================================================
// Types
// ============================================================================

export interface VaultStats {
	/** Number of markdown notes inside the configured stat folders. */
	noteCount: number;
	/** Number of distinct tags across the whole vault (case-insensitive). */
	tagCount: number;
	/**
	 * Days elapsed since the earliest note was created, inclusive of both ends.
	 * Mirrors flomo's "使用天数" (days since you started), not the number of
	 * days on which you happened to write.
	 */
	usageDays: number;
	/** YYYY-MM-DD of the earliest note, or null when the vault is empty. */
	firstDate: string | null;
	/** Milliseconds the last recomputation took — surfaced in the tooltip. */
	computeMs: number;
}

const EMPTY_STATS: VaultStats = {
	noteCount: 0,
	tagCount: 0,
	usageDays: 0,
	firstDate: null,
	computeMs: 0,
};

// ============================================================================
// StatsProvider — vault-wide counters for the panel header
// ============================================================================

/**
 * Computes the three headline numbers from Obsidian's in-memory indexes only:
 * `vault.getMarkdownFiles()` for paths and ctime, `metadataCache` for tags.
 * Nothing here touches the disk, so a full recomputation stays in the
 * single-digit millisecond range even on a vault with thousands of notes.
 *
 * Results are cached until `invalidate()` is called; the plugin wires that to
 * vault and metadata events so the numbers follow the vault without polling.
 */
export class StatsProvider {
	private cache: VaultStats | null = null;

	constructor(
		private app: App,
		private settings: WritingHeatmapSettings
	) {}

	invalidate(): void {
		this.cache = null;
	}

	get(): VaultStats {
		if (!this.cache) this.cache = this.compute();
		return this.cache;
	}

	private compute(): VaultStats {
		const t0 = performance.now();

		const files = this.app.vault.getMarkdownFiles();
		if (files.length === 0) return { ...EMPTY_STATS };

		const folders = this.settings.statsFolders;
		const tags = new Set<string>();
		let noteCount = 0;
		let earliest = Number.POSITIVE_INFINITY;

		// A future ctime means a broken clock or a bad sync; counting it would
		// blow up usageDays, so anything past today is ignored.
		const notAfter = Date.now() + 86_400_000;

		for (const file of files) {
			if (folders.length === 0 || isInFolders(file.path, folders)) {
				noteCount++;
			}

			const ctime = file.stat.ctime;
			if (ctime > 0 && ctime < earliest && ctime < notAfter) {
				earliest = ctime;
			}

			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache) continue;
			const fileTags = getAllTags(cache);
			if (!fileTags) continue;
			for (const tag of fileTags) tags.add(tag.toLowerCase());
		}

		let usageDays = 0;
		let firstDate: string | null = null;
		if (Number.isFinite(earliest)) {
			const first = new Date(earliest);
			first.setHours(0, 0, 0, 0);
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			usageDays =
				Math.floor((today.getTime() - first.getTime()) / 86_400_000) + 1;
			firstDate = formatDate(first);
		}

		return {
			noteCount,
			tagCount: tags.size,
			usageDays,
			firstDate,
			computeMs: performance.now() - t0,
		};
	}
}

// ============================================================================
// Helpers
// ============================================================================

/** True when the path sits inside one of the folders (or is that folder's file). */
function isInFolders(filePath: string, folders: string[]): boolean {
	for (const raw of folders) {
		const folder = raw.replace(/\/+$/, "");
		if (!folder) continue;
		if (filePath === folder || filePath.startsWith(folder + "/")) return true;
	}
	return false;
}
