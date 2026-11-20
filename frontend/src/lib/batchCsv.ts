import type { BatchEntry } from "../api/llm";

/** RFC 4180 quoting, including commas, escaped quotes, BOM and multiline memo cells. */
export function parseBatchCsv(text: string): BatchEntry[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, closed = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else cell += ch;
    } else if (ch === '"' && !cell && !closed) quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; closed = false; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(cell); if (row.some((v) => v.trim())) rows.push(row);
      row = []; cell = ""; closed = false;
    } else {
      if (closed || ch === '"') throw new Error("CSV 따옴표 형식이 올바르지 않습니다");
      cell += ch;
    }
  }
  if (quoted) throw new Error("CSV에 닫히지 않은 따옴표가 있습니다");
  row.push(cell); if (row.some((v) => v.trim())) rows.push(row);
  const header = rows.shift()?.map((v) => v.trim());
  if (!header) throw new Error("CSV가 비어 있습니다");
  const index = (names: string[]) => header.findIndex((value) => names.includes(value));
  const title = index(["title", "제목"]), date = index(["written_date", "작성일"]), memo = index(["memo", "메모"]);
  if ([title, date, memo].some((i) => i < 0)) throw new Error("CSV 첫 행에 title,written_date,memo 또는 제목,작성일,메모가 필요합니다");
  if (!rows.length || rows.length > 100) throw new Error("CSV는 1~100개 입력을 포함해야 합니다");
  return rows.map((values, i) => {
    const entry = { title: values[title]?.trim() ?? "", written_date: values[date]?.trim() ?? "", memo: values[memo]?.trim() ?? "" };
    if (values.length !== header.length || !entry.title || !entry.memo || !/^\d{4}-\d{2}-\d{2}$/.test(entry.written_date)
      || Number.isNaN(Date.parse(entry.written_date)) || new Date(entry.written_date).toISOString().slice(0, 10) !== entry.written_date) {
      throw new Error(`CSV ${i + 2}행의 제목, 메모, 날짜(YYYY-MM-DD)를 확인하세요`);
    }
    return entry;
  });
}

export const BATCH_CSV_TEMPLATE = '\uFEFFtitle,written_date,memo\r\n"센서 반복 측정",2026-11-17,"동일 조건에서 3회 측정. 측정값: 10.1, 10.2, 10.1. 원자료와 대조 필요."\r\n';
