// Makes the files of the demo on GitHub Pages that src/demo/media.ts names: a short video
// and a poster for each sample video, the pictures of the people, and the attachments.
// The pictures come from the test sources of ffmpeg and from drawn boxes, without text,
// so the demo needs no footage, no fonts, and no licenses. Meetings and lectures are
// drawn as they look on a screen: slides with a camera in the corner, a call of four
// people, a shared screen, and phones on a desk. The Pages workflow runs this after the
// demo build, with ffmpeg on the PATH:
//   node scripts/demo-media.ts demo-dist

import { spawnSync } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEMO_FILES } from "../src/demo/files.ts";
import { MEDIA_PATHS, PICTURE_FILES, VIDEO_FILES, type VideoFile } from "../src/demo/media.ts";

const WIDTH = 1280;
const HEIGHT = 720;
const RATE = 30;

interface SampleVideo {
  seconds: number;
  /** The moment of the poster, after the slides have built up. */
  posterAt: number;
  /** A filter graph whose output [v] is the picture. */
  picture: string;
  /** The pitch of the quiet tone that stands in for the sound, in hertz. */
  tone: number;
  /** The level of the tone: about -28 dBFS, and about -20 dBFS for the tone of the color bars. */
  volume?: number;
}

/** The colors of a person on camera, as hexadecimal RGB. */
interface Face {
  top: string;
  bottom: string;
  skin: string;
  hair: string;
  shirt: string;
}

// The people of the sample library (src/demo/data.ts), including those without a picture,
// who still turn up in meetings.
const FACES = {
  alex: { top: "8fb8f6", bottom: "5a8ee0", skin: "f0c7a0", hair: "4b3621", shirt: "1d3557" },
  mina: { top: "ffd8b0", bottom: "ffb27a", skin: "f3d2b8", hair: "1c1917", shirt: "c2410c" },
  daniel: { top: "bfe6cc", bottom: "7cc495", skin: "8d5524", hair: "111111", shirt: "f4f1de" },
  priya: { top: "d9c7fb", bottom: "b197fc", skin: "c68642", hair: "2b1d14", shirt: "3b2e8a" },
  jonas: { top: "fff1b8", bottom: "ffd866", skin: "ffdbac", hair: "b08d57", shirt: "495057" },
  lucia: { top: "ffcfcf", bottom: "ff9f9f", skin: "e0ac69", hair: "5c3a21", shirt: "0b7285" },
  kenji: { top: "c6f6e6", bottom: "8ee6c8", skin: "f1c27d", hair: "0b0b0b", shirt: "343a40" },
} satisfies Record<string, Face>;

type Person = keyof typeof FACES;

/** The colors of a deck of slides. */
interface Theme {
  background: string;
  band: string;
  accent: string;
  text: string;
  muted: string;
  light: string;
}

const COURSE: Theme = { background: "f8fafc", band: "1b2a4a", accent: "533afd", text: "1a2c44", muted: "a3acba", light: "eae7ff" };
const ALL_HANDS: Theme = { background: "ffffff", band: "0e7490", accent: "0e7490", text: "1a2c44", muted: "a3acba", light: "ecfeff" };
const INCIDENT: Theme = { background: "fafafa", band: "b42318", accent: "b42318", text: "1a2c44", muted: "a3acba", light: "fef3f2" };

/** A filled box, shown from a time on when `from` is given. */
function box(x: number, y: number, width: number, height: number, color: string, from?: number): string {
  const enable = from === undefined ? "" : `:enable='gte(t,${from})'`;
  return `drawbox=x=${x}:y=${y}:w=${width}:h=${height}:color=${color}:t=fill${enable}`;
}

/** The outline of a box, shown while `enable` holds when it is given. */
function outline(x: number, y: number, width: number, height: number, color: string, thickness: number, enable?: string): string {
  return `drawbox=x=${x}:y=${y}:w=${width}:h=${height}:color=${color}:t=${thickness}${enable === undefined ? "" : `:enable='${enable}'`}`;
}

