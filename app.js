// ---------------------------
// 設定（ここだけで調整可能）
// ---------------------------
const LEVELS = [
  { id: 1, name: 'Lv1', label: '合計10以内の足し算', type: 'add', max: 10, fill: false },
  { id: 2, name: 'Lv2', label: '10以内の引き算',     type: 'sub', max: 10, fill: false },
  { id: 3, name: 'Lv3', label: '合計20以内の足し算', type: 'add', max: 20, fill: false },
  { id: 4, name: 'Lv4', label: '合計20以内の引き算', type: 'sub', max: 20, fill: false },
  { id: 5, name: 'Lv5', label: '□+3=7（合計10以内）', type: 'add', max: 10, fill: true },
  { id: 6, name: 'Lv6', label: '□-3=4（10以内）',     type: 'sub', max: 10, fill: true },
];

const QUESTIONS_PER_LEVEL = 200; // 各レベル200問
const TEST_SIZE = 10;            // 10問テスト
const PASS_SCORE = 80;           // 80点以上
const MARK_MS = 2000;            // 〇×表示時間

// 「10個/20個」問題の暫定：20テスト中、10テスト合格で次レベル解放
const SETS_PER_LEVEL = QUESTIONS_PER_LEVEL / TEST_SIZE; // 20
const REQUIRED_PASS_SETS = 10;

// ---------------------------
// DOM
// ---------------------------
const viewHome = document.getElementById('viewHome');
const viewQuiz = document.getElementById('viewQuiz');
const viewResult = document.getElementById('viewResult');

const levelButtons = document.getElementById('levelButtons');
const btnStart = document.getElementById('btnStart');
const btnQuit = document.getElementById('btnQuit');
const btnSubmit = document.getElementById('btnSubmit');
const btnSkip = document.getElementById('btnSkip');

const btnNext = document.getElementById('btnNext');
const btnBackHome = document.getElementById('btnBackHome');

const questionText = document.getElementById('questionText');
const answerInput = document.getElementById('answerInput');
const feedbackBox = document.getElementById('feedback');
const markEl = document.getElementById('mark');
const msgEl = document.getElementById('msg');

const quizMeta = document.getElementById('quizMeta');
const quizCount = document.getElementById('quizCount');

const scoreText = document.getElementById('scoreText');
const judgeText = document.getElementById('judgeText');
const resultDetail = document.getElementById('resultDetail');
const statusText = document.getElementById('statusText');

const keypad = document.getElementById('keypad');

// ---------------------------
// 保存キー（localStorage）
// ---------------------------
const KEY_UNLOCK = 'km_unlock_level_v1'; // 解放レベル（最大値）
const KEY_POOL_PREFIX = 'km_pool_level_v1_';     // km_pool_level_v1_L{level}
const KEY_CURSOR_PREFIX = 'km_cursor_level_v1_'; // km_cursor_level_v1_L{level}
const KEY_PASSSET_PREFIX = 'km_passset_level_v1_'; // km_passset_level_v1_L{level}

// ---------------------------
// 状態
// ---------------------------
let selectedLevel = 1;

let currentSet = [];
let wrongCount = 0; // 今の問題で何回まちがえたか（0〜3）
let currentIndex = 0;
let answers = []; // {given, correct, ok, q}
let lastResult = null;

let tries = 0; // 今の問題での誤答回数（0=未誤答）
let markTimer = null;

// ---------------------------
// 初期化
// ---------------------------
init();

function init(){
  updateOnlineStatus();
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);

  btnStart.addEventListener('click', onStart);
  btnQuit.addEventListener('click', () => goHome());
  btnSubmit.addEventListener('click', onSubmit);
  btnSkip.addEventListener('click', () => {
    // わからない=不正解として次へ
    recordAnswer(null);
    nextQuestion();
  });

  btnNext.addEventListener('click', onNextAfterResult);
  btnBackHome.addEventListener('click', () => goHome());

  // Enterキーで決定（readonlyでも発火する）
  answerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onSubmit();
    if (e.key === 'Backspace') backspaceInput();
    if (/^\d$/.test(e.key)) appendDigit(e.key);
  });

  // テンキー
  keypad.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'clear') clearInput();
    else if (action === 'back') backspaceInput();
    else appendDigit(btn.textContent.trim());
  });

  renderLevelButtons();
  goHome();
}

function updateOnlineStatus(){
  const online = navigator.onLine;
  statusText.textContent = online ? 'オンライン（初回キャッシュOK）' : 'オフライン';
}

