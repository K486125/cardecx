// ════════════════════════════════════════════════════════════
// 개발자 전용 도구 (테스트용)
// 로비에서 닉네임 뒤에 '#Dev'를 붙이면 켜진다 — 예: "Alice#Dev"
// '#'은 Firebase 경로에 쓸 수 없으므로 닉네임 자체는 '#Dev'를 뗀 이름으로 등록된다.
// 켜지면 카드 선택 UI가 카드 검색기로 바뀌어, 원하는 카드를 바로 덱에 넣을 수 있다.
// (뽑기 풀에서 빠져 있는 진화 카드도 검색해서 바로 쓸 수 있다)
// ════════════════════════════════════════════════════════════

const DEV_SUFFIX_RE = /#dev$/i;

/** 닉네임 입력에서 '#Dev'를 떼어낸다 → { nick, dev } */
function devParseNickname(raw) {
  const dev = DEV_SUFFIX_RE.test(raw);
  return { nick: dev ? raw.replace(DEV_SUFFIX_RE, '').trim() : raw, dev };
}

function devSetMode(on) {
  sessionStorage.setItem('devMode', on ? '1' : '0');
}

function devModeOn() {
  return sessionStorage.getItem('devMode') === '1';
}

let _devQuery = '';

/** 제공 카드 영역을 카드 검색기로 바꾼다 (deck.js renderOfferedCards에서 호출) */
function devRenderPicker(container, label) {
  if (!container) return;
  if (label) label.textContent = t('devPickerLabel');

  // 이미 만들어져 있으면 입력 중인 내용을 지우지 않는다
  if (container.querySelector('.dev-picker')) { devRenderResults(); return; }

  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'dev-picker';
  wrap.innerHTML =
    `<input id="dev-card-search" class="dev-card-search" type="text" autocomplete="off" spellcheck="false" placeholder="${t('devSearchPlaceholder')}">` +
    `<div id="dev-card-results" class="dev-card-results"></div>`;
  container.appendChild(wrap);

  const input = wrap.querySelector('#dev-card-search');
  input.value = _devQuery;
  input.addEventListener('input', () => { _devQuery = input.value; devRenderResults(); });
  input.addEventListener('keydown', e => {
    e.stopPropagation();   // 검색어가 게임 단축키로 새지 않게
    if (e.key === 'Enter')  document.querySelector('#dev-card-results .dev-card-row')?.click();
    if (e.key === 'Escape') { input.value = ''; _devQuery = ''; devRenderResults(); }
  });

  devRenderResults();
}

/** 검색 결과 목록 — 이름·설명·카드 id 어느 쪽으로도 찾을 수 있다 */
function devRenderResults() {
  const box = document.getElementById('dev-card-results');
  if (!box) return;

  const q   = _devQuery.trim().toLowerCase();
  const ids = Object.keys(CARD_DEFINITIONS).filter(id => {
    if (!q) return true;
    return id.toLowerCase().includes(q) ||
           tCard(id, 'name').toLowerCase().includes(q) ||
           tCard(id, 'desc').toLowerCase().includes(q);
  });

  box.innerHTML = '';
  if (!ids.length) {
    const none = document.createElement('div');
    none.className = 'dev-card-none';
    none.textContent = t('devNoResult');
    box.appendChild(none);
    return;
  }

  ids.forEach(id => {
    const card     = CARD_DEFINITIONS[id];
    const isEvolved = EVOLUTION_ORIGIN[id] !== undefined;
    const row = document.createElement('div');
    row.className = `dev-card-row grade-${card.grade}`;
    row.dataset.cardId = id;
    row.innerHTML =
      `<span class="dev-card-icon">${card.icon}</span>` +
      `<span class="dev-card-name">${tCard(id, 'name')}${isEvolved ? ' ✨' : ''}</span>` +
      `<span class="dev-card-cost">⚡${card.energyCost}</span>`;
    row.title = tCard(id, 'desc');
    row.addEventListener('click', () => devGiveCard(id));
    box.appendChild(row);
  });
}

/** 고른 카드를 바로 덱에 넣는다 — 쌓기·대체 규칙은 평소와 같다 */
function devGiveCard(cardId) {
  const card = CARD_DEFINITIONS[cardId];
  if (!card || deckInputLocked()) return;
  addCardToDeck({ ...card });
  devFlashRow(cardId);
}

/** 넣었다는 표시 */
function devFlashRow(cardId) {
  const row = document.querySelector(`.dev-card-row[data-card-id="${cardId}"]`);
  if (!row) return;
  row.classList.remove('dev-card-added');
  void row.offsetWidth;
  row.classList.add('dev-card-added');
}
