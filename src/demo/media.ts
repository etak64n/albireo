// The files of the demo on GitHub Pages: a short video and its poster for each sample
// video, the pictures of the people, and the attachments. The Pages workflow makes them
// with scripts/demo-media.ts beside the demo, so git holds none of them, and the demo
// links to them where albireo gives signed URLs of the bucket.

/** The sample videos, by the name of their files. */
export const VIDEO_FILES = [
  "cellular-automata",
  "game-of-life",
  "mandelbrot",
  "gradients",
  "sync-launch",
  "sync-pricing",
  "sync-beta",
  "all-hands",
  "incident-review",
  "design-review",
  "color-bars",
  "encoder-test",
] as const;

export type VideoFile = (typeof VIDEO_FILES)[number];

/** The people who chose a picture, by the name of its file. */
export const PICTURE_FILES = ["alex", "mina", "daniel", "jonas", "kenji"] as const;

export type PictureFile = (typeof PICTURE_FILES)[number];

/** Where each file lives, relative to the root of the demo. */
export const MEDIA_PATHS = {
  video: (name: VideoFile) => `media/videos/${name}.mp4`,
  poster: (name: VideoFile) => `media/posters/${name}.jpg`,
  picture: (name: PictureFile) => `media/people/${name}.jpg`,
  attachment: (fileName: string) => `media/files/${fileName}`,
};
