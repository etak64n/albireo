import { describe, expect, it } from "vitest";
import { containsEvery, searchWords } from "../src/lib/search.ts";

describe("searchWords", () => {
  it("splits a query at its spaces, also at the wide space of Japanese text", () => {
    expect(searchWords("  SQL   lessons ")).toEqual(["SQL", "lessons"]);
    expect(searchWords("英語　会話")).toEqual(["英語", "会話"]);
  });

  it("keeps one of each word", () => {
    expect(searchWords("sql lessons sql")).toEqual(["sql", "lessons"]);
  });

  it("finds no words in a query of spaces", () => {
    expect(searchWords(" 　 ")).toEqual([]);
  });
});

describe("containsEvery", () => {
  it("finds every word inside the text, ignoring case", () => {
    expect(containsEvery("SQL in 20 lessons", ["sql", "LESS"])).toBe(true);
    expect(containsEvery("英語の会話", ["会話", "英語"])).toBe(true);
  });

  it("fails when one of the words is missing", () => {
    expect(containsEvery("SQL in 20 lessons", ["sql", "python"])).toBe(false);
  });
});
