/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regenerates every NexWork app-icon asset from a single source artwork.
 *
 * The source is treated as ONE indivisible image. Its cream field is part of
 * the icon, not a background to be removed: the whole artwork is scaled into
 * the icon body and the body is masked to a rounded square. Nothing is cut out
 * and nothing is redrawn.
 *
 * Why the geometry differs per platform:
 *
 *   macOS  the Dock does NOT mask icons. An icon must ship its own rounded
 *          shape AND its own margin, or it renders as an oversized square tile
 *          next to every correctly-built neighbour. Apple's Big Sur grid puts
 *          the body at 824/1024 (100px margin) with a corner radius of
 *          185.4/824 = 22.5%.
 *   Windows / Linux / PWA
 *          no margin — the icon is drawn as-is and a margin just makes it look
 *          small. Rounded corners still need real transparency.
 *
 * The corner is a superellipse approximation of Apple's continuous corner
 * (a proprietary curve). Deviation peaks around 1px at typical Dock sizes.
 *
 * Usage: node scripts/generate-brand-icons.mjs [--check]
 *   --check  compare against the committed assets instead of writing them
 */

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(path.join(projectRoot, 'package.json'))('sharp');

const SOURCE = path.join(projectRoot, 'resources/brand/nexwork-source-1024.png');

/** Apple Big Sur icon grid. */
export const APPLE_BODY_FRACTION = 824 / 1024; // 0.8047
export const APPLE_CORNER_RATIO = 185.4 / 824; // 0.2250
/** Superellipse exponent approximating Apple's continuous corner. 2 = circular. */
const CORNER_EXPONENT = 3;
/** Supersampling factor per axis when rasterising the corner. */
const SUPERSAMPLE = 4;

/** `bodyFraction: 1` means full-bleed — correct everywhere except macOS. */
export const TARGETS = [
  { out: 'resources/app_dev.png', size: 1024, bodyFraction: APPLE_BODY_FRACTION },
  { out: 'resources/app.png', size: 1024, bodyFraction: 1 },
  { out: 'resources/icon.png', size: 800, bodyFraction: 1 },
  { out: 'public/pwa/icon-180.png', size: 180, bodyFraction: 1 },
  { out: 'public/pwa/icon-192.png', size: 192, bodyFraction: 1 },
  { out: 'public/pwa/icon-512.png', size: 512, bodyFraction: 1 },
  { out: 'packages/desktop/src/renderer/assets/logos/brand/app.png', size: 1024, bodyFraction: 1 },
];

/**
 * macOS menu-bar template images. A template is alpha-only — macOS recolours it
 * for the light/dark menu bar — so the full-colour app icon cannot be used: at
 * 16px the cream field swamps the mark and nothing is legible. These carry only
 * the glyph, extracted from the same source artwork so there is no second
 * source of truth for the mark.
 */
const TRAY_TEMPLATES = [
  ['resources/trayTemplate.png', 16],
  ['resources/trayTemplate@2x.png', 32],
];
/** Inset of the glyph inside the tray square, as a fraction of the square. */
const TRAY_INSET = 0.06;

/** macOS .icns members. iconutil requires exactly these names. */
const ICNS_MEMBERS = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];

/**
 * Renders the glyph alone as an alpha-only template image.
 *
 * The source is one image, so the glyph is recovered rather than re-drawn:
 * flood-filling from the canvas corners marks the outer cream field (the glyph
 * is enclosed by the dark panel, so the fill never reaches it), and inside the
 * panel the glyph is whatever is cream-coloured. Coverage comes from luminance,
 * which preserves the artwork's own antialiasing.
 */
