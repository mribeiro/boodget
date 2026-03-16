import sharp from 'sharp';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const srcSvg = join(__dirname, '../public/icon.svg');
const outDir = join(__dirname, '../public/icons');

if (!existsSync(srcSvg)) {
  console.error('icon.svg not found at', srcSvg);
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
  for (const { size, file } of sizes) {
    await sharp(srcSvg).resize(size, size).png().toFile(join(outDir, file));
    console.log(`Generated ${file} (${size}x${size})`);
  }

  // Maskable: icon content centred in 80% of canvas, solid brand-color background
  const maskableSize = 512;
  const innerSize = Math.round(maskableSize * 0.8); // 410px
  const offset = Math.round((maskableSize - innerSize) / 2); // 51px

  const innerBuf = await sharp(srcSvg).resize(innerSize, innerSize).toBuffer();

  await sharp({
    create: {
      width: maskableSize,
      height: maskableSize,
      channels: 4,
      background: { r: 56, g: 189, b: 248, alpha: 1 }, // #38bdf8
    },
  })
    .composite([{ input: innerBuf, top: offset, left: offset }])
    .png()
    .toFile(join(outDir, 'icon-512-maskable.png'));

  console.log('Generated icon-512-maskable.png (512x512 maskable)');
}

generate().catch((err) => {
  console.error('Icon generation failed:', err.message);
  process.exit(1);
});
