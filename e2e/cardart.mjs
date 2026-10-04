// 그림리퍼 카드 면 그림 — 덱·받을 카드·관전자 덱에 그림이 뜬다
import { launch, waitFor, sleep, resetDB, check, failCount, addFail, startMatch, box } from './lib.mjs';
await resetDB();
const A = await launch('A', 9511), B = await launch('B', 9512);
try {
  await startMatch(A, B, 'Alice', 'Bobby');   // 개발자 모드가 아니어야 받을 카드 3장이 보인다
  await A.evalJs(`addCardToDeck({ ...CARD_DEFINITIONS.grim_reaper }); addCardToDeck({ ...CARD_DEFINITIONS.rock }); 1`);
  await sleep(600);
  await A.evalJs(`renderOfferedCards({ a: { cardId: 'grim_reaper' }, b: { cardId: 'black_hole' }, c: { cardId: 'dragon_breath' } }, true); 1`);
  await sleep(500);
  const r = await A.json(`JSON.stringify({
    deck: [...document.querySelectorAll('#deck-slots .card.card-art')].length,
    offer: [...document.querySelectorAll('#offer-cards .card.card-art')].length,
    bg: getComputedStyle(document.querySelector('#deck-slots .card.card-art')).backgroundImage.slice(0, 60),
    icon: getComputedStyle(document.querySelector('#deck-slots .card.card-art .card-icon')).visibility,
    others: document.querySelectorAll('#deck-slots .card:not(.card-art)').length })`);
  check('덱·받을 카드에 그림리퍼 카드 그림', r.deck === 1 && r.offer === 1 && /grim_reaper2\.jpg/.test(r.bg) && r.icon === 'hidden', JSON.stringify(r));
  check('다른 카드는 그대로 (돌)', r.others >= 1);
  const loaded = await A.evalJs(`new Promise(res => { const i = new Image(); i.onload = () => res(i.naturalWidth); i.onerror = () => res(0); i.src = 'img/cards/grim_reaper2.jpg'; })`);
  check('그림 파일이 실제로 불러와진다', loaded === 354, String(loaded));
  // 등급마다 한 장씩 — 배지 확인
  await A.evalJs(`['common','rare','epic','mythic','legendary','secret'].forEach(g => { const c = Object.values(CARD_DEFINITIONS).find(d => d.grade === g && d.id !== 'grim_reaper'); if (c) addCardToDeck({ ...c }); }); 1`);
  await sleep(600);
  const name = await A.evalJs(`getComputedStyle(document.querySelector('#deck-slots .card.card-art .card-name')).display + '|' + document.querySelector('#deck-slots .card.card-art .card-name').textContent`);
  check('그림리퍼 카드에 이름이 보인다', /^(?!none)/.test(name) && /리퍼|Reaper/i.test(name), name);
  const badge = await A.json(`JSON.stringify([...document.querySelectorAll('#deck-slots .card')].map(c => { const e = c.querySelector('.card-energy-cost'), g = c.querySelector('.card-grade-dot'); return [c.className.match(/grade-[a-z]+/)[0], getComputedStyle(e).color, getComputedStyle(e).display, getComputedStyle(g).display, e.getBoundingClientRect().width]; }))`);
  check('모든 카드에 비용·등급 배지 (같은 크기)', badge.every(b => b[2] !== 'none' && b[3] !== 'none' && Math.abs(b[4] - badge[0][4]) < 0.1), JSON.stringify(badge));
  const d = await box(A, '#deck-slots');
  const s2 = await A.send('Page.captureScreenshot', { format: 'png', clip: { x: d.x - d.w / 2 - 20, y: d.y - d.h / 2 - 20, width: d.w + 40, height: d.h + 40, scale: 2 } });
  (await import('fs')).writeFileSync('shot_badges.png', Buffer.from(s2.result.data, 'base64'));
  await A.evalJs(`const cs = document.querySelectorAll('#deck-slots .card'); cs[1].className = cs[1].className.replace(/grade-[a-z]+/, 'grade-mythic'); cs[2].className = cs[2].className.replace(/grade-[a-z]+/, 'grade-legendary'); 1`);
  await sleep(200);
  const s3 = await A.send('Page.captureScreenshot', { format: 'png', clip: { x: d.x - d.w / 2 - 20, y: d.y - d.h / 2 - 20, width: d.w + 40, height: d.h + 40, scale: 2 } });
  (await import('fs')).writeFileSync('shot_badges_offer.png', Buffer.from(s3.result.data, 'base64'));
  await A.shot('shot_cardart.png');
  const c = await box(A, '#deck-slots .card.card-art');
  await A.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y });
  await sleep(500);
  await A.shot('shot_cardart_hover.png');
  for (const b of [A, B]) if (b.exceptions.length) check(`[${b.name}] 예외 없음`, false, b.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { A.proc.kill(); B.proc.kill(); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