async function renderTrayTemplate(source, size) {
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  const lum = (i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  const fieldLum = lum(0);

  const outside = new Uint8Array(w * h);
  const stack = [0, w - 1, (h - 1) * w, h * w - 1];
  while (stack.length) {
    const p = stack.pop();
    if (outside[p]) continue;
    if (Math.abs(lum(p * c) - fieldLum) > 24) continue;
    outside[p] = 1;
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }

  // Panel fill = the darkest thing inside the panel; glyph = the lightest.
  let panelLum = Infinity;
  for (let p = 0; p < w * h; p++) if (!outside[p]) panelLum = Math.min(panelLum, lum(p * c));

  const alpha = new Float32Array(w * h);
  let minX = w,
    minY = h,
    maxX = -1,
    maxY = -1;
  for (let p = 0; p < w * h; p++) {
    if (outside[p]) continue;
    const a = Math.min(1, Math.max(0, (lum(p * c) - panelLum) / (fieldLum - panelLum)));
    alpha[p] = a;
    if (a > 0.5) {
      const x = p % w;
      const y = (p - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  // Square the glyph bounds so the mark is not distorted by the resize.
  const side = Math.max(maxX - minX + 1, maxY - minY + 1);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const x0 = Math.round(cx - side / 2);
  const y0 = Math.round(cy - side / 2);

  const crop = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const sx = x0 + x;
      const sy = y0 + y;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      // RGB stays black: macOS reads only the alpha of a template image.
      crop[(y * side + x) * 4 + 3] = Math.round(alpha[sy * w + sx] * 255);
    }
  }

  const inner = Math.round(size * (1 - 2 * TRAY_INSET));
  const pad = Math.round((size - inner) / 2);
  return sharp(crop, { raw: { width: side, height: side, channels: 4 } })
    .resize(inner, inner, { kernel: 'lanczos3' })
    .extend({
      top: pad,
      bottom: size - inner - pad,
      left: pad,
      right: size - inner - pad,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Coverage of a rounded square with superellipse corners, at (x, y) in body space. */
function corner(x, y, size, radius) {
  const a = size / 2;
  const cx = Math.abs(x - a);
  const cy = Math.abs(y - a);
  const flat = a - radius;
  if (cx > a || cy > a) return false;
  if (cx <= flat || cy <= flat) return true;
  const u = (cx - flat) / radius;
  const v = (cy - flat) / radius;
  return Math.pow(u, CORNER_EXPONENT) + Math.pow(v, CORNER_EXPONENT) <= 1;
}

/** Antialiased alpha mask for the body, one byte per pixel. */
function buildMask(size) {
  const radius = size * APPLE_CORNER_RATIO;
  const mask = Buffer.alloc(size * size);
  const step = 1 / SUPERSAMPLE;
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  const inset = Math.ceil(radius) + 2;

  for (let y = 0; y < size; y++) {
    const nearCornerRow = y < inset || y >= size - inset;
    for (let x = 0; x < size; x++) {
      // Only the corner regions need supersampling; the rest is solid.
      if (!nearCornerRow && x >= inset && x < size - inset) {
        mask[y * size + x] = 255;
        continue;
      }
      let covered = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          if (corner(x + (sx + 0.5) * step, y + (sy + 0.5) * step, size, radius)) covered++;
        }
      }
      mask[y * size + x] = Math.round((covered / samples) * 255);
    }
  }
  return mask;
}

/**
 * Scales the whole artwork to the body size, rounds its corners, and places it
 * on a transparent canvas. The artwork is never decomposed.
 */
async function render(source, canvas, bodyFraction) {
  const body = Math.round(canvas * bodyFraction);
  const offset = Math.round((canvas - body) / 2);

  const { data, info } = await sharp(source)
    .resize(body, body, { kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const mask = buildMask(body);
  const out = Buffer.alloc(canvas * canvas * 4);
  for (let y = 0; y < body; y++) {
    for (let x = 0; x < body; x++) {
      const src = (y * body + x) * info.channels;
      const dst = ((y + offset) * canvas + (x + offset)) * 4;
      const alpha = (data[src + 3] * mask[y * body + x]) / 255;
      out[dst] = data[src];
      out[dst + 1] = data[src + 1];
      out[dst + 2] = data[src + 2];
      out[dst + 3] = Math.round(alpha);
    }
  }
  return sharp(out, { raw: { width: canvas, height: canvas, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function main() {
  const check = process.argv.includes('--check');
  if (!existsSync(SOURCE)) throw new Error(`Source artwork missing: ${SOURCE}`);

  const source = readFileSync(SOURCE);
  const meta = await sharp(source).metadata();
  console.log(`source ${meta.width}x${meta.height} — used whole, not decomposed`);

  const written = [];
  const mismatched = [];
  const emit = (rel, buf) => {
    const abs = path.join(projectRoot, rel);
    if (check) {
      if (!existsSync(abs) || !readFileSync(abs).equals(buf)) mismatched.push(rel);
      return;
    }
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, buf);
    written.push(rel);
  };

  const masters = new Map();
  const master = async (bodyFraction) => {
    if (!masters.has(bodyFraction)) masters.set(bodyFraction, await render(source, 1024, bodyFraction));
    return masters.get(bodyFraction);
  };

  for (const t of TARGETS) {
    const m = await master(t.bodyFraction);
    const buf =
      t.size === 1024
        ? m
        : await sharp(m).resize(t.size, t.size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
    emit(t.out, buf);
  }

  for (const [out, size] of TRAY_TEMPLATES) emit(out, await renderTrayTemplate(source, size));

  const macMaster = await master(APPLE_BODY_FRACTION);
  const work = mkdtempSync(path.join(tmpdir(), 'nexwork-icons-'));
  try {
    const iconset = path.join(work, 'app.iconset');
    mkdirSync(iconset);
    for (const [name, size] of ICNS_MEMBERS) {
      const buf =
        size === 1024
          ? macMaster
          : await sharp(macMaster).resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
      writeFileSync(path.join(iconset, name), buf);
    }
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(work, 'app.icns')]);
    emit('resources/app.icns', readFileSync(path.join(work, 'app.icns')));

    const winPng = path.join(work, 'win.png');
    writeFileSync(winPng, await master(1));
    execFileSync('bunx', ['png2icons', winPng, path.join(work, 'win'), '-icowe', '-bc', '-i'], { stdio: 'ignore' });
    emit('resources/app.ico', readFileSync(path.join(work, 'win.ico')));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  if (check) {
    if (mismatched.length) {
      console.error(`Icons differ from the generator output:\n  ${mismatched.join('\n  ')}`);
      process.exit(1);
    }
    console.log(`All ${TARGETS.length + TRAY_TEMPLATES.length + 2} icon assets match the generator output.`);
    return;
  }
  console.log(`Wrote ${written.length} assets:\n  ${written.join('\n  ')}`);
}

await main();
