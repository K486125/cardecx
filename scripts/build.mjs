// dist/ 만들기 — 배포본은 손으로 복사하지 않는다.
// firebase.json의 hosting predeploy가 'firebase.cmd deploy' 때마다 이 스크립트를 먼저 돌린다.
//   node scripts/build.mjs        직접 돌려도 된다
// 소스(css · js · fx · img · game.html · index.html · firebase-config.js)를 dist/에 그대로 비추고,
// 소스에 없는 파일은 dist/에서 지운다. 만들기용 파일(*.py · *.gen.*)은 넣지 않는다.
import { readdirSync, statSync, mkdirSync, copyFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const DIRS = ['css', 'js', 'fx', 'img'];
const FILES = ['game.html', 'index.html', 'firebase-config.js'];
const SKIP = name => /\.py$/.test(name) || /\.gen\./.test(name) || name.startsWith('.');

const walk = dir => readdirSync(dir).flatMap(n => {
  if (SKIP(n)) return [];
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

if (!existsSync(join(ROOT, 'firebase-config.js'))) {
  console.error('firebase-config.js 가 없습니다 — firebase-config.example.js를 복사해 키를 채우세요.');
  process.exit(1);
}

const want = new Set();
for (const d of DIRS) for (const f of walk(join(ROOT, d))) want.add(relative(ROOT, f));
for (const f of FILES) want.add(f);

let copied = 0, same = 0, removed = 0;
for (const rel of want) {
  const from = join(ROOT, rel), to = join(DIST, rel);
  mkdirSync(dirname(to), { recursive: true });
  if (existsSync(to) && statSync(to).size === statSync(from).size && readFileSync(to).equals(readFileSync(from))) { same++; continue; }
  copyFileSync(from, to);
  copied++;
}
// 소스에서 사라진 파일 — dist에서도 지운다 (지운 카드 · 그림이 배포본에 남지 않게)
if (existsSync(DIST)) for (const f of walk(DIST)) {
  const rel = relative(DIST, f);
  if (!want.has(rel)) { rmSync(f); removed++; }
}
console.log(`dist 준비 — 바뀐 파일 ${copied} · 그대로 ${same} · 지운 파일 ${removed}`.replaceAll(sep, '/'));
