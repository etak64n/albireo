import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Spinner } from "../ui/spinner.tsx";
import { useFileText } from "./useFileText.ts";

/**
 * A Markdown file as a page, with GitHub's tables, task lists, and strikethrough.
 * react-markdown leaves HTML in the file as text, so nothing in it runs.
 */
export default function MarkdownPreview({ url }: { url: string }) {
  const { text, error } = useFileText(url);
  if (error) return <p className="error-box m-4">{error}</p>;
  if (text === null) return <Spinner />;
  return (
    <article className="markdown mx-auto my-4 max-w-3xl rounded-sm bg-surface px-8 py-10 shadow-[0_0_0_1px_var(--theme-border)]">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" /> }}
      >
        {text}
      </Markdown>
    </article>
  );
}
