// Makes the files of the demo on GitHub Pages that src/demo/media.ts names, so that the
// demo looks like a library in real use. Chromium, through Playwright, draws the slides,
// the mock screens, and the pictures of the people (scripts/demo-content.ts), and prints
// a deck as a PDF attachment. pptxgenjs makes another deck a PowerPoint file, and docx
// makes a Word document of questions and answers. ffmpeg turns the slides into videos with gentle
// crossfades, scrolls through a document as a screen recording does, and draws two calm
// loops of drifting color and soft light. The videos are silent. Nothing is downloaded,
// and nothing shows a person. The Pages workflow runs this after the demo build, with
// ffmpeg on the PATH and Playwright, pptxgenjs, and docx installed in a folder of their own:
//   node scripts/demo-media.ts <folder of the demo build> <folder of the tools>

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createLibrary } from "../src/demo/data.ts";
import { ATTACHMENT_FILES, MEDIA_PATHS, PICTURE_FILES, VIDEO_SECONDS, type AttachmentFile, type VideoFile } from "../src/demo/media.ts";
import { LESSONS } from "../src/demo/lessons.ts";
import { CHECKLIST_SCREENS, DECKS, NOTES, PRICING_FAQ, SCREENS, deckPage, lessonDeck, monogram, slidePages, type Answers, type DeckName } from "./demo-content.ts";

const WIDTH = 1280;
const HEIGHT = 720;
const RATE = 30;
const PICTURE_SIZE = 256;
const DOCUMENT_BAR_HEIGHT = 64;
// Slides cross-fade like a slideshow, and screens change as quickly as an app does.
const SLIDE_FADE = 0.6;
const SCREEN_FADE = 0.3;

// The parts of Playwright that this script uses. Playwright is no dependency of albireo,
// so its own types are not at hand.
interface Page {
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  setContent(html: string): Promise<void>;
  evaluate(expression: string): Promise<unknown>;
  screenshot(options: { path: string; fullPage?: boolean; type?: "png" | "jpeg"; quality?: number }): Promise<unknown>;
  pdf(options: { path: string; width: string; height: string; printBackground: boolean }): Promise<unknown>;
}

interface Browser {
  newPage(): Promise<Page>;
  close(): Promise<void>;
}

interface Playwright {
  chromium: { launch(): Promise<Browser> };
}

// The parts of pptxgenjs and docx that this script uses, which are no dependencies of
// albireo either.
interface PptxDeck {
  layout: string;
  title: string;
  author: string;
  addSlide(): { addImage(options: { path: string; x: number; y: number; w: number; h: number }): unknown };
  writeFile(options: { fileName: string }): Promise<string>;
}

type PptxGenJS = new () => PptxDeck;

interface Docx {
  Document: new (options: object) => object;
  Packer: { toBuffer(document: object): Promise<Buffer> };
  Paragraph: new (options: object) => object;
  Table: new (options: object) => object;
  TableRow: new (options: object) => object;
  TableCell: new (options: object) => object;
  HeadingLevel: { TITLE: string; HEADING_1: string; HEADING_2: string };
  WidthType: { PERCENTAGE: string };
}

// What a video shows: the slides of a deck, screens of an app one after another, a
// document that scrolls under the bar of its app, or a loop that ffmpeg draws itself.
type Picture =
  | { kind: "slides"; deck: DeckName }
  | { kind: "lesson"; index: number }
  | { kind: "screens"; screens: readonly string[] }
  | { kind: "scroll"; bar: string; document: string }
  | { kind: "loop"; graph: () => string };

interface SampleVideo {
  picture: Picture;
  /** The moment of the poster: a slide that shows what the video is about. */
  posterAt: number;
}

/**
 * Soft light over dusk colors: two glows that drift slowly. ffmpeg draws the glows as
 * Gaussians in the alpha of a small picture and scales it up, so they cost little and
 * stay smooth.
 */
