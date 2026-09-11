/**
 * Pure resolvers for "which calendar day does this note belong to" and
 * "where does a dated note actually live".
 *
 * Deliberately free of Obsidian imports so the logic can be unit-tested in
 * plain Node (see tests/run.mjs).
 */

// ============================================================================
// Date formatting
// ============================================================================

/** Format a Date as YYYY-MM-DD in local time. */
export function formatDate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

/** True if the YYYY-MM-DD parts describe a real calendar day. */
function isRealDate(y: number, m: number, d: number): boolean {
	if (m < 1 || m > 12 || d < 1 || d > 31) return false;
	const probe = new Date(y, m - 1, d);
	return (
		probe.getFullYear() === y &&
		probe.getMonth() === m - 1 &&
		probe.getDate() === d
	);
}

/** Take a leading YYYY-MM-DD off a string, rejecting impossible dates. */
function leadingDate(s: string): string | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})(?!\d)/.exec(s);
	if (!m) return null;
	const [, y, mo, d] = m;
	if (!isRealDate(Number(y), Number(mo), Number(d))) return null;
	return `${y}-${mo}-${d}`;
}

// ============================================================================
// Date sources
// ============================================================================

/**
 * The date a note's own filename claims, e.g. "2026-05-01周五" → "2026-05-01".
 * Only a leading date counts: a date buried in the title is about something
 * else, not about when the note was written.
 */
export function dateFromBasename(basename: string): string | null {
	return leadingDate(basename);
}

/** Frontmatter keys checked, in order of preference. */
const DATE_KEYS = ["created", "date"];

/**
 * Reduce a frontmatter value to the bare text a date could be read from.
 *
 * Templater and Dataview setups routinely store the creation date as a link
 * to that day's daily note — `created: "[[2026-03-26周四]]"` — optionally
 * inside a folder and with a display alias.
 */
function unwrapValue(raw: string): string {
	let v = raw.trim().replace(/^["']|["']$/g, "").trim();
	const link = /^\[\[([^\]]*)\]\]$/.exec(v);
	if (link) {
		// [[folder/note|alias]] → the note's own name
		v = link[1].split("|")[0];
		v = v.slice(v.lastIndexOf("/") + 1).trim();
	}
	return v;
}

/**
 * The date declared in the note's own frontmatter.
 *
 * Only top-level keys count — an indented `created:` belongs to some nested
 * object, not to the note. Values may be quoted and may carry a time part.
 */
export function dateFromFrontmatter(text: string): string | null {
	const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
	if (!block) return null;

	const entries = new Map<string, string>();
	for (const line of block[1].split(/\r?\n/)) {
		const m = /^([A-Za-z_][\w-]*)\s*:\s*(\S.*)$/.exec(line);
		if (!m) continue;
		const key = m[1].toLowerCase();
		if (!entries.has(key)) entries.set(key, m[2].trim());
	}

	for (const key of DATE_KEYS) {
		const raw = entries.get(key);
		if (raw === undefined) continue;
		const date = leadingDate(unwrapValue(raw));
		if (date) return date;
	}
	return null;
}

// ============================================================================
// Combined resolution
// ============================================================================

export interface NoteDateInput {
	/** File name without the .md extension. */
	basename: string;
	/** Raw file contents. */
	content: string;
	/** Filesystem creation time, in milliseconds. */
	ctime: number;
}

/**
 * Decide which day a note counts towards.
 *
 * Filename first, frontmatter second, ctime last. ctime is the weakest signal
 * by far: syncing, moving or restoring a vault rewrites it, which collapses
 * years of notes onto whatever day the transfer happened.
 */
export function resolveNoteDate(input: NoteDateInput): string {
	return (
		dateFromBasename(input.basename) ??
		dateFromFrontmatter(input.content) ??
		formatDate(new Date(input.ctime))
	);
}

// ============================================================================
// Locating a dated note among several candidates
// ============================================================================

/** How many leading path segments two paths share. */
function sharedSegments(a: string, b: string): number {
	const as = a.split("/");
	const bs = b.split("/");
	let n = 0;
	while (n < as.length && n < bs.length && as[n] === bs[n]) n++;
	return n;
}

/**
 * Of several files that could be the note for a date, pick the one living
 * closest to `preferredFolder` — the folder the daily-notes setting points at.
 * Ties break on the shorter, then alphabetically first path, so the choice is
 * stable across runs.
 */
export function pickClosestPath(
	paths: string[],
	preferredFolder: string
): string | null {
	let best: string | null = null;
	let bestScore = -1;
	for (const p of paths) {
		const score = sharedSegments(p, preferredFolder);
		if (
			score > bestScore ||
			(score === bestScore &&
				best !== null &&
				(p.length < best.length || (p.length === best.length && p < best)))
		) {
			best = p;
			bestScore = score;
		}
	}
	return best;
}