// ---------------------------
// 解放レベル
// ---------------------------
function getUnlockedLevel(){
  const raw = localStorage.getItem(KEY_UNLOCK);
  const n = raw ? Number(raw) : 1;
  return Number.isFinite(n) ? Math.max(1, Math.min(6, n)) : 1;
}
function setUnlockedLevel(level){
  const cur = getUnlockedLevel();
  const next = Math.max(cur, level);
  localStorage.setItem(KEY_UNLOCK, String(next));
}
function isLevelUnlocked(level){
  return level <= getUnlockedLevel();
}

// ---------------------------
// UI: レベルボタン
// ---------------------------
function renderLevelButtons(){
  levelButtons.innerHTML = '';
  const unlocked = getUnlockedLevel();
renderLevelProgress();

  LEVELS.forEach(lv => {
    const btn = document.createElement('button');
    btn.className = 'levelBtn';
    btn.textContent = `${lv.name}（${lv.label}）`;

    const locked = lv.id > unlocked;
    if (locked) btn.classList.add('locked');
    if (lv.id === selectedLevel) btn.classList.add('active');

    btn.addEventListener('click', () => {
      if (locked) return;
      selectedLevel = lv.id;
      renderLevelButtons();
    });

    levelButtons.appendChild(btn);
  });

  // 選択中レベルがロックなら戻す
  if (!isLevelUnlocked(selectedLevel)) {
    selectedLevel = unlocked;
    renderLevelButtons();
  }
}

// ---------------------------
// 画面遷移
// ---------------------------
function show(view){
  [viewHome, viewQuiz, viewResult].forEach(v => v.classList.add('hidden'));
  view.classList.remove('hidden');
}

function goHome(){
  show(viewHome);
  feedback.textContent = '';
  answerInput.value = '';
  renderLevelButtons();
  renderLevelProgress(); // ★これ
}

// ---------------------------
// テスト開始
// ---------------------------
function onStart(){
  if (!isLevelUnlocked(selectedLevel)) return;

  ensurePool(selectedLevel);

  const pool = getPool(selectedLevel);
  let cursor = getCursor(selectedLevel);

  if (cursor >= QUESTIONS_PER_LEVEL) cursor = 0;

  let set = pool.slice(cursor, cursor + TEST_SIZE);
  if (set.length < TEST_SIZE) set = set.concat(pool.slice(0, TEST_SIZE - set.length));

  currentSet = set;
  currentIndex = 0;
  answers = [];
  lastResult = null;

  show(viewQuiz);
  renderQuestion();
}

function renderQuestion(){
  clearMark();

  const lv = LEVELS.find(x => x.id === selectedLevel);
  const q = currentSet[currentIndex];

  quizMeta.textContent = `${lv.name}：${lv.label}`;
  quizCount.textContent = `${currentIndex + 1} / ${TEST_SIZE}`;

  questionText.textContent = formatQuestion(q);
  answerInput.value = '';
  answerInput.focus();
  wrongCount = 0;

  tries = 0; // この問題の誤答回数リセット
}

function showFeedback(type, message, after) {
  const mark = (type === 'ok') ? '〇' : '×';

  // ここで「必ず見える」表示にする
  feedback.style.display = 'block';
  feedback.style.position = 'fixed';
  feedback.style.left = '50%';
  feedback.style.top = '50%';
  feedback.style.transform = 'translate(-50%, -50%)';
  feedback.style.zIndex = '9999';
  feedback.style.padding = '24px 32px';
  feedback.style.borderRadius = '16px';
  feedback.style.background = 'rgba(0,0,0,0.75)';
  feedback.style.backdropFilter = 'blur(6px)';
  feedback.style.textAlign = 'center';

  feedback.innerHTML = `
    <div style="font-size:96px;font-weight:900;line-height:1; color:${type === 'ok' ? '#ff3b30' : '#007aff'}">${mark}</div>
    <div style="margin-top:10px;font-size:22px;font-weight:800;color:#fff">${message}</div>
  `;

  setTimeout(() => {
    feedback.innerHTML = '';
    feedback.style.display = 'none';
    if (after) after();
  }, 3000);
}

function showFeedback(type, message, after){
  // type: 'ok' or 'ng'
  const mark = (type === 'ok') ? '〇' : '×';

  feedback.className = 'feedback ' + type;
  feedback.textContent = `${mark} ${message}`;

  // 3秒表示してから次の動作
  setTimeout(() => {
    feedback.textContent = '';
    if (after) after();
  }, 3000);
}

