// The made-up library of the demo on GitHub Pages: seven people at a small company, the
// meetings and lectures that they recorded, two series, comments, ratings, and the
// history of Alex Morgan, the admin who is signed in. Every date counts back from the
// moment that the page opened, so the library always looks recent.
//
// The lengths are those of the recordings that the samples stand for. The sample files
// themselves last a few seconds, so the times in the comments stay within them.

import type { Language, Session, SignIn } from "../../shared/api.ts";
import type { DemoFileKey } from "./files.ts";
import type { PictureFile, VideoFile } from "./media.ts";

export interface DemoPerson {
  id: string;
  displayName: string;
  bio: string;
  picture: PictureFile | null;
}

export interface DemoAttachment {
  id: string;
  file: DemoFileKey;
  createdAt: string;
}

export interface DemoVideo {
  id: string;
  title: string;
  description: string;
  durationSec: number;
  createdAt: string;
  updatedAt: string;
  uploaderId: string;
  seriesId: string | null;
  /** The place in the series. Episodes are numbered in this order. */
  seriesPosition: number | null;
  media: VideoFile;
  attachments: DemoAttachment[];
}

export interface DemoSeries {
  id: string;
  title: string;
  description: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface DemoComment {
  id: string;
  videoId: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export interface DemoRating {
  videoId: string;
  personId: string;
  stars: number;
}

export interface DemoWatch {
  videoId: string;
  watchedAt: string;
}

export interface DemoLibrary {
  /** The person who is signed in. Their name, bio, and picture are among the people. */
  me: { id: string; email: string; isAdmin: boolean; joinedAt: string; language: Language };
  people: DemoPerson[];
  videos: DemoVideo[];
  series: DemoSeries[];
  comments: DemoComment[];
  ratings: DemoRating[];
  history: DemoWatch[];
  signIn: SignIn;
  sessions: Session[];
}

const PEOPLE = {
  alex: "u1x7k3m9c5v2q8wb",
  mina: "u6p2r8t4n1z9h3jd",
  daniel: "u9c4w1q7x3m8k2vf",
  priya: "u3h8z5n2p9t1r6ky",
  jonas: "u7m3v9k1w6c4x2qe",
  lucia: "u2t6q1r8z4n9p5ma",
  kenji: "u5k9x2c7m3w8v1hn",
};

const VIDEOS = {
  cellular: "k2f9x7q4m1v8c3np",
  life: "r5t1w8z3b6n2h9ld",
  mandelbrot: "p7c3m9x1q5v2j8tb",
  gradients: "f4n8r2k6w1z9s3gy",
  launch: "h9b2q6v1t8m4x3wc",
  pricing: "d3x8w5n1p7k2r9mf",
  beta: "w6m1t4z9c3q8v2hk",
  allHands: "a8v3k7p2x6n1w5qe",
  incident: "j1q9r4c8m2t6z3vs",
  design: "n5z2h8x3w7k1c9pr",
  colorBars: "b7k4w1q9n3x6t2mz",
  encoder: "e2p6v9m4c1z8k5rt",
};

const SERIES = {
  patterns: "s8k3p1x6v9m2c7wb",
  sync: "t4n9z2q7h1w5r8dk",
};

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
// Cloudflare Access keeps a person signed in for the session duration of the application.
const SESSION_MS = 30 * DAY_MS;

/** A new copy of the library, dated back from now. */
export function createLibrary(now: Date): DemoLibrary {
  const ago = (days: number, hours = 0) => new Date(now.getTime() - days * DAY_MS - hours * HOUR_MS).toISOString();
  const later = (days: number, hours = 0) => new Date(now.getTime() + days * DAY_MS + hours * HOUR_MS).toISOString();

  let next = 0;
  // IDs of comments and attachments, which no address shows.
  const id = (prefix: "c" | "f") => `${prefix}${String((next += 1)).padStart(15, "0")}`;

  const video = (
    key: keyof typeof VIDEOS,
    fields: Omit<DemoVideo, "id" | "updatedAt" | "seriesId" | "seriesPosition" | "attachments"> & {
      series?: [key: keyof typeof SERIES, position: number];
      attachments?: DemoFileKey[];
    },
  ): DemoVideo => {
    const { series, attachments = [], ...rest } = fields;
    return {
      ...rest,
      id: VIDEOS[key],
      updatedAt: fields.createdAt,
      seriesId: series === undefined ? null : SERIES[series[0]],
      seriesPosition: series === undefined ? null : series[1],
      attachments: attachments.map((file) => ({ id: id("f"), file, createdAt: fields.createdAt })),
    };
  };

  const comment = (on: keyof typeof VIDEOS, by: keyof typeof PEOPLE, createdAt: string, body: string): DemoComment => ({
    id: id("c"),
    videoId: VIDEOS[on],
    authorId: PEOPLE[by],
    body,
    createdAt,
  });

  // Each video with the people who rated it and their stars.
  const stars: [keyof typeof VIDEOS, [keyof typeof PEOPLE, number][]][] = [
    ["cellular", [["mina", 5], ["kenji", 4], ["jonas", 5], ["alex", 5]]],
    ["life", [["mina", 4], ["priya", 5], ["lucia", 4], ["alex", 4]]],
    ["mandelbrot", [["mina", 5], ["priya", 5], ["jonas", 4], ["lucia", 5]]],
    ["gradients", [["mina", 5], ["kenji", 4]]],
    ["launch", [["jonas", 4], ["lucia", 4]]],
    ["pricing", [["mina", 5], ["jonas", 4], ["alex", 4]]],
    ["allHands", [["mina", 4], ["daniel", 5], ["jonas", 4], ["lucia", 5], ["kenji", 4], ["alex", 4]]],
    ["incident", [["daniel", 5], ["jonas", 4]]],
    ["design", [["lucia", 4], ["alex", 5]]],
    ["colorBars", [["daniel", 4]]],
  ];

  return {
    me: { id: PEOPLE.alex, email: "you@example.com", isAdmin: true, joinedAt: ago(412), language: "en" },
    people: [
      {
        id: PEOPLE.alex,
        displayName: "Alex Morgan",
        bio: "Product manager. I post the recording of every weekly product sync, with the decisions in the description.",
        picture: "alex",
      },
      {
        id: PEOPLE.mina,
        displayName: "Mina Sato",
        bio: "Product designer. Design reviews, prototypes, and now and then a test of the studio.",
        picture: "mina",
      },
      {
        id: PEOPLE.daniel,
        displayName: "Daniel Okafor",
        bio: "Engineer. On Thursdays I teach Patterns in computation: small rules that draw big pictures.",
        picture: "daniel",
      },
      {
        id: PEOPLE.priya,
        displayName: "Priya Nair",
        bio: "Head of operations. All-hands, incident reviews, and the runbooks behind them.",
        picture: null,
      },
      { id: PEOPLE.jonas, displayName: "Jonas Weber", bio: "Backend engineer. Uploads, storage, and anything that retries.", picture: "jonas" },
      { id: PEOPLE.lucia, displayName: "Lucía Fernández", bio: "Marketing. I write the launch posts and the help center.", picture: null },
      { id: PEOPLE.kenji, displayName: "Kenji Ito", bio: "Support lead. I bring what customers ask to the product sync.", picture: "kenji" },
    ],
    videos: [
      video("cellular", {
        title: "Cellular automata, one row at a time",
        description:
          "Lecture 1 of Patterns in computation. A row of cells, a rule of eight bits, and the pictures that grow from them: rule 30, rule 90, and rule 110, which can compute anything.\n\nThe table of rule 110 from the whiteboard is attached.",
        durationSec: 3108,
        createdAt: ago(34, 3),
        uploaderId: PEOPLE.daniel,
        media: "cellular-automata",
        series: ["patterns", 1],
        attachments: ["ruleTable"],
      }),
      video("life", {
        title: "The Game of Life",
        description:
          "Lecture 2. Conway's Game of Life on a grid that wraps around: births, deaths, and the gliders and oscillators that come out of four rules. The orange cells in the demo are the ones that just died.",
        durationSec: 2917,
        createdAt: ago(27, 3),
        uploaderId: PEOPLE.daniel,
        media: "game-of-life",
        series: ["patterns", 2],
      }),
      video("mandelbrot", {
        title: "Fractals: zooming into the Mandelbrot set",
        description:
          "Lecture 3. One rule, z → z² + c, and a picture without an end. We count how fast each point escapes, color the counts, and zoom into seahorse valley.\n\nThe slides and the exercises are attached.",
        durationSec: 3302,
        createdAt: ago(20, 3),
        uploaderId: PEOPLE.daniel,
        media: "mandelbrot",
        series: ["patterns", 3],
        attachments: ["mandelbrotSlides", "exercises"],
      }),
      video("gradients", {
        title: "Noise, gradients, and color spaces",
        description:
          "Lecture 4. How a gradient moves between colors, why the middle of a gradient in RGB looks muddy, and how mixing in a perceptual space such as OKLCH keeps it bright.",
        durationSec: 2781,
        createdAt: ago(13, 3),
        uploaderId: PEOPLE.daniel,
        media: "gradients",
        series: ["patterns", 4],
      }),
      video("launch", {
        title: "Product sync: launch checklist",
        description:
          "We went through the launch checklist. The copy of the pricing page is frozen, and the upload test passed with a 4 GB recording. The walkthrough for the help center still needs a recording. The checklist is attached.",
        durationSec: 1908,
        createdAt: ago(15, 6),
        uploaderId: PEOPLE.alex,
        media: "sync-launch",
        series: ["sync", 1],
        attachments: ["checklist"],
      }),
      video("pricing", {
        title: "Product sync: pricing page review",
        description:
          "Mina shared the new pricing page. We agreed on three plans and a yearly switch, and the table that compares the plans moves under the cards.",
        durationSec: 1685,
        createdAt: ago(8, 6),
        uploaderId: PEOPLE.alex,
        media: "sync-pricing",
        series: ["sync", 2],
      }),
      video("beta", {
        title: "Product sync: beta feedback",
        description:
          "Twelve teams joined the beta. The top requests: sharing a series with people outside the library, and chapters in long recordings. Kenji summed up the support tickets.",
        durationSec: 2000,
        createdAt: ago(1, 6),
        uploaderId: PEOPLE.alex,
        media: "sync-beta",
        series: ["sync", 3],
      }),
      video("allHands", {
        title: "All-hands: Q4 kickoff",
        description: "Where Q3 landed, the three goals for Q4, and questions from everyone. The slides are attached.",
        durationSec: 3765,
        createdAt: ago(38, 2),
        uploaderId: PEOPLE.priya,
        media: "all-hands",
        attachments: ["kickoffSlides"],
      }),
      video("incident", {
        title: "Incident review: object storage latency",
        description:
          "Uploads and playback were slow for 47 minutes on Tuesday. We go through the timeline, what went well, and three action items. Blameless, as always.",
        durationSec: 1452,
        createdAt: ago(5, 4),
        uploaderId: PEOPLE.priya,
        media: "incident-review",
        attachments: ["timeline", "latency"],
      }),
      video("design", {
        title: "Design review: mobile checkout",
        description:
          "Three versions of the checkout on a phone. We picked the middle one: the total stays in view, and the pay button stays under the thumb.",
        durationSec: 1120,
        createdAt: ago(3, 5),
        uploaderId: PEOPLE.mina,
        media: "design-review",
      }),
      video("colorBars", {
        title: "Studio check: color bars and tone",
        description: "Bars and a 1 kHz tone from the new studio, to check the monitors and the levels before we record the course.",
        durationSec: 120,
        createdAt: ago(22, 1),
        uploaderId: PEOPLE.mina,
        media: "color-bars",
      }),
      video("encoder", {
        title: "Encoder test: moving patterns at CRF 28",
        description: "A test pattern through the encoder at CRF 28. Watch the counter and the moving gradients for banding.",
        durationSec: 256,
        createdAt: ago(10, 2),
        uploaderId: PEOPLE.daniel,
        media: "encoder-test",
      }),
    ],
    series: [
      {
        id: SERIES.patterns,
        title: "Patterns in computation",
        description:
          "A short course on the patterns that simple rules make: cellular automata, the Game of Life, fractals, and gradients. A new lecture every Thursday.",
        ownerId: PEOPLE.daniel,
        createdAt: ago(35),
        updatedAt: ago(13, 3),
      },
      {
        id: SERIES.sync,
        title: "Weekly product sync",
        description: "The weekly sync of the product team. The decisions are in the description of each recording, and the notes are attached.",
        ownerId: PEOPLE.alex,
        createdAt: ago(15, 6),
        updatedAt: ago(1, 6),
      },
    ],
    comments: [
      comment("cellular", "jonas", ago(33, 20), "Is the pattern at 0:04 rule 110? The triangles look like the ones on the whiteboard."),
      comment("cellular", "daniel", ago(33, 18), "It is. Rule 110 gets its own exercise next week."),
      comment("cellular", "kenji", ago(32, 2), "I ran rule 30 from a single cell after this. The left half is so regular, and the right half looks like noise."),
      comment("life", "priya", ago(26, 4), "Sharing this with the new hires. It's the best explanation of emergent behavior that I know."),
      comment("life", "lucia", ago(25, 22), "The gliders at 0:06 are hypnotic."),
      comment("mandelbrot", "jonas", ago(19, 20), "Exercise 2 took me 3,000 steps before the picture stopped changing."),
      comment("mandelbrot", "kenji", ago(19, 6), "0:05 is where the zoom passes the first spiral. I paused there for a long time."),
      comment("mandelbrot", "mina", ago(18, 9), "The palette on page 4 of the slides is lovely. Can I borrow it for the brand refresh?"),
      comment("mandelbrot", "daniel", ago(18, 7), "Of course, Mina. The colors are on page 4, and I'll add their hex values to the exercises."),
      comment("gradients", "mina", ago(12, 5), "Finally an answer to why our blue-to-yellow gradient turned gray in the middle."),
      comment("launch", "lucia", ago(14, 20), "I'll record the walkthrough for the help center and post it here by Friday."),
      comment("pricing", "jonas", ago(7, 22), "The highlighted card at 0:03: do we have data that it's the most popular plan?"),
      comment("pricing", "mina", ago(7, 20), "Good point. I'll change the badge to Recommended until we do."),
      comment("beta", "kenji", ago(0, 20), "The summary of the tickets is in the support channel. Most requests for chapters come from teams that record lectures."),
      comment("allHands", "daniel", ago(37, 21), "The chart of weekly teams at 0:04 deserves a poster."),
      comment("allHands", "lucia", ago(37, 20), "Thank you for taking all the questions!"),
      comment("incident", "jonas", ago(4, 21), "The playhead at 0:05 lines up with the failed parts in latency-p99.csv."),
      comment("design", "alex", ago(2, 3), "The total that stays in view is a clear win. Let's ship the middle one."),
    ],
    ratings: stars.flatMap(([on, raters]) => raters.map(([by, count]) => ({ videoId: VIDEOS[on], personId: PEOPLE[by], stars: count }))),
    // Alex is halfway through the course and watched last week's sync, so the home page
    // offers the next lecture first, then the next sync.
    history: [
      { videoId: VIDEOS.life, watchedAt: ago(0, 19) },
      { videoId: VIDEOS.design, watchedAt: ago(1, 22) },
      { videoId: VIDEOS.incident, watchedAt: ago(4, 2) },
      { videoId: VIDEOS.pricing, watchedAt: ago(7, 3) },
      { videoId: VIDEOS.cellular, watchedAt: ago(26) },
      { videoId: VIDEOS.allHands, watchedAt: ago(36) },
    ],
    signIn: {
      method: "passkeys",
      signedInAt: ago(0, 2.25),
      passkeys: [
        { name: "MacBook Pro", addedAt: ago(300), lastUsedAt: ago(0, 2.25) },
        { name: "iPhone", addedAt: ago(200), lastUsedAt: ago(3, 1) },
      ],
    },
    sessions: [
      {
        browser: "Chrome",
        os: "macOS",
        city: "Tokyo",
        country: "JP",
        signedInAt: ago(0, 2.25),
        lastActiveAt: now.toISOString(),
        expiresAt: new Date(Date.parse(ago(0, 2.25)) + SESSION_MS).toISOString(),
        current: true,
      },
      {
        browser: "Safari",
        os: "iOS",
        city: "Tokyo",
        country: "JP",
        signedInAt: ago(3, 1),
        lastActiveAt: ago(0, 5),
        expiresAt: later(27, -1),
        current: false,
      },
      {
        browser: "Safari",
        os: "iPadOS",
        city: "Osaka",
        country: "JP",
        signedInAt: ago(9, 4),
        lastActiveAt: ago(2, 7),
        expiresAt: later(21, -4),
        current: false,
      },
    ],
  };
}
