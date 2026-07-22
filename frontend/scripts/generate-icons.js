import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const srcSvg = join(__dirname, '../public/icon.svg');
const srcSvgDark = join(__dirname, '../public/icon-dark.svg');
const outDir = join(__dirname, '../public/icons');

if (!existsSync(srcSvg)) {
  console.error('icon.svg not found at', srcSvg);
  process.exit(1);
}

if (!existsSync(srcSvgDark)) {
  console.error('icon-dark.svg not found at', srcSvgDark);
  process.exit(1);
}

if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

const sizes = [
  { size: 16, file: 'icon-16.png' },
  { size: 32, file: 'icon-32.png' },
  { size: 180, file: 'icon-180.png' },
  { size: 192, file: 'icon-192.png' },
  { size: 512, file: 'icon-512.png' },
];

async function generate() {
  // Light mode icons
  for (const { size, file } of sizes) {
    await sharp(srcSvg).resize(size, size).png().toFile(join(outDir, file));
    console.log(`Generated ${file} (${size}x${size})`);
  }

  // Maskable (light): icon content centred in 80% of canvas, solid brand-color background
  const maskableSize = 512;
  const innerSize = Math.round(maskableSize * 0.8); // 410px
  const offset = Math.round((maskableSize - innerSize) / 2); // 51px

  const innerBuf = await sharp(srcSvg).resize(innerSize, innerSize).toBuffer();

  await sharp({
    create: {
      width: maskableSize,
      height: maskableSize,
      channels: 4,
      background: { r: 31, g: 122, b: 140, alpha: 1 }, // #1F7A8C
    },
  })
    .composite([{ input: innerBuf, top: offset, left: offset }])
    .png()
    .toFile(join(outDir, 'icon-512-maskable.png'));

  console.log('Generated icon-512-maskable.png (512x512 maskable)');

  // Dark mode icons
  const darkSizes = [
    { size: 180, file: 'icon-180-dark.png' },
    { size: 192, file: 'icon-192-dark.png' },
    { size: 512, file: 'icon-512-dark.png' },
  ];

  for (const { size, file } of darkSizes) {
    await sharp(srcSvgDark).resize(size, size).png().toFile(join(outDir, file));
    console.log(`Generated ${file} (${size}x${size})`);
  }

  // Maskable dark: dark navy background
  const innerBufDark = await sharp(srcSvgDark).resize(innerSize, innerSize).toBuffer();

  await sharp({
    create: {
      width: maskableSize,
      height: maskableSize,
      channels: 4,
      background: { r: 6, g: 15, b: 22, alpha: 1 }, // #060F16
    },
  })
    .composite([{ input: innerBufDark, top: offset, left: offset }])
    .png()
    .toFile(join(outDir, 'icon-512-maskable-dark.png'));

  console.log('Generated icon-512-maskable-dark.png (512x512 maskable dark)');
}

generate().catch((err) => {
  console.error('Icon generation failed:', err.message);
  process.exit(1);
});
