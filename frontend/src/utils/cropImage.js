export async function createCroppedAvatarFile(imageSrc, crop, options = {}) {
  if (!imageSrc || !crop || crop.width <= 0 || crop.height <= 0) throw new Error('The selected crop area is invalid.');
  const ImageCtor = options.ImageCtor || globalThis.Image;
  const documentRef = options.documentRef || globalThis.document;
  const FileCtor = options.FileCtor || globalThis.File;
  if (!ImageCtor || !documentRef || !FileCtor) throw new Error('Your browser does not support photo cropping.');
  const image = new ImageCtor();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('The selected image could not be read.'));
    image.src = imageSrc;
  });
  const sourceSide = Math.max(1, Math.round(Math.min(crop.width, crop.height)));
  const side = Math.min(1024, sourceSide);
  const canvas = documentRef.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not prepare the cropped image.');
  context.drawImage(image, Math.round(crop.x), Math.round(crop.y), sourceSide, sourceSide, 0, 0, side, side);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) throw new Error('Your browser could not export the cropped image. Please try another photo.');
  return new FileCtor([blob], 'chattr-avatar.jpg', { type: 'image/jpeg', lastModified: Date.now() });
}
