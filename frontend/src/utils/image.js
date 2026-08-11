export const AVATAR_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const AVATAR_MAX_SOURCE_BYTES = 8 * 1024 * 1024; // raw upload cap, before client-side resize
export const AVATAR_OUTPUT_SIZE = 256; // px, square
export const AVATAR_OUTPUT_QUALITY = 0.85;

// Pure guard, split out from resizeAvatarToDataUrl so it's testable without a canvas/Image
// environment (jsdom doesn't implement <canvas> rendering).
export function validateAvatarFile(file) {
  if (!file) throw new Error('No file selected');
  if (!AVATAR_ACCEPTED_TYPES.includes(file.type)) {
    throw new Error('Image must be a PNG, JPEG, or WebP file');
  }
  if (file.size > AVATAR_MAX_SOURCE_BYTES) {
    throw new Error('Image must be smaller than 8MB');
  }
}

// Reads the file, center-crops it to a square, downscales it to a fixed size, and
// re-encodes it as JPEG — keeping the base64 payload sent to the server small
// regardless of how large the original photo was.
export function resizeAvatarToDataUrl(file, size = AVATAR_OUTPUT_SIZE, quality = AVATAR_OUTPUT_QUALITY) {
  validateAvatarFile(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to load image'));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