/** Lines of a slide, each after a small square, that appear one after another. */
function bullets(x: number, y: number, widths: readonly number[], theme: Theme, from: readonly number[]): string[] {
  return widths.flatMap((width, index) => {
    const top = y + index * 44;
    return [box(x, top + 2, 12, 12, `0x${theme.accent}`, from[index]), box(x + 26, top, width, 16, `0x${theme.muted}`, from[index])];
  });
}

/**
 * A person from the shoulders up, in front of a soft background, as a webcam shows them.
 * The head sways a little, as people do on camera. ffmpeg draws it pixel by pixel, so the
 * picture is small and is scaled up, which also softens it like a webcam.
 */
function face(person: Person, width: number, height: number, phase: number): string {
  const colors = FACES[person];
  const cy = `(H*0.42+H*0.012*sin(T*1.7+${phase}))`;
  const r = "(H*0.17)";
  const head = `lte(hypot(X-W/2,Y-${cy}),${r})`;
  const hair = `lt(Y,${cy}-${r}*0.3)`;
  const body = "lte(pow((X-W/2)/(W*0.3),2)+pow((Y-H*1.02)/(H*0.42),2),1)";
  const channel = (offset: number) => {
    const value = (hex: string) => Number.parseInt(hex.slice(offset, offset + 2), 16);
    const top = value(colors.top);
    return `if(${head},if(${hair},${value(colors.hair)},${value(colors.skin)}),if(${body},${value(colors.shirt)},${top}+(${value(colors.bottom) - top})*Y/H))`;
  };
  return `color=c=black:s=${width}x${height}:r=15,format=gbrp,geq=r='${channel(0)}':g='${channel(2)}':b='${channel(4)}'`;
}

/** A camera in the corner of slides, with a white edge. */
function camera(person: Person): { graph: string; place: string } {
  return {
    graph: `${face(person, 192, 108, 0.6)},scale=256:144:flags=bicubic[camera]`,
    place: `overlay=x=984:y=544,${outline(984, 544, 256, 144, "white", 3)}`,
  };
}

/**
 * A lecture: a slide with a moving picture on the left, points that appear on the right,
 * and the lecturer in the corner.
 */
function lecture(panel: string, speaker: Person, theme: Theme): string {
  const speakerCamera = camera(speaker);
  const slide = [
    `color=c=0x${theme.background}:s=${WIDTH}x${HEIGHT}:r=${RATE}`,
    box(0, 0, WIDTH, 96, `0x${theme.band}`),
    box(56, 32, 520, 32, "white@0.9"),
    box(896, 150, 300, 22, `0x${theme.text}`),
    ...bullets(896, 206, [280, 240, 300, 210], theme, [1, 2.5, 4, 5.5]),
    box(896, 400, 344, 96, `0x${theme.light}`, 6.5),
    box(912, 424, 260, 12, `0x${theme.accent}`, 6.5),
    box(912, 452, 200, 12, `0x${theme.accent}`, 6.5),
    box(56, 606, 380, 14, `0x${theme.muted}`),
    box(56, 662, 120, 10, `0x${theme.muted}`),
  ].join(",");
  return [
    `${slide}[slide]`,
    `${panel},setsar=1[panel]`,
    speakerCamera.graph,
    `[slide][panel]overlay=x=56:y=136,${outline(55, 135, 802, 452, `0x${theme.muted}`, 1)}[lecture]`,
    `[lecture][camera]${speakerCamera.place}[v]`,
  ].join(";");
}

