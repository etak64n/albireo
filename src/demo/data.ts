// The made-up library of the demo on GitHub Pages: seven people at a small company that
// makes a video product, and the short videos that they share: design tips in slides,
// screen recordings after the weekly sync, the slides of an all-hands and of an incident
// review, and two calm loops. It holds comments, ratings, attachments, the history and the
// sessions of Alex Morgan, the admin who is signed in, and an invitation that nobody has
// used yet. Every date counts back from the moment that
// the page opened, so the library always looks recent. The length of each video is the
// length of its file (media.ts), so the times in the comments stay within it.

import type { Language, Session } from "../../shared/api.ts";
import { LESSONS, LESSONS_SERIES_ID } from "./lessons.ts";
import type { AttachmentFile, PictureFile, VideoFile } from "./media.ts";

export interface DemoPerson {
  id: string;
  displayName: string;
  bio: string;
  picture: PictureFile | null;
  email: string;
  isAdmin: boolean;
  joinedAt: string;
  lastActiveAt: string;
  /** An admin removed them: they cannot sign in, and their videos and comments stay. */
  removed: boolean;
}

export interface DemoInvitation {
  id: string;
  isAdmin: boolean;
  invitedById: string;
  createdAt: string;
  expiresAt: string;
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
  /** The person who is signed in. Their name, email, and role are among the people. */
  me: { id: string; language: Language };
  people: DemoPerson[];
  videos: DemoVideo[];
  series: DemoSeries[];
  playlists: DemoPlaylist[];
  comments: DemoComment[];
  ratings: DemoRating[];
  history: DemoWatch[];
  sessions: Session[];
  invitations: DemoInvitation[];
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
// A session ends 30 days after its last request, and an invitation 7 days after an admin made it.
const SESSION_MS = 30 * DAY_MS;
const INVITATION_MS = 7 * DAY_MS;

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

  const comment = (on: keyof typeof VIDEOS, by: keyof typeof PEOPLE, createdAt: string, body: string): DemoComment => ({
    id: id("c"),
    videoId: VIDEOS[on],
    authorId: PEOPLE[by],
    body,
    createdAt,
  });

  // Each video with the people who rated it and their stars.
  const stars: [keyof typeof VIDEOS, [keyof typeof PEOPLE, number][]][] = [
    ["tipColors", [["jonas", 5], ["kenji", 4], ["lucia", 5], ["alex", 5]]],
    ["tipType", [["lucia", 5], ["daniel", 4], ["priya", 4], ["alex", 4]]],
    ["tipCharts", [["priya", 5], ["jonas", 5], ["daniel", 4], ["lucia", 5]]],
    ["checklist", [["jonas", 4], ["lucia", 4]]],
    ["pricing", [["mina", 5], ["jonas", 4], ["alex", 4]]],
    ["kickoff", [["mina", 4], ["daniel", 5], ["jonas", 4], ["lucia", 5], ["kenji", 4], ["alex", 4]]],
    ["incident", [["daniel", 5], ["jonas", 4]]],
    ["checkout", [["lucia", 4], ["alex", 5]]],
    ["uploads", [["kenji", 5], ["jonas", 4]]],
    ["lobby", [["priya", 5], ["mina", 4]]],
    ["breathing", [["kenji", 5], ["lucia", 5], ["mina", 4]]],
  ];

