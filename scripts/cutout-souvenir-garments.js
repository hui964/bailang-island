const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const sourceDir = '/Users/lvchunhui/Documents/桃花源/26.06 法式小镇/场景图/邮局/伴手礼/礼裙';
const outputDir = path.resolve(__dirname, '../assets/souvenirs/clothing');
const files = ['2', '3', '4', '5', '6', '7', '9', '10'];

async function cutout(id) {
  const input = path.join(sourceDir, `${id}.png`);
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const paleBackground = (index) => {
    const offset = index * channels;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    return Math.min(r, g, b) > 226 && Math.max(r, g, b) - Math.min(r, g, b) < 24;
  };
  const enqueue = (index) => {
    if (!seen[index] && paleBackground(index)) {
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
  await sharp(data, { raw: { width, height, channels } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(outputDir, `${id}.png`));
}

fs.mkdirSync(outputDir, { recursive: true });
Promise.all(files.map(cutout)).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
