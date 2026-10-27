import multer from 'multer';

export const AVATAR_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const POST_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

const acceptedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export function parseImageUpload(maxBytes = POST_IMAGE_MAX_BYTES) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 6, parts: 8 },
    fileFilter(_req, file, callback) {
      if (!acceptedTypes.has(file.mimetype)) return callback(Object.assign(new Error('Choose a JPG, PNG, WebP, or GIF image.'), { status: 415 }));
      callback(null, true);
    },
  });
  return (req, res, next) => upload.single('image')(req, res, (error) => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: { message: `Image is too large. The maximum size is ${Math.floor(maxBytes / 1024 / 1024)} MB.` } });
    const status = Number.isInteger(error.status) ? error.status : 400;
    return res.status(status).json({ error: { message: error.message || 'Could not read the uploaded image.' } });
  });
}

export function validateImageFile(file, maxBytes) {
  if (!file) throw Object.assign(new Error('Choose an image to upload.'), { status: 400 });
  if (file.size > maxBytes) throw Object.assign(new Error(`Image is too large. The maximum size is ${Math.floor(maxBytes / 1024 / 1024)} MB.`), { status: 413 });
  const bytes = file.buffer;
  let detectedType = '';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) detectedType = 'image/jpeg';
  else if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) detectedType = 'image/png';
  else if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') detectedType = 'image/webp';
  else if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) detectedType = 'image/gif';
  if (!detectedType || detectedType !== file.mimetype) throw Object.assign(new Error('The uploaded file is not a valid supported image.'), { status: 415 });
  return detectedType;
}
