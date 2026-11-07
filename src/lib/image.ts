// Turns the part of a picture that a person chose into the small square JPEG that albireo
// keeps: 256 pixels on each side.

import { currentMessages } from "../i18n.ts";

const AVATAR_SIZE = 256;
const AVATAR_QUALITY = 0.9;

/** The chosen part of a picture, in pixels of the original picture. */
export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function cropToJpeg(imageUrl: string, area: CropArea): Promise<Blob> {
  const image = new Image();
  image.src = imageUrl;
  await image.decode().catch(() => {
    throw new Error(currentMessages().channel.unreadable);
  });
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error(currentMessages().channel.cannotDraw);
  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", AVATAR_QUALITY));
  if (blob === null) throw new Error(currentMessages().channel.cannotEncode);
  return blob;
}
