// The attachments of the demo: slides as PDF, notes in Markdown, a CSV, and a text file.
// scripts/demo-media.ts writes them beside the demo, and the demo takes their sizes from
// the same text, so the sizes on the page are the sizes of the files. The text does not
// depend on the time, so the files and the page always agree.

import { slidesPdf, type PdfItem } from "./pdf.ts";

export interface DemoFile {
  fileName: string;
  /** The type that albireo gives a file of this name. */
  contentType: string;
  text: string;
}

const NAVY = "#1b2a4a";
const INDIGO = "#533afd";
const TEXT = "#1a2c44";
const MUTED = "#667691";
const PALE = "#aab4d4";
const LIGHT = "#f4f7fa";
const LINE = "#d4dee9";
const TEAL = "#0e7490";
const PALE_TEAL = "#a5f3fc";
const LIGHT_TEAL = "#ecfeff";
const AMBER = "#f59e0b";
const WHITE = "#ffffff";

/** The band at the top of a slide, with its title. */
function header(title: string, color: string): PdfItem[] {
  return [
    { box: [0, 0, 960, 88], color },
    { text: title, at: [56, 58], size: 30, color: WHITE, bold: true },
  ];
}

/** Lines of text, each after a small square. */
function bullets(lines: readonly string[], top: number, color: string): PdfItem[] {
  return lines.flatMap((line, index): PdfItem[] => [
    { box: [64, top + index * 52 - 12, 10, 10], color },
    { text: line, at: [88, top + index * 52], size: 20, color: TEXT },
  ]);
}

function pageNumber(page: number): PdfItem {
  return { text: String(page), at: [900, 512], size: 12, color: MUTED };
}

// The colors of the zoom in the recording, from fast escapes to the points in the set.
const PALETTE = ["#000764", "#206bcb", "#edffff", "#ffaa00", "#7a2e00", "#05050f"];
const BANDS = ["1 to 2", "3 to 5", "6 to 10", "11 to 50", "51 to 999", "in the set"];
// Steps before |z| passed 2 for 16 points on one row, where 1000 means that it never did.
const ESCAPE_STEPS = [3, 4, 6, 9, 15, 28, 61, 180, 1000, 1000, 1000, 240, 75, 22, 9, 5];

const MANDELBROT_SLIDES: PdfItem[][] = [
  [
    { box: [0, 0, 960, 540], color: NAVY },
    { text: "PATTERNS IN COMPUTATION  /  LECTURE 3", at: [64, 140], size: 14, color: PALE, bold: true },
    { box: [64, 156, 72, 6], color: "#7c6cff" },
    { text: "Fractals: zooming into", at: [64, 236], size: 44, color: WHITE, bold: true },
    { text: "the Mandelbrot set", at: [64, 290], size: 44, color: WHITE, bold: true },
    { text: "Daniel Okafor", at: [64, 452], size: 18, color: PALE },
    ...PALETTE.map((color, index): PdfItem => ({ box: [600 + index * 50, 430, 40, 40], color })),
  ],
  [
    ...header("One rule, repeated", NAVY),
    { box: [56, 120, 848, 96], color: LIGHT },
    { text: "z  ->  z * z + c", at: [88, 182], size: 36, color: TEXT, bold: true },
    ...bullets(
      [
        "Start from z = 0 and apply the rule again and again.",
        "If z stays small forever, c belongs to the set.",
        "Once |z| passes 2, it never comes back: c escapes.",
        "Each pixel of the picture is one value of c.",
      ],
      276,
      INDIGO,
    ),
    pageNumber(2),
  ],
  [
    ...header("Escape time along one row", NAVY),
    { box: [400, 108, 14, 14], color: INDIGO },
    { text: "escaped after that many steps", at: [422, 120], size: 14, color: TEXT },
    { box: [660, 108, 14, 14], color: NAVY },
    { text: "never escaped: in the set", at: [682, 120], size: 14, color: TEXT },
    { box: [80, 150, 2, 302], color: TEXT },
    { box: [80, 450, 800, 2], color: TEXT },
    { text: "1000", at: [42, 156], size: 12, color: MUTED },
    { text: "100", at: [49, 256], size: 12, color: MUTED },
    { text: "10", at: [56, 356], size: 12, color: MUTED },
    // A logarithmic scale, so that 1000 steps reach the top and 10 steps a third of the way.
    ...ESCAPE_STEPS.map((steps, index): PdfItem => {
      const height = Math.round((300 * Math.log10(steps)) / 3);
      return { box: [100 + index * 48, 450 - height, 36, height], color: steps >= 1000 ? NAVY : INDIGO };
    }),
    { text: "Steps before |z| passes 2, for 16 points on one row (log scale)", at: [80, 490], size: 16, color: MUTED },
    pageNumber(3),
  ],
  [
    ...header("Coloring by escape time", NAVY),
    ...PALETTE.flatMap((color, index): PdfItem[] => [
      { box: [63 + index * 140, 139, 122, 122], color: LINE },
      { box: [64 + index * 140, 140, 120, 120], color },
      { text: BANDS[index] ?? "", at: [64 + index * 140, 292], size: 16, color: TEXT, bold: true },
    ]),
    ...bullets(
      ["Smooth coloring blends the bands with the normalized iteration count.", "The zoom in the recording uses this palette."],
      380,
      INDIGO,
    ),
    pageNumber(4),
  ],
  [
    ...header("Exercises", NAVY),
    ...[
      "1.  Draw the set in a terminal, 80 by 40 characters.",
      "2.  Zoom into -0.7436 + 0.1318i and count the steps you need.",
      "3.  Color the escape times with a palette of your own.",
      "4.  Bring one picture to the next lecture.",
    ].map((line, index): PdfItem => ({ text: line, at: [64, 166 + index * 56], size: 20, color: TEXT })),
    { box: [56, 420, 848, 1], color: LINE },
    { text: "The exercises are also in exercises.md, attached under the recording.", at: [56, 460], size: 16, color: MUTED },
    pageNumber(5),
  ],
];

