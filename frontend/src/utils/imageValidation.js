export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const POST_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export function imageSelectionError(file, maxBytes) {
  if (!file) return '';
  if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) return 'Choose a JPG, PNG, WebP, or GIF image.';
  if (file.size > maxBytes) return `Image must be ${Math.floor(maxBytes / 1024 / 1024)} MB or smaller.`;
  return '';
}
