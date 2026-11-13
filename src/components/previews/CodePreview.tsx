import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { Spinner } from "../ui/spinner.tsx";
import "./code.css";
import { useFileText } from "./useFileText.ts";

// The languages that src/lib/attachments.ts names for the extensions of code.
const LANGUAGES = { bash, c, cpp, csharp, css, diff, go, ini, java, javascript, json, kotlin, php, python, ruby, rust, scss, sql, swift, typescript, xml, yaml };
for (const [name, language] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, language);

// Longer files show without colors, which would take the browser too long.
const COLOR_MAX_CHARS = 300_000;

const PRE_CLASS =
  "code-view mx-auto my-4 max-w-5xl overflow-x-auto rounded-sm bg-surface p-6 font-mono text-sm leading-relaxed whitespace-pre text-strong shadow-[0_0_0_1px_var(--theme-border)]";

/** A code file in the colors of its language. JSON that parses is laid out with two spaces. */
export default function CodePreview({ url, language }: { url: string; language: string }) {
  const { text, error } = useFileText(url);
  if (error) return <p className="error-box m-4">{error}</p>;
  if (text === null) return <Spinner />;
  const source = language === "json" ? layOut(text) : text;
  if (source.length > COLOR_MAX_CHARS || hljs.getLanguage(language) === undefined) return <pre className={PRE_CLASS}>{source}</pre>;
  // highlight.js escapes the text and adds only spans with classes, so its HTML is safe to insert.
  const html = hljs.highlight(source, { language, ignoreIllegals: true }).value;
  return (
    <pre className={PRE_CLASS}>
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}

function layOut(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
