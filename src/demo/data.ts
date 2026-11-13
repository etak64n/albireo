// The made-up library of the demo on GitHub Pages: the videos that Alex Morgan, a product
// manager at a small company, keeps for their work: design tips in slides, screen recordings
// after the weekly sync, the slides of an all-hands and of an incident review, a course of
// SQL, and two calm loops. Alex is the one person of albireo, who uploaded every video and
// wrote the comments, the ratings, and the history. Every date counts back from the moment
// that the page opened, so the library always looks recent. The length of each video is the
// length of its file (media.ts), so the times in the comments stay within it.

import type { Language } from "../../shared/api.ts";
import { LESSONS, LESSONS_SERIES_ID } from "./lessons.ts";
import type { AttachmentFile, PictureFile, VideoFile } from "./media.ts";

export interface DemoPerson {
  id: string;
  displayName: string;
  bio: string;
  picture: PictureFile | null;
}

export interface DemoAttachment {
  id: string;
  file: AttachmentFile;
  createdAt: string;
}

export interface DemoVideo {
  id: string;
  title: string;
  description: string;
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

export interface DemoPlaylist {
  id: string;
  title: string;
  description: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  /** The videos of the playlist, in their order. */
  videoIds: string[];
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
  /** The one person of albireo. Their name, bio, and picture are among the people. */
  me: { id: string; joinedAt: string; language: Language };
  people: DemoPerson[];
  videos: DemoVideo[];
  series: DemoSeries[];
  playlists: DemoPlaylist[];
  comments: DemoComment[];
  ratings: DemoRating[];
  history: DemoWatch[];
}

const ALEX = "u1x7k3m9c5v2q8wb";

const VIDEOS = {
  tipColors: "k2f9x7q4m1v8c3np",
  tipType: "r5t1w8z3b6n2h9ld",
  tipCharts: "p7c3m9x1q5v2j8tb",
  checklist: "h9b2q6v1t8m4x3wc",
  pricing: "d3x8w5n1p7k2r9mf",
  beta: "w6m1t4z9c3q8v2hk",
  kickoff: "a8v3k7p2x6n1w5qe",
  incident: "j1q9r4c8m2t6z3vs",
  checkout: "n5z2h8x3w7k1c9pr",
  uploads: "e2p6v9m4c1z8k5rt",
  lobby: "f4n8r2k6w1z9s3gy",
  breathing: "b7k4w1q9n3x6t2mz",
};

const SERIES = {
  tips: "s8k3p1x6v9m2c7wb",
  updates: "t4n9z2q7h1w5r8dk",
};

const PLAYLISTS = {
  teammates: "l3w8q1z6k9v2c5nr",
  reviews: "l7m2x9c4p1t6h8zb",
  calm: "l5r1k8w3n7q2v9dx",
};

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** A new copy of the library, dated back from now. */
export function createLibrary(now: Date): DemoLibrary {
  const ago = (days: number, hours = 0) => new Date(now.getTime() - days * DAY_MS - hours * HOUR_MS).toISOString();

  let next = 0;
  // IDs of comments and attachments, which no address shows.
  const id = (prefix: "c" | "f") => `${prefix}${String((next += 1)).padStart(15, "0")}`;

  const video = (
    key: keyof typeof VIDEOS,
    fields: Omit<DemoVideo, "id" | "updatedAt" | "seriesId" | "seriesPosition" | "attachments"> & {
      series?: [key: keyof typeof SERIES, position: number];
      attachments?: AttachmentFile[];
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

  const comment = (on: keyof typeof VIDEOS, createdAt: string, body: string): DemoComment => ({
    id: id("c"),
    videoId: VIDEOS[on],
    authorId: ALEX,
    body,
    createdAt,
  });

  // The stars that Alex gave each video. The update on the beta has none yet.
  const stars: [keyof typeof VIDEOS, number][] = [
    ["tipColors", 5],
    ["tipType", 4],
    ["tipCharts", 5],
    ["checklist", 4],
    ["pricing", 4],
    ["kickoff", 4],
    ["incident", 5],
    ["checkout", 5],
    ["uploads", 5],
    ["lobby", 4],
    ["breathing", 5],
  ];

  return {
    me: { id: ALEX, joinedAt: ago(412), language: "en" },
    people: [
      {
        id: ALEX,
        displayName: "Alex Morgan",
        bio: "Product manager. I keep my recordings here: the weekly syncs, the design reviews, the talks, and the courses, with their slides.",
        picture: "alex",
      },
    ],
    videos: [
      video("tipColors", {
        title: "Design tip 1: start from two colors",
        description:
          "A dark color for text and a bright one for what matters, then lighter tints of both. Ink on white reads at 17.9 to 1, so the gold is for shapes, not for text.",
        createdAt: ago(20, 3),
        uploaderId: ALEX,
        media: "tip-colors",
        series: ["tips", 1],
      }),
      video("tipType", {
        title: "Design tip 2: one typeface, three sizes",
        description:
          "One family, Noto Sans, at three sizes: 46 pixels for the heading, 30 for the line that explains it, and 20 for the details. Weight does the rest.",
        createdAt: ago(13, 3),
        uploaderId: ALEX,
        media: "tip-type",
        series: ["tips", 2],
      }),
      video("tipCharts", {
        title: "Design tip 3: label the data, not the axis",
        description:
          "Write the value on the bar, drop the gridlines, and color only the bar that matters. The slides, the chart, its data, a checklist, the colors, and the script that draws the chart are attached.",
        createdAt: ago(6, 3),
        uploaderId: ALEX,
        media: "tip-charts",
        series: ["tips", 3],
        attachments: ["chartSlides", "chartPptx", "chartImage", "chartData", "chartChecklist", "chartColors", "chartScript"],
      }),
      video("checklist", {
        title: "Product update: the launch checklist",
        description:
          "A quick walk through the launch checklist after the sync. Before Friday, the walkthrough for the help center still needs a recording. The checklist is attached.",
        createdAt: ago(15, 6),
        uploaderId: ALEX,
        media: "update-checklist",
        series: ["updates", 1],
        attachments: ["checklist"],
      }),
      video("pricing", {
        title: "Product update: yearly prices",
        description:
          "The pricing page has a yearly switch now. Billed yearly, Team costs $10 and Business $20 for each uploader a month. Recorded on the staging site. The answers for the support team are attached.",
        createdAt: ago(8, 6),
        uploaderId: ALEX,
        media: "update-pricing",
        series: ["updates", 2],
        attachments: ["pricingFaq"],
      }),
      video("beta", {
        title: "Product update: what the beta teams asked for",
        description:
          "Twelve teams joined the beta. They asked most for sharing a series outside the library and for chapters in long recordings. Next: chapters, then sharing.",
        createdAt: ago(1, 6),
        uploaderId: ALEX,
        media: "update-beta",
        series: ["updates", 3],
      }),
      video("kickoff", {
        title: "Q4 kickoff: the slides",
        description:
          "The slides of the all-hands, for the screens in the office: where Q3 landed, and three goals for Q4. The PowerPoint file is attached.",
        createdAt: ago(38, 2),
        uploaderId: ALEX,
        media: "q4-kickoff",
        attachments: ["kickoffSlides"],
      }),
      video("incident", {
        title: "Incident review: object storage latency",
        description:
          "Uploads and playback were slow for 47 minutes on Tuesday. These are the slides of the review. The full timeline and the latency are attached.",
        createdAt: ago(5, 4),
        uploaderId: ALEX,
        media: "incident-summary",
        attachments: ["timeline", "latency"],
      }),
      video("checkout", {
        title: "Checkout: three versions on a phone",
        description:
          "Three versions of the checkout on a phone, from the design review. We picked B: the total stays in view, and the pay button stays under the thumb.",
        createdAt: ago(3, 5),
        uploaderId: ALEX,
        media: "checkout-versions",
      }),
      video("uploads", {
        title: "How uploads resume, in one diagram",
        description:
          "Why a large upload survives a flaky connection: the browser sends parts four at a time, and retries a part rather than the file. The notes and a sketch of the code are attached.",
        createdAt: ago(10, 2),
        uploaderId: ALEX,
        media: "uploads-diagram",
        attachments: ["uploadSteps", "uploadCode"],
      }),
      video("lobby", {
        title: "Lobby screen: evening loop",
        description: "Twelve seconds of dusk colors and soft light that loop on the screen in the lobby after six.",
        createdAt: ago(22, 1),
        uploaderId: ALEX,
        media: "lobby-evening",
      }),
      video("breathing", {
        title: "Breathing break",
        description:
          "Sixteen seconds to breathe along with: in while the light grows, out while it fades. Watch it two or three times between meetings.",
        createdAt: ago(30, 2),
        uploaderId: ALEX,
        media: "breathing-break",
      }),
      // SQL in 20 lessons, older than the rest of the library: a lesson every two days.
      ...LESSONS.map(
        (lesson, index): DemoVideo => ({
          id: lesson.id,
          title: `SQL lesson ${index + 1}: ${lesson.title}`,
          description: lesson.lead,
          createdAt: ago(90 - index * 2, 4),
          updatedAt: ago(90 - index * 2, 4),
          uploaderId: ALEX,
          seriesId: LESSONS_SERIES_ID,
          seriesPosition: index + 1,
          media: lesson.file,
          attachments: (lesson.attachments ?? []).map((file) => ({ id: id("f"), file, createdAt: ago(90 - index * 2, 4) })),
        }),
      ),
    ],
    series: [
      {
        id: SERIES.tips,
        title: "Design tips",
        description:
          "Short videos of the slides that we keep reusing: color, type, and charts. A new tip every Thursday, each under fifteen seconds.",
        ownerId: ALEX,
        createdAt: ago(21),
        updatedAt: ago(6, 3),
      },
      {
        id: SERIES.updates,
        title: "Product updates",
        description: "Short screen recordings after the weekly sync: what changed in the product, and what comes next.",
        ownerId: ALEX,
        createdAt: ago(15, 6),
        updatedAt: ago(1, 6),
      },
      {
        id: LESSONS_SERIES_ID,
        title: "SQL in 20 lessons",
        description: "Twenty short lessons of SQL, one idea each, with the query on the slide. Each builds on the one before, so watch them in order.",
        ownerId: ALEX,
        createdAt: ago(91),
        updatedAt: ago(52, 4),
      },
    ],
    playlists: [
      {
        id: PLAYLISTS.teammates,
        title: "For new teammates",
        description: "What to watch in the first week: the plan for the quarter, how the product works, and how we handle trouble.",
        ownerId: ALEX,
        createdAt: ago(10),
        updatedAt: ago(2, 5),
        videoIds: [VIDEOS.kickoff, VIDEOS.uploads, VIDEOS.incident, VIDEOS.checklist],
      },
      {
        id: PLAYLISTS.reviews,
        title: "Before a design review",
        description: "The tips and the screens to look at again before we review a design.",
        ownerId: ALEX,
        createdAt: ago(12),
        updatedAt: ago(3, 1),
        videoIds: [VIDEOS.tipColors, VIDEOS.tipCharts, VIDEOS.checkout],
      },
      {
        id: PLAYLISTS.calm,
        title: "Calm loops",
        description: "For the screen in the lobby, and for a short break.",
        ownerId: ALEX,
        createdAt: ago(18),
        updatedAt: ago(7),
        videoIds: [VIDEOS.lobby, VIDEOS.breathing],
      },
    ],
    comments: [
      comment("tipColors", ago(19, 22), "The tints at 0:06 go into my slide template."),
      comment("tipType", ago(12, 6), "The scale at 0:05 is the clearest one I've seen."),
      comment("tipCharts", ago(5, 20), "At 0:05 the numbers sit right on the bars, which is easier than reading an axis."),
      comment("tipCharts", ago(5, 2), "The line chart at 0:09 is a preview of the next tip."),
      comment("checklist", ago(14, 20), "The walkthrough for the help center still needs a recording before Friday."),
      comment("pricing", ago(7, 22), "The yearly prices at 0:06 are rounded to whole dollars."),
      comment("beta", ago(0, 20), "Most requests for chapters come from teams that record lectures."),
      comment("kickoff", ago(37, 21), "The chart at 0:04 deserves a poster."),
      comment("incident", ago(4, 21), "The timeline at 0:04 lines up with the failed parts in latency-p99.csv."),
      comment("checkout", ago(2, 3), "Version B keeps the total in view. We ship it."),
      comment("uploads", ago(9, 20), "For anyone who asks why a big upload survives a flaky connection."),
      comment("lobby", ago(21, 20), "A morning version in ocean colors would be nice."),
      comment("breathing", ago(29, 4), "Four seconds in, four seconds out. Good between calls."),
    ],
    ratings: stars.map(([on, count]) => ({ videoId: VIDEOS[on], personId: ALEX, stars: count })),
    // Alex has seen the first two design tips and last week's update, so the home page
    // offers the third tip first, then the next update.
    history: [
      { videoId: VIDEOS.tipType, watchedAt: ago(0, 19) },
      { videoId: VIDEOS.checkout, watchedAt: ago(1, 22) },
      { videoId: VIDEOS.incident, watchedAt: ago(4, 2) },
      { videoId: VIDEOS.pricing, watchedAt: ago(7, 3) },
      { videoId: VIDEOS.tipColors, watchedAt: ago(12) },
      { videoId: VIDEOS.kickoff, watchedAt: ago(36) },
    ],
  };
}
