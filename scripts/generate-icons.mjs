#!/usr/bin/env node
// PWA 아이콘(PNG)을 src/assets/favicon.svg와 동일한 모양으로 코드 상에서 직접
// 래스터화해서 생성한다. 외부 이미지 툴/의존성(sharp, rsvg-convert 등) 없이
// Node 내장 zlib만으로 PNG를 인코딩하므로, favicon.svg 디자인이 바뀌면 이
// 스크립트의 SHAPES만 맞춰 고치고 다시 실행하면 된다(`node scripts/generate-icons.mjs`).
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

// favicon.svg의 viewBox(0 0 32 32) 좌표계 그대로 사용.
const BG = [0x10, 0x10, 0x14];
const BAR = [0x3c, 0x82, 0xd2];
const DOT = [0xe8, 0xc9, 0x6b];

const CIRCLES = [
  [10, 20],
  [16, 23],
  [22, 20],
  [13, 26],
  [19, 26],
].map(([cx, cy]) => ({ cx, cy, r: 2.4 }));

function insideRoundedRect(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  if (r <= 0) return true;
  const left = px - x;
  const right = x + w - px;
  const top = py - y;
  const bottom = y + h - py;
  let dx = 0;
  let dy = 0;
  if (left < r && top < r) {
    dx = r - left;
    dy = r - top;
  } else if (right < r && top < r) {
    dx = r - right;
    dy = r - top;
  } else if (left < r && bottom < r) {
    dx = r - left;
    dy = r - bottom;
  } else if (right < r && bottom < r) {
    dx = r - right;
    dy = r - bottom;
  } else {
    return true;
  }
  return dx * dx + dy * dy <= r * r;
}

function insideCircle(px, py, cx, cy, r) {
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

// scale: bar+circle 그룹을 중심(16,16) 기준으로 축소해 maskable 안전 영역
// (중앙 지름 80% 원) 안쪽으로 모은다. standard 아이콘은 scale=1(원본 그대로).
function buildScene({ rounded, scale }) {
  const cx = 16;
  const cy = 16;
  const s = scale;
  const barX = cx + (6 - cx) * s;
  const barY = cy + (7 - cy) * s;
  const barW = 20 * s;
  const barH = 5 * s;
  const barR = 2 * s;
  const circles = CIRCLES.map((c) => ({
    cx: cx + (c.cx - cx) * s,
    cy: cy + (c.cy - cy) * s,
    r: c.r * s,
  }));
  return {
    shapeAt(px, py) {
      for (const c of circles) {
        if (insideCircle(px, py, c.cx, c.cy, c.r)) return DOT;
      }
      if (insideRoundedRect(px, py, barX, barY, barW, barH, barR)) return BAR;
      if (rounded) {
        if (insideRoundedRect(px, py, 0, 0, 32, 32, 6)) return BG;
        return null; // 투명 (아이콘 바깥 = 둥근 모서리 밖)
      }
      return BG; // maskable: 배경이 캔버스 전체를 꽉 채움(플랫폼이 알아서 마스킹)
    },
  };
}

function rasterize(size, scene) {
  const SS = 4; // 서브픽셀 슈퍼샘플링 배수 (안티에일리어싱)
  const px2v = 32 / size;
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let iy = 0; iy < size; iy++) {
    for (let ix = 0; ix < size; ix++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        const vy = (iy + (sy + 0.5) / SS) * px2v;
        for (let sx = 0; sx < SS; sx++) {
          const vx = (ix + (sx + 0.5) / SS) * px2v;
          const color = scene.shapeAt(vx, vy);
          if (color) {
            r += color[0];
            g += color[1];
            b += color[2];
            a += 255;
          }
        }
      }
      const n = SS * SS;
      const o = (iy * size + ix) * 4;
      if (a === 0) {
        rgba[o] = 0;
        rgba[o + 1] = 0;
        rgba[o + 2] = 0;
        rgba[o + 3] = 0;
      } else {
        // 부분 커버리지 픽셀은 색상을 커버된 샘플만으로 평균(불투명 색 유지),
        // 알파만 커버리지 비율로 낮춘다.
        const covered = a / 255;
        rgba[o] = r / covered;
        rgba[o + 1] = g / covered;
        rgba[o + 2] = b / covered;
        rgba[o + 3] = Math.round((a / n));
      }
    }
  }
  return rgba;
}

// --- 최소 PNG 인코더 (8bit RGBA, filter 0, Node 내장 zlib로 압축) ---
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(size, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function generate(name, size, opts) {
  const rgba = rasterize(size, buildScene(opts));
  const png = encodePNG(size, rgba);
  const outPath = path.join(outDir, name);
  writeFileSync(outPath, png);
  console.log(`wrote ${path.relative(process.cwd(), outPath)} (${size}x${size})`);
}

generate('icon-192.png', 192, { rounded: true, scale: 1 });
generate('icon-512.png', 512, { rounded: true, scale: 1 });
generate('icon-512-maskable.png', 512, { rounded: false, scale: 0.72 });
generate('apple-touch-icon.png', 180, { rounded: true, scale: 1 });