/** Slides of the all-hands: weekly numbers that grow bar by bar, and three key figures. */
function allHands(): string {
  const weekly = [42, 45, 47, 51, 50, 56, 61, 64, 66, 71, 75, 78, 84];
  const speakerCamera = camera("priya");
  const slide = [
    `color=c=0x${ALL_HANDS.background}:s=${WIDTH}x${HEIGHT}:r=${RATE}`,
    box(0, 0, WIDTH, 96, `0x${ALL_HANDS.band}`),
    box(56, 32, 460, 32, "white@0.9"),
    box(96, 126, 360, 14, `0x${ALL_HANDS.muted}`),
    ...[1, 2, 3, 4].map((line) => box(98, 570 - line * 100, 718, 1, "0xe5e7eb")),
    box(96, 150, 2, 422, `0x${ALL_HANDS.text}`),
    box(96, 570, 720, 2, `0x${ALL_HANDS.text}`),
    ...weekly.map((teams, index) =>
      box(112 + index * 54, 570 - teams * 5, 40, teams * 5, index === weekly.length - 1 ? "0xf59e0b" : `0x${ALL_HANDS.accent}`, 0.3 + index * 0.4),
    ),
    ...[0, 1, 2].flatMap((index) => {
      const top = 150 + index * 120;
      const from = 5.5 + index * 0.7;
      return [
        box(860, top, 380, 100, `0x${ALL_HANDS.light}`, from),
        box(860, top, 6, 100, `0x${ALL_HANDS.accent}`, from),
        box(884, top + 24, 140, 30, `0x${ALL_HANDS.text}`, from),
        box(884, top + 66, 200, 12, `0x${ALL_HANDS.muted}`, from),
      ];
    }),
  ].join(",");
  return [`${slide}[slide]`, speakerCamera.graph, `[slide][camera]${speakerCamera.place}[v]`].join(";");
}

/** Slides of the incident review: a timeline with a moving playhead, and action items that get done. */
function incidentReview(seconds: number): string {
  const speakerCamera = camera("priya");
  const latency = [4, 5, 5, 6, 30, 52, 60, 56, 44, 38, 32, 18, 7, 5, 5, 4, 4, 5, 4, 4, 5, 4, 4, 4];
  const slide = [
    `color=c=0x${INCIDENT.background}:s=${WIDTH}x${HEIGHT}:r=${RATE}`,
    box(0, 0, WIDTH, 96, `0x${INCIDENT.band}`),
    box(56, 32, 560, 32, "white@0.9"),
    box(80, 150, 240, 16, `0x${INCIDENT.text}`),
    // Normal, down, recovering, and normal again.
    box(80, 220, 440, 28, "0x16a34a"),
    box(520, 220, 240, 28, "0xdc2626"),
    box(760, 220, 140, 28, "0xf59e0b"),
    box(900, 220, 300, 28, "0x16a34a"),
    ...Array.from({ length: 15 }, (_, index) => box(80 + index * 80, 256, 2, 10, `0x${INCIDENT.muted}`)),
    box(520, 192, 2, 24, `0x${INCIDENT.text}`),
    box(900, 192, 2, 24, `0x${INCIDENT.text}`),
    ...[0, 1, 2].flatMap((index) => {
      const top = 330 + index * 60;
      const done = [3.5, 6, undefined][index];
      return [
        outline(80, top, 24, 24, `0x${INCIDENT.muted}`, 3),
        box(120, top + 6, [420, 360, 400][index] ?? 400, 12, `0x${INCIDENT.muted}`),
        ...(done === undefined ? [] : [box(86, top + 6, 12, 12, "0x16a34a", done)]),
      ];
    }),
    box(640, 320, 300, 170, "white"),
    outline(640, 320, 300, 170, "0xe5e7eb", 2),
    ...latency.map((value, index) => box(656 + index * 11, 470 - value * 2, 7, value * 2, value > 20 ? "0xdc2626" : `0x${INCIDENT.muted}`)),
  ].join(",");
  return [
    `${slide}[slide]`,
    `color=c=0x111827:s=4x80:r=${RATE}[playhead]`,
    speakerCamera.graph,
    `[slide][playhead]overlay=x='78+${1120 / seconds}*t':y=194[timeline]`,
    `[timeline][camera]${speakerCamera.place}[v]`,
  ].join(";");
}

