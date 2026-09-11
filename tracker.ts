import { App, TFile } from "obsidian";
import type { WritingHeatmapSettings } from "./settings";
import { countWords, FileMatcher, formatDate } from "./utils";
import { resolveNoteDate } from "./note-date";

// ============================================================================
// Types
// ============================================================================

export interface DayStat {
	created: number;
	totalWords: number;
}

interface FileRecord {
	words: number;
	mtime: number;
	date: string; // YYYY-MM-DD the note counts towards (see resolveNoteDate)
}

export interface TrackerData {
	dayBucket: Record<string, DayStat>;
	fileWords: Record<string, FileRecord>;
}

// ============================================================================
// Tracker — current-state aggregation engine
// ============================================================================

export class Tracker {
	private dayBucket = new Map<string, DayStat>();
	private fileWords = new Map<string, FileRecord>();
	private matcher: FileMatcher;
	private modifyTimers = new Map<string, number>();

	/** Called whenever aggregated data changes; plugin uses this to refresh UI. */
	onUpdate: () => void = () => {};

	constructor(
		private app: App,
		private settings: WritingHeatmapSettings,
		private persist: () => void
	) {
		this.matcher = new FileMatcher(app, settings);
	}

	// ----------------------------------------------------------------
	// Initialisation
	// ----------------------------------------------------------------

	/**
	 * Load previously persisted state, then sync with the current vault.
	 * If no saved data exists, does a full rebuild.
	 */
	async initialize(saved: TrackerData | null): Promise<void> {
		if (saved?.dayBucket && saved?.fileWords) {
			for (const [k, v] of Object.entries(saved.dayBucket)) {
				this.dayBucket.set(k, { ...v });
			}
			for (const [k, v] of Object.entries(saved.fileWords)) {
				this.fileWords.set(k, { ...v });
			}
			await this.sync();
		} else {
			await this.rebuild();
		}
	}

	/**
	 * Incremental sync: compare the in-memory cache with the current vault,
	 * only re-reading files whose mtime changed or that are new / deleted.
	 */
	private async sync(): Promise<void> {
		this.matcher.refresh();
		const currentFiles = this.app.vault.getMarkdownFiles();
		const seen = new Set<string>();

		for (const file of currentFiles) {
			if (this.matcher.isExcluded(file.path)) continue;
			seen.add(file.path);

			const rec = this.fileWords.get(file.path);
			if (!rec) {
				await this.addFile(file);
			} else if (rec.mtime !== file.stat.mtime) {
				await this.updateFile(file);
			}
		}

		// Remove entries for files that no longer exist
		for (const [path, rec] of this.fileWords) {
			if (!seen.has(path)) {
				this.removeFromBucket(rec.date, 1, rec.words);
				this.fileWords.delete(path);
			}
		}

		this.schedulePersist();
	}

	/** Full rebuild: clear everything and scan the entire vault. */
	async rebuild(): Promise<void> {
		this.dayBucket.clear();
		this.fileWords.clear();
		this.matcher.refresh();

		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			if (this.matcher.isExcluded(file.path)) continue;
			await this.addFile(file);
		}

