import type { Grid } from '../engine/Grid';
import { allMaterials } from '../materials/registry';
import { AMBIENT_TEMP } from '../config';

export interface PresetMeta {
  id: string;
  name: {
    ko: string;
    en: string;
  };
  desc: {
    ko: string;
    en: string;
  };
  icon: string;
  badge: {
    ko: string;
    en: string;
  };
}

export const PRESETS: PresetMeta[] = [
  {
    id: 'volcano',
    name: {
      ko: '화산과 화산유리',
      en: 'Volcano & Obsidian',
    },
    desc: {
      ko: '용암 풀 위로 떨어지는 물이 흑요석(Obsidian) 껍질과 격렬한 수증기를 형성하는 자연재해 맵',
      en: 'Water falling into a lava pool forms obsidian crusts and intense steam plumes',
    },
    icon: '🌋',
    badge: {
      ko: '열/상전이',
      en: 'Phase Change',
    },
  },
  {
    id: 'blast_furnace',
    name: {
      ko: '고로 철 제련소',
      en: 'Blast Furnace Smelting',
    },
    desc: {
      ko: '철광석, 석탄가루, 석회석을 높이별로 충전하고 하단 열원으로 환원하여 쇳물을 얻는 제련 맵',
      en: 'Layered iron ore, coal powder, and limestone smelting into molten iron via high heat',
    },
    icon: '⚒️',
    badge: {
      ko: '야금/화학',
      en: 'Metallurgy',
    },
  },
  {
    id: 'circuit',
    name: {
      ko: '전자회로 & 메카트로닉스',
      en: 'Circuitry & Physics',
    },
    desc: {
      ko: '배터리, Wire, 레이저, 우퍼, C4 폭약이 복합 배선되어 전기를 전파하는 메카트로닉스 맵',
      en: 'Batteries, wires, lasers, woofers, and C4 explosives wired into an interactive circuit',
    },
    icon: '⚡',
    badge: {
      ko: '전기/물리',
      en: 'Electronics',
    },
  },
  {
    id: 'refinery',
    name: {
      ko: '석유 정제 분별증류탑',
      en: 'Petroleum Refinery',
    },
    desc: {
      ko: '원유 수조와 간접열 용기, 촉매(Catalyst) 분별 증류 파이프라인이 구비된 석유화학 맵',
      en: 'Crude oil basin, heating vessel, and catalyst tubes for fractional distillation',
    },
    icon: '🛢️',
    badge: {
      ko: '석유/유분',
      en: 'Refining',
    },
  },
  {
    id: 'ecosystem',
    name: {
      ko: '생태계와 생명',
      en: 'Ecosystem & Life',
    },
    desc: {
      ko: '흙, 웅덩이, 번성하는 식물과 나무를 갈아먹는 흰개미(Termite)가 번식하는 생태계 맵',
      en: 'Dirt, water pond, flourishing plants, and termites feeding on wood',
    },
    icon: '🌿',
    badge: {
      ko: '생물/번식',
      en: 'Ecosystem',
    },
  },
];

function setCell(
  grid: Grid,
  x: number,
  y: number,
  matId: number,
  temp: number = AMBIENT_TEMP,
  aux: number = 0
): void {
  if (x < 0 || x >= grid.width || y < 0 || y >= grid.height) return;
  const idx = y * grid.width + x;
  grid.cells[idx] = matId;
  grid.temp[idx] = temp;
  grid.aux[idx] = aux;
  grid.markActive(x, y);
}

function fillRect(
  grid: Grid,
  x0: number,
  y0: number,
  w: number,
  h: number,
  matId: number,
  temp: number = AMBIENT_TEMP,
  aux: number = 0
): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      setCell(grid, x0 + dx, y0 + dy, matId, temp, aux);
    }
  }
}

function safeGetId(name: string): number {
  const found = allMaterials().find((m) => m && m.name.toLowerCase() === name.toLowerCase());
  return found ? found.id : 0;
}

/**
 * Populates the grid with a preset map scenario based on presetId.
 * Clears the existing grid first.
 */
