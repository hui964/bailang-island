import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";

const root = "/Users/lvchunhui/Documents/桃花源/26.06 法式小镇/代码/白浪屿4.0";
const outputDir = path.join(root, "outputs/2026-08-29-web-copy-export");
const outputFile = path.join(outputDir, "白浪屿网页全站文案.xlsx");

const htmlFile = path.join(root, "index.html");
const dataFiles = [
  path.join(root, "assets/essays-data.js"),
  path.join(root, "assets/excerpts-data.js"),
  path.join(root, "assets/notes-data.js"),
];

const html = await fs.readFile(htmlFile, "utf8");

function normalize(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function isUseful(text) {
  if (!text || text.length < 2 || text.length > 30000) return false;
  if (/^[-—–·•|/\\()（）【】\[\]{}<>:：,，.。!?！？+*=_%#@\s\d]+$/.test(text)) return false;
  if (/^\{\{[\s\S]*\}\}$/.test(text)) return false;
  return /[\u3400-\u9fffA-Za-z]/.test(text);
}

function extractHtmlCopy(source) {
  const masked = source
    .replace(/<style\b[\s\S]*?<\/style>/gi, m => m.replace(/[^\n]/g, " "))
    .replace(/<script\b[\s\S]*?<\/script>/gi, m => m.replace(/[^\n]/g, " "));
  const rows = [];
  const textRe = />([^<>]+)</g;
  for (const match of masked.matchAll(textRe)) {
    const text = normalize(match[1]);
    if (!isUseful(text)) continue;
    const before = masked.slice(Math.max(0, match.index - 220), match.index + 1);
    const tag = (before.match(/<([a-zA-Z0-9-]+)(?:\s[^<>]*)?>\s*$/) || [])[1] || "HTML文本";
    rows.push({ category: "页面静态文案", text, source: "index.html", line: lineAt(source, match.index), context: `<${tag}>` });
  }
  const attrRe = /\b(title|aria-label|placeholder|alt|data-tip|data-label)\s*=\s*(["'])([\s\S]*?)\2/gi;
  for (const match of masked.matchAll(attrRe)) {
    const text = normalize(match[3]);
    if (!isUseful(text) || /^assets\//.test(text)) continue;
    rows.push({ category: "属性提示文案", text, source: "index.html", line: lineAt(source, match.index), context: match[1] });
  }
  return rows;
}

function decodeJsString(raw) {
  const body = raw.slice(1, -1);
  return normalize(body
    .replace(/\\n/g, " ")
    .replace(/\\r/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\\([\\'"`])/g, "$1"));
}

function extractJsCopy(source) {
  const rows = [];
  const scriptRe = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  for (const scriptMatch of source.matchAll(scriptRe)) {
    const code = scriptMatch[1];
    const baseIndex = scriptMatch.index + scriptMatch[0].indexOf(code);
    const stringRe = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g;
    for (const match of code.matchAll(stringRe)) {
      let text = decodeJsString(match[0]);
      const absoluteIndex = baseIndex + match.index;
      if (text.includes("<") && text.includes(">")) {
        const mini = text.replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, "|");
        for (const piece of mini.split("|")) {
          const cleaned = normalize(piece.replace(/\$\{[^}]*\}/g, "{变量}"));
          if (isUseful(cleaned) && /[\u3400-\u9fff]/.test(cleaned)) {
            rows.push({ category: "动态模板文案", text: cleaned, source: "index.html", line: lineAt(source, absoluteIndex), context: "脚本模板" });
          }
        }
        continue;
      }
      text = normalize(text.replace(/\$\{[^}]*\}/g, "{变量}"));
      if (!isUseful(text) || !/[\u3400-\u9fff]/.test(text)) continue;
      if (/^(assets\/|#[a-zA-Z]|\.|--|data:|https?:)/.test(text)) continue;
      rows.push({ category: "页面动态文案", text, source: "index.html", line: lineAt(source, absoluteIndex), context: "JavaScript 字符串" });
    }
  }
  return rows;
}

function loadWindowData(code) {
  const context = { window: {} };
  vm.runInNewContext(code, context, { timeout: 3000 });
  return context.window;
}

const dataContext = {};
for (const file of dataFiles) {
  Object.assign(dataContext, loadWindowData(await fs.readFile(file, "utf8")));
}

const essays = (dataContext.WW_ESSAYS || []).map((item, index) => [
  index + 1, item.id || "", item.title || "", item.date || "", item.excerpt || "",
  (item.paras || []).join("\n\n"), item.source || "", item.isCat ? "是" : "否",
]);

const themeMap = new Map((dataContext.WW_EXCERPT_THEMES || []).map(t => [t.id, t]));
const excerpts = (dataContext.WW_EXCERPTS || []).map((item, index) => {
  const theme = themeMap.get(item.theme) || {};
  return [index + 1, item.id || "", theme.label || item.theme || "", theme.scope || "", item.text || "", item.source || ""];
});

const notes = [];
for (const book of dataContext.WW_NOTE_BOOKS || []) {
  for (const page of book.pages || []) {
    const paras = (page.paragraphs || []).map(p => typeof p === "string" ? p : p.text || "").filter(Boolean);
    if (page.title || page.subtitle || page.section || paras.length) {
      notes.push([
        notes.length + 1, book.no || "", book.title || "", book.subtitle || "",
        page.id || "", page.kind || "", page.title || "", page.subtitle || "", page.section || "", paras.join("\n\n"),
      ]);
    }
  }
}

const rawCopy = [...extractHtmlCopy(html), ...extractJsCopy(html)];
const counts = new Map();
for (const row of rawCopy) counts.set(row.text, (counts.get(row.text) || 0) + 1);
rawCopy.sort((a, b) => a.line - b.line || a.category.localeCompare(b.category, "zh-CN"));
const copyRows = rawCopy.map((row, index) => [
  index + 1, row.category, row.text, row.source, row.line, row.context,
  counts.get(row.text) > 1 ? `重复 ${counts.get(row.text)} 次` : "唯一",
]);

const uniqueMap = new Map();
for (const row of rawCopy) {
  const current = uniqueMap.get(row.text);
  if (!current) uniqueMap.set(row.text, { ...row, lines: [row.line], count: 1 });
  else { current.lines.push(row.line); current.count += 1; }
}
const uniqueRows = [...uniqueMap.values()].map((row, index) => [
  index + 1, row.category, row.text, row.count, row.lines.join("、"), row.context,
]);

const workbook = Workbook.create();
const overview = workbook.worksheets.add("统计说明");
const pageSheet = workbook.worksheets.add("页面文案-全部出现");
const uniqueSheet = workbook.worksheets.add("页面文案-去重");
const essaySheet = workbook.worksheets.add("随笔");
const excerptSheet = workbook.worksheets.add("摘录");
const noteSheet = workbook.worksheets.add("手记");

function colLetter(n) {
  let s = "";
  while (n > 0) { n -= 1; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
}

const palette = {
  ink: "#493B2F", brown: "#9A744A", cream: "#F7F0E2", pale: "#FFFDF7",
  line: "#D9C9AF", green: "#87977A", gold: "#C7A267", white: "#FFFFFF",
};

function writeDataSheet(sheet, title, subtitle, headers, rows, widths, wrapCols = []) {
  const lastCol = colLetter(headers.length);
  sheet.showGridLines = false;
  sheet.getRange(`A1:${lastCol}1`).merge();
  sheet.getRange("A1").values = [[title]];
  sheet.getRange("A1").format = {
    fill: palette.ink, font: { bold: true, color: palette.white, size: 18 },
    horizontalAlignment: "left", verticalAlignment: "center", rowHeight: 34,
  };
  sheet.getRange(`A2:${lastCol}2`).merge();
  sheet.getRange("A2").values = [[subtitle]];
  sheet.getRange("A2").format = {
    fill: palette.cream, font: { color: palette.brown, italic: true, size: 10 },
    verticalAlignment: "center", rowHeight: 25,
  };
  sheet.getRange(`A4:${lastCol}4`).values = [headers];
  sheet.getRange(`A4:${lastCol}4`).format = {
    fill: palette.gold, font: { bold: true, color: palette.white },
    horizontalAlignment: "center", verticalAlignment: "center",
    borders: { preset: "all", style: "thin", color: palette.line }, rowHeight: 27,
  };
  if (rows.length) {
    const body = sheet.getRange(`A5:${lastCol}${rows.length + 4}`);
    body.values = rows;
    body.format = {
      fill: palette.pale, font: { color: palette.ink, size: 10 },
      verticalAlignment: "top", borders: { preset: "all", style: "thin", color: palette.line },
    };
    for (const col of wrapCols) sheet.getRange(`${col}5:${col}${rows.length + 4}`).format.wrapText = true;
    for (let i = 0; i < headers.length; i++) sheet.getRange(`${colLetter(i + 1)}:${colLetter(i + 1)}`).format.columnWidth = widths[i];
    sheet.tables.add(`A4:${lastCol}${rows.length + 4}`, true, `${sheet.name.replace(/[^A-Za-z0-9]/g, "") || "Copy"}Table`);
  }
  sheet.freezePanes.freezeRows(4);
}

writeDataSheet(pageSheet, "页面文案｜全部出现", "保留每一次出现及源码行号，便于逐处核对与修改。", ["编号", "类型", "文案", "来源文件", "行号", "上下文", "重复情况"], copyRows, [8, 18, 58, 18, 10, 18, 14], ["C"]);
writeDataSheet(uniqueSheet, "页面文案｜去重清单", "相同文字合并为一条，出现次数和全部行号保留在右侧。", ["编号", "类型", "文案", "出现次数", "所在行号", "上下文"], uniqueRows, [8, 18, 64, 12, 28, 18], ["C", "E"]);
writeDataSheet(essaySheet, "随笔文案", "来自网页加载的数据文件 assets/essays-data.js。", ["编号", "ID", "标题", "日期", "摘要", "正文", "原始来源", "猫咪条目"], essays, [8, 15, 30, 18, 50, 86, 24, 12], ["E", "F"]);
writeDataSheet(excerptSheet, "摘录文案", "主题名称和主题范围已与摘录正文对应。", ["编号", "ID", "主题", "主题范围", "摘录正文", "原始来源"], excerpts, [8, 16, 18, 40, 92, 24], ["D", "E"]);
writeDataSheet(noteSheet, "旅行手记文案", "按手记、页面顺序保留标题、章节与正文。", ["编号", "册号", "手记标题", "手记副标题", "页面ID", "页面类型", "页标题", "页副标题", "章节", "正文"], notes, [8, 8, 22, 28, 18, 13, 22, 28, 20, 82], ["D", "G", "H", "I", "J"]);

overview.showGridLines = false;
overview.getRange("A1:F1").merge();
overview.getRange("A1").values = [["白浪屿网页全站文案清单"]];
overview.getRange("A1").format = { fill: palette.ink, font: { bold: true, color: palette.white, size: 20 }, rowHeight: 38, verticalAlignment: "center" };
overview.getRange("A2:F2").merge();
overview.getRange("A2").values = [["导出范围：当前主网页 index.html，以及网页载入的随笔、摘录、手记数据文件。"]];
overview.getRange("A2").format = { fill: palette.cream, font: { color: palette.brown, italic: true }, rowHeight: 26, verticalAlignment: "center" };
overview.getRange("A4:C4").values = [["工作表", "条目数", "说明"]];
overview.getRange("A5:C9").values = [
  ["页面文案-全部出现", null, "静态文字、属性提示、动态脚本文案；保留重复项"],
  ["页面文案-去重", null, "相同文字合并，适合统一校对"],
  ["随笔", null, "标题、摘要与完整正文"],
  ["摘录", null, "主题、主题范围与完整摘录"],
  ["手记", null, "按册与页面拆分的完整正文"],
];
overview.getRange("B5:B9").formulas = [
  [`=COUNTA('页面文案-全部出现'!A5:A${copyRows.length + 4})`],
  [`=COUNTA('页面文案-去重'!A5:A${uniqueRows.length + 4})`],
  [`=COUNTA('随笔'!A5:A${essays.length + 4})`],
  [`=COUNTA('摘录'!A5:A${excerpts.length + 4})`],
  [`=COUNTA('手记'!A5:A${notes.length + 4})`],
];
overview.getRange("A4:C9").format = { borders: { preset: "all", style: "thin", color: palette.line }, verticalAlignment: "center" };
overview.getRange("A4:C4").format = { fill: palette.gold, font: { bold: true, color: palette.white }, horizontalAlignment: "center" };
overview.getRange("A5:C9").format.fill = palette.pale;
overview.getRange("A11:F11").merge();
overview.getRange("A11").values = [["使用说明"]];
overview.getRange("A11").format = { fill: palette.green, font: { bold: true, color: palette.white }, rowHeight: 26, verticalAlignment: "center" };
overview.getRange("A12:F15").merge(true);
overview.getRange("A12:A15").values = [
  ["1. “页面文案-全部出现”适合定位源码中的每一次使用；“页面文案-去重”适合集中改稿。"],
  ["2. 页面脚本里的动态文本已纳入；纯技术标识、文件路径、颜色值与代码选择器已排除。"],
  ["3. 随笔、摘录和手记保留原始文字，不执行润色、纠错或改写。"],
  ["4. 本表以当前代码版本为准；后续页面新增文案需重新导出。"],
];
overview.getRange("A12:F15").format = { fill: palette.pale, font: { color: palette.ink }, wrapText: true, borders: { preset: "all", style: "thin", color: palette.line }, rowHeight: 24, verticalAlignment: "center" };
overview.getRange("A:A").format.columnWidth = 28;
overview.getRange("B:B").format.columnWidth = 14;
overview.getRange("C:C").format.columnWidth = 62;
overview.getRange("D:F").format.columnWidth = 14;
overview.freezePanes.freezeRows(2);

await fs.mkdir(outputDir, { recursive: true });
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputFile);

const inspect = await workbook.inspect({ kind: "workbook,sheet,table", maxChars: 12000, tableMaxRows: 3, tableMaxCols: 5, tableMaxCellChars: 100 });
await fs.writeFile(path.join(outputDir, "inspect.txt"), inspect.ndjson || String(inspect), "utf8");
const formulaErrors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 200 }, maxChars: 12000 });
await fs.writeFile(path.join(outputDir, "formula-errors.txt"), formulaErrors.ndjson || String(formulaErrors), "utf8");

for (const sheetName of ["统计说明", "页面文案-全部出现", "页面文案-去重", "随笔", "摘录", "手记"]) {
  const preview = await workbook.render({ sheetName, range: sheetName === "统计说明" ? "A1:F15" : "A1:J16", scale: 1, format: "png" });
  await fs.writeFile(path.join(outputDir, `预览-${sheetName}.png`), new Uint8Array(await preview.arrayBuffer()));
}

console.log(JSON.stringify({ outputFile, counts: { allCopy: copyRows.length, uniqueCopy: uniqueRows.length, essays: essays.length, excerpts: excerpts.length, notes: notes.length } }, null, 2));