/** A call of four people, with the edge of whoever speaks lit up in turn. */
function call(people: readonly [Person, Person, Person, Person], turns: readonly number[], seconds: number): string {
  const spots = [
    [16, 16],
    [644, 16],
    [16, 364],
    [644, 364],
  ] as const;
  const turn = seconds / turns.length;
  const speaking = turns.map((speaker, index) => {
    const [x, y] = spots[speaker] ?? spots[0];
    return outline(x, y, 620, 340, "0x34d399", 6, `between(t,${index * turn},${(index + 1) * turn})`);
  });
  return [
    `color=c=0x16181d:s=${WIDTH}x${HEIGHT}:r=${RATE}[call0]`,
    ...people.map((person, index) => `${face(person, 248, 136, index * 1.3)},scale=620:340:flags=bicubic[face${index}]`),
    ...spots.map(([x, y], index) => `[call${index}][face${index}]overlay=x=${x}:y=${y}${index === 3 ? `,${speaking.join(",")}[v]` : `[call${index + 1}]`}`),
  ].join(";");
}

/** A shared screen of the new pricing page, with the people of the call and their chat beside it. */
function pricingReview(seconds: number): string {
  const cards = [76, 370, 664].flatMap((x, index) => {
    const chosen = index === 1;
    return [
      box(x, 260, 260, 340, "white"),
      outline(x, 260, 260, 340, chosen ? "0x533afd" : "0xd4dee9", chosen ? 4 : 2, chosen ? "gte(t,2)" : undefined),
      ...(chosen ? [outline(x, 260, 260, 340, "0xd4dee9", 2, "lt(t,2)"), box(x + 50, 248, 160, 24, "0x533afd", 3)] : []),
      box(x + 24, 290, 120, 14, "0xa3acba"),
      box(x + 24, 324, 140, 36, "0x1a2c44"),
      ...[200, 180, 190, 150].map((width, line) => box(x + 24, 390 + line * 26, width, 10, "0xc4ccd8")),
      chosen ? box(x + 24, 540, 212, 36, "0x533afd") : outline(x + 24, 540, 212, 36, "0xa3acba", 2),
    ];
  });
  const screen = [
    `color=c=0x2b2d33:s=${WIDTH}x${HEIGHT}:r=${RATE}`,
    box(24, 24, 952, 672, "0xf8f9fb"),
    box(24, 24, 952, 40, "0xe4e7ec"),
    ...["0xff5f57", "0xfebc2e", "0x28c840"].map((color, index) => box(44 + index * 20, 38, 12, 12, color)),
    box(120, 32, 600, 24, "white"),
    box(56, 88, 28, 28, "0x533afd"),
    ...[0, 1, 2].map((index) => box(640 + index * 90, 98, 64, 10, "0xa3acba")),
    box(300, 160, 400, 28, "0x1a2c44"),
    box(340, 204, 320, 14, "0xa3acba"),
    ...cards,
    // The chat beside the call, which fills up as people write.
    box(1000, 504, 256, 192, "white"),
    ...[0, 1, 2].flatMap((index) => [
      box(1016, 520 + index * 56, 20, 20, ["0x5a8ee0", "0xffb27a", "0xffd866"][index] ?? "0x5a8ee0", 1.5 + index * 2.5),
      box(1044, 522 + index * 56, [180, 150, 170][index] ?? 160, 8, "0xa3acba", 1.5 + index * 2.5),
      box(1044, 538 + index * 56, [120, 160, 90][index] ?? 120, 8, "0xc4ccd8", 1.5 + index * 2.5),
    ]),
  ].join(",");
  const strip = (["alex", "mina", "jonas"] as const).map((person, index) => `${face(person, 192, 108, index * 1.1)},scale=256:144:flags=bicubic[strip${index}]`);
  const turn = seconds / 3;
  return [
    `${screen}[screen0]`,
    ...strip,
    ...[0, 1, 2].map((index) => {
      const y = 24 + index * 160;
      const last = index === 2;
      return `[screen${index}][strip${index}]overlay=x=1000:y=${y},${outline(1000, y, 256, 144, "0x34d399", 4, `between(t,${index * turn},${(index + 1) * turn})`)}${last ? "[v]" : `[screen${index + 1}]`}`;
    }),
  ].join(";");
}

