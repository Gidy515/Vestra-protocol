/** Local files are resized and encoded; only pixels, never SVG markup, reach the catalogue. */
export async function localTokenLogo(file: File): Promise<string> {
  if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG or WebP image');
  if (file.size > 5 * 1024 * 1024) throw new Error('Choose an image smaller than 5 MB');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing unavailable');
    const size = Math.min(img.naturalWidth, img.naturalHeight);
    context.drawImage(img, (img.naturalWidth-size)/2, (img.naturalHeight-size)/2, size, size, 0, 0, 128, 128);
    const result = canvas.toDataURL('image/png');
    if (result.length > 90_000) throw new Error('Image is too detailed; choose a simpler logo');
    return result;
  } finally {URL.revokeObjectURL(url);}
}