export function applyPreset(grid: Grid, presetId: string): boolean {
  const meta = PRESETS.find((p) => p.id === presetId);
  if (!meta) return false;

  // Clear current grid cells
  grid.cells.fill(0);
  grid.overlay.fill(0);
  grid.overlayAux.fill(0);
  grid.aux.fill(0);
  grid.temp.fill(AMBIENT_TEMP);
  grid.objects.length = 0;

  const gw = grid.width;
  const gh = grid.height;

  const wallId = safeGetId('wall');
  const stoneId = safeGetId('stone');
  const dirtId = safeGetId('dirt');
  const soilId = safeGetId('soil');
  const lavaId = safeGetId('lava');
  const waterId = safeGetId('water');
  const ironOreId = safeGetId('ironore');
  const coalPowderId = safeGetId('coalpowder');
  const limestoneId = safeGetId('limestone');
  const fireId = safeGetId('fire');
  const batteryId = safeGetId('battery');
  const wireId = safeGetId('wire');
  const laserId = safeGetId('laser');
  const wooferId = safeGetId('woofer');
  const c4Id = safeGetId('c4');
  const sparkId = safeGetId('spark');
  const oilId = safeGetId('oil');
  const catalystId = safeGetId('catalyst');
  const plantId = safeGetId('plant');
  const termiteId = safeGetId('termite');
  const woodId = safeGetId('wood');

  switch (presetId) {
    case 'volcano': {
      // Bottom lava lake surrounded by stone volcano walls
      const volcanoWidth = Math.floor(gw * 0.7);
      const startX = Math.floor((gw - volcanoWidth) / 2);
      const lavaY = Math.floor(gh * 0.1);
      const lavaHeight = Math.floor(gh * 0.2);

      // Volcano base slope
      for (let y = 0; y < lavaY + lavaHeight + 20; y++) {
        const factor = y / (lavaY + lavaHeight + 20);
        const margin = Math.floor(startX * (1 - factor * 0.5));
        fillRect(grid, 0, y, margin, 1, stoneId);
        fillRect(grid, gw - margin, y, margin, 1, stoneId);
      }

      // Volcano floor & Lava pool
      fillRect(grid, startX, 0, volcanoWidth, lavaY, stoneId);
      fillRect(grid, startX, lavaY, volcanoWidth, lavaHeight, lavaId, 1200);

      // Water cloud / rain stream from above
      const waterStreamWidth = Math.floor(gw * 0.2);
      const waterX = Math.floor((gw - waterStreamWidth) / 2);
      const waterY = Math.floor(gh * 0.75);
      fillRect(grid, waterX, waterY, waterStreamWidth, Math.floor(gh * 0.15), waterId);
      break;
    }

    case 'blast_furnace': {
      // High blast furnace column in the middle
      const fWidth = Math.floor(gw * 0.35);
      const fX = Math.floor((gw - fWidth) / 2);
      const wallThick = 4;
      const fHeight = Math.floor(gh * 0.7);

      // Outer walls
      fillRect(grid, fX, 0, wallThick, fHeight, wallId);
      fillRect(grid, fX + fWidth - wallThick, 0, wallThick, fHeight, wallId);
      fillRect(grid, fX, 0, fWidth, 3, wallId);

      const innerX = fX + wallThick;
      const innerW = fWidth - wallThick * 2;

      // Bottom heating fire/lava
      fillRect(grid, innerX, 3, innerW, 8, lavaId, 1400);
      fillRect(grid, innerX, 11, innerW, 4, fireId, 1000);

      // Layers: Limestone, Coal Powder, Iron Ore
      let curY = 15;
      const layerH = Math.floor((fHeight - 20) / 4);

      fillRect(grid, innerX, curY, innerW, layerH, limestoneId);
      curY += layerH;
      fillRect(grid, innerX, curY, innerW, layerH, coalPowderId);
      curY += layerH;
      fillRect(grid, innerX, curY, innerW, layerH, ironOreId);
      curY += layerH;
      fillRect(grid, innerX, curY, innerW, layerH, coalPowderId);
      break;
    }

    case 'circuit': {
      // Battery -> Wire -> Laser / Woofer / C4
      const centerY = Math.floor(gh * 0.4);
      const startX = Math.floor(gw * 0.15);

      // Battery source
      fillRect(grid, startX, centerY - 5, 8, 10, batteryId);

      // Wire trunk
      const wireLen = Math.floor(gw * 0.5);
      fillRect(grid, startX + 8, centerY, wireLen, 2, wireId);

      // Add a spark trigger on the wire
      setCell(grid, startX + 9, centerY, sparkId);

      // Branch 1: Woofer
      fillRect(grid, startX + 25, centerY + 2, 2, 15, wireId);
      fillRect(grid, startX + 22, centerY + 17, 8, 8, wooferId);

      // Branch 2: Laser
      fillRect(grid, startX + 45, centerY - 15, 2, 15, wireId);
      fillRect(grid, startX + 42, centerY - 20, 8, 5, laserId);

      // Target: C4 block on the right
      fillRect(grid, startX + wireLen, centerY - 8, 12, 16, c4Id);
      break;
    }

    case 'refinery': {
      // Fractional distillation column & oil basin
      const rWidth = Math.floor(gw * 0.3);
      const rX = Math.floor(gw * 0.2);
      const rH = Math.floor(gh * 0.65);
      const wallThick = 3;

      // Vessel wall
      fillRect(grid, rX, 0, wallThick, rH, wallId);
      fillRect(grid, rX + rWidth, 0, wallThick, rH, wallId);
      fillRect(grid, rX, 0, rWidth + wallThick, wallThick, wallId);

      const innerX = rX + wallThick;
      const innerW = rWidth - wallThick;

      // Bottom Crude Oil pool + Heat source
      fillRect(grid, innerX, wallThick, innerW, 5, lavaId, 900);
      fillRect(grid, innerX, wallThick + 5, innerW, Math.floor(rH * 0.35), oilId);

      // Catalyst plates in upper levels
      fillRect(grid, innerX, wallThick + Math.floor(rH * 0.5), Math.floor(innerW * 0.6), 2, catalystId);
      fillRect(
        grid,
        innerX + Math.floor(innerW * 0.4),
        wallThick + Math.floor(rH * 0.65),
        Math.floor(innerW * 0.6),
        2,
        catalystId
      );
      break;
    }

    case 'ecosystem': {
      // Dirt floor + Water pond + Plant growth + Wood & Termites
      const soilH = Math.floor(gh * 0.25);

      // Floor (Dirt/Soil)
      fillRect(grid, 0, 0, gw, soilH, soilId);

      // Water Pond in middle
      const pondW = Math.floor(gw * 0.3);
      const pondX = Math.floor(gw * 0.1);
      fillRect(grid, pondX, 0, pondW, soilH - 2, dirtId);
      fillRect(grid, pondX, Math.floor(soilH * 0.3), pondW, Math.floor(soilH * 0.6), waterId);

      // Plant trees and grass on the right
      const plantX = Math.floor(gw * 0.5);
      const plantW = Math.floor(gw * 0.4);
      fillRect(grid, plantX, soilH, plantW, 6, plantId);

      // Wood log with termites
      const woodX = Math.floor(gw * 0.65);
      fillRect(grid, woodX, soilH + 6, 12, 10, woodId);
      fillRect(grid, woodX + 3, soilH + 16, 6, 4, termiteId);
      break;
    }
  }

  grid.randomizeTints();
  return true;
}