/** Three versions of a checkout on phones, with the chosen one marked and a note beside it. */
function designReview(): string {
  // The first version keeps the total and the button at the end of the list, the second
  // keeps them in a bar at the bottom of the screen, and the third puts the button first.
  const phones = [205, 515, 825].flatMap((x, index) => {
    const y = 70;
    const sx = x + 10;
    const sy = y + 14;
    const accent = ["0x64748b", "0x533afd", "0x0e7490"][index] ?? "0x533afd";
    const rows = index === 2 ? 252 : 196;
    const footer =
      index === 1
        ? [box(sx, sy + 348, 230, 84, "0xe9edf3"), box(sx + 16, sy + 358, 70, 14, "0x1a2c44"), box(sx + 150, sy + 356, 64, 18, "0x1a2c44"), box(sx + 16, sy + 384, 198, 36, accent)]
        : index === 0
          ? [box(sx + 16, sy + 336, 70, 14, "0x1a2c44"), box(sx + 150, sy + 334, 64, 18, "0x1a2c44"), box(sx + 16, sy + 384, 198, 36, accent)]
          : [box(sx + 16, sy + 200, 198, 36, accent), box(sx + 16, sy + 392, 70, 14, "0x1a2c44"), box(sx + 150, sy + 390, 64, 18, "0x1a2c44")];
    return [
      box(x, y, 250, 460, "0x0b0c0f"),
      box(sx, sy, 230, 432, "0xf7f8fa"),
      box(x + 95, y + 6, 60, 6, "0x2a2d34"),
      box(sx, sy + 18, 230, 44, accent),
      box(sx + 16, sy + 76, 198, 100, "0xdfe4ec"),
      box(sx + 30, sy + 90, 60, 60, "0xc7d2fe"),
      ...[0, 1, 2].flatMap((row) => [
        box(sx + 16, sy + rows + row * 36, 110, 10, "0x9aa5b4"),
        box(sx + 170, sy + rows + row * 36, 44, 10, "0x1a2c44"),
      ]),
      box(sx + 16, sy + rows + 124, 198, 2, "0xe2e8f0"),
      ...footer,
    ];
  });
  const speakerCamera = camera("mina");
  const desk = [
    `color=c=0x1f2229:s=${WIDTH}x${HEIGHT}:r=${RATE}`,
    ...phones,
    outline(500, 60, 280, 480, "0x34d399", 4, "gte(t,2)"),
    box(1090, 100, 170, 120, "0xfde68a", 4),
    ...[0, 1, 2].map((line) => box(1106, 122 + line * 26, [134, 112, 90][line] ?? 112, 10, "0x92400e", 4)),
  ].join(",");
  return [`${desk}[desk]`, speakerCamera.graph, `[desk][camera]${speakerCamera.place}[v]`].join(";");
}

