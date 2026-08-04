// svg-assets/material-icons/*.svg → src/game/render/handIcons.ts
//
// 이 저장소에는 런타임에 로드되는 이미지 파일이 없다(SKILL.md §0). `svg-assets/` 의
// `.svg` 는 디자인 핸드오프 원본이고, 실제로 번들되는 건 코드다 — 오브젝트
// 스프라이트가 전부 그렇게 돼 있고 손그림 아이콘도 같은 규칙을 따른다.
// Vite 의 `?raw` 나 `import.meta.glob` 을 쓰지 않는 이유는 테스트 하네스가
// esbuild 로 직접 번들해서 그 변환이 없기 때문이다. 생성물이면 양쪽에서 돈다.
//
//   node scripts/build-hand-icons.mjs         모듈을 다시 만든다
//   node scripts/build-hand-icons.mjs --check 원본과 어긋났는지만 본다(종료코드)
//
// 검사 모드는 `npm run check:hand-icons` 로 묶여 있고 빌드에 물려 있다. 여기서
// 잡는 실패는 전부 **아무 신호가 없는** 것들이다: `.svg` 만 고치고 다시 굽지 않으면
// 옛 그림이 계속 나가고, 파일명이 어떤 물질의 키도 아니면 모듈에는 실리는데 화면에는
// 안 나오고, 하위 폴더나 대문자 확장자는 아예 읽히지도 않는다.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { parseIconSvg, iconKey } from './icon-svg.mjs';
import { collectMaterials } from './check-material-ids.mjs';

const SRC = 'svg-assets/material-icons';
const OUT = 'src/game/render/handIcons.ts';

// 파일명이 곧 배선 키다: `materialSvg.ts` 는 `iconKey(m.name)` 으로 찾는다. 키가
// 어떤 물질의 것도 아니면 그림은 모듈에 실리는데 화면에는 절대 안 나온다 —
// 검사 없이는 아무 신호가 없는 실패라, 실제 물질 목록과 맞춰 본다.
const KEYS = new Map();
for (const m of collectMaterials()) {
  const k = iconKey(m.name);
  // 두 물질이 같은 키로 뭉개지면 Map 은 조용히 마지막 것만 남기고, 아이콘 하나가
  // 엉뚱한 물질에 붙는다. 지금은 138종 전부 유일하지만 이름은 늘어난다.
  if (KEYS.has(k)) {
    console.error(`아이콘 키 '${k}' 를 두 물질이 공유한다: ${KEYS.get(k)} / ${m.name}`);
    process.exit(1);
  }
  KEYS.set(k, m.name);
}

const all = readdirSync(SRC, { withFileTypes: true });

/** 무엇이길래 못 읽는지 — 오류 문구에 그대로 들어간다. */
function shapeOf(d) {
  if (d.isDirectory()) return '하위 폴더';
  if (d.isSymbolicLink()) return '심볼릭 링크';
  if (d.isFIFO()) return '파이프(FIFO)';
  if (d.isSocket()) return '소켓';
  if (d.isCharacterDevice() || d.isBlockDevice()) return '장치 파일';
  return '일반 파일이 아닌 것';
}

// **받아들이는 모양을 하나만 정하고 나머지를 전부 막는다.** 못 읽는 모양을 하나씩
// 열거하는 쪽으로 짜면 열거에서 빠진 것이 조용히 사라진다 — 실제로 하위 폴더와
// 대문자 확장자를 막은 뒤에도 심볼릭 링크가, 그걸 막은 뒤에도 FIFO 가 그렇게
// 빠져나갔다. `isFile()` 이 아닌 건 전부 여기서 걸린다.
for (const d of all) {
  if (!d.isFile()) {
    console.error(`${SRC}/${d.name}: 일반 파일이 아니어서 읽지 않는다(${shapeOf(d)}) — 실제 .svg 파일을 둘 것.`);
    process.exit(1);
  }
  // 일반 파일이지만 `.SVG` 인 경우. 확장자가 소문자가 아니면 아래 filter 에서
  // 빠지므로, 무시하지 말고 알려 준다. 확장자가 아예 다른 파일(메모 등)은 통과.
  if (!d.name.endsWith('.svg') && /\.svg$/i.test(d.name)) {
    console.error(`${SRC}/${d.name}: 확장자는 소문자 '.svg' 여야 한다.`);
    process.exit(1);
  }
}

const files = all.filter((d) => d.name.endsWith('.svg')).map((d) => d.name).sort();

const entries = [];
for (const f of files) {
  const key = f.replace(/\.svg$/, '');
  if (!KEYS.has(key)) {
    const near = [...KEYS.keys()].find((k) => k.replace(/[^a-z0-9]/g, '') === key.replace(/[^a-z0-9]/g, ''));
    console.error(
      `${f}: '${key}' 는 어떤 물질의 아이콘 키도 아니다` +
        (near ? ` — '${near}.svg' 를 의도한 것 같다.` : '. 물질 영문명의 소문자 kebab-case 여야 한다.'),
    );
    process.exit(1);
  }
  let r;
  try {
    r = parseIconSvg(readFileSync(`${SRC}/${f}`, 'utf8'));
  } catch (e) {
    console.error(`${f}: ${e.message}`);
    process.exit(1);
  }
  entries.push([key, r.inner]);
}

const body = entries.map(([k, v]) => `  '${k}': '${v}',`).join('\n');
const out = `// GENERATED — 손대지 말 것. \`node scripts/build-hand-icons.mjs\` 가 만든다.
//
// 원본은 \`${SRC}/*.svg\` 이고, 규격은
// \`.claude/skills/create-svg-assets/MATERIAL-ICON-BRIEF.md\` 다. 여기 담긴 문자열은
// 그 파일들을 검수기(\`scripts/icon-svg.mjs\`)로 통과시킨 뒤 **출하 형태로 정규화한**
// \`<rect>\` 나열이다 — 작성자의 들여쓰기·공백·\`<svg>\` 래퍼는 들어 있지 않다.
// 래퍼는 \`materialSvg.ts\` 가 다시 씌운다.
//
// 원본과 어긋났는지는 \`npm run check:hand-icons\` 가 본다.

/** 아이콘 키(물질 영문명의 kebab-case) → 정규화된 \`<rect>\` 나열. */
export const HAND_ICONS: Readonly<Record<string, string>> = {
${body}
};
`;

if (process.argv.includes('--check')) {
  let cur = '';
  try {
    cur = readFileSync(OUT, 'utf8');
  } catch {
    console.error(`${OUT} 이 없다 — \`node scripts/build-hand-icons.mjs\` 를 돌릴 것.`);
    process.exit(1);
  }
  if (cur !== out) {
    console.error(
      `${OUT} 이 ${SRC}/ 와 어긋났다 — \`node scripts/build-hand-icons.mjs\` 를 돌려 갱신할 것.`,
    );
    process.exit(1);
  }
  console.log(`✓ 손그림 아이콘 ${entries.length}종, 모듈이 원본과 일치.`);
} else {
  // 전부 사라진 상태로 굽으면 손그림이 통째로 없는 모듈이 조용히 커밋된다.
  if (entries.length === 0) {
    console.error(`${SRC}/ 에 .svg 가 하나도 없다 — 의도한 것이라면 ${OUT} 을 직접 지울 것.`);
    process.exit(1);
  }
  writeFileSync(OUT, out);
  console.log(`✓ ${OUT} — ${entries.length}종 (${entries.map(([k]) => k).join(', ')})`);
}
