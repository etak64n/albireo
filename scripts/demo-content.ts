// The pictures and the notes of the demo on GitHub Pages, which scripts/demo-media.ts
// renders: slide decks and mock screens as HTML that Chromium draws at 1280 by 720, a
// monogram for the picture of each person, and the text of the notes. The decks share
// one calm design: white pages, the navy and the gold of albireo as accents, Noto Sans,
// and wide margins. Nothing shows a person.

import { LESSONS, type Lesson } from "../src/demo/lessons.ts";
import type { PictureFile } from "../src/demo/media.ts";

const NAVY = "#01153d";
const GOLD = "#fcb80b";
const INK = "#26324d";
const SLATE = "#5a6580";
const MIST = "#8b94a8";
const LINE = "#e3e7ef";
const CLOUD = "#f4f6fa";

/** A color mixed with white, from 1 for the color itself down to 0 for white. */
function tint(color: string, share: number): string {
  const channels = [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16));
  return `#${channels.map((value) => Math.round(value * share + 255 * (1 - share)).toString(16).padStart(2, "0")).join("")}`;
}

function page(style: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${style}</style></head><body>${body}</body></html>`;
}

const DECK_STYLE = `
@page { size: 1280px 720px; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-font-smoothing: antialiased; }
body { font-family: "Noto Sans", sans-serif; color: ${INK}; background: #ffffff; }
.slide { position: relative; width: 1280px; height: 720px; overflow: hidden; padding: 80px 112px 0; background: #ffffff; break-after: page; }
.slide:last-child { break-after: auto; }
.kicker { font-size: 16px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: ${SLATE}; }
h1 { margin-top: 24px; font-size: 68px; line-height: 1.1; font-weight: 700; letter-spacing: -0.015em; color: ${NAVY}; max-width: 860px; text-wrap: balance; }
h2 { margin-top: 14px; font-size: 44px; line-height: 1.15; font-weight: 700; letter-spacing: -0.01em; color: ${NAVY}; text-wrap: balance; }
.lead { margin-top: 26px; font-size: 26px; line-height: 1.45; color: ${SLATE}; max-width: 760px; }
.rule { margin-top: 36px; width: 64px; height: 6px; border-radius: 3px; background: ${GOLD}; }
.cover { padding-top: 150px; }
.closing { padding-top: 220px; }
.byline { position: absolute; left: 112px; bottom: 80px; font-size: 20px; color: ${SLATE}; }
.star { position: absolute; right: -140px; bottom: -140px; width: 440px; height: 440px; border-radius: 50%; background: ${NAVY}; }
.star::after { content: ""; position: absolute; left: 84px; top: 84px; width: 66px; height: 66px; border-radius: 50%; background: ${GOLD}; }
.foot { position: absolute; left: 112px; right: 112px; bottom: 38px; display: flex; justify-content: space-between; font-size: 15px; letter-spacing: 0.02em; color: ${MIST}; }
.points { list-style: none; margin-top: 46px; display: grid; gap: 26px; max-width: 940px; }
.points li { position: relative; padding-left: 42px; font-size: 30px; line-height: 1.35; color: ${INK}; }
.points li::before { content: ""; position: absolute; left: 0; top: 14px; width: 14px; height: 14px; border-radius: 50%; background: ${GOLD}; }
.chart { display: block; margin-top: 34px; }
.code { margin-top: 44px; max-width: 1056px; padding: 30px 38px; border: 2px solid ${LINE}; border-radius: 16px; background: ${CLOUD}; font-family: "Noto Sans Mono", "DejaVu Sans Mono", monospace; font-size: 28px; line-height: 1.5; color: ${NAVY}; white-space: pre; }
.figure { margin-top: 26px; font-size: 168px; line-height: 1; font-weight: 700; letter-spacing: -0.03em; color: ${NAVY}; }
.figure + .lead { margin-top: 18px; }
.swatches { margin-top: 44px; display: flex; gap: 40px; }
.swatches figure { width: 448px; }
.chip { height: 250px; border-radius: 18px; }
figcaption { margin-top: 18px; display: grid; gap: 4px; }
figcaption strong { font-size: 28px; font-weight: 700; color: ${NAVY}; }
figcaption span { font-size: 20px; color: ${SLATE}; }
.tints { margin-top: 40px; display: grid; gap: 26px; }
.tint-row { display: flex; gap: 20px; }
.tint { width: 192px; }
.tint-chip { height: 120px; border-radius: 14px; box-shadow: inset 0 0 0 1px rgba(1, 21, 61, 0.06); }
.tint span { display: block; margin-top: 8px; font-size: 18px; color: ${SLATE}; }
.contrast { margin-top: 44px; display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
.sample { border: 1px solid ${LINE}; border-radius: 18px; padding: 44px 40px; }
.sample-text { font-size: 52px; font-weight: 700; }
.sample-ratio { margin-top: 26px; font-size: 22px; color: ${SLATE}; }
.sample-ratio strong { display: block; margin-bottom: 4px; font-size: 30px; color: ${NAVY}; }
.specimen { margin-top: 40px; display: grid; gap: 28px; }
.specimen div { display: flex; align-items: baseline; justify-content: space-between; gap: 40px; padding-bottom: 22px; border-bottom: 1px solid ${LINE}; }
.specimen span { flex: none; font-size: 18px; letter-spacing: 0.04em; color: ${MIST}; }
.cards { margin-top: 52px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; }
.card { min-height: 230px; padding: 30px 30px 28px; border-top: 6px solid ${GOLD}; border-radius: 16px; background: ${CLOUD}; }
.card strong { display: block; font-size: 28px; line-height: 1.3; font-weight: 600; color: ${NAVY}; }
.card span { display: block; margin-top: 18px; font-size: 20px; color: ${SLATE}; }
.quote { margin-top: 64px; max-width: 980px; padding-left: 40px; border-left: 8px solid ${GOLD}; font-size: 46px; line-height: 1.3; font-weight: 600; color: ${NAVY}; }
.quote + .lead { margin-left: 48px; }
.checks { list-style: none; margin-top: 48px; display: grid; gap: 30px; }
.checks li { position: relative; padding-left: 58px; font-size: 30px; line-height: 1.35; color: ${INK}; }
.checks li::before { content: ""; position: absolute; left: 0; top: 5px; width: 30px; height: 30px; border: 3px solid #b9c0ce; border-radius: 8px; }
.checks li.done::before { border-color: ${NAVY}; background: ${NAVY}; }
.checks li.done::after { content: ""; position: absolute; left: 11px; top: 10px; width: 8px; height: 15px; border: solid ${GOLD}; border-width: 0 4px 4px 0; transform: rotate(45deg); }
`;

interface Slide {
  className: "cover" | "content" | "closing";
  html: string;
}

export interface Deck {
  /** The name of the deck in the foot of its pages. */
  name: string;
  slides: Slide[];
}

function cover(kicker: string, title: string, lead: string, byline: string): Slide {
  return {
    className: "cover",
    html: `<div class="kicker">${kicker}</div><h1>${title}</h1><p class="lead">${lead}</p><div class="rule"></div><div class="byline">${byline}</div><div class="star"></div>`,
  };
}

function content(kicker: string, heading: string, body: string): Slide {
  return { className: "content", html: `<div class="kicker">${kicker}</div><h2>${heading}</h2>${body}` };
}

function closing(line: string, lead: string): Slide {
  return { className: "closing", html: `<h1>${line}</h1><p class="lead">${lead}</p><div class="rule"></div><div class="star"></div>` };
}

function points(lines: readonly string[]): string {
  return `<ul class="points">${lines.map((line) => `<li>${line}</li>`).join("")}</ul>`;
}

function section(deck: Deck, slide: Slide, index: number): string {
  const foot = slide.className === "content" ? `<footer class="foot"><span>${deck.name}</span><span>${index + 1}</span></footer>` : "";
  return `<section class="slide ${slide.className}">${slide.html}${foot}</section>`;
}

/** The two slides of a lesson of SQL in 20 lessons: its title, then its query. */
export function lessonDeck(lesson: Lesson, number: number): Deck {
  const kicker = `SQL lesson ${number}`;
  const code = lesson.code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return {
    name: `SQL in 20 lessons  ·  ${number}`,
    slides: [cover(kicker, lesson.title, lesson.lead, "Kenji Ito"), content(kicker, lesson.title, `<pre class="code">${code}</pre>`)],
  };
}

/** Each slide of a deck as a page of its own, to draw as a picture. */
export function slidePages(deck: Deck): string[] {
  return deck.slides.map((slide, index) => page(DECK_STYLE, section(deck, slide, index)));
}

/** The whole deck as one page of slides, to print as a PDF. */
export function deckPage(deck: Deck): string {
  return page(DECK_STYLE, deck.slides.map((slide, index) => section(deck, slide, index)).join(""));
}

function svg(width: number, height: number, inner: string): string {
  return `<svg class="chart" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Noto Sans, sans-serif">${inner}</svg>`;
}

/** Columns with the value on top of each one that shows its value, and one column in gold. */
function columns(items: readonly { label: string; value: number }[], highlight: number, values: "all" | "highlight"): string {
  const width = 1056;
  const height = 380;
  const top = 40;
  const bottom = 44;
  const max = Math.max(...items.map((item) => item.value));
  const step = width / items.length;
  const bar = Math.min(96, step * 0.6);
  const bars = items.map((item, index) => {
    const barHeight = Math.round(((height - top - bottom) * item.value) / max);
    const x = index * step + (step - bar) / 2;
    const y = height - bottom - barHeight;
    const center = (x + bar / 2).toFixed(1);
    const value =
      values === "all" || index === highlight
        ? `<text x="${center}" y="${y - 12}" text-anchor="middle" font-size="24" font-weight="700" fill="${NAVY}">${item.value}</text>`
        : "";
    const label = item.label === "" ? "" : `<text x="${center}" y="${height - 12}" text-anchor="middle" font-size="18" fill="${SLATE}">${item.label}</text>`;
    return `<rect x="${x.toFixed(1)}" y="${y}" width="${bar.toFixed(1)}" height="${barHeight}" rx="6" fill="${index === highlight ? GOLD : NAVY}"/>${value}${label}`;
  });
  const baseline = `<line x1="0" y1="${height - bottom}" x2="${width}" y2="${height - bottom}" stroke="${LINE}" stroke-width="2"/>`;
  return svg(width, height, bars.join("") + baseline);
}

/** A line over weeks that ends in a gold point with its label. */
function line(values: readonly number[], end: string): string {
  const width = 1056;
  const height = 360;
  const left = 16;
  const right = 220;
  const top = 30;
  const bottom = 50;
  const max = Math.max(...values) * 1.08;
  const points = values.map((value, index): [number, number] => [
    left + (index * (width - left - right)) / (values.length - 1),
    top + (height - top - bottom) * (1 - value / max),
  ]);
  const path = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = points[points.length - 1] ?? [0, 0];
  return svg(
    width,
    height,
    `<line x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}" stroke="${LINE}" stroke-width="2"/>` +
      `<path d="${path}" fill="none" stroke="${NAVY}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>` +
      `<circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="10" fill="${GOLD}"/>` +
      `<text x="${(lastX + 24).toFixed(1)}" y="${(lastY + 9).toFixed(1)}" font-size="26" font-weight="700" fill="${NAVY}">${end}</text>` +
      `<text x="${left}" y="${height - 14}" font-size="18" fill="${SLATE}">Week 1</text>` +
      `<text x="${width - right}" y="${height - 14}" text-anchor="end" font-size="18" fill="${SLATE}">Week ${values.length}</text>`,
  );
}

/** Bars across, from the largest, with the first in gold. */
function rows(items: readonly { label: string; value: number }[]): string {
  const width = 1056;
  const labelWidth = 480;
  const rowHeight = 80;
  const max = Math.max(...items.map((item) => item.value));
  const space = width - labelWidth - 80;
  const inner = items.map((item, index) => {
    const y = index * rowHeight;
    const barWidth = Math.round((space * item.value) / max);
    return (
      `<text x="0" y="${y + 34}" font-size="24" fill="${INK}">${item.label}</text>` +
      `<rect x="${labelWidth}" y="${y + 8}" width="${barWidth}" height="36" rx="6" fill="${index === 0 ? GOLD : NAVY}"/>` +
      `<text x="${labelWidth + barWidth + 14}" y="${y + 35}" font-size="24" font-weight="700" fill="${NAVY}">${item.value}</text>`
    );
  });
  return svg(width, items.length * rowHeight, inner.join(""));
}

/** The hour of the incident: when the latency was normal, high, and recovering, and what happened when. */
function timeline(): string {
  const width = 1056;
  const height = 330;
  const track = 150;
  // Minutes from 13:50 to the left edge of the chart, which ends at 15:00.
  const x = (minutes: number) => (minutes / 70) * width;
  const segments = [
    [0, 12, "#d9dee8"],
    [12, 45, GOLD],
    [45, 59, "#fde4a3"],
    [59, 70, "#d9dee8"],
  ] as const;
  const events = [
    { at: 12, time: "14:02", text: "p99 latency above 2 s", above: true, anchor: "start" },
    { at: 19, time: "14:09", text: "On call paged", above: false, anchor: "start" },
    { at: 45, time: "14:35", text: "Provider confirms", above: true, anchor: "start" },
    { at: 59, time: "14:49", text: "Back to normal", above: false, anchor: "end" },
  ] as const;
  const legend = (
    [
      ["Normal", "#d9dee8"],
      ["Slow", GOLD],
      ["Recovering", "#fde4a3"],
    ] as const
  )
    .map(([name, color], index) => `<circle cx="${index * 170 + 8}" cy="14" r="8" fill="${color}"/><text x="${index * 170 + 24}" y="20" font-size="18" fill="${SLATE}">${name}</text>`)
    .join("");
  const bars = segments
    .map(([from, to, color]) => `<rect x="${x(from).toFixed(1)}" y="${track}" width="${(x(to) - x(from)).toFixed(1)}" height="28" fill="${color}"/>`)
    .join("");
  const marks = events
    .map((event) => {
      const at = x(event.at).toFixed(1);
      const labelY = event.above ? track - 40 : track + 78;
      const lineEnd = event.above ? track - 30 : track + 56;
      return (
        `<line x1="${at}" y1="${track + 14}" x2="${at}" y2="${lineEnd}" stroke="${NAVY}" stroke-width="2"/>` +
        `<circle cx="${at}" cy="${track + 14}" r="8" fill="${NAVY}" stroke="#ffffff" stroke-width="3"/>` +
        `<text x="${at}" y="${labelY}" text-anchor="${event.anchor}" font-size="20" fill="${INK}"><tspan font-weight="700" fill="${NAVY}">${event.time}</tspan>  ${event.text}</text>`
      );
    })
    .join("");
  const hours = [
    [10, "14:00"],
    [25, "14:15"],
    [40, "14:30"],
    [55, "14:45"],
    [70, "15:00"],
  ] as const;
  const ticks = hours
    .map(([minutes, label]) => `<text x="${x(minutes).toFixed(1)}" y="${height - 10}" text-anchor="${minutes === 70 ? "end" : "middle"}" font-size="16" fill="${MIST}">${label}</text>`)
    .join("");
  return svg(
    width,
    height,
    `${legend}<defs><clipPath id="track"><rect x="0" y="${track}" width="${width}" height="28" rx="14"/></clipPath></defs>` +
      `<g clip-path="url(#track)">${bars}</g>${marks}${ticks}`,
  );
}

/** How an upload travels: the browser sends the parts to albireo, which passes each one on to the bucket. */
function uploadDiagram(): string {
  const width = 1056;
  const height = 400;
  const boxes = [
    { x: 0, name: "Browser", caption: "your computer" },
    { x: 413, name: "albireo", caption: "passes each part on" },
    { x: 826, name: "Bucket", caption: "keeps the parts" },
  ]
    .map(
      (box) =>
        `<rect x="${box.x}" y="30" width="230" height="110" rx="16" fill="${CLOUD}" stroke="${LINE}" stroke-width="2"/>` +
        `<text x="${box.x + 115}" y="80" text-anchor="middle" font-size="26" font-weight="700" fill="${NAVY}">${box.name}</text>` +
        `<text x="${box.x + 115}" y="112" text-anchor="middle" font-size="18" fill="${SLATE}">${box.caption}</text>`,
    )
    .join("");
  const arrows =
    `<line x1="240" y1="64" x2="403" y2="64" stroke="${SLATE}" stroke-width="2" marker-end="url(#arrow)"/>` +
    `<text x="321" y="52" text-anchor="middle" font-size="16" fill="${SLATE}">1  start</text>` +
    `<line x1="403" y1="108" x2="240" y2="108" stroke="${SLATE}" stroke-width="2" marker-end="url(#arrow)"/>` +
    `<text x="321" y="132" text-anchor="middle" font-size="16" fill="${SLATE}">2  the size of the parts</text>` +
    `<line x1="653" y1="85" x2="816" y2="85" stroke="${SLATE}" stroke-width="2" marker-end="url(#arrow)"/>` +
    `<text x="734" y="73" text-anchor="middle" font-size="16" fill="${SLATE}">4  each part</text>` +
    `<path d="M115,140 L115,196 L528,196 L528,150" fill="none" stroke="${SLATE}" stroke-width="2" marker-end="url(#arrow)"/>` +
    `<text x="528" y="226" text-anchor="middle" font-size="18" fill="${INK}">3  the parts go to albireo, four at a time</text>`;
  const parts = Array.from({ length: 8 }, (_, index) => {
    const x = index * 133.7;
    const again = index === 5;
    return (
      `<rect x="${x.toFixed(1)}" y="266" width="120" height="58" rx="10" fill="${again ? GOLD : NAVY}"/>` +
      `<text x="${(x + 60).toFixed(1)}" y="302" text-anchor="middle" font-size="18" font-weight="600" fill="${again ? NAVY : "#ffffff"}">Part ${index + 1}</text>`
    );
  }).join("");
  const notes =
    `<text x="0" y="360" font-size="16" fill="${MIST}">16 MiB each</text>` +
    `<text x="${(5 * 133.7 + 60).toFixed(1)}" y="360" text-anchor="middle" font-size="16" fill="${SLATE}">sent again</text>`;
  const marker = `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${SLATE}"/></marker></defs>`;
  return svg(width, height, marker + boxes + arrows + parts + notes);
}

const TEAM_UPLOADS = [
  { label: "Design", value: 18 },
  { label: "Support", value: 24 },
  { label: "Sales", value: 22 },
  { label: "Engineering", value: 46 },
  { label: "Marketing", value: 31 },
  { label: "Operations", value: 12 },
];

const WEEKLY_TEAMS = [42, 45, 47, 51, 50, 56, 61, 64, 66, 71, 75, 78, 84];

export const DECKS = {
  tipColors: {
    name: "Design tips  ·  1",
    slides: [
      cover("Design tip 1", "Start from two colors", "A dark one for text, and a bright one for what matters.", "Mina Sato"),
      content(
        "Design tip 1",
        "Pick a dark and a bright",
        `<div class="swatches">
          <figure><div class="chip" style="background:${NAVY}"></div><figcaption><strong>Ink</strong><span>#01153D  ·  text and shapes</span></figcaption></figure>
          <figure><div class="chip" style="background:${GOLD}"></div><figcaption><strong>Signal</strong><span>#FCB80B  ·  what matters</span></figcaption></figure>
        </div>`,
      ),
      content(
        "Design tip 1",
        "Then make lighter tints",
        `<div class="tints">${[NAVY, GOLD]
          .map(
            (color) =>
              `<div class="tint-row">${[100, 80, 60, 40, 20]
                .map((share) => `<div class="tint"><div class="tint-chip" style="background:${tint(color, share / 100)}"></div><span>${share}%</span></div>`)
                .join("")}</div>`,
          )
          .join("")}</div>`,
      ),
      content(
        "Design tip 1",
        "Keep text dark on light",
        `<div class="contrast">
          <div class="sample"><div class="sample-text" style="color:${NAVY}">Ink on white</div><div class="sample-ratio"><strong>17.9 : 1</strong>Easy to read at any size</div></div>
          <div class="sample"><div class="sample-text" style="color:${GOLD}">Signal on white</div><div class="sample-ratio"><strong>1.8 : 1</strong>For shapes, not for text</div></div>
        </div>`,
      ),
      closing("Two colors are enough for most slides.", "Next tip: one typeface, three sizes."),
    ],
  },
  tipType: {
    name: "Design tips  ·  2",
    slides: [
      cover("Design tip 2", "One typeface, three sizes", "Noto Sans at 46, 30, and 20 pixels does every job on a slide.", "Mina Sato"),
      content(
        "Design tip 2",
        "Three sizes",
        `<div class="specimen">
          <div><p style="font-size:46px;font-weight:700;color:${NAVY}">The heading says the point</p><span>46 PX  ·  BOLD</span></div>
          <div><p style="font-size:30px;color:${INK}">The line under it explains it</p><span>30 PX  ·  REGULAR</span></div>
          <div><p style="font-size:20px;color:${SLATE}">Details, sources, and dates stay small</p><span>20 PX  ·  REGULAR</span></div>
        </div>`,
      ),
      content("Design tip 2", "Use weight, not more sizes", points(["Bold for the one thing to remember", "Regular for everything else", "Two weights at most on a slide"])),
      closing("Fewer sizes, clearer slides.", "Next tip: label the data, not the axis."),
    ],
  },
  tipCharts: {
    name: "Design tips  ·  3",
    slides: [
      cover("Design tip 3", "Label the data, not the axis", "Put the numbers where the eyes already are.", "Mina Sato"),
      content("Design tip 3", "Videos uploaded by each team", columns(TEAM_UPLOADS, 3, "all")),
      content("Design tip 3", "Readers look at the data first", points(["Write the value on the bar", "Drop the gridlines and the axis", "Color only the bar that matters"])),
      content("Design tip 3", "Next time: line charts", line([120, 135, 128, 150, 170, 165, 190, 214], "214 hours")),
      closing("Label the data, and the axis can go.", "Next tip: one chart, one message."),
    ],
  },
  kickoff: {
    name: "All-hands  ·  Q4 kickoff",
    slides: [
      cover("All-hands", "Q4 kickoff", "Where Q3 landed, and three goals for the quarter.", "Priya Nair"),
      content(
        "Where Q3 landed",
        "Teams that watched a video each week",
        columns(
          WEEKLY_TEAMS.map((value, index) => ({ label: index === 0 ? "Week 1" : index === WEEKLY_TEAMS.length - 1 ? "Week 13" : "", value })),
          WEEKLY_TEAMS.length - 1,
          "highlight",
        ),
      ),
      content("Where Q3 landed", "Twice as many teams", `<div class="figure">84</div><p class="lead">teams watched a video in the last week of Q3, up from 42 in the first week.</p>`),
      content(
        "Q4",
        "Three goals for the quarter",
        `<div class="cards">
          <div class="card"><strong>Share a series outside the library</strong><span>Mina Sato</span></div>
          <div class="card"><strong>Halve the time to the first video</strong><span>Daniel Okafor</span></div>
          <div class="card"><strong>Answer support within a day</strong><span>Kenji Ito</span></div>
        </div>`,
      ),
      closing("Questions?", "Ask in the comments under this video."),
    ],
  },
  incident: {
    name: "Incident review  ·  object storage latency",
    slides: [
      cover("Incident review", "Object storage latency", "Uploads and playback were slow for 47 minutes. No data was lost.", "Priya Nair"),
      content("Timeline", "Tuesday, from 13:50 to 15:00 UTC", timeline()),
      content(
        "What went well",
        "Most uploads finished anyway",
        points(["Uploads sent failed parts again, so most of them finished", "The player asked for fresh URLs and recovered", "The status page was up in nine minutes"]),
      ),
      content(
        "Action items",
        "Two done, one to go",
        `<ul class="checks">
          <li class="done">Alert on the p99 latency, not only on failed parts</li>
          <li class="done">Link the status page of the provider from the runbook</li>
          <li>Show a notice in the library while uploads are slow</li>
        </ul>`,
      ),
      closing("Thank you to everyone on call.", "Blameless, as always."),
    ],
  },
  beta: {
    name: "Product updates  ·  beta feedback",
    slides: [
      cover("Product update", "What the beta teams asked for", "Twelve teams, six weeks, and 41 tickets.", "Alex Morgan"),
      content("The beta", "Twelve teams joined", `<div class="figure">12</div><p class="lead">teams used the beta for six weeks and wrote 41 tickets to support.</p>`),
      content(
        "What they asked for",
        "Top requests",
        rows([
          { label: "Share a series outside the library", value: 14 },
          { label: "Chapters in long recordings", value: 11 },
          { label: "Download a whole series", value: 7 },
          { label: "Comments on attachments", value: 5 },
        ]),
      ),
      content(
        "In their words",
        "Why chapters matter",
        `<blockquote class="quote">“We record every lecture. Chapters would save our students hours.”</blockquote><p class="lead">A university team in the beta</p>`,
      ),
      closing("Next: chapters, then sharing.", "The first build of chapters ships in two weeks."),
    ],
  },
  uploads: {
    name: "Tech talk  ·  uploads",
    slides: [
      cover("Tech talk", "How uploads resume", "One diagram, and three rules.", "Daniel Okafor"),
      content("The diagram", "albireo passes each part on", uploadDiagram()),
      content(
        "Three rules",
        "Why a flaky connection is fine",
        points(["Send the parts four at a time", "Send a failed part again, never the whole file", "Complete the upload when every part is in"]),
      ),
      closing("Big uploads survive a flaky connection.", "The notes are attached under the video."),
    ],
  },
} satisfies Record<string, Deck>;

export type DeckName = keyof typeof DECKS;

const SCREEN_STYLE = `
* { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-font-smoothing: antialiased; }
body { font-family: "Noto Sans", sans-serif; color: ${INK}; background: ${CLOUD}; }
.window { width: 1280px; height: 720px; overflow: hidden; background: #ffffff; }
.chrome { height: 46px; display: flex; align-items: center; gap: 8px; padding: 0 18px; border-bottom: 1px solid #e1e5ec; background: #f1f3f7; }
.chrome i { display: block; width: 12px; height: 12px; border-radius: 50%; }
.address { display: flex; align-items: center; width: 520px; height: 28px; margin-left: 120px; padding: 0 14px; border: 1px solid #e1e5ec; border-radius: 8px; background: #ffffff; font-size: 14px; color: ${SLATE}; }
.site { padding: 0 96px; }
.site nav { height: 76px; display: flex; align-items: center; justify-content: space-between; }
.mark { position: relative; display: block; width: 30px; height: 30px; border-radius: 8px; background: ${NAVY}; }
.mark::after { content: ""; position: absolute; left: 7px; top: 7px; width: 9px; height: 9px; border-radius: 50%; background: ${GOLD}; }
.links { display: flex; align-items: center; gap: 34px; font-size: 16px; color: ${SLATE}; }
.links .here { font-weight: 600; color: ${NAVY}; }
.links .sign-in { padding: 7px 16px; border: 1px solid #cfd5e0; border-radius: 8px; color: ${NAVY}; }
.site h1 { margin-top: 18px; text-align: center; font-size: 42px; letter-spacing: -0.01em; color: ${NAVY}; }
.intro { margin-top: 10px; text-align: center; font-size: 19px; color: ${SLATE}; }
.switch { display: flex; width: fit-content; margin: 22px auto 0; padding: 4px; border-radius: 999px; background: #eef1f6; font-size: 16px; }
.switch span { padding: 8px 22px; border-radius: 999px; color: ${SLATE}; }
.switch .on { background: #ffffff; font-weight: 600; color: ${NAVY}; box-shadow: 0 1px 3px rgba(1, 21, 61, 0.14); }
.switch em { margin-left: 6px; font-style: normal; font-size: 14px; font-weight: 600; color: #9a6b00; }
.plans { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; margin-top: 30px; }
.plan { position: relative; padding: 28px 28px 26px; border: 1px solid #e1e5ec; border-radius: 18px; }
.plan.chosen { border: 2px solid ${NAVY}; }
.badge { position: absolute; top: -14px; left: 28px; padding: 4px 12px; border-radius: 999px; background: ${GOLD}; font-size: 13px; font-weight: 700; letter-spacing: 0.04em; color: ${NAVY}; }
.plan-name { font-size: 20px; font-weight: 600; color: ${NAVY}; }
.price { margin-top: 8px; font-size: 52px; font-weight: 700; letter-spacing: -0.02em; color: ${NAVY}; }
.per { min-height: 20px; font-size: 15px; color: ${SLATE}; }
.plan ul { display: grid; gap: 10px; margin-top: 20px; list-style: none; font-size: 16px; color: ${INK}; }
.plan li { position: relative; padding-left: 24px; }
.plan li::before { content: ""; position: absolute; left: 0; top: 7px; width: 10px; height: 10px; border-radius: 50%; background: ${GOLD}; }
.action { display: flex; align-items: center; justify-content: center; height: 46px; margin-top: 24px; border: 1px solid #cfd5e0; border-radius: 10px; font-size: 16px; font-weight: 600; color: ${NAVY}; }
.plan.chosen .action { border-color: ${NAVY}; background: ${NAVY}; color: #ffffff; }
.review { padding: 52px 96px 0; }
.review .kicker { font-size: 15px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: ${SLATE}; }
.review h2 { margin-top: 8px; font-size: 36px; color: ${NAVY}; }
.phones { display: flex; justify-content: center; gap: 80px; margin-top: 30px; }
.device { display: grid; justify-items: center; gap: 22px; }
.phone { width: 250px; height: 480px; padding: 12px; border-radius: 40px; background: #0f172a; }
.phone.chosen { outline: 4px solid ${GOLD}; outline-offset: 8px; }
.screen { position: relative; width: 100%; height: 100%; overflow: hidden; border-radius: 30px; background: #ffffff; }
.status { display: flex; align-items: center; height: 34px; padding: 0 22px; font-size: 12px; font-weight: 600; color: ${NAVY}; }
.appbar { padding: 6px 20px 12px; border-bottom: 1px solid #edf0f5; font-size: 19px; font-weight: 700; color: ${NAVY}; }
.items { padding: 4px 20px; }
.item { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f0f2f6; font-size: 13px; color: ${INK}; }
.thumb { flex: none; width: 38px; height: 38px; border-radius: 10px; }
.item .name { flex: 1; }
.item .cost { font-weight: 600; }
.total { display: flex; justify-content: space-between; padding: 14px 20px 6px; font-size: 15px; font-weight: 700; color: ${NAVY}; }
.pay { display: flex; align-items: center; justify-content: center; height: 44px; margin: 8px 20px; border-radius: 12px; background: ${NAVY}; font-size: 15px; font-weight: 600; color: #ffffff; }
.sticky { position: absolute; left: 0; right: 0; bottom: 0; padding: 2px 0 14px; border-top: 1px solid #e6e9ef; background: #f6f7fa; }
.version { display: flex; align-items: center; gap: 8px; font-size: 17px; color: ${SLATE}; }
.version.chosen { font-weight: 700; color: ${NAVY}; }
.tag { padding: 3px 10px; border-radius: 999px; background: ${GOLD}; font-size: 12px; font-weight: 700; color: ${NAVY}; }
.docbar { display: flex; align-items: center; gap: 14px; width: 1280px; height: 64px; padding: 0 28px; border-bottom: 1px solid #e3e7ef; background: #ffffff; }
.doc-icon { position: relative; width: 30px; height: 36px; border-radius: 6px; background: ${NAVY}; }
.doc-icon::after { content: ""; position: absolute; left: 7px; right: 7px; top: 10px; height: 12px; border-top: 3px solid ${GOLD}; border-bottom: 3px solid #ffffff; }
.doc-title { font-size: 17px; font-weight: 600; color: ${NAVY}; }
.doc-meta { font-size: 13px; color: ${MIST}; }
.share { margin-left: auto; padding: 8px 18px; border-radius: 8px; background: ${NAVY}; font-size: 14px; font-weight: 600; color: #ffffff; }
.paper { width: 780px; margin: 48px auto 80px; padding: 64px 80px 72px; border: 1px solid #e3e7ef; border-radius: 14px; background: #ffffff; }
.paper h1 { font-size: 40px; letter-spacing: -0.01em; color: ${NAVY}; }
.paper .meta { margin-top: 8px; font-size: 16px; color: ${MIST}; }
.paper p { margin-top: 20px; font-size: 19px; line-height: 1.6; color: ${INK}; }
.paper h3 { margin-top: 40px; font-size: 22px; color: ${NAVY}; }
.todo { display: grid; gap: 14px; margin-top: 16px; list-style: none; }
.todo li { position: relative; padding-left: 40px; font-size: 19px; line-height: 1.5; color: ${INK}; }
.todo li::before { content: ""; position: absolute; left: 0; top: 3px; width: 22px; height: 22px; border: 2px solid #b9c0ce; border-radius: 6px; }
.todo li.done { color: ${SLATE}; }
.todo li.done::before { border-color: ${NAVY}; background: ${NAVY}; }
.todo li.done::after { content: ""; position: absolute; left: 8px; top: 7px; width: 6px; height: 11px; border: solid ${GOLD}; border-width: 0 3px 3px 0; transform: rotate(45deg); }
`;

function pricingPage(yearly: boolean): string {
  const per = yearly ? "per uploader a month, billed yearly" : "per uploader a month";
  const plans = [
    { name: "Starter", price: "$0", per: "for up to 3 uploaders", features: ["Unlimited viewers", "50 GB of video", "Comments and ratings"], action: "Start free" },
    { name: "Team", price: yearly ? "$10" : "$12", per, features: ["Unlimited uploads", "1 TB of video", "Series and attachments"], action: "Choose Team" },
    { name: "Business", price: yearly ? "$20" : "$24", per, features: ["Single sign-on", "5 TB of video", "Audit log"], action: "Talk to us" },
  ];
  return page(
    SCREEN_STYLE,
    `<div class="window">
      <div class="chrome"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><div class="address">staging.example.com/pricing</div></div>
      <div class="site">
        <nav><span class="mark"></span><div class="links"><span>Product</span><span class="here">Pricing</span><span>Docs</span><span class="sign-in">Sign in</span></div></nav>
        <h1>Plans for every team</h1>
        <p class="intro">Everyone can watch. You pay for the people who upload.</p>
        <div class="switch"><span class="${yearly ? "" : "on"}">Monthly</span><span class="${yearly ? "on" : ""}">Yearly<em>2 months free</em></span></div>
        <div class="plans">${plans
          .map(
            (plan, index) =>
              `<div class="plan${index === 1 ? " chosen" : ""}">${index === 1 ? `<div class="badge">RECOMMENDED</div>` : ""}<div class="plan-name">${plan.name}</div>` +
              `<div class="price">${plan.price}</div><div class="per">${plan.per}</div><ul>${plan.features.map((feature) => `<li>${feature}</li>`).join("")}</ul>` +
              `<div class="action">${plan.action}</div></div>`,
          )
          .join("")}</div>
      </div>
    </div>`,
  );
}

// The same order on three layouts: A ends the list with the total and the button, B keeps
// them in a bar at the bottom of the screen, and C puts the button first.
function checkoutPage(chosen: boolean): string {
  const items = `<div class="items">${(
    [
      ["Notebook, A5", "$12.00", "#e8ecf4"],
      ["Pens, set of 3", "$6.50", "#fdf0cf"],
      ["Desk lamp", "$34.00", "#e3eef0"],
    ] as const
  )
    .map(([name, cost, color]) => `<div class="item"><span class="thumb" style="background:${color}"></span><span class="name">${name}</span><span class="cost">${cost}</span></div>`)
    .join("")}</div>`;
  const total = `<div class="total"><span>Total</span><span>$52.50</span></div>`;
  const pay = `<div class="pay">Pay $52.50</div>`;
  const screens = [items + total + pay, items + `<div class="sticky">${total}${pay}</div>`, pay + items + total];
  const devices = screens
    .map((screen, index) => {
      const letter = String.fromCharCode(65 + index);
      const isChosen = chosen && index === 1;
      return (
        `<div class="device"><div class="phone${isChosen ? " chosen" : ""}"><div class="screen"><div class="status">9:41</div><div class="appbar">Your order</div>${screen}</div></div>` +
        `<div class="version${isChosen ? " chosen" : ""}">Version ${letter}${isChosen ? `<span class="tag">CHOSEN</span>` : ""}</div></div>`
      );
    })
    .join("");
  return page(SCREEN_STYLE, `<div class="review"><div class="kicker">Design review</div><h2>Checkout, three versions</h2></div><div class="phones">${devices}</div>`);
}

const CHECKLIST = [
  {
    heading: "Before the launch",
    items: [
      ["Freeze the copy of the pricing page", true],
      ["Upload a 4 GB recording over a slow connection", true],
      ["Record the walkthrough for the help center", false],
    ],
  },
  {
    heading: "On the day",
    items: [
      ["Turn on the new plans at 10:00", false],
      ["Post in #announcements", false],
      ["Watch the error rate for an hour", false],
    ],
  },
  {
    heading: "After the launch",
    items: [
      ["Bring the first week of feedback to the weekly sync", false],
      ["Thank the beta teams", false],
    ],
  },
] as const;

/** The checklist as a document app shows it: its bar, and the page under it, to scroll through. */
export const CHECKLIST_SCREENS = {
  bar: page(
    SCREEN_STYLE,
    `<div class="docbar"><div class="doc-icon"></div><div><div class="doc-title">Launch checklist</div><div class="doc-meta">Edited 2 hours ago</div></div><div class="share">Share</div></div>`,
  ),
  document: page(
    SCREEN_STYLE,
    `<div class="paper"><h1>Launch checklist</h1><div class="meta">Product team  ·  launch on Friday</div>
      <p>The new plans go live on Friday at 10:00. Check an item off when it is done, and say so in the weekly sync.</p>
      ${CHECKLIST.map(
        (part) =>
          `<h3>${part.heading}</h3><ul class="todo">${part.items.map(([text, done]) => `<li${done ? ' class="done"' : ""}>${text}</li>`).join("")}</ul>`,
      ).join("")}
      <p>Questions go to #launch. The pricing page is on the staging site until Friday.</p></div>`,
  ),
};

export const SCREENS = {
  pricing: [pricingPage(false), pricingPage(true)],
  checkout: [checkoutPage(false), checkoutPage(true)],
};

/** The colors of the picture of each person, from the upper left corner to the lower right. */
const PICTURE_COLORS: Record<PictureFile, readonly [string, string]> = {
  alex: [NAVY, "#2f5aa8"],
};

/** The picture of a person: the first letter of their name on a soft gradient, as a square that the app shows in a circle. */
export function monogram(picture: PictureFile, name: string): string {
  const [from, to] = PICTURE_COLORS[picture];
  return page(
    `* { margin: 0; } html, body { width: 256px; height: 256px; }
    body { display: grid; place-items: center; background: linear-gradient(135deg, ${from}, ${to}); font-family: "Noto Sans", sans-serif; }
    span { padding-bottom: 8px; font-size: 124px; line-height: 1; font-weight: 600; color: #ffffff; }`,
    `<span>${name.slice(0, 1)}</span>`,
  );
}

/** The text of the notes that go with some videos. */
/** Questions and answers, with a table, for a Word document. */
export interface Answers {
  title: string;
  author: string;
  intro: string;
  table: readonly (readonly string[])[];
  tableNote: string;
  questions: readonly (readonly [string, string])[];
}

/** The answers about the yearly prices for the support team, which go with the video of the pricing page. */
export const PRICING_FAQ: Answers = {
  title: "Yearly prices: answers for the support team",
  author: "Alex Morgan",
  intro: "The pricing page has a switch between monthly and yearly prices. Everyone can watch, and teams pay for the people who upload.",
  table: [
    ["Plan", "Monthly", "Billed yearly"],
    ["Starter", "$0", "$0"],
    ["Team", "$12", "$10"],
    ["Business", "$24", "$20"],
  ],
  tableNote: "Prices are for each uploader a month. Starter is free for up to 3 uploaders.",
  questions: [
    ["How much does a team save with yearly prices?", "Two months: billed yearly, Team costs $120 for each uploader instead of $144."],
    ["Does anyone pay to watch?", "No. Everyone can watch, and only the people who upload count."],
    ["Where can I try the switch?", "On the staging site, at staging.example.com/pricing."],
  ],
};

// The lesson whose query goes with it as a file of SQL.
const JOIN_LESSON = LESSONS.find((lesson) => lesson.file === "sql-08");
if (JOIN_LESSON === undefined) throw new Error("SQL in 20 lessons has no lesson 8.");

export const NOTES = {
  // The script that draws the chart of Design tip 3, from the same data and colors.
  chartScript: `# Draws the bar chart of Design tip 3: the value on each bar, no gridlines and no axis,
# and gold for the bar that matters.
import matplotlib.pyplot as plt

teams = [${TEAM_UPLOADS.map(({ label }) => `"${label}"`).join(", ")}]
videos = [${TEAM_UPLOADS.map(({ value }) => value).join(", ")}]
highlight = "Engineering"

colors = ["${GOLD}" if team == highlight else "${NAVY}" for team in teams]
fig, ax = plt.subplots(figsize=(10.56, 3.8))
bars = ax.bar(teams, videos, color=colors, width=0.6)
ax.bar_label(bars, padding=6, fontsize=14, fontweight="bold", color="${NAVY}")
ax.set_title("Videos uploaded by each team", loc="left", fontsize=18, fontweight="bold")
ax.spines[["top", "right", "left"]].set_visible(False)
ax.tick_params(axis="x", colors="${SLATE}", length=0)
ax.set_yticks([])
fig.savefig("bar-chart.png", dpi=200, bbox_inches="tight")
`,
  // A sketch of the code of the diagram of resumable uploads.
  uploadCode: `// How the browser sends the parts of an upload: four at a time, with a fresh signed URL
// for each attempt, and up to three attempts for each part. The other parts keep going.
const PARALLEL = 4;
const ATTEMPTS = 3;

interface Part {
  number: number;
  body: Blob;
}

type SignedUrlOf = (part: number) => Promise<string>;

export async function sendParts(parts: Part[], signedUrlOf: SignedUrlOf): Promise<Map<number, string>> {
  const etags = new Map<number, string>();
  const queue = [...parts];
  const sender = async () => {
    for (let part = queue.shift(); part !== undefined; part = queue.shift()) {
      etags.set(part.number, await sendPart(part, signedUrlOf));
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, sender));
  return etags;
}

async function sendPart(part: Part, signedUrlOf: SignedUrlOf): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    // A fresh URL for each attempt, so that a retry never uses one that expired.
    const response = await fetch(await signedUrlOf(part.number), { method: "PUT", body: part.body });
    if (response.ok) return response.headers.get("ETag") ?? "";
    if (attempt === ATTEMPTS) throw new Error(\`Part \${part.number} failed \${ATTEMPTS} times.\`);
  }
}
`,
  lessonQuery: `-- SQL lesson 8: ${JOIN_LESSON.title}\n-- ${JOIN_LESSON.lead}\n${JOIN_LESSON.code}\n`,
  // The files that go with the chart of Design tip 3: its data, a checklist, and its colors.
  chartData: `team,videos\n${TEAM_UPLOADS.map(({ label, value }) => `${label},${value}`).join("\n")}\n`,
  chartChecklist: `# Before you share a chart

From Design tip 3: label the data, not the axis.

- [x] Write the value on each bar
- [x] Drop the gridlines and the axis
- [x] Color only the bar that matters
- [ ] Say in the title what the chart shows

| Part | Color |
| --- | --- |
| Bars | Navy \`${NAVY}\` |
| The bar that matters | Gold \`${GOLD}\` |
| Labels | Slate \`${SLATE}\` |
`,
  chartColors: `${JSON.stringify({ chart: "Videos uploaded by each team", colors: { bars: NAVY, highlight: GOLD, values: NAVY, labels: SLATE, baseline: LINE } }, null, 2)}\n`,
  timeline: `# Incident review: object storage latency

Uploads and playback were slow for 47 minutes. No data was lost.

## Timeline (UTC)

| Time | What happened |
| --- | --- |
| 14:02 | The p99 latency of the bucket rises above 2 seconds |
| 14:09 | The alert on failed parts pages the engineer on call |
| 14:21 | Uploads send failed parts again, and a few fail after three attempts |
| 14:35 | The storage provider confirms a degraded region |
| 14:49 | Latency is back to normal |

## What went well

- Uploads sent the failed parts again, so most of them finished.
- Playback recovered by itself: the player asked for fresh URLs.
- The status page was up in nine minutes.

## Action items

- [x] Alert on the p99 latency of the bucket, not only on failed parts
- [x] Link the status page of the provider from the runbook
- [ ] Show a notice in the library while uploads are slow
`,
  latency: `time_utc,p50_ms,p99_ms,failed_parts
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
`,
  checklist: `# Launch checklist

The new plans go live on Friday at 10:00. Check an item off when it is done, and say so in the weekly sync.

${CHECKLIST.map((part) => `## ${part.heading}\n\n${part.items.map(([text, done]) => `- [${done ? "x" : " "}] ${text}`).join("\n")}`).join("\n\n")}

Questions go to #launch. The pricing page is on the staging site until Friday.
`,
  uploadSteps: `How uploads resume
==================

1. The browser asks albireo to start an upload.
2. albireo answers with the size of the parts. Each part is 16 MiB or more.
3. The browser sends the parts to albireo, four at a time.
4. albireo passes each part on to the bucket as it arrives,
   and answers with the ETag that the bucket gave the part.
5. A part that fails is sent again, up to three attempts in all.
   The other parts keep going.
6. When every part is in, albireo completes the upload.

A 4 GiB recording has 256 parts of 16 MiB.
`,
};
