// The files of the demo on GitHub Pages: a short video and its poster for each sample
// video, the pictures of the people, the attachments, and the sizes of them all. The
// Pages workflow makes them with scripts/demo-media.ts beside the demo, so git holds none
// of them, and the demo links to them where albireo gives the URLs of its files.

/** The sample videos, by the name of their files, with their length in seconds. */
export const VIDEO_SECONDS = {
  "tip-colors": 14,
  "tip-type": 12,
  "tip-charts": 14,
  "update-checklist": 12,
  "update-pricing": 10,
  "update-beta": 14,
  "q4-kickoff": 14,
  "incident-summary": 14,
  "checkout-versions": 10,
  "uploads-diagram": 12,
  "lobby-evening": 12,
  "breathing-break": 16,
  // SQL in 20 lessons (lessons.ts): the title of each lesson, then its query.
  "sql-01": 8,
  "sql-02": 8,
  "sql-03": 8,
  "sql-04": 8,
  "sql-05": 8,
  "sql-06": 8,
  "sql-07": 8,
  "sql-08": 8,
  "sql-09": 8,
  "sql-10": 8,
  "sql-11": 8,
  "sql-12": 8,
  "sql-13": 8,
  "sql-14": 8,
  "sql-15": 8,
  "sql-16": 8,
  "sql-17": 8,
  "sql-18": 8,
  "sql-19": 8,
  "sql-20": 8,
} as const;

export type VideoFile = keyof typeof VIDEO_SECONDS;

/** The people who chose a picture, by the name of its file. */
export const PICTURE_FILES = ["alex", "mina", "daniel", "jonas", "kenji"] as const;

export type PictureFile = (typeof PICTURE_FILES)[number];

/** The attachments, with the type that albireo gives a file of that name. */
export const ATTACHMENT_FILES = {
  chartSlides: { fileName: "label-the-data.pdf", contentType: "application/pdf" },
  chartPptx: { fileName: "label-the-data.pptx", contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  chartImage: { fileName: "bar-chart.png", contentType: "image/png" },
  chartData: { fileName: "uploads-by-team.csv", contentType: "text/csv; charset=utf-8" },
  chartChecklist: { fileName: "chart-checklist.md", contentType: "text/markdown; charset=utf-8" },
  chartColors: { fileName: "chart-colors.json", contentType: "application/json" },
  chartScript: { fileName: "bar-chart.py", contentType: "application/octet-stream" },
  uploadCode: { fileName: "send-parts.ts", contentType: "application/octet-stream" },
  lessonQuery: { fileName: "inner-join.sql", contentType: "application/octet-stream" },
  kickoffSlides: { fileName: "q4-kickoff.pptx", contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  pricingFaq: { fileName: "pricing-faq.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  timeline: { fileName: "timeline.md", contentType: "text/markdown; charset=utf-8" },
  latency: { fileName: "latency-p99.csv", contentType: "text/csv; charset=utf-8" },
  checklist: { fileName: "launch-checklist.md", contentType: "text/markdown; charset=utf-8" },
  uploadSteps: { fileName: "upload-steps.txt", contentType: "text/plain; charset=utf-8" },
} as const;

export type AttachmentFile = keyof typeof ATTACHMENT_FILES;

/** Where each file lives, relative to the root of the demo. */
export const MEDIA_PATHS = {
  video: (name: VideoFile) => `media/videos/${name}.mp4`,
  poster: (name: VideoFile) => `media/posters/${name}.jpg`,
  picture: (name: PictureFile) => `media/people/${name}.jpg`,
  attachment: (fileName: string) => `media/files/${fileName}`,
  /** The size in bytes of each file above, by its path, which the demo shows for attachments. */
  sizes: "media/sizes.json",
};