function lobbyEvening(): string {
  const glow = (x: string, y: string, size: number, strength: number) =>
    `${strength}*exp(-(pow(X-W*(${x}),2)+pow(Y-H*(${y}),2))/(2*pow(H*${size},2)))`;
  const light = `255*min(1,${glow("0.33+0.14*sin(T*0.31)", "0.42+0.10*cos(T*0.23)", 0.3, 0.42)}+${glow("0.70+0.11*cos(T*0.27)", "0.62+0.09*sin(T*0.19)", 0.24, 0.3)})`;
  return [
    // A sky from deep blue at the top to peach at the horizon, which tilts a little.
    `gradients=s=640x360:r=${RATE}:c0=0x1d1b4f:c1=0x4a2f6e:c2=0xa8587e:c3=0xf0a274:n=4:x0=320:y0=0:x1=320:y1=360:speed=0.0015,scale=${WIDTH}:${HEIGHT}:flags=bicubic,format=yuv420p[sky]`,
    `color=c=black@0:s=320x180:r=15,format=gbrap,geq=r=255:g=228:b=200:a='${light}',scale=${WIDTH}:${HEIGHT}:flags=bicubic[light]`,
    "[sky][light]overlay,format=yuv420p[v]",
    "anullsrc=r=48000:cl=mono[a]",
  ].join(";");
}

/** A light over the colors of the sea that grows for four seconds and fades for four, to breathe along with. */
function breathingBreak(): string {
  // 0 at the start of each breath, 1 when it is deepest, and 0 again after eight seconds.
  const breath = "(1-cos(2*PI*T/8))/2";
  const light = `255*(0.2+0.3*${breath})*exp(-(pow(X-W/2,2)+pow(Y-H/2,2))/(2*pow(H*(0.15+0.08*${breath}),2)))`;
  return [
    `gradients=s=640x360:r=${RATE}:c0=0x0b2f45:c1=0x145e74:c2=0x3f9aa8:c3=0x9fd8d8:n=4:x0=0:y0=0:x1=640:y1=360:speed=0.003,scale=${WIDTH}:${HEIGHT}:flags=bicubic,format=yuv420p[sea]`,
    `color=c=black@0:s=320x180:r=15,format=gbrap,geq=r=236:g=250:b=255:a='${light}',scale=${WIDTH}:${HEIGHT}:flags=bicubic[light]`,
    "[sea][light]overlay,format=yuv420p[v]",
    "anullsrc=r=48000:cl=mono[a]",
  ].join(";");
}

// The sample videos other than the lessons of SQL in 20 lessons.
const SAMPLE_VIDEOS: Record<Exclude<VideoFile, `sql-${string}`>, SampleVideo> = {
  "tip-colors": { picture: { kind: "slides", deck: "tipColors" }, posterAt: 4.3 },
  "tip-type": { picture: { kind: "slides", deck: "tipType" }, posterAt: 4.6 },
  "tip-charts": { picture: { kind: "slides", deck: "tipCharts" }, posterAt: 4.3 },
  "update-checklist": { picture: { kind: "scroll", ...CHECKLIST_SCREENS }, posterAt: 0.5 },
  "update-pricing": { picture: { kind: "screens", screens: SCREENS.pricing }, posterAt: 7 },
  "update-beta": { picture: { kind: "slides", deck: "beta" }, posterAt: 7 },
  "q4-kickoff": { picture: { kind: "slides", deck: "kickoff" }, posterAt: 4.3 },
  "incident-summary": { picture: { kind: "slides", deck: "incident" }, posterAt: 4.3 },
  "checkout-versions": { picture: { kind: "screens", screens: SCREENS.checkout }, posterAt: 7 },
  "uploads-diagram": { picture: { kind: "slides", deck: "uploads" }, posterAt: 4.6 },
  "lobby-evening": { picture: { kind: "loop", graph: lobbyEvening }, posterAt: 6 },
  "breathing-break": { picture: { kind: "loop", graph: breathingBreak }, posterAt: 4 },
};

// The lessons of SQL in 20 lessons, each with its title and its query.
const LESSON_VIDEOS = Object.fromEntries(
  LESSONS.map((lesson, index): [VideoFile, SampleVideo] => [lesson.file, { picture: { kind: "lesson", index }, posterAt: 1.5 }]),
);

const VIDEOS = { ...SAMPLE_VIDEOS, ...LESSON_VIDEOS } as Record<VideoFile, SampleVideo>;
const unmade = Object.keys(VIDEO_SECONDS).filter((name) => !(name in VIDEOS));
if (unmade.length > 0) throw new Error(`Nothing makes the videos ${unmade.join(", ")}.`);

const VIDEO_NAMES = Object.keys(VIDEOS) as VideoFile[];

// Decks also go with their videos, as a PDF of their slides or as a PowerPoint file with a
// picture of each slide. Design tip 3 has files of many kinds, to try each viewer of the
// preview: its slides in both, its chart as a picture, and its data, checklist, and colors
// as text. The answers about the prices are a Word document, which has no preview.
type AttachmentSource =
  | { pdf: DeckName }
  | { pptx: DeckName; title: string; author: string }
  | { png: { deck: DeckName; slide: number } }
  | { docx: Answers }
  | { text: string };

