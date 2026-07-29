// temp/material-icons/*.svg → src/game/render/handIcons.ts
//
// 이 저장소에는 런타임에 로드되는 이미지 파일이 없다(SKILL.md §0). `temp/` 의
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

const SRC = 'temp/material-icons';
const OUT = 'src/game/render/handIcons.ts';

// 파일명이 곧 배선 키다: `materialSvg.ts` 는 `iconKey(m.name)` 으로 찾는다. 키가
// 어떤 물질의 것도 아니면 그림은 모듈에 실리는데 화면에는 절대 안 나온다 —
// 검사 없이는 아무 신호가 없는 실패라, 실제 물질 목록과 맞춰 본다.
const KEYS = new Map(collectMaterials().map((m) => [iconKey(m.name), m.name]));

const all = readdirSync(SRC, { withFileTypes: true });
// 하위 폴더에 넣으면 readdir 이 못 보고 조용히 빠진다. 확장자 대소문자도 같다.
for (const d of all) {
  if (d.isDirectory()) {
    console.error(`${SRC}/${d.name}/: 하위 폴더는 읽지 않는다 — .svg 는 바로 이 폴더에 둘 것.`);
    process.exit(1);
  }
  if (!d.name.endsWith('.svg') && /\.svg$/i.test(d.name)) {
    console.error(`${d.name}: 확장자는 소문자 '.svg' 여야 한다.`);
    process.exit(1);
  }
}

const files = all.filter((d) => d.isFile() && d.name.endsWith('.svg')).map((d) => d.name).sort();
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
  writeFileSync(OUT, out);
  console.log(`✓ ${OUT} — ${entries.length}종 (${entries.map(([k]) => k).join(', ')})`);
}
