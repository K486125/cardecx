// 빠른 검사 — 커밋할 때마다 git pre-commit 훅이 돌린다 (몇 초).
//   node scripts/check.mjs
//   · js/ · scripts/ · e2e/ 의 모든 스크립트 문법 (node --check)
//   · database.rules.json · firebase.json 이 올바른 JSON인가
//   · 진짜 키(firebase-config.js)가 커밋에 들어가지 않는가
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const bad = (what, why) => { fails++; console.error(`✗ ${what}\n  ${String(why).split('\n').slice(0, 6).join('\n  ')}`); };

// vendor(외부 라이브러리) · e2e/site(테스트용 복사본)는 건너뛴다
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? (['vendor', 'site', 'node_modules'].includes(e.name) ? [] : walk(join(dir, e.name)))
                  : /\.(m?js)$/.test(e.name) ? [join(dir, e.name)] : []);
const scripts = ['js', 'scripts', 'e2e'].flatMap(d => walk(join(ROOT, d)));
for (const f of scripts) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { bad(f.slice(ROOT.length + 1), e.stderr?.toString() || e.message); }
}
for (const f of ['database.rules.json', 'firebase.json']) {
  try { JSON.parse(readFileSync(join(ROOT, f), 'utf8')); } catch (e) { bad(f, e.message); }
}
try {
  const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: ROOT }).toString().split('\n');
  if (staged.some(p => /(^|\/)firebase-config\.js$/.test(p))) bad('firebase-config.js', '진짜 키가 담긴 파일은 커밋하지 않습니다 (.gitignore)');
} catch { /* git 밖에서 돌리면 건너뛴다 */ }

if (fails) { console.error(`\n검사 실패 ${fails}건 — 고친 뒤 다시 커밋하세요.`); process.exit(1); }
console.log(`검사 통과 — 스크립트 ${scripts.length}개 · 규칙 · 설정`);
