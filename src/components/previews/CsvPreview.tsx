import { useT } from "../../i18n.ts";
import { parseCsv } from "../../lib/csv.ts";
import { cn } from "../../lib/utils.ts";
import { Spinner } from "../ui/spinner.tsx";
import { useFileText } from "./useFileText.ts";

// A table this long stays quick to show. Longer files show their first rows.
const ROWS_MAX = 2000;
const HEAD = "h-9 px-3 text-left align-middle text-xs font-semibold whitespace-nowrap text-label";
const CELL = "px-3 py-2 align-top whitespace-pre-wrap text-strong";
// A number, with commas between thousands, a fraction, or a percent sign.
const NUMBER = /^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?%?$/;

/** A CSV file as a table, with its first row as the head. Columns of numbers align to the right. */
export default function CsvPreview({ url }: { url: string }) {
  const { text, error } = useFileText(url);
  const t = useT();
  if (error) return <p className="error-box m-4">{error}</p>;
  if (text === null) return <Spinner />;
  const { rows, more } = parseCsv(text, ROWS_MAX + 1);
  const [head = [], ...body] = rows;
  const columns = Array.from({ length: Math.max(0, ...rows.map((row) => row.length)) }, (_, column) => {
    const cells = body.map((row) => (row[column] ?? "").trim()).filter((cell) => cell !== "");
    return { numeric: cells.length > 0 && cells.every((cell) => NUMBER.test(cell)) };
  });
  return (
    <div className="grid gap-3 p-4">
      <div className="mx-auto w-full max-w-6xl overflow-x-auto rounded-sm bg-surface shadow-[0_0_0_1px_var(--theme-border)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {columns.map(({ numeric }, column) => (
                <th key={column} className={cn(HEAD, numeric && "text-right")}>
                  {head[column] ?? ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, index) => (
              <tr key={index} className="border-b border-hairline last:border-0">
                {columns.map(({ numeric }, column) => (
                  <td key={column} className={cn(CELL, numeric && "numeric text-right")}>
                    {row[column] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more && <p className="text-center text-sm text-label">{t.files.firstRows(ROWS_MAX)}</p>}
    </div>
  );
}
