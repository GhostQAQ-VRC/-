'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const sharp = require('sharp');

async function main() {
  const root = path.join(__dirname, '..');
  const svgPath = path.join(__dirname, 'assets', 'icon.svg');
  const buildDir = path.join(root, 'build');
  await fs.mkdir(buildDir, { recursive: true });

  const targets = [
    { file: 'icon.png', size: 512 },
    { file: 'icon-256.png', size: 256 },
  ];

  for (const target of targets) {
    await sharp(svgPath)
      .resize(target.size, target.size)
      .png()
      .toFile(path.join(buildDir, target.file));
    console.log(`[desktop:icon] build/${target.file} (${target.size}px)`);
  }
}

main().catch((error) => {
  console.error('[desktop:icon]', error.message);
  process.exit(1);
});
