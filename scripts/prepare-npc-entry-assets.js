const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const pngDir = path.join(root, 'assets/npc/entries');
const webpDir = path.join(root, 'assets/optimized/npc/entries');
const previewPath = path.join(root, 'outputs/npc-entry-contact-sheet.png');

async function restoreTransparentBackground(file) {
  const image = sharp(file).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const isBackground = (index) => {
    const offset = index * channels;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    return Math.min(r, g, b) >= 218 && Math.max(r, g, b) - Math.min(r, g, b) <= 10;
  };
  const enqueue = (index) => {
    if (!seen[index] && isBackground(index)) {
      seen[index] = 1;
      queue[tail++] = index;
    }
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }
  for (let index = 0; index < seen.length; index += 1) {
    if (seen[index]) data[index * channels + 3] = 0;
  }
  await sharp(data, { raw: { width, height, channels } }).png({ compressionLevel: 9 }).toFile(file + '.alpha.png');
  fs.renameSync(file + '.alpha.png', file);
}

async function cleanCanvasEdges(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let minX = width;
  let maxX = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const visible = data[offset + 3] > 8;
      const meaningful = visible && (Math.max(r, g, b) > 55 || Math.max(r, g, b) - Math.min(r, g, b) > 15);
      if (meaningful) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
  }
  const safeMin = Math.max(0, minX - 28);
  const safeMax = Math.min(width - 1, maxX + 28);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < safeMin || x > safeMax || y < 7 || y >= height - 7) data[(y * width + x) * channels + 3] = 0;
    }
  }
  const temp = file + '.edge.png';
  await sharp(data, { raw: { width, height, channels } })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
    .extend({ top: 24, bottom: 24, left: 24, right: 24, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(temp);
  fs.renameSync(temp, file);
}

async function main() {
  fs.mkdirSync(webpDir, { recursive: true });
  fs.mkdirSync(path.dirname(previewPath), { recursive: true });
  const backgroundRepair = ['antoine-photographer.png', 'chunhui-island-keeper.png'];
  for (const name of backgroundRepair) {
    const file = path.join(pngDir, name);
    if (!fs.existsSync(file)) continue;
    const meta = await sharp(file).metadata();
    if (!meta.hasAlpha || name === 'chunhui-island-keeper.png') await restoreTransparentBackground(file);
  }

  const names = fs.readdirSync(pngDir).filter((name) => name.endsWith('.png')).sort();
  for (const name of names) {
    await cleanCanvasEdges(path.join(pngDir, name));
    await sharp(path.join(pngDir, name))
      .resize({ height: 1200, withoutEnlargement: true })
      .webp({ quality: 84, alphaQuality: 96, effort: 5 })
      .toFile(path.join(webpDir, name.replace(/\.png$/, '.webp')));
  }

  const cellW = 220;
  const cellH = 310;
  const columns = 5;
  const rows = Math.ceil(names.length / columns);
  const composites = [];
  for (let index = 0; index < names.length; index += 1) {
    const thumb = await sharp(path.join(pngDir, names[index]))
      .resize({ width: 190, height: 268, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    composites.push({ input: thumb, left: index % columns * cellW + 15, top: Math.floor(index / columns) * cellH + 10 });
  }
  await sharp({ create: { width: columns * cellW, height: rows * cellH, channels: 4, background: '#eee9df' } })
    .composite(composites)
    .png()
    .toFile(previewPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
