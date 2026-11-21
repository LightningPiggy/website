#!/usr/bin/env node
/**
 * One-off: write small WebP copies of oversized images next to the originals.
 *
 * Usage (from the repo root): node scripts/optimise-images.mjs
 *
 * It never overwrites or deletes an original: pages are switched to the new
 * files by hand, and the originals stay for anything that links to them
 * (og:image, the JSON-LD logo, newsletters, other sites).
 * Uses the sharp that Astro already installs for its image service.
 */
import sharp from 'sharp';
import fs from 'node:fs';

// [source, output, max width in pixels (about 2x the size the page shows it)]
const JOBS = [
  ['public/images/mascot.png', 'public/images/mascot-192.webp', 192],
  ['public/images/mascot-head.png', 'public/images/mascot-head-96.webp', 96],
  ['public/images/pages/lightningpiggy-thumbs-up.png', 'public/images/pages/lightningpiggy-thumbs-up-320.webp', 320],
  ['public/images/characters/lightningpiggy-sunglasses.png', 'public/images/characters/lightningpiggy-sunglasses-512.webp', 512],
  ['public/images/characters/lightningpiggy-tractor.png', 'public/images/characters/lightningpiggy-tractor-320.webp', 320],
  ['public/images/educators/group-build-workshop.jpeg', 'public/images/educators/group-build-workshop.webp', 1280],
  ['public/images/educators/informal-build-area.jpeg', 'public/images/educators/informal-build-area.webp', 1280],
  ['public/images/educators/character-design-challenge.jpeg', 'public/images/educators/character-design-challenge.webp', 1280],
  ['public/images/educators/piggy-build-challenge.jpeg', 'public/images/educators/piggy-build-challenge.webp', 1280],
  ['public/images/v1-example.jpeg', 'public/images/v1-example-900.webp', 900],
  ['public/images/v2-example.jpeg', 'public/images/v2-example-900.webp', 900],
];

for (const [src, out, width] of JOBS) {
  if (fs.existsSync(out)) { console.log(`skip ${out} (exists)`); continue; }
  const info = await sharp(src)
    .rotate() // apply any EXIF orientation, since WebP output drops the tag
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(out);
  const before = fs.statSync(src).size;
  console.log(`${out}  ${info.width}x${info.height}  ${Math.round(before / 1024)} KB -> ${Math.round(info.size / 1024)} KB`);
}