const ATTACHMENTS: Record<AttachmentFile, AttachmentSource> = {
  chartSlides: { pdf: "tipCharts" },
  chartPptx: { pptx: "tipCharts", title: "Design tip 3: label the data, not the axis", author: "Mina Sato" },
  chartImage: { png: { deck: "tipCharts", slide: 1 } },
  chartData: { text: NOTES.chartData },
  chartChecklist: { text: NOTES.chartChecklist },
  chartColors: { text: NOTES.chartColors },
  chartScript: { text: NOTES.chartScript },
  uploadCode: { text: NOTES.uploadCode },
  lessonQuery: { text: NOTES.lessonQuery },
  kickoffSlides: { pptx: "kickoff", title: "Q4 kickoff", author: "Priya Nair" },
  pricingFaq: { docx: PRICING_FAQ },
  timeline: { text: NOTES.timeline },
  latency: { text: NOTES.latency },
  checklist: { text: NOTES.checklist },
  uploadSteps: { text: NOTES.uploadSteps },
};

const ATTACHMENT_KEYS = Object.keys(ATTACHMENTS) as AttachmentFile[];

interface Quality {
  crf: number;
  tune?: string;
  params?: string;
}

// Text stays sharp on still slides. Smooth gradients get adaptive quantization that
// favors dark areas, so that they do not band.
const STILL: Quality = { crf: 22, tune: "stillimage" };
const SCREEN: Quality = { crf: 23 };
const LOOP: Quality = { crf: 23, params: "aq-mode=3" };

function ffmpeg(args: string[]): void {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`ffmpeg exited with ${result.status}.`);
}

/** Silence for the sound track, as the last input. */
function silence(seconds: number): string[] {
  return ["-f", "lavfi", "-t", String(seconds), "-i", "anullsrc=r=48000:cl=mono"];
}

function still(image: string, seconds: number): string[] {
  return ["-loop", "1", "-framerate", String(RATE), "-t", seconds.toFixed(3), "-i", image];
}

// H.264 and AAC in MP4 play in every browser, and faststart lets playback begin before the file has loaded.
function encode(inputs: string[], graph: string, audio: string, seconds: number, output: string, quality: Quality): void {
  ffmpeg([
    ...inputs,
    "-filter_complex", graph,
    "-map", "[v]", "-map", audio, "-t", String(seconds),
    "-c:v", "libx264", "-preset", "slow", "-crf", String(quality.crf),
    ...(quality.tune === undefined ? [] : ["-tune", quality.tune]),
    ...(quality.params === undefined ? [] : ["-x264-params", quality.params]),
    "-pix_fmt", "yuv420p", "-r", String(RATE), "-g", String(4 * RATE),
    "-c:a", "aac", "-b:a", "32k", "-ac", "1",
    "-movflags", "+faststart", output,
  ]);
}

/** Pictures one after another, each for the same time, cross-fading into the next. */
function slideshow(images: readonly string[], seconds: number, fade: number, output: string, quality: Quality): void {
  const each = (seconds + (images.length - 1) * fade) / images.length;
  const streams = images.map((_, index) => `[${index}:v]format=yuv420p,setsar=1[s${index}]`);
  const fades = images.slice(1).map((_, index) => {
    const into = index === images.length - 2 ? "v" : `x${index + 1}`;
    const offset = ((index + 1) * (each - fade)).toFixed(3);
    return `[${index === 0 ? "s0" : `x${index}`}][s${index + 1}]xfade=transition=fade:duration=${fade}:offset=${offset}[${into}]`;
  });
  const graph = [...streams, ...(images.length === 1 ? ["[s0]null[v]"] : fades)].join(";");
  encode([...images.flatMap((image) => still(image, each)), ...silence(seconds)], graph, `${images.length}:a`, seconds, output, quality);
}

/** A document under the bar of its app, held at the top, scrolled to its end, and held there, as a screen recording shows it. */
function scroll(bar: string, document: string, seconds: number, output: string): void {
  const view = HEIGHT - DOCUMENT_BAR_HEIGHT;
  const start = 1.5;
  const length = seconds - 2 * start;
  // The scroll eases in and out, as a hand on a trackpad does.
  const top = `(ih-${view})*(1-cos(PI*min(max((t-${start})/${length},0),1)))/2`;
  const graph = [
    "[0:v]format=rgb24[bar]",
    `[1:v]crop=${WIDTH}:${view}:0:'${top}',format=rgb24[page]`,
    "[bar][page]vstack=inputs=2,format=yuv420p,setsar=1[v]",
  ].join(";");
  encode([...still(bar, seconds), ...still(document, seconds), ...silence(seconds)], graph, "2:a", seconds, output, SCREEN);
}

