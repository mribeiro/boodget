import { validateAvatarFile, AVATAR_MAX_SOURCE_BYTES } from './image';

function makeFile({ type = 'image/png', size = 1024 } = {}) {
  return { type, size };
}

describe('validateAvatarFile', () => {
  it('accepts a PNG/JPEG/WebP file under the size cap', () => {
    expect(() => validateAvatarFile(makeFile({ type: 'image/png' }))).not.toThrow();
    expect(() => validateAvatarFile(makeFile({ type: 'image/jpeg' }))).not.toThrow();
    expect(() => validateAvatarFile(makeFile({ type: 'image/webp' }))).not.toThrow();
  });

  it('rejects a missing file', () => {
    expect(() => validateAvatarFile(null)).toThrow('No file selected');
  });

  it('rejects a disallowed mime type', () => {
    expect(() => validateAvatarFile(makeFile({ type: 'image/gif' }))).toThrow(/PNG, JPEG, or WebP/);
  });

  it('rejects a file over the size cap', () => {
    expect(() => validateAvatarFile(makeFile({ size: AVATAR_MAX_SOURCE_BYTES + 1 }))).toThrow(/smaller than 8MB/);
  });
});