const VIDEOS: Record<VideoFile, SampleVideo> = {
  "cellular-automata": {
    seconds: 10,
    posterAt: 8,
    tone: 220,
    picture: lecture(
      // Rule 110 from random cells, one new row at the bottom of each frame, in the colors of the course.
      "cellauto=rule=110:s=160x90:r=12:full=1:seed=11,format=rgb24," +
        "lutrgb=r='if(gt(val,127),83,234)':g='if(gt(val,127),58,231)':b='if(gt(val,127),253,255)',scale=800:450:flags=neighbor",
      "daniel",
      COURSE,
    ),
  },
  "game-of-life": {
    seconds: 10,
    posterAt: 8,
    tone: 247,
    picture: lecture(
      "life=s=160x90:r=10:ratio=0.3:seed=7:mold=24:life_color=0x533afd:death_color=0xf59e0b:mold_color=0xeae7ff,scale=800:450:flags=neighbor",
      "daniel",
      COURSE,
    ),
  },
  mandelbrot: {
    seconds: 12,
    posterAt: 10,
    tone: 262,
    picture: lecture(
      `mandelbrot=s=400x225:r=${RATE}:maxiter=1500:start_scale=3:end_scale=0.06:end_pts=${12 * RATE},scale=800:450:flags=bicubic`,
      "daniel",
      COURSE,
    ),
  },
  gradients: {
    seconds: 8,
    posterAt: 6,
    tone: 294,
    picture: lecture(
      `gradients=s=800x450:r=${RATE}:c0=0x533afd:c1=0x06b6d4:c2=0xf59e0b:c3=0xec4899:n=4:speed=0.03:seed=3`,
      "daniel",
      COURSE,
    ),
  },
  "sync-launch": { seconds: 10, posterAt: 7, tone: 196, picture: call(["alex", "mina", "jonas", "priya"], [0, 2, 1, 3], 10) },
  "sync-pricing": { seconds: 10, posterAt: 8, tone: 208, picture: pricingReview(10) },
  "sync-beta": { seconds: 10, posterAt: 4, tone: 185, picture: call(["alex", "kenji", "lucia", "jonas"], [1, 0, 3, 2], 10) },
  "all-hands": { seconds: 10, posterAt: 8.5, tone: 233, picture: allHands() },
  "incident-review": { seconds: 10, posterAt: 8, tone: 175, picture: incidentReview(10) },
  "design-review": { seconds: 9, posterAt: 7, tone: 330, picture: designReview() },
  "color-bars": { seconds: 6, posterAt: 3, tone: 1000, volume: 0.8, picture: `smptehdbars=s=${WIDTH}x${HEIGHT}:r=${RATE}[v]` },
  "encoder-test": { seconds: 8, posterAt: 4, tone: 440, picture: `testsrc2=s=${WIDTH}x${HEIGHT}:r=${RATE}[v]` },
};

function ffmpeg(args: string[]): void {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`ffmpeg exited with ${result.status}.`);
}

function prepare(site: string, path: string): string {
  const file = join(site, path);
  mkdirSync(dirname(file), { recursive: true });
  return file;
}

function main(site: string): void {
  const made: string[] = [];

  for (const name of VIDEO_FILES) {
    const video = VIDEOS[name];
    const output = prepare(site, MEDIA_PATHS.video(name));
    const sound =
      `sine=f=${video.tone}:r=48000,volume=${video.volume ?? 0.3},` +
      `afade=t=in:d=0.5,afade=t=out:st=${video.seconds - 0.8}:d=0.8[a]`;
    console.log(`Making ${name}`);
    // H.264 and AAC in MP4 play in every browser, and faststart lets playback begin before the file has loaded.
    ffmpeg([
      "-filter_complex", `${video.picture};${sound}`,
      "-map", "[v]", "-map", "[a]", "-t", String(video.seconds),
      "-c:v", "libx264", "-preset", "slow", "-crf", "28", "-maxrate", "1200k", "-bufsize", "2400k",
      "-pix_fmt", "yuv420p", "-r", String(RATE), "-g", String(4 * RATE),
      "-c:a", "aac", "-b:a", "48k", "-ac", "1",
      "-movflags", "+faststart", output,
    ]);
    const poster = prepare(site, MEDIA_PATHS.poster(name));
    ffmpeg(["-ss", String(video.posterAt), "-i", output, "-frames:v", "1", "-update", "1", "-q:v", "4", poster]);
    made.push(output, poster);
  }

  for (const name of PICTURE_FILES) {
    const picture = prepare(site, MEDIA_PATHS.picture(name));
    ffmpeg(["-filter_complex", `${face(name, 256, 256, 0)}[v]`, "-map", "[v]", "-frames:v", "1", "-update", "1", "-q:v", "3", picture]);
    made.push(picture);
  }

  for (const file of Object.values(DEMO_FILES)) {
    const path = prepare(site, MEDIA_PATHS.attachment(file.fileName));
    writeFileSync(path, file.text);
    made.push(path);
  }

  let total = 0;
  for (const file of made) {
    const { size } = statSync(file);
    total += size;
    console.log(`${String(size).padStart(10)}  ${file}`);
  }
  console.log(`${String(total).padStart(10)}  in all`);
}

const [site] = process.argv.slice(2);
if (site === undefined) {
  console.error("Usage: node scripts/demo-media.ts <folder of the demo build>");
  process.exit(1);
}
main(site);
