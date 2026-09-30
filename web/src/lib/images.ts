// Photos are shrunk in the browser before upload: phones take 4–12 MB pictures, and a listing page
// needs about 1600 px. This keeps uploads quick on mobile data and the server free of image libraries.

export const FULL_SIZE = 1600;
export const THUMB_SIZE = 480;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

/** Size that fits inside `max`×`max` keeping the shape; never enlarges. */
export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

export class ImageError extends Error {}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new ImageError("Couldn't process that photo."))), "image/jpeg", quality));
}

async function draw(bitmap: ImageBitmap, max: number, quality: number): Promise<Blob> {
  const { w, h } = fitWithin(bitmap.width, bitmap.height, max);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  // JPEG has no transparency: put PNG cut-outs on white rather than black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  return toBlob(canvas, quality);
}

/** A full-size and a thumbnail JPEG made from a picked file. */
export async function preparePhoto(file: File): Promise<{ full: Blob; thumb: Blob }> {
  if (!ACCEPTED.includes(file.type)) throw new ImageError(`${file.name}: use a JPEG, PNG or WebP photo (iPhone HEIC photos: choose "Most Compatible" in camera settings, or share as JPEG).`);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ImageError(`${file.name}: this file couldn't be opened as a picture.`);
  }
  try {
    if (bitmap.width < 320 || bitmap.height < 200) throw new ImageError(`${file.name}: the photo is too small (at least 320 × 200 pixels).`);
    return { full: await draw(bitmap, FULL_SIZE, 0.85), thumb: await draw(bitmap, THUMB_SIZE, 0.8) };
  } finally {
    bitmap.close();
  }
}