/** Waits for the fonts of a page, which are installed and so ready at once, so that no text falls back to another font. */
async function show(page: Page, html: string): Promise<void> {
  await page.setContent(html);
  await page.evaluate("document.fonts.ready.then(() => true)");
}

/** Draws pages at a size, each into a picture of its own, and returns the pictures. */
async function draw(page: Page, pages: readonly string[], size: { width: number; height: number }, path: (index: number) => string, options: { fullPage?: boolean; jpeg?: boolean } = {}): Promise<string[]> {
  await page.setViewportSize(size);
  const pictures: string[] = [];
  for (const [index, html] of pages.entries()) {
    await show(page, html);
    const picture = path(index);
    await page.screenshot({ path: picture, fullPage: options.fullPage ?? false, ...(options.jpeg === true ? { type: "jpeg" as const, quality: 90 } : {}) });
    pictures.push(picture);
  }
  return pictures;
}

/** A PowerPoint file with a picture of each slide, as a deck saved for the screens of an office looks. */
async function powerPoint(PptxGen: PptxGenJS, slides: readonly string[], about: { title: string; author: string }, output: string): Promise<void> {
  const deck = new PptxGen();
  // 13.333 by 7.5 inches: 16:9, like the slides.
  deck.layout = "LAYOUT_WIDE";
  deck.title = about.title;
  deck.author = about.author;
  for (const slide of slides) deck.addSlide().addImage({ path: slide, x: 0, y: 0, w: 13.333, h: 7.5 });
  await deck.writeFile({ fileName: output });
}

/** A Word document of questions and answers, with a table. */
async function wordDocument(docx: Docx, answers: Answers): Promise<Buffer> {
  const { Document, Packer, Paragraph, Table, TableRow, TableCell, HeadingLevel, WidthType } = docx;
  const cell = (text: string) => new TableCell({ children: [new Paragraph({ text })] });
  const document = new Document({
    creator: answers.author,
    title: answers.title,
    sections: [
      {
        children: [
          new Paragraph({ text: answers.title, heading: HeadingLevel.TITLE }),
          new Paragraph({ text: answers.intro }),
          new Paragraph({ text: "Prices", heading: HeadingLevel.HEADING_1 }),
          new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: answers.table.map((row) => new TableRow({ children: row.map(cell) })) }),
          new Paragraph({ text: answers.tableNote }),
          new Paragraph({ text: "Questions", heading: HeadingLevel.HEADING_1 }),
          ...answers.questions.flatMap(([question, answer]) => [
            new Paragraph({ text: question, heading: HeadingLevel.HEADING_2 }),
            new Paragraph({ text: answer }),
          ]),
        ],
      },
    ],
  });
  return Packer.toBuffer(document);
}

function prepare(site: string, path: string): string {
  const file = join(site, path);
  mkdirSync(dirname(file), { recursive: true });
  return file;
}

