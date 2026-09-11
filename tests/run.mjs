/**
 * Unit tests for the pure resolvers in note-date.ts.
 *
 * The module deliberately imports nothing from "obsidian", so it can be
 * bundled and executed in plain Node without stubbing the plugin API.
 */
import esbuild from "esbuild";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const outfile = join(mkdtempSync(join(tmpdir(), "wh-test-")), "note-date.mjs");
await esbuild.build({
	entryPoints: ["note-date.ts"],
	bundle: true,
	format: "esm",
	outfile,
	logLevel: "silent",
});
const M = await import(pathToFileURL(outfile).href);

let passed = 0;
const failures = [];
function test(name, fn) {
	try {
		fn();
		passed++;
	} catch (e) {
		failures.push([name, e]);
	}
}

// --------------------------------------------------------------------------
// dateFromBasename
// --------------------------------------------------------------------------

test("日记文件名带星期后缀", () => {
	assert.equal(M.dateFromBasename("2026-05-01周五"), "2026-05-01");
});

test("纯日期文件名", () => {
	assert.equal(M.dateFromBasename("2026-05-01"), "2026-05-01");
});

test("日期后接分隔符和标题", () => {
	assert.equal(M.dateFromBasename("2026-05-01 会议纪要"), "2026-05-01");
});

test("日期不在开头的不算", () => {
	assert.equal(M.dateFromBasename("周报 2026-05-01"), null);
});

test("多出一位数字的不算", () => {
	assert.equal(M.dateFromBasename("2026-05-011"), null);
});

test("非法月份不算", () => {
	assert.equal(M.dateFromBasename("2026-13-01"), null);
});

test("非法日不算（2026-02-30）", () => {
	assert.equal(M.dateFromBasename("2026-02-30"), null);
});

test("无分隔符的日期不算", () => {
	assert.equal(M.dateFromBasename("20260501"), null);
});

// --------------------------------------------------------------------------
// dateFromFrontmatter
// --------------------------------------------------------------------------

const DIARY = `---
tags:
  - 认识自我/自我叙事/日记
created: 2026-05-01 11:25
updated: 2026-05-03 09:00
---
# 今天做了什么
正文`;

test("读取 created 字段", () => {
	assert.equal(M.dateFromFrontmatter(DIARY), "2026-05-01");
});

test("带引号的值", () => {
	assert.equal(
		M.dateFromFrontmatter('---\ncreated: "2026-05-01T11:25:00"\n---\n正文'),
		"2026-05-01"
	);
});

test("created 缺失时回落到 date", () => {
	assert.equal(M.dateFromFrontmatter("---\ndate: 2026-05-01\n---\n正文"), "2026-05-01");
});

test("created 优先于 date，与行序无关", () => {
	assert.equal(
		M.dateFromFrontmatter("---\ndate: 2020-01-01\ncreated: 2026-05-01\n---\n正文"),
		"2026-05-01"
	);
});

test("缩进的同名键属于别的字段，不采用", () => {
	assert.equal(
		M.dateFromFrontmatter("---\nmeta:\n  created: 2020-01-01\n---\n正文"),
		null
	);
});

test("没有 frontmatter 返回 null", () => {
	assert.equal(M.dateFromFrontmatter("# 标题\ncreated: 2026-05-01"), null);
});

test("frontmatter 中没有日期字段返回 null", () => {
	assert.equal(M.dateFromFrontmatter("---\ntags:\n  - a\n---\n正文"), null);
});

test("非法日期值不采用", () => {
	assert.equal(M.dateFromFrontmatter("---\ncreated: 不详\n---\n正文"), null);
});

test("created 是指向日记的双链", () => {
	assert.equal(
		M.dateFromFrontmatter('---\ncreated: "[[2026-03-26周四]]"\n---\n正文'),
		"2026-03-26"
	);
});

test("双链带显示别名", () => {
	assert.equal(
		M.dateFromFrontmatter("---\ncreated: [[2026-03-26周四|三月廿六]]\n---\n正文"),
		"2026-03-26"
	);
});

test("双链带路径前缀", () => {
	assert.equal(
		M.dateFromFrontmatter('---\ncreated: "[[Diary/2026/2026-03-26周四]]"\n---\n正文'),
		"2026-03-26"
	);
});

test("未渲染的模板占位符不采用", () => {
	assert.equal(
		M.dateFromFrontmatter("---\ncreated: {{date:YYYY-MM-DD HH:mm}}\n---\n正文"),
		null
	);
});

test("双链指向非日期笔记时不采用", () => {
	assert.equal(
		M.dateFromFrontmatter("---\ncreated: [[某篇笔记]]\n---\n正文"),
		null
	);
});

// --------------------------------------------------------------------------
// resolveNoteDate — 文件名 > frontmatter > ctime
// --------------------------------------------------------------------------

const ctime = new Date(2026, 4, 4, 15, 0).getTime(); // 2026-05-04 本地时间

test("文件名日期优先于 ctime（用户报的 2026-05-01 场景）", () => {
	assert.equal(
		M.resolveNoteDate({ basename: "2026-05-01周五", content: DIARY, ctime }),
		"2026-05-01"
	);
});

test("文件名无日期时用 frontmatter created", () => {
	assert.equal(
		M.resolveNoteDate({ basename: "随手记", content: DIARY, ctime }),
		"2026-05-01"
	);
});

test("都没有时回落到 ctime 本地日期", () => {
	assert.equal(
		M.resolveNoteDate({ basename: "随手记", content: "正文", ctime }),
		"2026-05-04"
	);
});

// --------------------------------------------------------------------------
// pickClosestPath — 在多个同名候选里挑离配置目录最近的
// --------------------------------------------------------------------------

test("跨月日记：选与配置目录同树的那个", () => {
	const got = M.pickClosestPath(
		[
			"归档/2026-05-01周五.md",
			"01 RIVER·河流/Diary 日记/2026/05-五月/2026-05-01周五.md",
		],
		"01 RIVER·河流/Diary 日记/2026/09-九月"
	);
	assert.equal(got, "01 RIVER·河流/Diary 日记/2026/05-五月/2026-05-01周五.md");
});

test("只有一个候选时直接返回", () => {
	assert.equal(M.pickClosestPath(["a/b.md"], "x/y"), "a/b.md");
});

test("没有候选返回 null", () => {
	assert.equal(M.pickClosestPath([], "x/y"), null);
});

test("同分时取路径最短的，结果稳定", () => {
	const got = M.pickClosestPath(["z/2026-05-01.md", "a/2026-05-01.md"], "无关");
	assert.equal(got, "a/2026-05-01.md");
});

// --------------------------------------------------------------------------

for (const [name, err] of failures) {
	console.error(`✗ ${name}\n  ${err.message}`);
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
