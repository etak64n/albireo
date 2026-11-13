import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/lib/csv.ts";

describe("parseCsv", () => {
  it("splits rows at line breaks and cells at commas", () => {
    expect(parseCsv("team,videos\nDesign,18\nSales,22\n", 10)).toEqual({
      rows: [
        ["team", "videos"],
        ["Design", "18"],
        ["Sales", "22"],
      ],
      more: false,
    });
  });

  it("reads quoted cells with commas, quotes, and line breaks", () => {
    expect(parseCsv('name,note\r\n"Ito, Kenji","He said ""hi""\r\ntwice"\r\n', 10).rows).toEqual([
      ["name", "note"],
      ["Ito, Kenji", 'He said "hi"\r\ntwice'],
    ]);
  });

  it("keeps empty cells and a last line without a line break", () => {
    expect(parseCsv("a,,c\n,b,", 10).rows).toEqual([
      ["a", "", "c"],
      ["", "b", ""],
    ]);
  });

  it("skips the byte order mark", () => {
    expect(parseCsv("﻿a,b\n1,2", 10).rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("stops after the limit and says that more rows follow", () => {
    expect(parseCsv("1\n2\n3\n4\n", 2)).toEqual({ rows: [["1"], ["2"]], more: true });
    expect(parseCsv("1\n2\n", 2)).toEqual({ rows: [["1"], ["2"]], more: false });
  });
});