// ---------------------------
// 回答処理（ここが要望の本体）
// ---------------------------
function onSubmit(){
  const raw = answerInput.value.trim();

  if (raw === '') {
    showFeedback('ng', 'こたえをいれてね', () => {
      answerInput.focus();
    });
    return;
  }

  const given = Number(raw);
  if (!Number.isFinite(given)) {
    showFeedback('ng', 'すうじをいれてね', () => {
      answerInput.value = '';
      answerInput.focus();
    });
    return;
  }

  const q = currentSet[currentIndex];
  const correct = getCorrectAnswer(q);

  // 正解
  if (given === correct) {
    recordAnswer(given); // 記録
    showFeedback('ok', 'せいかい！つぎのもんだい！', () => {
      wrongCount = 0;
      nextQuestion();
    });
    return;
  }

  // 不正解
  wrongCount++;

  // 1〜2回目：もう一回（同じ問題）
  if (wrongCount <= 2) {
    recordAnswer(given); // ←ログに残したいなら残す（いらなければ消してOK）
    showFeedback('ng', 'ちがうよ、もういっかい！', () => {
      answerInput.value = '';
      answerInput.focus();
    });
    return;
  }

  // 3回目：ざんねん→次へ
  recordAnswer(null);
  showFeedback('ng', 'ざんねん。つぎのもんだい', () => {
    wrongCount = 0;
    nextQuestion();
  });
}

function disableInput(disabled){
  answerInput.disabled = disabled;
  btnSubmit.disabled = disabled;
  btnSkip.disabled = disabled;
  // テンキーも無効化したいなら（押しても入力されないように）
  keypad.style.pointerEvents = disabled ? 'none' : 'auto';
  keypad.style.opacity = disabled ? '0.6' : '1';
}

// ---------------------------
// 採点・結果
// ---------------------------
function recordAnswer(given){
  const q = currentSet[currentIndex];
  const correct = getCorrectAnswer(q);
  const ok = (given === correct);

  answers.push({ given, correct, ok, q });
}

function nextQuestion(){
  setTimeout(() => {
    currentIndex++;
    if (currentIndex >= TEST_SIZE) finishTest();
    else renderQuestion();
  }, 50);
}

function finishTest(){
  const correctCount = answers.filter(a => a.ok).length;
  const score = correctCount * 10;
  const passed = score >= PASS_SCORE;

  lastResult = { score, passed, correctCount };

  if (passed) {
    advanceCursor(selectedLevel);

    // 合格テスト回数を加算
    addPassedSet(selectedLevel);

    // 次レベル解放（暫定：合格テストがREQUIRED_PASS_SETS以上で解放）
    const passedSets = getPassedSetCount(selectedLevel);
    if (passedSets >= REQUIRED_PASS_SETS) {
      setUnlockedLevel(Math.min(selectedLevel + 1, 6));
    }
  }

  show(viewResult);
  renderResult();
}

function renderResult(){
  const score = lastResult.score;
  scoreText.textContent = `${score}点`;

  // 表示ルール
  if (score === 100) {
    judgeText.textContent = 'すごいね！よくできました！';
    resultDetail.innerHTML = '💮 花丸！';
  } else if (score >= PASS_SCORE) {
    judgeText.textContent = 'ごうかく！おめでとう！';
    resultDetail.innerHTML = '◎ ごうかく！';
  } else {
    judgeText.textContent = 'もういっかいがんばろう！';
    resultDetail.innerHTML = '× もういっかい！';
  }

  // まちがい一覧（軽め）
  const miss = answers.filter(a => !a.ok);
  if (miss.length > 0) {
    let html = `<br><br><strong>まちがえたもんだい</strong><br>`;
    miss.forEach(m => {
      html += `・${escapeHtml(formatQuestion(m.q))}（こたえ：${m.correct}）<br>`;
    });
    resultDetail.innerHTML += html;
  }
}

function onNextAfterResult(){
  if (!lastResult) return;

  if (lastResult.passed) {
    onStart(); // 次の10問
  } else {
    // 不合格：同じ10問をやり直し
    currentIndex = 0;
    answers = [];
    show(viewQuiz);
    renderQuestion();
  }
}

// ---------------------------
// 〇×＋メッセージ表示
// ---------------------------
function showMark(mark, kind, message, after){
  clearMark();
  markEl.textContent = mark;
  msgEl.textContent = message;

  feedbackBox.classList.remove('hidden');
  feedbackBox.classList.remove('ok', 'ng');
  feedbackBox.classList.add(kind);

  markTimer = setTimeout(() => {
    clearMark();
    if (after) after();
  }, MARK_MS);
}