// Teams that watched a video in each week of Q3.
const WEEKLY_TEAMS = [42, 45, 47, 51, 50, 56, 61, 64, 66, 71, 75, 78, 84];
const GOALS = [
  { title: "Share a series with people outside the library", owner: "Owner: Mina Sato" },
  { title: "Halve the time from sign-up to the first video", owner: "Owner: Daniel Okafor" },
  { title: "Answer every support ticket within a day", owner: "Owner: Priya Nair" },
];

const KICKOFF_SLIDES: PdfItem[][] = [
  [
    { box: [0, 0, 960, 540], color: TEAL },
    { text: "ALL-HANDS", at: [64, 140], size: 14, color: PALE_TEAL, bold: true },
    { box: [64, 156, 72, 6], color: AMBER },
    { text: "Q4 kickoff", at: [64, 250], size: 56, color: WHITE, bold: true },
    { text: "Where Q3 landed, and three goals for Q4", at: [64, 300], size: 22, color: PALE_TEAL },
    { text: "Priya Nair", at: [64, 452], size: 18, color: PALE_TEAL },
  ],
  [
    ...header("Where Q3 landed", TEAL),
    { text: "Teams that watched a video each week", at: [80, 128], size: 16, color: MUTED },
    { box: [80, 160, 2, 292], color: TEXT },
    { box: [80, 450, 560, 2], color: TEXT },
    ...WEEKLY_TEAMS.map((teams, index): PdfItem => ({
      box: [96 + index * 41, 450 - teams * 3, 30, teams * 3],
      color: index === WEEKLY_TEAMS.length - 1 ? AMBER : TEAL,
    })),
    { text: "Week 1", at: [92, 474], size: 12, color: MUTED },
    { text: "Week 13", at: [576, 474], size: 12, color: MUTED },
    { text: "84", at: [700, 250], size: 72, color: TEXT, bold: true },
    { text: "teams in the last week of Q3", at: [700, 286], size: 16, color: MUTED },
    { text: "+100% since week 1", at: [700, 330], size: 20, color: TEAL, bold: true },
    pageNumber(2),
  ],
  [
    ...header("Goals for Q4", TEAL),
    ...GOALS.flatMap((goal, index): PdfItem[] => {
      const top = 128 + index * 120;
      return [
        { box: [56, top, 848, 100], color: LIGHT_TEAL },
        { box: [56, top, 8, 100], color: TEAL },
        { text: goal.title, at: [88, top + 44], size: 24, color: TEXT, bold: true },
        { text: goal.owner, at: [88, top + 76], size: 16, color: MUTED },
      ];
    }),
    pageNumber(3),
  ],
  [
    { box: [0, 0, 960, 540], color: TEAL },
    { text: "Questions?", at: [64, 250], size: 56, color: WHITE, bold: true },
    { text: "Ask in the comments under the recording.", at: [64, 300], size: 22, color: PALE_TEAL },
  ],
];