  return {
    me: { id: PEOPLE.alex, language: "en" },
    people: [
      {
        id: PEOPLE.alex,
        displayName: "Alex Morgan",
        bio: "Product manager. After each weekly sync, I post a short screen recording of what changed.",
        picture: "alex",
        email: "alex@example.com",
        isAdmin: true,
        joinedAt: ago(412),
        lastActiveAt: now.toISOString(),
        removed: false,
      },
      {
        id: PEOPLE.mina,
        displayName: "Mina Sato",
        bio: "Product designer. Design tips on Thursdays, and design reviews in between.",
        picture: "mina",
        email: "mina@example.com",
        isAdmin: false,
        joinedAt: ago(405),
        lastActiveAt: ago(0, 3),
        removed: false,
      },
      {
        id: PEOPLE.daniel,
        displayName: "Daniel Okafor",
        bio: "Engineer. I explain how our uploads and storage work, mostly in diagrams.",
        picture: "daniel",
        email: "daniel@example.com",
        isAdmin: false,
        joinedAt: ago(388),
        lastActiveAt: ago(1, 2),
        removed: false,
      },
      {
        id: PEOPLE.priya,
        displayName: "Priya Nair",
        bio: "Head of operations. All-hands, incident reviews, and the breathing break.",
        picture: null,
        email: "priya@example.com",
        isAdmin: true,
        joinedAt: ago(371),
        lastActiveAt: ago(0, 20),
        removed: false,
      },
      {
        id: PEOPLE.jonas,
        displayName: "Jonas Weber",
        bio: "Backend engineer. Uploads, storage, and anything that retries.",
        picture: "jonas",
        email: "jonas@example.com",
        isAdmin: false,
        joinedAt: ago(250),
        lastActiveAt: ago(2, 5),
        removed: false,
      },
      {
        id: PEOPLE.lucia,
        displayName: "Lucía Fernández",
        bio: "Marketing. Launch posts, the help center, and the screen in the lobby.",
        picture: null,
        email: "lucia@example.com",
        isAdmin: false,
        joinedAt: ago(180),
        lastActiveAt: ago(5, 1),
        removed: false,
      },
      {
        id: PEOPLE.kenji,
        displayName: "Kenji Ito",
        bio: "Support lead. I bring what customers ask to the weekly sync.",
        picture: "kenji",
        email: "kenji@example.com",
        isAdmin: false,
        joinedAt: ago(120),
        lastActiveAt: ago(0, 8),
        removed: false,
      },
    ],
    videos: [
      video("tipColors", {
        title: "Design tip 1: start from two colors",
        description:
          "A dark color for text and a bright one for what matters, then lighter tints of both. Ink on white reads at 17.9 to 1, so the gold is for shapes, not for text.",
        createdAt: ago(20, 3),
        uploaderId: PEOPLE.mina,
        media: "tip-colors",
        series: ["tips", 1],
      }),
      video("tipType", {
        title: "Design tip 2: one typeface, three sizes",
        description:
          "One family, Noto Sans, at three sizes: 46 pixels for the heading, 30 for the line that explains it, and 20 for the details. Weight does the rest.",
        createdAt: ago(13, 3),
        uploaderId: PEOPLE.mina,
        media: "tip-type",
        series: ["tips", 2],
      }),
      video("tipCharts", {
        title: "Design tip 3: label the data, not the axis",
        description:
          "Write the value on the bar, drop the gridlines, and color only the bar that matters. The slides, the chart, its data, a checklist, the colors, and the script that draws the chart are attached.",
        createdAt: ago(6, 3),
        uploaderId: PEOPLE.mina,
        media: "tip-charts",
        series: ["tips", 3],
        attachments: ["chartSlides", "chartPptx", "chartImage", "chartData", "chartChecklist", "chartColors", "chartScript"],
      }),
      video("checklist", {
        title: "Product update: the launch checklist",
        description:
          "A quick walk through the launch checklist after the sync. Before Friday, the walkthrough for the help center still needs a recording. The checklist is attached.",
        createdAt: ago(15, 6),
        uploaderId: PEOPLE.alex,
        media: "update-checklist",
        series: ["updates", 1],
        attachments: ["checklist"],
      }),
      video("pricing", {
        title: "Product update: yearly prices",
        description:
          "The pricing page has a yearly switch now. Billed yearly, Team costs $10 and Business $20 for each uploader a month. Recorded on the staging site. The answers for the support team are attached.",
        createdAt: ago(8, 6),
        uploaderId: PEOPLE.alex,
        media: "update-pricing",
        series: ["updates", 2],
        attachments: ["pricingFaq"],
      }),
      video("beta", {
        title: "Product update: what the beta teams asked for",
        description:
          "Twelve teams joined the beta. They asked most for sharing a series outside the library and for chapters in long recordings. Next: chapters, then sharing.",
        createdAt: ago(1, 6),
        uploaderId: PEOPLE.alex,
        media: "update-beta",
        series: ["updates", 3],
      }),
      video("kickoff", {
        title: "Q4 kickoff: the slides",
        description:
          "The slides of the all-hands, for the screens in the office: where Q3 landed, and three goals for Q4. The PowerPoint file is attached.",
        createdAt: ago(38, 2),
        uploaderId: PEOPLE.priya,
        media: "q4-kickoff",
        attachments: ["kickoffSlides"],
      }),
      video("incident", {
        title: "Incident review: object storage latency",
        description:
          "Uploads and playback were slow for 47 minutes on Tuesday. These are the slides of the review. The full timeline and the latency are attached.",
        createdAt: ago(5, 4),
        uploaderId: PEOPLE.priya,
        media: "incident-summary",
        attachments: ["timeline", "latency"],
      }),
      video("checkout", {
        title: "Checkout: three versions on a phone",
        description:
          "Three versions of the checkout on a phone, from the design review. We picked B: the total stays in view, and the pay button stays under the thumb.",
        createdAt: ago(3, 5),
        uploaderId: PEOPLE.mina,
        media: "checkout-versions",
      }),
      video("uploads", {
        title: "How uploads resume, in one diagram",
        description:
          "Why a large upload survives a flaky connection: the browser sends parts four at a time, and retries a part rather than the file. The notes and a sketch of the code are attached.",
        createdAt: ago(10, 2),
        uploaderId: PEOPLE.daniel,
        media: "uploads-diagram",
        attachments: ["uploadSteps", "uploadCode"],
      }),
      video("lobby", {
        title: "Lobby screen: evening loop",
        description: "Twelve seconds of dusk colors and soft light that loop on the screen in the lobby after six.",
        createdAt: ago(22, 1),
        uploaderId: PEOPLE.lucia,
        media: "lobby-evening",
      }),
      video("breathing", {
        title: "Breathing break",
        description:
          "Sixteen seconds to breathe along with: in while the light grows, out while it fades. Watch it two or three times between meetings.",
        createdAt: ago(30, 2),
        uploaderId: PEOPLE.priya,
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
          uploaderId: PEOPLE.kenji,
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
        ownerId: PEOPLE.mina,
        createdAt: ago(21),
        updatedAt: ago(6, 3),
      },
      {
        id: SERIES.updates,
        title: "Product updates",
        description: "Short screen recordings after the weekly sync: what changed in the product, and what comes next.",
        ownerId: PEOPLE.alex,
        createdAt: ago(15, 6),
        updatedAt: ago(1, 6),
      },
      {
        id: LESSONS_SERIES_ID,
        title: "SQL in 20 lessons",
        description: "Twenty short lessons of SQL, one idea each, with the query on the slide. Each builds on the one before, so watch them in order.",
        ownerId: PEOPLE.kenji,
        createdAt: ago(91),
        updatedAt: ago(52, 4),
      },
    ],
    playlists: [
      {
        id: PLAYLISTS.teammates,
        title: "For new teammates",
        description: "What to watch in the first week: the plan for the quarter, how the product works, and how we handle trouble.",
        ownerId: PEOPLE.alex,
        createdAt: ago(10),
        updatedAt: ago(2, 5),
        videoIds: [VIDEOS.kickoff, VIDEOS.uploads, VIDEOS.incident, VIDEOS.checklist],
      },
      {
        id: PLAYLISTS.reviews,
        title: "Before a design review",
        description: "The tips and the screens to look at again before we review a design.",
        ownerId: PEOPLE.daniel,
        createdAt: ago(12),
        updatedAt: ago(3, 1),
        videoIds: [VIDEOS.tipColors, VIDEOS.tipCharts, VIDEOS.checkout],
      },
      {
        id: PLAYLISTS.calm,
        title: "Calm loops",
        description: "For the screen in the lobby, and for a short break.",
        ownerId: PEOPLE.lucia,
        createdAt: ago(18),
        updatedAt: ago(7),
        videoIds: [VIDEOS.lobby, VIDEOS.breathing],
      },
    ],
    comments: [
      comment("tipColors", "jonas", ago(19, 22), "The tints at 0:06 are going straight into our slide template."),
      comment("tipColors", "kenji", ago(19, 5), "Could there be a third color for warnings?"),
      comment("tipColors", "mina", ago(19, 3), "Maybe in a later tip: when a third color earns its place."),
      comment("tipType", "lucia", ago(12, 20), "Three sizes is so freeing. The help center used seven."),
      comment("tipType", "daniel", ago(12, 6), "The scale at 0:05 is the clearest one I've seen."),
      comment("tipCharts", "priya", ago(5, 22), "Using this for the chart of the next all-hands."),
      comment("tipCharts", "jonas", ago(5, 20), "At 0:05 the numbers sit right on the bars. So much easier than reading an axis."),
      comment("tipCharts", "daniel", ago(5, 4), "Could you do one for line charts?"),
      comment("tipCharts", "mina", ago(5, 2), "The line chart at 0:09 is a preview of the next tip."),
      comment("checklist", "lucia", ago(14, 20), "I'll record the walkthrough for the help center and post it here by Friday."),
      comment("pricing", "jonas", ago(7, 22), "The yearly prices at 0:06: do we round them to whole dollars?"),
      comment("pricing", "mina", ago(7, 20), "We do, and the cards say billed yearly now."),
      comment("beta", "kenji", ago(0, 20), "The summary of the tickets is in the support channel. Most requests for chapters come from teams that record lectures."),
      comment("kickoff", "daniel", ago(37, 21), "The chart at 0:04 deserves a poster."),
      comment("kickoff", "lucia", ago(37, 20), "Thank you for taking all the questions!"),
      comment("incident", "jonas", ago(4, 21), "The timeline at 0:04 lines up with the failed parts in latency-p99.csv."),
      comment("checkout", "alex", ago(2, 3), "Version B keeps the total in view. Let's ship it."),
      comment("uploads", "kenji", ago(9, 20), "Sending this to customers who ask why a big upload survives a flaky connection."),
      comment("lobby", "priya", ago(21, 20), "So calm. Could we have a morning version too?"),
      comment("lobby", "lucia", ago(21, 18), "Working on it, in ocean colors."),
      comment("breathing", "kenji", ago(29, 4), "I play this between support calls. Four seconds in, four seconds out."),
    ],
    ratings: stars.flatMap(([on, raters]) => raters.map(([by, count]) => ({ videoId: VIDEOS[on], personId: PEOPLE[by], stars: count }))),
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
    // The sessions of Alex, with the one of this browser. Each ends 30 days after its last request.
    sessions: [
      {
        id: "a7k2m9x4c1v8q3wb",
        browser: "Chrome",
        os: "macOS",
        signedInAt: ago(0, 2.25),
        lastActiveAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + SESSION_MS).toISOString(),
        current: true,
      },
      {
        id: "b3n8r1t6z9h4p2jd",
        browser: "Safari",
        os: "iOS",
        signedInAt: ago(3, 1),
        lastActiveAt: ago(0, 5),
        expiresAt: new Date(Date.parse(ago(0, 5)) + SESSION_MS).toISOString(),
        current: false,
      },
      {
        id: "c9w2q7x5m3k8v1fe",
        browser: "Safari",
        os: "iPadOS",
        signedInAt: ago(9, 4),
        lastActiveAt: ago(2, 7),
        expiresAt: new Date(Date.parse(ago(2, 7)) + SESSION_MS).toISOString(),
        current: false,
      },
    ],
    invitations: [
      {
        id: "d4h9z2n7p1t5r8ky",
        isAdmin: false,
        invitedById: PEOPLE.priya,
        createdAt: ago(1, 3),
        expiresAt: new Date(Date.parse(ago(1, 3)) + INVITATION_MS).toISOString(),
      },
    ],
  };
}