function clearMark(){
  if (markTimer) clearTimeout(markTimer);
  markTimer = null;
  if (!feedbackBox) return;
  feedbackBox.classList.add('hidden');
  feedbackBox.classList.remove('ok', 'ng');
}

// ---------------------------
// プール生成・保存
// ---------------------------
function ensurePool(level){
  const poolKey = poolStorageKey(level);
  const existing = localStorage.getItem(poolKey);
  if (existing) return;

  const lv = LEVELS.find(x => x.id === level);
  const pool = buildPool(lv);
  localStorage.setItem(poolKey, JSON.stringify(pool));
  localStorage.setItem(cursorStorageKey(level), '0');
  localStorage.setItem(passSetStorageKey(level), '0');
}

function buildPool(lv){
  const pool = [];
  while (pool.length < QUESTIONS_PER_LEVEL) {
    pool.push(generateQuestion(lv));
  }
  shuffle(pool);
  return pool;
}

function generateQuestion(lv){
  const max = lv.max;
  const fill = !!lv.fill;

  if (!fill) {
    if (lv.type === 'add') {
      const a = randInt(0, max);
      const b = randInt(0, max - a); // a+b<=max
      return { kind:'normal', op:'+', a, b };
    } else {
      const a = randInt(0, max);
      const b = randInt(0, a); // a-b>=0
      return { kind:'normal', op:'-', a, b };
    }
  }

  // 穴埋め（仕様例に合わせて「□が左」固定）
  if (lv.type === 'add') {
    const c = randInt(0, max);
    const b = randInt(0, c);
    const a = c - b;
    return { kind:'fill', op:'+', a, b, c, blank:'a' }; // □ + b = c
  } else {
    // □ - b = c（aが□）
    const a = randInt(0, max);
    const b = randInt(0, a);
    const c = a - b;
    return { kind:'fill', op:'-', a, b, c, blank:'a' };
  }
}

function getPool(level){
  const raw = localStorage.getItem(poolStorageKey(level));
  return raw ? JSON.parse(raw) : [];
}

function getCursor(level){
  const raw = localStorage.getItem(cursorStorageKey(level));
  return raw ? Number(raw) : 0;
}
function setCursor(level, cursor){
  localStorage.setItem(cursorStorageKey(level), String(cursor));
}
function advanceCursor(level){
  const cur = getCursor(level);
  setCursor(level, cur + TEST_SIZE);
}

function getPassedSetCount(level){
  const raw = localStorage.getItem(passSetStorageKey(level));
  return raw ? Number(raw) : 0;
}
function addPassedSet(level){
  const cur = getPassedSetCount(level);
  localStorage.setItem(passSetStorageKey(level), String(cur + 1));
}

function poolStorageKey(level){ return `${KEY_POOL_PREFIX}L${level}`; }
function cursorStorageKey(level){ return `${KEY_CURSOR_PREFIX}L${level}`; }
function passSetStorageKey(level){ return `${KEY_PASSSET_PREFIX}L${level}`; }

// ---------------------------
// 表示・採点
// ---------------------------
function formatQuestion(q){
  if (q.kind === 'normal') return `${q.a} ${q.op} ${q.b} = ?`;

  // fill（□が左固定）
  if (q.op === '+') return `□ + ${q.b} = ${q.c}`;
  return `□ - ${q.b} = ${q.c}`;
}

function getCorrectAnswer(q){
  if (q.kind === 'normal') return q.op === '+' ? (q.a + q.b) : (q.a - q.b);
  // fill（□がa）
  return q.a;
}

// ---------------------------
// 入力（テンキー）
// ---------------------------
function appendDigit(d){
  if (!/^\d$/.test(d)) return;
  if (answerInput.disabled) return;
  // 先頭ゼロ連発を軽く抑制（必要なら消してOK）
  if (answerInput.value === '0') answerInput.value = d;
  else answerInput.value += d;
}
function backspaceInput(){
  if (answerInput.disabled) return;
  answerInput.value = answerInput.value.slice(0, -1);
}
function clearInput(){
  if (answerInput.disabled) return;
  answerInput.value = '';
}

// ---------------------------
// ユーティリティ
// ---------------------------
function randInt(min, max){
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function shuffle(arr){
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function escapeHtml(str){
  return str.replace(/[&<>"']/g, s => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[s]));
}
//-------------------------------
合格回数に関する表示
//-------------------------------
function renderLevelProgress() {
  const el = document.getElementById('levelProgress');
  if (!el) return;

  const passed = getPassedSetCount(selectedLevel);
  el.textContent = `Lv${selectedLevel} 合格 ${passed} / ${REQUIRED_PASS_SETS}`;
}