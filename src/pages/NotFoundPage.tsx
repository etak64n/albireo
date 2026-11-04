import { Shell } from "../components/Shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { usePageTitle } from "../lib/title.ts";
import { Link } from "../router.tsx";

// An error page may be playful: bubbles rise behind the message, and the way home is one button.
export function NotFoundPage() {
  usePageTitle("Not found");
  return (
    <Shell>
      <section className="panel relative grid justify-items-center gap-4 overflow-hidden px-6 py-20 text-center">
        <Bubbles />
        <h1 className="heading relative text-3xl">This page does not exist.</h1>
        <Button asChild variant="primary" size="lg" className="relative">
          <Link to="/">Back to the library</Link>
        </Button>
      </section>
    </Shell>
  );
}

function Bubbles() {
  // slice keeps the bubbles round on a wide panel: the drawing covers the panel and is cut at its edges.
  const bubbles = [
    { cx: 30, cy: 70, r: 10 },
    { cx: 58, cy: 38, r: 6 },
    { cx: 84, cy: 82, r: 4 },
    { cx: 330, cy: 28, r: 8 },
    { cx: 360, cy: 66, r: 12 },
    { cx: 384, cy: 18, r: 5 },
  ];
  return (
    <svg viewBox="0 0 400 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className="absolute inset-0 size-full">
      {bubbles.map((bubble) => (
        <circle
          key={`${bubble.cx}-${bubble.cy}`}
          cx={bubble.cx}
          cy={bubble.cy}
          r={bubble.r}
          fill="none"
          stroke="var(--theme-accent)"
          strokeOpacity="0.45"
          strokeWidth="1.5"
        />
      ))}
    </svg>
  );
}
