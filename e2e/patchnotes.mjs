// 닉네임 화면 아래 밸런스 패치 노트
import { writeFileSync } from 'node:fs';
import { launch, waitFor, sleep, resetDB, check, failCount, addFail } from './lib.mjs';

await resetDB();
const A = await launch('A', 9641);
const all = [A];
const shot = async file => { const s = await A.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(s.result.data, 'base64')); };
try {
  await A.goto('/index.html');
  await waitFor(A, `typeof confirmNickname === 'function' && document.readyState === 'complete' && !document.getElementById('screen-nickname').classList.contains('hidden')`, 15000);
  await sleep(1200);
  const btn = await A.json(`JSON.stringify((() => { const b = document.getElementById('btn-patch-notes').getBoundingClientRect();
    const c = document.getElementById('btn-confirm-nickname').getBoundingClientRect(), p = document.querySelector('.nickname-panel').getBoundingClientRect();
    return { below: b.top >= c.bottom, inside: b.bottom <= p.bottom, modal: !!document.getElementById('pn-modal'),
             panelH: Math.round(document.querySelector('.nickname-panel').offsetHeight) }; })())`);
  check('닉네임 확인 아래에 패치 노트 버튼 (패널 안, 패널은 원래 크기)', btn.below && btn.inside && !btn.modal && btn.panelH === 480, JSON.stringify(btn));
  await shot('pn_button.png');
  await A.evalJs(`document.getElementById('btn-patch-notes').click(); 1`);
  await sleep(400);
  const info = await A.json(`JSON.stringify((() => {
    const m = document.getElementById('pn-modal'); if (!m) return null;
    const d = m.querySelector('.pn-dialog').getBoundingClientRect();
    const sc = m.querySelector('.pn-scroll');
    return { rows: m.querySelectorAll('.pn-row').length, patches: m.querySelectorAll('.pn-patch').length,
      fits: d.top >= 0 && d.bottom <= innerHeight && d.left >= 0 && d.right <= innerWidth,
      scrolls: sc.scrollHeight > sc.clientHeight,
      apo: [...m.querySelectorAll('.pn-row')].some(e => e.textContent.includes('아포칼립스') && e.textContent.includes('220')) };
  })())`);
  check('버튼을 누르면 패치 노트 창이 화면 안에 뜬다', !!info && info.fits, JSON.stringify(info));
  check('패치 열한 묶음 · 모든 변경 줄', info?.patches === 11 && info?.rows === 86 && info?.apo, JSON.stringify(info));
  check('길면 창 안에서 스크롤', info?.scrolls);
  await shot('pn_top.png');
  await A.evalJs(`document.querySelector('.pn-scroll').scrollTop = 900; 1`);
  await sleep(200);
  await shot('pn_mid.png');
  await A.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await A.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(400);
  check('Esc로 닫힌다', await A.evalJs(`!document.getElementById('pn-modal')`) === true);
  await A.evalJs(`document.getElementById('btn-patch-notes').click(); 1`);
  await sleep(300);
  await A.evalJs(`document.getElementById('pn-modal').dispatchEvent(new MouseEvent('click', { bubbles: true })); 1`);
  await sleep(400);
  check('바깥(어두운 막)을 눌러도 닫힌다', await A.evalJs(`!document.getElementById('pn-modal')`) === true);
  await A.evalJs(`document.getElementById('btn-patch-notes').click(); 1`);
  await sleep(300);
  await A.evalJs(`document.querySelector('.pn-close').click(); 1`);
  await sleep(400);
  check('✕로 닫힌다', await A.evalJs(`!document.getElementById('pn-modal')`) === true);
  // ── 카드 확률 안내 ──
  const cb = await A.json(`JSON.stringify((() => { const b = document.getElementById('btn-card-rates').getBoundingClientRect();
    const pn = document.getElementById('btn-patch-notes').getBoundingClientRect(), p = document.querySelector('.nickname-panel').getBoundingClientRect();
    return { below: b.top >= pn.bottom, inside: b.bottom <= p.bottom }; })())`);
  check('패치 노트 버튼 아래에 카드 확률 버튼 (패널 안)', cb.below && cb.inside, JSON.stringify(cb));
  await shot('cr_button.png');
  await A.evalJs(`document.getElementById('btn-card-rates').click(); 1`);
  await sleep(400);
  const cr = await A.json(`JSON.stringify((() => {
    const m = document.getElementById('pn-modal'); if (!m) return null;
    const d = m.querySelector('.pn-dialog').getBoundingClientRect();
    const grades = [...m.querySelectorAll('.cr-grade:not(.cr-evolve)')].map(g => ({
      name: g.querySelector('.cr-grade-name').textContent, pct: g.querySelector('.cr-grade-pct').textContent,
      cards: [...g.querySelectorAll('.cr-row')].map(r => r.querySelector('.pn-name').textContent + '=' + r.querySelector('.cr-pct').textContent) }));
    return { title: m.querySelector('.pn-title').textContent, fits: d.top >= 0 && d.bottom <= innerHeight, grades,
             sum: grades.reduce((s, g) => s + parseFloat(g.pct), 0), evo: m.querySelectorAll('.cr-evo').length };
  })())`);
  check('카드 확률 창 — 등급 6개 · 합 100%', cr?.title === '카드 확률 안내' && cr.fits && cr.grades.length === 6 && Math.abs(cr.sum - 100) < 0.01, JSON.stringify(cr && { sum: cr.sum, g: cr.grades.map(g => g.name + g.pct) }));
  const com = cr?.grades.find(g => g.name === '일반'), sec = cr?.grades.find(g => g.name === '비밀');
  check('카드마다 확률 — 일반 55% ÷ 5종 = 11%, 비밀 0.05% ÷ 2종 = 0.025%',
        com?.pct === '55%' && com.cards.includes('목검=11%') && sec?.pct === '0.05%' && sec.cards.every(c => c.endsWith('=0.025%')), JSON.stringify([com, sec]));
  check('진화 카드는 뽑기 없음 — 11종 안내', cr?.evo === 11, String(cr?.evo));
  await shot('cr_top.png');
  await A.evalJs(`document.querySelector('.pn-scroll').scrollTop = 1400; 1`);
  await sleep(200);
  await shot('cr_mid.png');
  await A.evalJs(`document.querySelector('.pn-close').click(); 1`);
  await sleep(400);
  check('카드 확률 창도 ✕로 닫힌다', await A.evalJs(`!document.getElementById('pn-modal')`) === true);

  // 닉네임 입력은 그대로 된다
  await A.evalJs(`document.getElementById('input-nickname').value='Alice'; document.getElementById('btn-confirm-nickname').click(); 1`);
  await waitFor(A, `!document.getElementById('screen-room').classList.contains('hidden')`, 8000)
    .then(() => check('닉네임 확인은 그대로 된다', true)).catch(() => check('닉네임 확인은 그대로 된다', false));
  if (A.exceptions.length) check('예외 없음', false, A.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { all.forEach(b => b.proc.kill()); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