/** Rule 110 from one live cell at the right edge, one generation a line. */
function rule110(width: number, generations: number): string {
  let cells = Array.from({ length: width }, (_, index) => index === width - 1);
  const lines: string[] = [];
  for (let generation = 0; generation < generations; generation += 1) {
    lines.push(cells.map((alive) => (alive ? "#" : ".")).join(""));
    cells = cells.map((_, index) => {
      // The left, the cell, and the right make a number from 0 to 7, and that bit of 110 is the next state.
      const pattern = (cells[index - 1] === true ? 4 : 0) + (cells[index] === true ? 2 : 0) + (cells[index + 1] === true ? 1 : 0);
      return ((110 >> pattern) & 1) === 1;
    });
  }
  return lines.join("\n");
}

const RULE_TABLE = `Rule 110, from one live cell, 32 generations
# is a live cell and . is a dead one. Each line is the next generation.

${rule110(64, 32)}
`;

const EXERCISES = `# Exercises for lecture 3

Bring one picture to the next lecture. Any language is fine.

1. Draw the Mandelbrot set in a terminal, 80 columns by 40 rows, with \`#\` for the points in the set.
2. Zoom into one of the points below and count the steps that you need before the picture stops changing.
3. Color the escape times with a palette of your own.

## Points to try

| Name | Real part | Imaginary part |
| --- | --- | --- |
| Seahorse valley | -0.7436 | 0.1318 |
| Elephant valley | 0.2850 | 0.0100 |
| Double spiral | -0.7615 | -0.0848 |

## The loop

\`\`\`text
z = 0
for n in 1 .. max:
    z = z * z + c
    if |z| > 2: return n
return max
\`\`\`
`;

const TIMELINE = `# Incident review: object storage latency

Uploads and playback were slow for 47 minutes. No data was lost.

## Timeline (UTC)

| Time | What happened |
| --- | --- |
| 14:02 | The p99 latency of the bucket rises above 2 seconds |
| 14:09 | The alert on failed parts pages the on-call engineer |
| 14:21 | Uploads retry parts, and a few fail after three attempts |
| 14:35 | The storage provider confirms a degraded region |
| 14:49 | Latency is back to normal |

## What went well

- Uploads retried the failed parts, so most of them finished.
- Playback recovered by itself: the player asked for fresh URLs.

## Action items

- [x] Alert on the p99 latency of the bucket, not only on failed parts
- [x] Link the status page of the provider from the runbook
- [ ] Show a notice in the library while uploads are slow
`;

const LATENCY = `time_utc,p50_ms,p99_ms,failed_parts
13:50,38,142,0
13:55,40,151,0
14:00,41,163,0
14:05,47,2140,2
14:10,55,3870,7
14:15,61,4210,11
14:20,58,3990,9
14:25,54,3120,4
14:30,52,2650,3
14:35,49,2280,1
14:40,44,1180,0
14:45,41,420,0
14:50,39,168,0
14:55,38,149,0
`;

const CHECKLIST = `# Launch checklist

## Before the launch

- [x] Freeze the copy of the pricing page
- [x] Upload a 4 GB recording from a slow connection
- [ ] Record the walkthrough for the help center

## On the day

- [ ] Turn on the new plans at 10:00
- [ ] Post in #announcements
- [ ] Watch the error rate for an hour

## After the launch

- [ ] Bring the first week of feedback to the product sync
`;

export const DEMO_FILES = {
  ruleTable: { fileName: "rule-110.txt", contentType: "text/plain; charset=utf-8", text: RULE_TABLE },
  mandelbrotSlides: { fileName: "mandelbrot-slides.pdf", contentType: "application/pdf", text: slidesPdf(MANDELBROT_SLIDES) },
  exercises: { fileName: "exercises.md", contentType: "text/markdown; charset=utf-8", text: EXERCISES },
  kickoffSlides: { fileName: "q4-kickoff.pdf", contentType: "application/pdf", text: slidesPdf(KICKOFF_SLIDES) },
  timeline: { fileName: "timeline.md", contentType: "text/markdown; charset=utf-8", text: TIMELINE },
  latency: { fileName: "latency-p99.csv", contentType: "text/csv; charset=utf-8", text: LATENCY },
  checklist: { fileName: "launch-checklist.md", contentType: "text/markdown; charset=utf-8", text: CHECKLIST },
} satisfies Record<string, DemoFile>;

export type DemoFileKey = keyof typeof DEMO_FILES;
