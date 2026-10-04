// ============================================================
//  i18n.js — UI 문자열 테이블 (한국어)
// ============================================================

const STRINGS = {
  subtitle:            '닉네임을 입력하고 게임을 시작하세요',
  confirmBtn:          '확인',
  confirmingBtn:       '확인 중...',
  roomListTitle:       '방 목록',
  joinByCodeTitle:     '코드로 참가하기',
  roomCodeInputPlaceholder: '코드 입력',
  createRoom:          '방 만들기',
  creatingRoom:        '생성 중...',
  joinRoom:            '방 접속',
  joiningRoom:         '접속 중...',
  noRooms:             '대기 중인 방이 없습니다.',

  // 연결 상태 안내 (js/netstate.js)
  netReconnecting:     '인터넷에 다시 연결하는 중',
  netBack:             '연결이 복구됐습니다',
  netLostTitle:        '인터넷 연결을 확인해 주세요',
  netLostBody:         '서버와 연결이 끈겼습니다. Wi-Fi나 데이터 상태를 확인해 주세요.',
  netLostNote:         '연결이 돌아오면 자동으로 이어서 진행됩니다 · 끈긴 시간',
  netLostNoteSpec:     '연결이 돌아오면 지금 경기 상황으로 바로 다시 맞춰집니다 · 끊긴 시간',
  netRetrying:         '다시 연결하는 중…',
  netRetry:            '다시 시도',

  // 투척 차징 조작법 (js/board.js shape 'throw')
  throwChargeHint:     'Space 꾹 → 클릭',
  host:                '방장: ',
  join:                '참가',
  roomWaiting:         '대기중..',
  spectate:            '관전',
  spectateNotReady:    '아직 관전 할 수 없습니다',
  nickLengthError:     '닉네임은 2~12자여야 합니다.',
  nickTakenError:      '이미 사용 중인 닉네임입니다.',
  nickGeneralError:    '오류가 발생했습니다. 다시 시도하세요.',
  roomNotFound:        '존재하지 않는 방 코드입니다.',
  roomInProgress:      '이미 게임이 시작된 방입니다.',
  roomFull:            '방이 가득 찼습니다.',
  createRoomError:     '방 생성 중 오류가 발생했습니다.',
  networkTimeout:      '서버 응답이 없습니다. 인터넷 연결을 확인해 주세요.',
  readyBtn:            '게임 준비',
  cancelReady:         '준비 취소',
  ready:               '준비완료',
  notReady:            '준비 중',
  waitingJoin:         '참가 대기',
  disconnectedState:   '연결 끊김',
  // 퇴장·전환 (presence.js / room.js)
  toLobby:             '로비로 돌아가는 중...',
  enteringLobby:       '로비 입장 중...',
  creatingRoom:        '방 만드는 중...',
  enteringRoom:        '방 입장 중...',
  deckFullReplace:     '슬롯이 가득 찼습니다 — 대체할 슬롯을 더블클릭하거나 슬롯을 비우세요',
  creatingBotRoom:     'AI 대전 준비 중...',
  vsAi:                'AI와 대전',
  botName:             'AI',
  botLevel_easy:       '쉬움',
  botLevel_normal:     '보통',
  botLevelBtn:         '난이도: {level}',
  enteringSpectate:    '관전 입장 중...',
  toWaitingRoom:       '대기실로 돌아가는 중...',
  enemyDisconnecting:  '상대 플레이어의 연결이 끊겼습니다 · {n}초 후 퇴장',
  enemyReconnected:    '상대 플레이어가 다시 연결되었습니다',
  enemyLeft:           '상대 플레이어가 나갔습니다',
  enemyForfeit:        '상대 플레이어가 돌아오지 않아 기권승으로 경기를 마칩니다',
  forfeitWinReason:    '상대가 경기를 떠나 기권승',
  forfeitLoseReason:   '연결이 끊겨 기권패',
  forfeitSpecReason:   '{name} 연결 끊김 — 기권',
  enemyKicked:         '연결이 끊긴 상대 플레이어를 대기실에서 내보냈습니다',
  becameHost:          '방장이 나가 새 방장이 되었습니다',
  selfRemoved:         '연결이 끊겨 방에서 나가졌습니다',
  roomGone:            '존재하지 않는 방입니다',
  roomLoadFailed:      '방 정보를 불러오지 못했습니다',
  roomResetFailed:     '방을 정리하지 못했습니다',
  spectateEnded:       '플레이어가 나가 관전이 종료되었습니다',
  roomCode:            '방 코드',
  waitingSlot:         '대기 중…',
  startGame:           '게임 시작 (2/2 필요)',
  leaveRoom:           '방 나가기',
  offerLabelWaiting:       '카드 제공 대기 중...',
  offerLabelFull:          '덱 가득 참 (5/5)',
  offerLabelSelect:        '카드 선택',
  castCooldown:            '공격이 끝난 후 재사용 가능합니다',
  wallOccupied:            '이 타워에는 이미 다른 방어막이 있습니다',
  devPickerLabel:          '개발자 도구 · 카드 검색',
  devSearchPlaceholder:    '카드 이름 검색 (Enter = 첫 카드)',
  devNoResult:             '검색 결과 없음',
  offerLabelPreview:       '미리보기...',
  offerPlaceholderWaiting: '카드를 기다리는 중...',
  deckFullMsg:         '슬롯이 가득 찼습니다 — 카드를 고르면 대체할 슬롯을 더블클릭하세요',
  returnLobby:             '로비로 돌아가기',
  returnWaitingRoom:       '대기실로 돌아가기',
  winTitle:  '승리!',
  losTitle:  '패배..',
  drawTitle: '무승부!',
  language:      '언어',
  close:         '닫기',
  grade_common:    '일반',
  grade_rare:      '희귀',
  grade_epic:      '에픽',
  grade_mythic:    '신화',
  grade_legendary: '전설',
  grade_secret:    '비밀',
};

function t(key) {
  return STRINGS[key] ?? key;
}

/**
 * 카드 이름/설명 조회 — 카드 정의(cards.js)가 원본이다. 다른 언어를 붙이면 STRINGS의 card_{id}_{field}가 먼저 쓰인다.
 * 설명의 {식} 자리는 카드 값으로 채운다 (cards.js cardFillDesc)
 */
function tCard(cardId, field) {
  const key = `card_${cardId}_${field}`;
  const card = typeof CARD_DEFINITIONS !== 'undefined' ? CARD_DEFINITIONS[cardId] : null;
  const text = STRINGS[key] !== undefined ? STRINGS[key] : card?.[field] ?? key;
  return field === 'desc' && card && typeof cardFillDesc === 'function' ? cardFillDesc(text, card) : text;
}

/** [data-i18n] 요소의 textContent, [data-i18n-placeholder] 요소의 placeholder 적용 */
function applyI18n(root) {
  const el = root || document;
  el.querySelectorAll('[data-i18n]').forEach(node => {
    node.textContent = t(node.dataset.i18n);
  });
  el.querySelectorAll('[data-i18n-placeholder]').forEach(node => {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  });
}
