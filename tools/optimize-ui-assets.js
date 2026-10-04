'use strict';
// Build display-size derivatives; retain original PNG artwork for later design work.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const directory = path.resolve(__dirname, '../static/assets');
(async () => {
  for (const [name, width] of [['chulink-ink-wordmark-v2', 720], ['theme-phoenix-book-v1', 336]]) {
    const input = path.join(directory, name + '.png');
    const output = path.join(directory, name + '.webp');
    await sharp(input).resize({ width, withoutEnlargement: true })
      .webp({ quality: 92, alphaQuality: 100, effort: 6 }).toFile(output);
    console.log(name + ': ' + fs.statSync(input).size + ' -> ' + fs.statSync(output).size + ' bytes');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
