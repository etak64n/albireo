// Reads CSV text into rows of cells, as RFC 4180 describes it: commas between the cells,
// double quotes around a cell that holds a comma, a quote, or a line break, and two
// quotes for a quote inside it. Lines end with CRLF or LF.

/** The rows of CSV text, at most limit of them, and whether more rows follow. */
export function parseCsv(text: string, limit: number): { rows: string[][]; more: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let index = text.startsWith("﻿") ? 1 : 0;
  const endRow = () => {
    row.push(cell);
    rows.push(row);
    row = [];
    cell = "";
  };
  while (index < text.length && rows.length <= limit) {
    const char = text.charAt(index);
    if (quoted) {
      if (char === '"' && text.charAt(index + 1) === '"') {
        cell += '"';
        index += 2;
      } else if (char === '"') {
        quoted = false;
        index += 1;
      } else {
        cell += char;
        index += 1;
      }
    } else if (char === '"' && cell === "") {
      quoted = true;
      index += 1;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
      index += 1;
    } else if (char === "\r" || char === "\n") {
      endRow();
      index += char === "\r" && text.charAt(index + 1) === "\n" ? 2 : 1;
    } else {
      cell += char;
      index += 1;
    }
  }
  // The last line may end without a line break.
  if (cell !== "" || row.length > 0) endRow();
  return { rows: rows.slice(0, limit), more: rows.length > limit };
}
