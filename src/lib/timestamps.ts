// Finds times such as 1:23 and 1:02:03 in the text of a comment, so that a click on
// one plays the video from there.

/** A piece of a comment: plain text, or a time in the video and its position in seconds. */
export type CommentPart = { kind: "text"; text: string } | { kind: "time"; text: string; seconds: number };

// Minutes and seconds, with hours in front when the time has three parts.
const TIME = /\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b/g;

/**
 * Splits the text of a comment into plain text and times. A time stays plain text when
 * its seconds, or its minutes after hours, reach 60, and when it is past the end of the
 * video. A null duration means that the length is unknown, so every time counts.
 */
export function splitTimes(body: string, durationSec: number | null): CommentPart[] {
  const parts: CommentPart[] = [];
  let end = 0;
  for (const match of body.matchAll(TIME)) {
    const [text, hours, minutes, seconds] = match;
    const h = hours === undefined ? 0 : Number(hours);
    const m = Number(minutes);
    const s = Number(seconds);
    if (s >= 60 || (hours !== undefined && m >= 60)) continue;
    const position = h * 3600 + m * 60 + s;
    if (durationSec !== null && position > durationSec) continue;
    if (match.index > end) parts.push({ kind: "text", text: body.slice(end, match.index) });
    parts.push({ kind: "time", text, seconds: position });
    end = match.index + text.length;
  }
  if (end < body.length) parts.push({ kind: "text", text: body.slice(end) });
  return parts;
}