		this.schedulePersist();
		this.onUpdate();
	}

	// ----------------------------------------------------------------
	// Vault event handlers
	// ----------------------------------------------------------------

	onCreate(file: TFile): void {
		if (this.matcher.isExcluded(file.path)) return;
		void this.addFile(file).then(() => {
			this.onUpdate();
			this.schedulePersist();
		});
	}

	onModify(file: TFile): void {
		if (this.matcher.isExcluded(file.path)) return;

		// Per-file debounce: 300 ms
		const existing = this.modifyTimers.get(file.path);
		if (existing != null) window.clearTimeout(existing);

		const timer = window.setTimeout(() => {
			this.modifyTimers.delete(file.path);

			const op = this.fileWords.has(file.path)
				? this.updateFile(file)
				: this.addFile(file);

			void op.then(() => {
				this.onUpdate();
				this.schedulePersist();
			});
		}, 300);

		this.modifyTimers.set(file.path, timer);
	}

	onDelete(file: TFile): void {
		const rec = this.fileWords.get(file.path);
		if (!rec) return;

		this.removeFromBucket(rec.date, 1, rec.words);
		this.fileWords.delete(file.path);
		this.onUpdate();
		this.schedulePersist();
	}

	onRename(file: TFile, oldPath: string): void {
		const wasExcluded = this.matcher.isExcluded(oldPath);
		const isExcluded = this.matcher.isExcluded(file.path);

		if (wasExcluded && isExcluded) return;

		if (wasExcluded && !isExcluded) {
			// Moved into tracked area → add
			void this.addFile(file).then(() => {
				this.onUpdate();
				this.schedulePersist();
			});
			return;
		}

		if (!wasExcluded && isExcluded) {
			// Moved into excluded area → remove
			const rec = this.fileWords.get(oldPath);
			if (rec) {
				this.removeFromBucket(rec.date, 1, rec.words);
				this.fileWords.delete(oldPath);
				this.onUpdate();
				this.schedulePersist();
			}
			return;
		}

		// Normal rename within tracked area. The name can carry the note's date,
		// so re-read rather than just moving the key.
		const rec = this.fileWords.get(oldPath);
		if (rec) {
			this.removeFromBucket(rec.date, 1, rec.words);
			this.fileWords.delete(oldPath);
		}
		void this.addFile(file).then(() => {
			this.onUpdate();
			this.schedulePersist();
		});
	}

	// ----------------------------------------------------------------
	// Query
	// ----------------------------------------------------------------

	getDay(date: string): DayStat {
		return this.dayBucket.get(date) || { created: 0, totalWords: 0 };
	}

	/**
	 * The earliest day any tracked note belongs to, or null when nothing is
	 * tracked yet. Already resolved from note names and frontmatter, so it
	 * survives the ctime rewrites that syncing a vault causes.
	 */
	getEarliestDate(): string | null {
		let earliest: string | null = null;
		for (const date of this.dayBucket.keys()) {
			if (earliest === null || date < earliest) earliest = date;
		}
		return earliest;
	}

	getRange(
		startDate: Date,
		endDate: Date
	): { date: string; created: number; totalWords: number }[] {
		const result: { date: string; created: number; totalWords: number }[] = [];
		const cur = new Date(startDate);
		while (cur <= endDate) {
			const d = formatDate(cur);
			const day = this.dayBucket.get(d);
			result.push({
				date: d,
				created: day?.created ?? 0,
				totalWords: day?.totalWords ?? 0,
			});
			cur.setDate(cur.getDate() + 1);
		}
		return result;
	}

	// ----------------------------------------------------------------
	// Serialisation
	// ----------------------------------------------------------------

	serialize(): TrackerData {
		return {
			dayBucket: Object.fromEntries(this.dayBucket),
			fileWords: Object.fromEntries(this.fileWords),
		};
	}

	// ----------------------------------------------------------------
	// Internal helpers
	// ----------------------------------------------------------------

	private async addFile(file: TFile): Promise<void> {
		const content = await this.app.vault.cachedRead(file);
		const words = countWords(content, this.settings.includeCodeBlocks);
		const date = this.dateFor(file, content);

		this.fileWords.set(file.path, {
			words,
			mtime: file.stat.mtime,
			date,
		});
		this.addToBucket(date, 1, words);
	}

	private async updateFile(file: TFile): Promise<void> {
		const content = await this.app.vault.cachedRead(file);
		const words = countWords(content, this.settings.includeCodeBlocks);
		const rec = this.fileWords.get(file.path);
		if (!rec) return;

		const date = this.dateFor(file, content);
		if (date === rec.date) {
			this.addToBucket(date, 0, words - rec.words);
		} else {
			// Editing the frontmatter date moves the note to another day.
			this.removeFromBucket(rec.date, 1, rec.words);
			this.addToBucket(date, 1, words);
			rec.date = date;
		}

		rec.words = words;
		rec.mtime = file.stat.mtime;
	}

	/**
	 * Which day a note counts towards. The file name and frontmatter say when
	 * it was written; `ctime` only says when this machine happened to receive
	 * the file, which sync and vault moves rewrite wholesale.
	 */
	private dateFor(file: TFile, content: string): string {
		return resolveNoteDate({
			basename: file.basename,
			content,
			ctime: file.stat.ctime,
		});
	}

	private addToBucket(
		date: string,
		createdDelta: number,
		wordDelta: number
	): void {
		const day = this.dayBucket.get(date) || { created: 0, totalWords: 0 };
		day.created += createdDelta;
		day.totalWords += wordDelta;
		this.dayBucket.set(date, day);
	}

	private removeFromBucket(
		date: string,
		createdDelta: number,
		wordDelta: number
	): void {
		const day = this.dayBucket.get(date);
		if (!day) return;
		day.created -= createdDelta;
		day.totalWords -= wordDelta;
		if (day.created <= 0 && day.totalWords <= 0) {
			this.dayBucket.delete(date);
		}
	}

	private persistTimer: number | null = null;

	private schedulePersist(): void {
		if (this.persistTimer != null) window.clearTimeout(this.persistTimer);
		this.persistTimer = window.setTimeout(() => {
			this.persistTimer = null;
			this.persist();
		}, 1000);
	}

	/** Force a persist right now (used on unload). */
	flush(): void {
		if (this.persistTimer != null) {
			window.clearTimeout(this.persistTimer);
			this.persistTimer = null;
		}
		this.persist();
	}
}
