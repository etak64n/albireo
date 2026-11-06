import { Spinner } from "../ui/spinner.tsx";
import { useFileText } from "./useFileText.ts";

/** A plain text file as it is, with its lines wrapped to the width of the preview. */
export default function TextPreview({ url }: { url: string }) {
  const { text, error } = useFileText(url);
  if (error) return <p className="error-box m-4">{error}</p>;
  if (text === null) return <Spinner />;
  return (
    <pre className="mx-auto my-4 max-w-4xl rounded-sm bg-surface p-6 font-mono text-sm leading-relaxed break-words whitespace-pre-wrap shadow-[0_0_0_1px_var(--theme-border)]">
      {text}
    </pre>
  );
}