async function main(site: string, toolsFolder: string): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), "albireo-demo-"));
  const frame = { width: WIDTH, height: HEIGHT };
  const made: string[] = [];

  const tools = createRequire(join(toolsFolder, "package.json"));
  const { chromium } = tools("playwright") as Playwright;
  // The CommonJS build of pptxgenjs exports the class, or the class as its default.
  const pptxgenjs = tools("pptxgenjs") as PptxGenJS | { default: PptxGenJS };
  const PptxGen = "default" in pptxgenjs ? pptxgenjs.default : pptxgenjs;
  const docx = tools("docx") as Docx;
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Chromium draws the pictures of every video first. ffmpeg turns them into videos afterwards.
  console.log("Drawing the slides, the screens, the attachments, and the pictures");
  const pictures = new Map<VideoFile, string[]>();
  for (const name of VIDEO_NAMES) {
    const { picture } = VIDEOS[name];
    const into = (index: number) => join(work, `${name}-${index + 1}.png`);
    if (picture.kind === "slides") pictures.set(name, await draw(page, slidePages(DECKS[picture.deck]), frame, into));
    if (picture.kind === "lesson") {
      const lesson = LESSONS[picture.index];
      if (lesson === undefined) throw new Error(`SQL in 20 lessons has no lesson ${picture.index + 1}.`);
      pictures.set(name, await draw(page, slidePages(lessonDeck(lesson, picture.index + 1)), frame, into));
    }
    if (picture.kind === "screens") pictures.set(name, await draw(page, picture.screens, frame, into));
    if (picture.kind === "scroll") {
      const [bar = ""] = await draw(page, [picture.bar], { width: WIDTH, height: DOCUMENT_BAR_HEIGHT }, () => join(work, `${name}-bar.png`));
      const [document = ""] = await draw(page, [picture.document], { width: WIDTH, height: HEIGHT - DOCUMENT_BAR_HEIGHT }, () => join(work, `${name}-page.png`), { fullPage: true });
      pictures.set(name, [bar, document]);
    }
  }

  for (const key of ATTACHMENT_KEYS) {
    const attachment = ATTACHMENTS[key];
    const path = MEDIA_PATHS.attachment(ATTACHMENT_FILES[key].fileName);
    if ("pdf" in attachment) {
      await show(page, deckPage(DECKS[attachment.pdf]));
      await page.pdf({ path: prepare(site, path), width: `${WIDTH}px`, height: `${HEIGHT}px`, printBackground: true });
    } else if ("pptx" in attachment) {
      const slides = await draw(page, slidePages(DECKS[attachment.pptx]), frame, (index) => join(work, `${key}-${index + 1}.jpg`), { jpeg: true });
      await powerPoint(PptxGen, slides, attachment, prepare(site, path));
    } else if ("png" in attachment) {
      const slide = slidePages(DECKS[attachment.png.deck])[attachment.png.slide];
      if (slide === undefined) throw new Error(`The deck ${attachment.png.deck} has no slide ${attachment.png.slide}.`);
      await draw(page, [slide], frame, () => prepare(site, path));
    } else {
      continue;
    }
    made.push(path);
  }

  const people = createLibrary(new Date()).people;
  for (const name of PICTURE_FILES) {
    const person = people.find((candidate) => candidate.picture === name);
    if (person === undefined) throw new Error(`Nobody in the sample library has the picture ${name}.`);
    const path = MEDIA_PATHS.picture(name);
    await draw(page, [monogram(name, person.displayName)], { width: PICTURE_SIZE, height: PICTURE_SIZE }, () => prepare(site, path), { jpeg: true });
    made.push(path);
  }
  await browser.close();

  for (const name of VIDEO_NAMES) {
    const { picture, posterAt } = VIDEOS[name];
    const seconds = VIDEO_SECONDS[name];
    const drawn = pictures.get(name) ?? [];
    const path = MEDIA_PATHS.video(name);
    const output = prepare(site, path);
    console.log(`Making ${name}`);
    if (picture.kind === "slides" || picture.kind === "lesson") slideshow(drawn, seconds, SLIDE_FADE, output, STILL);
    if (picture.kind === "screens") slideshow(drawn, seconds, SCREEN_FADE, output, SCREEN);
    if (picture.kind === "scroll") scroll(drawn[0] ?? "", drawn[1] ?? "", seconds, output);
    if (picture.kind === "loop") encode([], picture.graph(), "[a]", seconds, output, LOOP);
    const poster = MEDIA_PATHS.poster(name);
    ffmpeg(["-ss", String(posterAt), "-i", output, "-frames:v", "1", "-update", "1", "-q:v", "3", prepare(site, poster)]);
    made.push(path, poster);
  }

  for (const key of ATTACHMENT_KEYS) {
    const attachment = ATTACHMENTS[key];
    const path = MEDIA_PATHS.attachment(ATTACHMENT_FILES[key].fileName);
    if ("text" in attachment) writeFileSync(prepare(site, path), attachment.text);
    else if ("docx" in attachment) writeFileSync(prepare(site, path), await wordDocument(docx, attachment.docx));
    else continue;
    made.push(path);
  }

  // The demo shows the sizes of the attachments from this list.
  const sizes = Object.fromEntries(made.map((path) => [path, statSync(join(site, path)).size]));
  writeFileSync(prepare(site, MEDIA_PATHS.sizes), `${JSON.stringify(sizes, null, 2)}\n`);
  let total = 0;
  for (const [path, size] of Object.entries(sizes)) {
    total += size;
    console.log(`${String(size).padStart(10)}  ${path}`);
  }
  console.log(`${String(total).padStart(10)}  in all`);
}

const [site, toolsFolder] = process.argv.slice(2);
if (site === undefined || toolsFolder === undefined) {
  console.error("Usage: node scripts/demo-media.ts <folder of the demo build> <folder of the tools>");
  process.exit(1);
}
await main(site, toolsFolder);
