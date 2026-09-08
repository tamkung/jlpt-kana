/**
 * Nihongo Master (にほんごマスター) - Application Logic
 * Clean, modular vanilla JavaScript with authentic KanjiVG stroke vector engine
 * Supports all single kana, compound Yoon (เสียงควบ e.g. しゅ, きゃ), and Tokushuon (e.g. ファ, ティ).
 */

/* =========================================================================
   1. APPLICATION STATE
   ========================================================================= */
const APP_STATE = {
  activeTab: 'chart',
  kanaType: 'hiragana',      // 'hiragana' | 'katakana'
  kanaGroup: 'basic',        // 'basic' | 'dakuon' | 'yoon' | 'tokushuon'
  chartViewMode: 'table',    // 'table' (Gojūon 五十音図) | 'grid' (Card Grid)
  settings: {
    fontFamily: 'zenmaru',
    fontSizeScale: 'normal',
    volume: 1.0,
    speechRate: 0.85,
    speechPitch: 1.05,
    showThaiReading: true,
    showRomajiReading: true
  },
  djt: {
    selectedRows: new Set(['hira_a', 'hira_ka', 'hira_sa', 'hira_ta', 'hira_na', 'hira_ha', 'hira_ma', 'hira_ya', 'hira_ra', 'hira_wa', 'hira_n']),
    pool: [],
    queue: [],
    currentIndex: 0,
    currentChar: null,
    streak: 0,
    maxStreak: 0,
    correctCount: 0,
    mistakeCount: 0,
    totalAnswered: 0,
    mistakes: [],
    startTime: null,
    audioEnabled: true,
    targetCount: 46,
    font: 'maru'
  },
  stroke: {
    type: 'hiragana',
    group: 'basic',
    charIndex: 0,
    currentChar: 'あ',
    data: null,
    inkColor: '#0f172a',
    brushSize: 8,
    showGhost: true,
    isDrawing: false,
    strokesHistory: [],      // array of { pts, color, size }
    currentStrokePts: [],
    animating: false,
    animFrameId: null
  },
  flashcards: {
    deckName: 'hiragana-basic',
    cards: [],
    currentIndex: 0,
    isFlipped: false,
    masteredSet: new Set(),
    reviewSet: new Set()
  },
  quiz: {
    active: false,
    charset: 'hiragana',
    mode: 'kana-to-sound',
    questions: [],
    currentIndex: 0,
    score: 0,
    timer: null,
    timeLeft: 10,
    mistakes: []
  },
  vocab: {
    activeCategory: 'all',
    searchTerm: ''
  },
  roadmap: {
    completedTasks: new Set()
  }
};

/* =========================================================================
   2. AUDIO SYNTHESIS & SOUND EFFECTS (Web Speech API + Web Audio API)
   ========================================================================= */
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      audioCtx = new AudioContext();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playTone(freq = 520, type = 'sine', duration = 0.15) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const vol = APP_STATE.settings?.volume ?? 1.0;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.15 * vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    console.warn('Audio tone error:', e);
  }
}

function playSuccessChime() {
  playTone(587.33, 'triangle', 0.1);
  setTimeout(() => playTone(880, 'sine', 0.25), 90);
}

function playErrorBuzz() {
  playTone(220, 'sawtooth', 0.2);
}

function speakJapanese(text, onStartCallback = null) {
  if (!('speechSynthesis' in window)) {
    showToast('เบราว์เซอร์นี้ไม่รองรับเสียงพูด Web Speech API', '⚠️');
    return;
  }

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ja-JP';
  utterance.rate = APP_STATE.settings?.speechRate ?? 0.85;
  utterance.pitch = APP_STATE.settings?.speechPitch ?? 1.05;
  utterance.volume = APP_STATE.settings?.volume ?? 1.0;

  const voices = window.speechSynthesis.getVoices();
  const jaVoice = voices.find(v => v.lang === 'ja-JP' || v.lang.startsWith('ja'));
  if (jaVoice) {
    utterance.voice = jaVoice;
  }

  utterance.onstart = () => {
    showToast(`กำลังออกเสียง: "${text}"`, '🔊');
    if (onStartCallback) onStartCallback();
  };

  utterance.onerror = (e) => {
    console.warn('SpeechSynthesis error:', e);
    playTone(600, 'sine', 0.12);
  };

  window.speechSynthesis.speak(utterance);
}

function testSpeechAudio() {
  speakJapanese('こんにちは、日本語の勉強を始めましょう！');
}

function showToast(msg, icon = '🔊') {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-msg');
  const toastIcon = document.getElementById('toast-icon');
  if (!toast || !toastMsg) return;
  toastMsg.textContent = msg;
  if (toastIcon) toastIcon.textContent = icon;
  toast.classList.remove('translate-y-20', 'opacity-0');
  toast.classList.add('translate-y-0', 'opacity-100');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    toast.classList.remove('translate-y-0', 'opacity-100');
    toast.classList.add('translate-y-20', 'opacity-0');
  }, 2200);
}

/* =========================================================================
   3. TAB NAVIGATION CONTROLLER
   ========================================================================= */
function switchTab(tabId) {
  APP_STATE.activeTab = tabId;

  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.add('hidden');
    pane.classList.remove('active');
  });
  const currentPane = document.getElementById(`tab-${tabId}`);
  if (currentPane) {
    currentPane.classList.remove('hidden');
    currentPane.classList.add('active');
  }

  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.className = 'nav-tab px-3.5 py-1.5 rounded-xl text-xs xl:text-sm font-medium transition-all duration-200 flex items-center gap-1.5 whitespace-nowrap text-sumi-600 hover:text-sumi-900 hover:bg-white/60';
  });
  const activeNavBtn = document.getElementById(`nav-${tabId}`);
  if (activeNavBtn) {
    activeNavBtn.className = 'nav-tab active px-3.5 py-1.5 rounded-xl text-xs xl:text-sm font-semibold transition-all duration-200 flex items-center gap-1.5 whitespace-nowrap text-sakura-600 bg-white shadow-sm';
  }

  document.querySelectorAll('.mobile-nav-tab').forEach(btn => {
    btn.classList.remove('bg-sakura-100', 'text-sakura-700', 'active');
    btn.classList.add('text-sumi-600', 'bg-sumi-100');
  });
  const activeMNavBtn = document.getElementById(`m-nav-${tabId}`);
  if (activeMNavBtn) {
    activeMNavBtn.classList.remove('text-sumi-600', 'bg-sumi-100');
    activeMNavBtn.classList.add('bg-sakura-100', 'text-sakura-700', 'active');
  }

  if (tabId === 'stroke') {
    initStrokeCanvas();
    updateStrokeView();
  } else if (tabId === 'djt') {
    initDjtMatrix();
    showDjtSetup();
  } else if (tabId === 'flashcards') {
    initFlashcards();
  } else if (tabId === 'vocab') {
    renderVocabGrid();
  } else if (tabId === 'roadmap') {
    renderRoadmap();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* =========================================================================
   4. KANA CHART LOGIC (TAB 1)
   ========================================================================= */
function setKanaType(type) {
  APP_STATE.kanaType = type;
  const btnHira = document.getElementById('kana-type-hira');
  const btnKata = document.getElementById('kana-type-kata');
  const btnKanji = document.getElementById('kana-type-kanji');
  const viewSwitcher = document.getElementById('view-mode-table')?.parentElement;

  if (type === 'hiragana') {
    if (btnHira) btnHira.className = 'px-4 py-2 rounded-xl font-bold text-xs sm:text-sm transition-all shadow-sm bg-white text-sakura-600';
    if (btnKata) btnKata.className = 'px-4 py-2 rounded-xl font-medium text-xs sm:text-sm transition-all text-sumi-600 hover:text-sumi-900';
    if (btnKanji) btnKanji.className = 'px-4 py-2 rounded-xl font-medium text-xs sm:text-sm transition-all text-sumi-600 hover:text-indigo-600';
    if (viewSwitcher) viewSwitcher.style.display = 'inline-flex';
    APP_STATE.kanaGroup = 'basic';
    renderKanaFilterButtons('kana');
  } else if (type === 'katakana') {
    if (btnKata) btnKata.className = 'px-4 py-2 rounded-xl font-bold text-xs sm:text-sm transition-all shadow-sm bg-white text-sakura-600';
    if (btnHira) btnHira.className = 'px-4 py-2 rounded-xl font-medium text-xs sm:text-sm transition-all text-sumi-600 hover:text-sumi-900';
    if (btnKanji) btnKanji.className = 'px-4 py-2 rounded-xl font-medium text-xs sm:text-sm transition-all text-sumi-600 hover:text-indigo-600';
    if (viewSwitcher) viewSwitcher.style.display = 'inline-flex';
    APP_STATE.kanaGroup = 'basic';
    renderKanaFilterButtons('kana');
  } else if (type === 'kanji') {
    if (btnKanji) btnKanji.className = 'px-4 py-2 rounded-xl font-bold text-xs sm:text-sm transition-all shadow-sm bg-white text-sakura-600';
    if (btnHira) btnHira.className = 'px-4 py-2 rounded-xl font-medium text-xs sm:text-sm transition-all text-sumi-600 hover:text-sumi-900';
    if (btnKata) btnKata.className = 'px-4 py-2 rounded-xl font-medium text-xs sm:text-sm transition-all text-sumi-600 hover:text-sumi-900';
    if (viewSwitcher) viewSwitcher.style.display = 'none';
    APP_STATE.kanaGroup = 'all';
    renderKanaFilterButtons('kanji');
  }
  updateKanaFilterButtons();
  renderKanaGrid();
}

function renderKanaFilterButtons(mode) {
  const container = document.getElementById('kana-filter-buttons-container');
  if (!container) return;

  if (mode === 'kanji') {
    const categories = (typeof N5_KANJI_DATA !== 'undefined') ? N5_KANJI_DATA.categories : [];
    let html = '';
    categories.forEach(cat => {
      const isSelected = (APP_STATE.kanaGroup === cat.id) || (cat.id === 'all' && (!APP_STATE.kanaGroup || APP_STATE.kanaGroup === 'all'));
      const cls = isSelected
        ? 'kg-filter px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-sakura-600 text-white shadow-sm transition-all whitespace-nowrap'
        : 'kg-filter px-3.5 py-1.5 rounded-xl text-xs font-medium bg-white text-sumi-600 border border-sumi-200 hover:bg-sumi-50 transition-all whitespace-nowrap';
      html += `
        <button onclick="setKanaGroup('${cat.id}')" id="kg-${cat.id}" class="${cls}">
          ${cat.icon ? cat.icon + ' ' : ''}${cat.name}
        </button>
      `;
    });
    container.innerHTML = html;
  } else {
    const isKata = APP_STATE.kanaType === 'katakana';
    container.innerHTML = `
      <button onclick="setKanaGroup('basic')" id="kg-basic" class="kg-filter px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-sakura-600 text-white shadow-sm transition-all whitespace-nowrap">
        เสียงพื้นฐาน 46 (Seion)
      </button>
      <button onclick="setKanaGroup('dakuon')" id="kg-dakuon" class="kg-filter px-3.5 py-1.5 rounded-xl text-xs font-medium bg-white text-sumi-600 border border-sumi-200 hover:bg-sumi-50 transition-all whitespace-nowrap">
        เสียงขุ่น (Dakuon/Handakuon)
      </button>
      <button onclick="setKanaGroup('yoon')" id="kg-yoon" class="kg-filter px-3.5 py-1.5 rounded-xl text-xs font-medium bg-white text-sumi-600 border border-sumi-200 hover:bg-sumi-50 transition-all whitespace-nowrap">
        เสียงควบ (Yōon)
      </button>
      <button onclick="setKanaGroup('tokushuon')" id="kg-tokushuon" style="display: ${isKata ? 'inline-block' : 'none'};" class="kg-filter px-3.5 py-1.5 rounded-xl text-xs font-medium bg-white text-sumi-600 border border-sumi-200 hover:bg-sumi-50 transition-all whitespace-nowrap">
        เสียงพิเศษ (Tokushuon)
      </button>
    `;
  }
}

function setKanaGroup(group) {
  APP_STATE.kanaGroup = group;
  updateKanaFilterButtons();
  renderKanaGrid();
}

function updateKanaFilterButtons() {
  document.querySelectorAll('.kg-filter').forEach(btn => {
    btn.className = 'kg-filter px-3.5 py-1.5 rounded-xl text-xs font-medium bg-white text-sumi-600 border border-sumi-200 hover:bg-sumi-50 transition-all whitespace-nowrap';
  });
  const curGroup = (APP_STATE.kanaType === 'kanji' && (!APP_STATE.kanaGroup || APP_STATE.kanaGroup === 'all')) ? 'all' : APP_STATE.kanaGroup;
  const activeBtn = document.getElementById(`kg-${curGroup}`);
  if (activeBtn) {
    activeBtn.className = 'kg-filter px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-sakura-600 text-white shadow-sm transition-all whitespace-nowrap';
  }
}

function setKanaViewMode(mode) {
  APP_STATE.chartViewMode = mode;
  const tableBtn = document.getElementById('view-mode-table');
  const gridBtn = document.getElementById('view-mode-grid');
  if (tableBtn && gridBtn) {
    if (mode === 'table') {
      tableBtn.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold text-xs bg-white text-sakura-600 shadow-xs transition-all';
      gridBtn.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium text-xs text-sumi-600 hover:text-sumi-900 transition-all';
    } else {
      tableBtn.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium text-xs text-sumi-600 hover:text-sumi-900 transition-all';
      gridBtn.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold text-xs bg-white text-sakura-600 shadow-xs transition-all';
    }
  }
  renderKanaGrid();
}

function renderKanjiCard(item) {
  if (!item) return '';
  const onyomiStr = item.on || (Array.isArray(item.onyomi) ? item.onyomi.join(', ') : item.onyomi) || '-';
  const kunyomiStr = item.kun || (Array.isArray(item.kunyomi) ? item.kunyomi.join(', ') : item.kunyomi) || '—';
  const onyomiR = item.on_r || '-';
  const onyomiTh = item.on_th || '-';
  const kunyomiR = item.kun_r || '-';
  const kunyomiTh = item.kun_th || '-';

  const sample = item.sample || {};
  const sampleJp = sample.jp || item.k;
  const sampleKana = sample.kana || sample.r || '';
  const sampleR = sample.r || '';
  const sampleThRead = sample.th_read || '';
  const sampleTh = sample.th || item.th;

  // Primary reading: show first Onyomi and Kunyomi with Romaji & Thai
  const onFirst = item.on ? item.on.split(/[,、]/)[0].trim() : '';
  const kunFirst = item.kun ? item.kun.split(/[,、]/)[0].trim() : '';
  const primaryReading = [onFirst, kunFirst].filter(Boolean).join(' / ');

  const onRFirst = item.on_r ? item.on_r.split(/[,、]/)[0].trim() : '';
  const kunRFirst = item.kun_r ? item.kun_r.split(/[,、]/)[0].trim() : '';
  const primaryR = [onRFirst, kunRFirst].filter(Boolean).join(' / ');

  const onThFirst = item.on_th ? item.on_th.split(/[,、]/)[0].trim() : '';
  const kunThFirst = item.kun_th ? item.kun_th.split(/[,、]/)[0].trim() : '';
  const primaryTh = [onThFirst, kunThFirst].filter(Boolean).join(' / ');

  return `
    <div class="group relative bg-white hover:bg-gradient-to-b hover:from-white hover:to-sakura-50/40 rounded-2xl p-3.5 sm:p-4 border border-sumi-200 hover:border-sakura-300 hover:shadow-card transition-all duration-200 flex flex-col justify-between cursor-pointer" onclick="speakJapanese('${item.k}')">
      <!-- Top meta: strokes count & sound -->
      <div class="flex items-center justify-between text-xs mb-1">
        <span class="px-2 py-0.5 rounded-md bg-sumi-100 text-[10px] font-mono font-bold text-sumi-600 tracking-wide">${item.strokes} ขีด</span>
        <button onclick="event.stopPropagation(); speakJapanese('${item.k}')" title="ฟังเสียงอ่าน" class="w-6 h-6 rounded-full flex items-center justify-center text-sumi-400 hover:text-sakura-600 hover:bg-sakura-100 transition-colors">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"></path></svg>
        </button>
      </div>

      <!-- Main Kanji Character & Pronunciation -->
      <div class="py-1 text-center">
        <div class="font-jp font-jp-scale font-black text-4xl sm:text-5xl text-sumi-900 group-hover:scale-105 group-hover:text-sakura-700 transition-all duration-200 select-none">
          ${item.k}
        </div>
        <div class="text-[11px] font-jp font-bold text-sakura-700 mt-1 tracking-wide" title="คำอ่านเสียงอง / เสียงคุง">
          ${primaryReading || ''}
        </div>
        <div class="flex items-center justify-center gap-1.5 text-[10px] text-sumi-500 flex-wrap mt-0.5">
          ${primaryR ? `<span class="reading-romaji font-mono font-medium">${primaryR}</span>` : ''}
          ${primaryTh ? `<span class="reading-th font-thai font-semibold text-sakura-600">[${primaryTh}]</span>` : ''}
        </div>
        <div class="text-xs font-thai font-bold text-sumi-800 line-clamp-1 mt-0.5" title="${item.th}">
          ${item.th}
        </div>
      </div>

      <!-- Readings (Onyomi & Kunyomi) with Kana + Romaji + Thai -->
      <div class="my-2 p-2 rounded-xl bg-sumi-50/80 border border-sumi-100 text-[11px] space-y-2">
        <!-- Onyomi -->
        <div class="space-y-0.5" title="เสียงอง (Onyomi) - เสียงอ่านแบบจีน มักใช้ในคำประสม">
          <div class="flex items-center gap-1.5">
            <span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-thai flex items-center gap-1 flex-shrink-0">
              <span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>เสียงอง
            </span>
            <span class="font-jp font-bold text-rose-900 truncate" title="${onyomiStr}">${onyomiStr}</span>
          </div>
          <div class="pl-1 text-[10px] text-sumi-500 flex items-center gap-1.5 flex-wrap">
            <span class="reading-romaji font-mono text-sumi-500">${onyomiR}</span>
            <span class="reading-th font-thai text-rose-600 font-semibold">[${onyomiTh}]</span>
          </div>
        </div>

        <!-- Kunyomi -->
        <div class="space-y-0.5 pt-1 border-t border-sumi-200/50" title="เสียงคุง (Kunyomi) - เสียงอ่านแบบญี่ปุ่นแท้ มักใช้เดี่ยวๆ">
          <div class="flex items-center gap-1.5">
            <span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-thai flex items-center gap-1 flex-shrink-0">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>เสียงคุง
            </span>
            <span class="font-jp font-bold text-emerald-900 truncate" title="${kunyomiStr}">${kunyomiStr}</span>
          </div>
          <div class="pl-1 text-[10px] text-sumi-500 flex items-center gap-1.5 flex-wrap">
            <span class="reading-romaji font-mono text-sumi-500">${kunyomiR}</span>
            <span class="reading-th font-thai text-emerald-600 font-semibold">[${kunyomiTh}]</span>
          </div>
        </div>
      </div>

      <!-- Sample word & Practice jump button -->
      <div class="pt-2 border-t border-sumi-100 flex items-center justify-between gap-1 text-[10px] sm:text-[11px] font-thai">
        <div class="text-sumi-600 truncate min-w-0 pr-1">
          <div class="truncate">
            例: <span class="font-jp font-bold text-sumi-800">${sampleJp}</span> <span class="text-[10px] text-sumi-400">(${sampleKana})</span>
          </div>
          <div class="text-[10px] text-sumi-500 truncate flex items-center gap-1 flex-wrap">
            <span class="reading-romaji font-mono text-[9px] text-sumi-400">${sampleR}</span>
            ${sampleThRead ? `<span class="reading-th text-torii font-medium">[${sampleThRead}]</span>` : ''}
            <span class="text-sumi-600">• ${sampleTh}</span>
          </div>
        </div>
        <button onclick="event.stopPropagation(); jumpToStrokePractice('${item.k}', 'kanji', '${item.cat}')" class="font-bold text-torii hover:text-torii/80 flex items-center gap-0.5 transition-colors whitespace-nowrap bg-rose-50 hover:bg-rose-100 px-2 py-1 rounded-lg border border-rose-200/60 flex-shrink-0">
          <span>🖌️ คัด</span>
        </button>
      </div>
    </div>
  `;
}

function renderKanaCard(item, isTableCell = false) {
  if (!item) {
    return `<div class="gojuon-empty-cell"><span class="text-sumi-300 font-mono text-sm">—</span></div>`;
  }
  return `
    <div class="group relative bg-white hover:bg-gradient-to-b hover:from-white hover:to-sakura-50/40 rounded-2xl p-3 sm:p-3.5 border border-sumi-200 hover:border-sakura-300 hover:shadow-card transition-all duration-200 flex flex-col justify-between cursor-pointer ${isTableCell ? 'min-w-[95px] sm:min-w-[110px] h-[148px]' : ''}" onclick="speakJapanese('${item.k}')">
      <div class="flex items-center justify-between text-xs">
        <span class="reading-romaji font-mono font-bold text-sumi-500 group-hover:text-sakura-600 transition-colors uppercase tracking-wide">${item.r}</span>
        <button onclick="event.stopPropagation(); speakJapanese('${item.k}')" title="ฟังเสียง" class="w-6 h-6 rounded-full flex items-center justify-center text-sumi-400 hover:text-sakura-600 hover:bg-sakura-100 transition-colors">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"></path></svg>
        </button>
      </div>
      <div class="py-1 text-center">
        <div class="font-jp font-jp-scale font-black text-3xl sm:text-4xl text-sumi-900 group-hover:scale-105 group-hover:text-sakura-700 transition-all duration-200 select-none">
          ${item.k}
        </div>
        <div class="reading-th text-[11px] sm:text-xs font-thai font-semibold text-sumi-600 mt-0.5">
          ${item.th || ''}
        </div>
      </div>
      <div class="pt-1.5 border-t border-sumi-100 flex items-center justify-center">
        <button onclick="event.stopPropagation(); jumpToStrokePractice('${item.k}', '${APP_STATE.kanaType}', '${APP_STATE.kanaGroup}')" class="text-[10px] sm:text-[11px] font-thai font-medium text-sumi-400 group-hover:text-torii flex items-center gap-1 transition-colors">
          <span>🖌️ คัดตัวนี้</span>
        </button>
      </div>
    </div>
  `;
}

function renderKanaGrid() {
  const container = document.getElementById('kana-grid');
  const badge = document.getElementById('kana-count-badge');
  if (!container) return;

  const type = APP_STATE.kanaType;

  // KANJI N5 MODE
  if (type === 'kanji') {
    const group = APP_STATE.kanaGroup || 'all';
    let list = (typeof N5_KANJI_DATA !== 'undefined') ? N5_KANJI_DATA.items : [];
    if (group !== 'all') {
      list = list.filter(item => item.cat === group);
    }

    const searchInput = (document.getElementById('kanaSearch')?.value || '').trim().toLowerCase();
    if (searchInput) {
      list = list.filter(item => (
        item.k.includes(searchInput) ||
        (item.th && item.th.toLowerCase().includes(searchInput)) ||
        (item.on && item.on.toLowerCase().includes(searchInput)) ||
        (item.kun && item.kun.toLowerCase().includes(searchInput)) ||
        (item.sample && (
          (item.sample.jp && item.sample.jp.includes(searchInput)) ||
          (item.sample.kana && item.sample.kana.includes(searchInput)) ||
          (item.sample.r && item.sample.r.toLowerCase().includes(searchInput)) ||
          (item.sample.th && item.sample.th.toLowerCase().includes(searchInput))
        ))
      ));
    }

    if (badge) {
      badge.textContent = `แสดง ${list.length} ตัวอักษรคันจิ`;
    }

    if (list.length === 0) {
      container.innerHTML = `
        <div class="py-16 text-center text-sumi-400 font-thai bg-white rounded-3xl border border-sumi-200 shadow-soft">
          <div class="text-4xl mb-2">🔍</div>
          <p class="text-base font-semibold text-sumi-700">ไม่พบคันจิที่ตรงกับ "${searchInput}"</p>
          <p class="text-xs text-sumi-400 mt-1">ลองค้นหาด้วยตัวอักษรคันจิ, คำอ่านอง/คุง หรือความหมายภาษาไทย</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 sm:gap-4">
        ${list.map(item => renderKanjiCard(item)).join('')}
      </div>
    `;
    return;
  }
  const group = APP_STATE.kanaGroup;
  const list = KANA_DATA[type]?.[group] || [];
  const searchInput = (document.getElementById('kanaSearch')?.value || '').trim().toLowerCase();

  // If searching, always show filtered results in grid view
  if (searchInput) {
    const filtered = list.filter(item => (
      item.k.includes(searchInput) ||
      item.r.toLowerCase().includes(searchInput) ||
      (item.th && item.th.includes(searchInput))
    ));

    if (badge) badge.textContent = `พบ ${filtered.length} ตัวอักษร`;

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="py-16 text-center text-sumi-400 font-thai bg-white rounded-3xl border border-sumi-200 shadow-soft">
          <div class="text-4xl mb-2">🔍</div>
          <p class="text-base font-semibold text-sumi-700">ไม่พบตัวอักษรที่ตรงกับ "${searchInput}"</p>
          <p class="text-xs text-sumi-400 mt-1">ลองค้นหาด้วยตัวอักษร, โรมาจิ (เช่น ka, shi, n) หรือคำอ่านไทย (เช่น คะ, ชิ)</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 sm:gap-4">
        ${filtered.map(item => renderKanaCard(item, false)).join('')}
      </div>
    `;
    return;
  }

  // Not searching
  if (badge) {
    badge.textContent = `แสดง ${list.length} ตัวอักษร`;
  }

  // If user chose Grid view mode
  if (APP_STATE.chartViewMode === 'grid') {
    container.innerHTML = `
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 sm:gap-4">
        ${list.map(item => renderKanaCard(item, false)).join('')}
      </div>
    `;
    return;
  }

  // Table mode (Gojūon 五十音図 Layout)
  const gojuon = (typeof GOJUON_STRUCTURE !== 'undefined') ? GOJUON_STRUCTURE[group] : null;

  // For Tokushuon
  if (group === 'tokushuon') {
    const rows = GOJUON_STRUCTURE?.tokushuon?.rows || [];
    const itemMap = new Map();
    list.forEach(x => itemMap.set(x.k, x));

    container.innerHTML = `
      <div class="space-y-4">
        <div class="bg-gradient-to-r from-sakura-50/90 to-amber-50/70 border border-sakura-200/70 rounded-2xl p-3.5 sm:p-4 flex items-center gap-3 text-xs text-sumi-700 font-thai shadow-xs">
          <span class="text-xl">💡</span>
          <div>
            <span class="font-bold text-sakura-800">เสียงพิเศษสากล (Tokushuon):</span>
            <span class="text-sumi-600 ml-1">ใช้ในอักษรคาตาคานะเป็นหลักเพื่อถอดเสียงภาษาต่างประเทศอย่างแม่นยำ เช่น ฟ, ว, ท, ด, เช, เจ</span>
          </div>
        </div>
        <div class="space-y-3.5">
          ${rows.map(r => {
            const rowChars = (r.kata || []).filter(Boolean).concat(r.extra || []);
            const rowItems = rowChars.map(k => itemMap.get(k)).filter(Boolean);
            if (rowItems.length === 0) return '';
            return `
              <div class="bg-white/90 backdrop-blur rounded-2xl p-3.5 sm:p-4 border border-sumi-200 shadow-soft">
                <div class="flex items-center gap-2 mb-3 pb-2 border-b border-sumi-100">
                  <span class="w-2 h-2 rounded-full bg-sakura-500"></span>
                  <h3 class="font-thai font-bold text-sm text-sumi-800">${r.name}</h3>
                  <span class="font-mono text-xs text-sumi-400 ml-1">(${r.romaji})</span>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
                  ${rowItems.map(item => renderKanaCard(item, false)).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
    return;
  }

  // Fallback if structure not found
  if (!gojuon) {
    container.innerHTML = `
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 sm:gap-4">
        ${list.map(item => renderKanaCard(item, false)).join('')}
      </div>
    `;
    return;
  }

  // Authentic Gojūon 5-Vowel (or 3-Vowel for Yoon) Table Layout
  const itemMap = new Map();
  list.forEach(x => itemMap.set(x.k, x));

  const columns = gojuon.columns;
  const rows = gojuon.rows;

  let tableHtml = `
    <div class="gojuon-scroll-wrapper bg-white/80 backdrop-blur rounded-3xl border border-sumi-200 shadow-soft p-3 sm:p-5">
      <table class="gojuon-table">
        <thead>
          <tr>
            <th class="gojuon-sticky-col p-1 sm:p-2 text-center text-xs font-thai text-sumi-400 font-semibold w-[90px] sm:w-[105px]">
              <span class="bg-sumi-100/90 text-sumi-600 px-2.5 py-1 rounded-lg text-[11px] font-thai">วรรค / สระ</span>
            </th>
            ${columns.map(col => `
              <th class="p-1 text-center">
                <div class="flex flex-col items-center justify-center py-2 px-2 sm:px-3 rounded-xl bg-gradient-to-b from-sakura-50/80 to-white border border-sakura-200/70 shadow-2xs">
                  <span class="font-jp font-black text-sakura-700 text-base sm:text-lg leading-none">${col.name}</span>
                  <span class="font-thai text-[10px] sm:text-[11px] text-sumi-500 font-medium mt-0.5">${col.th}</span>
                </div>
              </th>
            `).join('')}
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => {
            const chars = type === 'katakana' ? row.kata : row.hira;
            return `
              <tr>
                <td class="gojuon-sticky-col p-0 align-top">
                  <div class="flex flex-col items-center justify-center bg-sumi-50/90 border border-sumi-200/80 rounded-2xl p-2 w-[90px] sm:w-[105px] h-[148px] select-none text-center shadow-xs">
                    <span class="text-[10px] font-mono font-bold uppercase tracking-wider text-sakura-600 bg-sakura-50 px-2 py-0.5 rounded-full mb-1">วรรค</span>
                    <span class="font-thai font-bold text-sumi-800 text-xs sm:text-sm leading-tight">${row.name.replace('วรรค ', '')}</span>
                    <span class="font-mono text-[11px] text-sumi-400 mt-1">(${row.romaji}-)</span>
                  </div>
                </td>
                ${chars.map(ch => {
                  if (!ch) {
                    return `<td class="p-0 align-top">${renderKanaCard(null, true)}</td>`;
                  }
                  const item = itemMap.get(ch) || { k: ch, r: '', th: '' };
                  return `<td class="p-0 align-top">${renderKanaCard(item, true)}</td>`;
                }).join('')}
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  container.innerHTML = tableHtml;
}

function filterKanaCards() {
  renderKanaGrid();
}

function jumpToStrokePractice(char, type, group) {
  APP_STATE.stroke.type = type || 'hiragana';
  if (group) APP_STATE.stroke.group = group;
  APP_STATE.stroke.currentChar = char;
  switchTab('stroke');
  selectCharacterForStroke(char, type, group);
}

/* =========================================================================
   5. AUTHENTIC KANJIVG STROKE VECTOR ENGINE & PRACTICE CANVAS (PRIORITY)
   ========================================================================= */
let canvas = null;
let ctx = null;
const CANVAS_SIZE = 420;
const KANJIVG_VIEWBOX_SIZE = 109;
const SCALE_FACTOR = CANVAS_SIZE / KANJIVG_VIEWBOX_SIZE; // 3.8532

// Calculate fallback starting position from SVG path string
function getFallbackNumPos(pathStr) {
  const match = pathStr.match(/M\s*([-\d.]+)[,\s]+([-\d.]+)/i);
  if (match) {
    return { x: Math.max(10, parseFloat(match[1]) - 5), y: Math.max(10, parseFloat(match[2]) - 5) };
  }
  return { x: 20, y: 20 };
}

/**
 * Universal Kana Stroke Retriever
 * Supports single characters (あ, ア, が), compound Yoon (しゅ, きゃ, キャ),
 * and foreign loanword Tokushuon (ファ, ティ).
 * Returns structured strokes with appropriate coordinate transforms.
 */
function getKanaStrokeEntry(char) {
  if (!char || typeof KANJIVG_STROKES === 'undefined') return null;

  // 1. Single character direct match
  if (KANJIVG_STROKES[char]) {
    const entry = KANJIVG_STROKES[char];
    return {
      char: char,
      strokes: entry.paths.map((p, i) => ({
        path: p,
        transform: null,
        number: (entry.numbers && entry.numbers[i]) ? entry.numbers[i] : getFallbackNumPos(p)
      }))
    };
  }

  // 2. Compound character match (Yoon like 'しゅ', 'きゃ', 'キャ' or Tokushuon like 'ファ', 'ティ')
  if (char.length >= 2) {
    const c1 = char[0];
    const c2 = char.slice(1);

    const e1 = KANJIVG_STROKES[c1];
    const e2 = KANJIVG_STROKES[c2];

    if (e1 && e2) {
      const strokes = [];

      // c1: Main character on the left side
      // transform: scale 0.78, translate(-4, 12)
      e1.paths.forEach((p, i) => {
        const num = (e1.numbers && e1.numbers[i]) ? e1.numbers[i] : getFallbackNumPos(p);
        strokes.push({
          path: p,
          transform: { dx: -4, dy: 12, scale: 0.78 },
          number: {
            num: strokes.length + 1,
            x: num.x * 0.78 - 4,
            y: num.y * 0.78 + 12
          }
        });
      });

      // c2: Small character on the lower-right side
      // transform: scale 0.58, translate(48, 32)
      e2.paths.forEach((p, i) => {
        const num = (e2.numbers && e2.numbers[i]) ? e2.numbers[i] : getFallbackNumPos(p);
        strokes.push({
          path: p,
          transform: { dx: 48, dy: 32, scale: 0.58 },
          number: {
            num: strokes.length + 1,
            x: num.x * 0.58 + 48,
            y: num.y * 0.58 + 32
          }
        });
      });

      return {
        char: char,
        strokes: strokes
      };
    } else if (e1) {
      return {
        char: char,
        strokes: e1.paths.map((p, i) => ({
          path: p,
          transform: null,
          number: (e1.numbers && e1.numbers[i]) ? e1.numbers[i] : getFallbackNumPos(p)
        }))
      };
    }
  }

  return null;
}

function initStrokeCanvas() {
  canvas = document.getElementById('practiceCanvas');
  if (!canvas) return;
  ctx = canvas.getContext('2d');

  const dpr = window.devicePixelRatio || 1;
  canvas.width = CANVAS_SIZE * dpr;
  canvas.height = CANVAS_SIZE * dpr;
  ctx.scale(dpr, dpr);

  setupCanvasEvents();
  updateStrokeGroupOptions();
  populateStrokeCharSelect();
}

function setupCanvasEvents() {
  if (!canvas) return;

  canvas.onmousedown = (e) => startDrawing(getCanvasPos(e));
  canvas.onmousemove = (e) => draw(getCanvasPos(e));
  canvas.onmouseup = () => stopDrawing();
  canvas.onmouseleave = () => stopDrawing();

  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    startDrawing(getCanvasPos(touch));
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    draw(getCanvasPos(touch));
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    stopDrawing();
  }, { passive: false });
}

function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = CANVAS_SIZE / rect.width;
  const scaleY = CANVAS_SIZE / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

function startDrawing(pos) {
  if (APP_STATE.stroke.animating) return;
  APP_STATE.stroke.isDrawing = true;
  APP_STATE.stroke.currentStrokePts = [pos];
  document.getElementById('canvas-hint')?.classList.add('opacity-0');

  ctx.beginPath();
  ctx.arc(pos.x, pos.y, APP_STATE.stroke.brushSize / 2, 0, Math.PI * 2);
  ctx.fillStyle = APP_STATE.stroke.inkColor;
  ctx.fill();
}

function draw(pos) {
  if (!APP_STATE.stroke.isDrawing || APP_STATE.stroke.animating) return;
  const pts = APP_STATE.stroke.currentStrokePts;
  pts.push(pos);

  ctx.lineWidth = APP_STATE.stroke.brushSize;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = APP_STATE.stroke.inkColor;

  if (pts.length > 2) {
    const lastTwo = pts.slice(-3);
    const xc = (lastTwo[1].x + lastTwo[2].x) / 2;
    const yc = (lastTwo[1].y + lastTwo[2].y) / 2;
    ctx.beginPath();
    ctx.moveTo(lastTwo[0].x, lastTwo[0].y);
    ctx.quadraticCurveTo(lastTwo[1].x, lastTwo[1].y, xc, yc);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }
}

function stopDrawing() {
  if (!APP_STATE.stroke.isDrawing) return;
  APP_STATE.stroke.isDrawing = false;
  if (APP_STATE.stroke.currentStrokePts.length > 0) {
    APP_STATE.stroke.strokesHistory.push({
      pts: [...APP_STATE.stroke.currentStrokePts],
      color: APP_STATE.stroke.inkColor,
      size: APP_STATE.stroke.brushSize
    });
    APP_STATE.stroke.currentStrokePts = [];
  }
}

function redrawUserCanvas() {
  if (!ctx) return;
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  drawGhostGuide();

  APP_STATE.stroke.strokesHistory.forEach(stroke => {
    ctx.lineWidth = stroke.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = stroke.color;

    const pts = stroke.pts;
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, stroke.size / 2, 0, Math.PI * 2);
      ctx.fillStyle = stroke.color;
      ctx.fill();
    } else if (pts.length > 1) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
    }
  });
}

function drawGhostGuide() {
  if (!APP_STATE.stroke.showGhost || !ctx) return;
  const entry = getKanaStrokeEntry(APP_STATE.stroke.currentChar);
  if (!entry || !entry.strokes) return;

  entry.strokes.forEach(s => {
    ctx.save();
    if (s.transform) {
      ctx.translate(s.transform.dx * SCALE_FACTOR, s.transform.dy * SCALE_FACTOR);
      ctx.scale(SCALE_FACTOR * s.transform.scale, SCALE_FACTOR * s.transform.scale);
    } else {
      ctx.scale(SCALE_FACTOR, SCALE_FACTOR);
    }
    ctx.lineWidth = 7.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#e2e8f0';

    try {
      const path2d = new Path2D(s.path);
      ctx.stroke(path2d);
    } catch (e) {
      console.warn('Path2D error:', e);
    }
    ctx.restore();
  });
}

function clearCanvas() {
  APP_STATE.stroke.strokesHistory = [];
  APP_STATE.stroke.currentStrokePts = [];
  if (ctx) ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  drawGhostGuide();
  document.getElementById('canvas-hint')?.classList.remove('opacity-0');
}

function undoStroke() {
  if (APP_STATE.stroke.strokesHistory.length > 0) {
    APP_STATE.stroke.strokesHistory.pop();
    redrawUserCanvas();
  }
}

function toggleGhostGuide() {
  APP_STATE.stroke.showGhost = !APP_STATE.stroke.showGhost;
  const btn = document.getElementById('btn-toggle-ghost');
  if (btn) {
    btn.textContent = `ไกด์ตัวอักษร: ${APP_STATE.stroke.showGhost ? 'เปิด' : 'ปิด'}`;
  }
  redrawUserCanvas();
}

function setInkColor(color) {
  APP_STATE.stroke.inkColor = color;
  showToast('เปลี่ยนสีหมึกเรียบร้อย', '🎨');
}

function getCurrentStrokeList() {
  if (APP_STATE.stroke.type === 'kanji') {
    const group = APP_STATE.stroke.group;
    const all = (typeof N5_KANJI_DATA !== 'undefined') ? N5_KANJI_DATA.items : [];
    if (!group || group === 'all') {
      return all;
    }
    return all.filter(item => item.cat === group);
  }
  return KANA_DATA[APP_STATE.stroke.type]?.[APP_STATE.stroke.group] || [];
}

function updateStrokeGroupOptions() {
  const select = document.getElementById('strokeGroupSelect');
  if (!select) return;

  if (APP_STATE.stroke.type === 'kanji') {
    const cats = (typeof N5_KANJI_DATA !== 'undefined') ? N5_KANJI_DATA.categories : [];
    select.innerHTML = cats.map(c => `
      <option value="${c.id}">${c.icon ? c.icon + ' ' : ''}${c.name}</option>
    `).join('');
    if (!APP_STATE.stroke.group || APP_STATE.stroke.group === 'basic' || APP_STATE.stroke.group === 'dakuon' || APP_STATE.stroke.group === 'yoon' || APP_STATE.stroke.group === 'tokushuon') {
      APP_STATE.stroke.group = 'all';
    }
  } else if (APP_STATE.stroke.type === 'katakana') {
    select.innerHTML = `
      <option value="basic">เสียงพื้นฐาน 46 (Seion)</option>
      <option value="dakuon">เสียงขุ่น (Dakuon)</option>
      <option value="yoon">เสียงควบ (Yoon)</option>
      <option value="tokushuon">เสียงพิเศษ (Tokushuon)</option>
    `;
    if (APP_STATE.stroke.group === 'all' || !['basic', 'dakuon', 'yoon', 'tokushuon'].includes(APP_STATE.stroke.group)) {
      APP_STATE.stroke.group = 'basic';
    }
  } else {
    select.innerHTML = `
      <option value="basic">เสียงพื้นฐาน 46 (Seion)</option>
      <option value="dakuon">เสียงขุ่น (Dakuon)</option>
      <option value="yoon">เสียงควบ (Yoon)</option>
    `;
    if (APP_STATE.stroke.group === 'tokushuon' || APP_STATE.stroke.group === 'all' || !['basic', 'dakuon', 'yoon'].includes(APP_STATE.stroke.group)) {
      APP_STATE.stroke.group = 'basic';
    }
  }
  select.value = APP_STATE.stroke.group;
}

function populateStrokeCharSelect() {
  const select = document.getElementById('strokeCharSelect');
  if (!select) return;
  const list = getCurrentStrokeList();
  if (APP_STATE.stroke.type === 'kanji') {
    select.innerHTML = list.map((item, idx) => {
      const onFirst = item.on ? item.on.split(/[,、]/)[0].trim() : '';
      const kunFirst = item.kun ? item.kun.split(/[,、]/)[0].trim() : '';
      const reading = [onFirst, kunFirst].filter(Boolean).join(' / ');
      return `
        <option value="${item.k}" ${idx === APP_STATE.stroke.charIndex ? 'selected' : ''}>
          ${item.k} [${reading || ''}] - ${item.th} (${item.strokes}ขีด)
        </option>
      `;
    }).join('');
  } else {
    select.innerHTML = list.map((item, idx) => `
      <option value="${item.k}" ${idx === APP_STATE.stroke.charIndex ? 'selected' : ''}>
        ${item.k} (${item.r})
      </option>
    `).join('');
  }
}

function setStrokeKanaType(type) {
  APP_STATE.stroke.type = type;
  APP_STATE.stroke.charIndex = 0;
  if (type === 'kanji') {
    APP_STATE.stroke.group = 'all';
  } else if (APP_STATE.stroke.group === 'all' || !['basic', 'dakuon', 'yoon', 'tokushuon'].includes(APP_STATE.stroke.group)) {
    APP_STATE.stroke.group = 'basic';
  }

  const btnH = document.getElementById('stroke-type-hira');
  const btnK = document.getElementById('stroke-type-kata');
  const btnKanji = document.getElementById('stroke-type-kanji');
  const tag = document.getElementById('stroke-script-tag');

  if (type === 'hiragana') {
    if (btnH) btnH.className = 'px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-sakura-600 shadow-sm transition-all';
    if (btnK) btnK.className = 'px-3 py-1.5 rounded-lg text-xs font-medium text-sumi-600 hover:text-sumi-900 transition-all';
    if (btnKanji) btnKanji.className = 'px-3 py-1.5 rounded-lg text-xs font-medium text-sumi-600 hover:text-indigo-600 transition-all';
    if (tag) {
      tag.textContent = 'ฮิรางานะ';
      tag.className = 'text-xs font-semibold px-2.5 py-0.5 rounded-full bg-sakura-100 text-sakura-700 font-thai';
    }
  } else if (type === 'katakana') {
    if (btnK) btnK.className = 'px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-sakura-600 shadow-sm transition-all';
    if (btnH) btnH.className = 'px-3 py-1.5 rounded-lg text-xs font-medium text-sumi-600 hover:text-sumi-900 transition-all';
    if (btnKanji) btnKanji.className = 'px-3 py-1.5 rounded-lg text-xs font-medium text-sumi-600 hover:text-indigo-600 transition-all';
    if (tag) {
      tag.textContent = 'คาตาคานะ';
      tag.className = 'text-xs font-semibold px-2.5 py-0.5 rounded-full bg-sakura-100 text-sakura-700 font-thai';
    }
  } else if (type === 'kanji') {
    if (btnKanji) btnKanji.className = 'px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-sakura-600 shadow-sm transition-all';
    if (btnH) btnH.className = 'px-3 py-1.5 rounded-lg text-xs font-medium text-sumi-600 hover:text-sumi-900 transition-all';
    if (btnK) btnK.className = 'px-3 py-1.5 rounded-lg text-xs font-medium text-sumi-600 hover:text-sumi-900 transition-all';
    if (tag) {
      tag.textContent = 'คันจิ JLPT N5 (103 ตัว)';
      tag.className = 'text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-thai';
    }
  }

  updateStrokeGroupOptions();
  populateStrokeCharSelect();
  updateStrokeView();
}

function onStrokeGroupChange() {
  const defaultVal = APP_STATE.stroke.type === 'kanji' ? 'all' : 'basic';
  const val = document.getElementById('strokeGroupSelect')?.value || defaultVal;
  APP_STATE.stroke.group = val;
  APP_STATE.stroke.charIndex = 0;
  populateStrokeCharSelect();
  updateStrokeView();
}

function onStrokeCharSelect(char) {
  const list = getCurrentStrokeList();
  const idx = list.findIndex(c => c.k === char);
  if (idx !== -1) {
    APP_STATE.stroke.charIndex = idx;
    updateStrokeView();
  }
}

function selectCharacterForStroke(char, type, group) {
  if (type) {
    APP_STATE.stroke.type = type;
    const btnH = document.getElementById('stroke-type-hira');
    const btnK = document.getElementById('stroke-type-kata');
    const btnKanji = document.getElementById('stroke-type-kanji');
    const tag = document.getElementById('stroke-script-tag');
    if (type === 'hiragana') {
      if (btnH) btnH.className = 'px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-sakura-600 shadow-sm transition-all';
      if (btnK) btnK.className = 'px-3 py-1.5 rounded-lg text-xs font-medium text-sumi-600 hover:text-sumi-900 transition-all';
      if (btnKanji) btnKanji.className = 'px-3 py-1.5 rounded-lg text-xs font-medium text-sumi-600 hover:text-indigo-600 transition-all';
      if (tag) {
        tag.textContent = 'ฮิรางานะ';
        tag.className = 'text-xs font-semibold px-2.5 py-0.5 rounded-full bg-sakura-100 text-sakura-700 font-thai';
      }
    } else if (type === 'katakana') {
      if (btnK) btnK.className = 'px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-sakura-600 shadow-sm transition-all';
      if (btnH) btnH.className = 'px-3 py-1.5 rounded-lg text-xs font-medium text-sumi-600 hover:text-sumi-900 transition-all';
      if (btnKanji) btnKanji.className = 'px-3 py-1.5 rounded-lg text-xs font-medium text-sumi-600 hover:text-indigo-600 transition-all';
      if (tag) {
        tag.textContent = 'คาตาคานะ';
        tag.className = 'text-xs font-semibold px-2.5 py-0.5 rounded-full bg-sakura-100 text-sakura-700 font-thai';
      }
    } else if (type === 'kanji') {
      if (btnKanji) btnKanji.className = 'px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-sakura-600 shadow-sm transition-all';
      if (btnH) btnH.className = 'px-3 py-1.5 rounded-lg text-xs font-medium text-sumi-600 hover:text-sumi-900 transition-all';
      if (btnK) btnK.className = 'px-3 py-1.5 rounded-lg text-xs font-medium text-sumi-600 hover:text-sumi-900 transition-all';
      if (tag) {
        tag.textContent = 'คันจิ JLPT N5 (103 ตัว)';
        tag.className = 'text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-thai';
      }
    }
  }
  if (APP_STATE.stroke.type === 'kanji' && typeof N5_KANJI_DATA !== 'undefined') {
    const item = N5_KANJI_DATA.items.find(i => i.k === char);
    if (item) {
      if (group && group !== 'all' && item.cat === group) {
        APP_STATE.stroke.group = group;
      } else if (!group || group === 'all') {
        APP_STATE.stroke.group = 'all';
      } else {
        APP_STATE.stroke.group = item.cat;
      }
    } else if (group) {
      APP_STATE.stroke.group = group;
    }
  } else if (group) {
    APP_STATE.stroke.group = group;
  }

  updateStrokeGroupOptions();
  let list = getCurrentStrokeList();
  let idx = list.findIndex(c => c.k === char);
  if (idx === -1 && APP_STATE.stroke.type === 'kanji' && typeof N5_KANJI_DATA !== 'undefined') {
    const item = N5_KANJI_DATA.items.find(i => i.k === char);
    if (item) {
      APP_STATE.stroke.group = item.cat;
      updateStrokeGroupOptions();
      list = getCurrentStrokeList();
      idx = list.findIndex(c => c.k === char);
    }
  }

  if (idx !== -1) {
    APP_STATE.stroke.charIndex = idx;
  } else {
    APP_STATE.stroke.charIndex = 0;
  }
  populateStrokeCharSelect();
  updateStrokeView();
}

function prevStrokeChar() {
  const list = getCurrentStrokeList();
  if (list.length === 0) return;
  APP_STATE.stroke.charIndex = (APP_STATE.stroke.charIndex - 1 + list.length) % list.length;
  updateStrokeView();
}

function nextStrokeChar() {
  const list = getCurrentStrokeList();
  if (list.length === 0) return;
  APP_STATE.stroke.charIndex = (APP_STATE.stroke.charIndex + 1) % list.length;
  updateStrokeView();
}

function updateStrokeView() {
  const list = getCurrentStrokeList();
  if (list.length === 0) return;

  if (APP_STATE.stroke.charIndex >= list.length || APP_STATE.stroke.charIndex < 0) {
    APP_STATE.stroke.charIndex = 0;
  }
  const charData = list[APP_STATE.stroke.charIndex];
  if (!charData) return;

  APP_STATE.stroke.currentChar = charData.k;
  APP_STATE.stroke.data = charData;

  const counter = document.getElementById('strokeProgressCounter');
  if (counter) counter.textContent = `${APP_STATE.stroke.charIndex + 1}/${list.length}`;
  const counterCanvas = document.getElementById('strokeProgressCounterCanvas');
  if (counterCanvas) counterCanvas.textContent = `${APP_STATE.stroke.charIndex + 1}/${list.length}`;

  const charSelect = document.getElementById('strokeCharSelect');
  if (charSelect) charSelect.value = charData.k;

  document.getElementById('char-display-large').textContent = charData.k;

  const badgesContainer = document.getElementById('char-kanji-badges');

  if (APP_STATE.stroke.type === 'kanji') {
    // Kanji specific view
    const onyomiStr = charData.on || (Array.isArray(charData.onyomi) ? charData.onyomi.join(', ') : charData.onyomi) || '-';
    const kunyomiStr = charData.kun || (Array.isArray(charData.kunyomi) ? charData.kunyomi.join(', ') : charData.kunyomi) || '—';
    const onyomiR = charData.on_r || '-';
    const onyomiTh = charData.on_th || '-';
    const kunyomiR = charData.kun_r || '-';
    const kunyomiTh = charData.kun_th || '-';

    const onFirst = charData.on ? charData.on.split(/[,、]/)[0].trim() : '';
    const kunFirst = charData.kun ? charData.kun.split(/[,、]/)[0].trim() : '';
    const primaryReading = [onFirst, kunFirst].filter(Boolean).join(' / ');

    const onRFirst = charData.on_r ? charData.on_r.split(/[,、]/)[0].trim() : '';
    const kunRFirst = charData.kun_r ? charData.kun_r.split(/[,、]/)[0].trim() : '';
    const primaryR = [onRFirst, kunRFirst].filter(Boolean).join(' / ');

    const onThFirst = charData.on_th ? charData.on_th.split(/[,、]/)[0].trim() : '';
    const kunThFirst = charData.kun_th ? charData.kun_th.split(/[,、]/)[0].trim() : '';
    const primaryTh = [onThFirst, kunThFirst].filter(Boolean).join(' / ');

    const romajiLargeEl = document.getElementById('char-romaji-large');
    if (romajiLargeEl) {
      romajiLargeEl.innerHTML = `
        <span class="font-jp text-sakura-700">${primaryReading || `${charData.strokes} ขีด`}</span>
        ${primaryR ? `<span class="reading-romaji font-mono text-xs text-sumi-500 font-semibold ml-1.5">${primaryR}</span>` : ''}
        ${primaryTh ? `<span class="reading-th font-thai text-xs text-sakura-600 font-bold ml-1.5">[${primaryTh}]</span>` : ''}
      `;
    }
    document.getElementById('char-thai-large').textContent = `ความหมาย: ${charData.th} (${charData.strokes} ขีด)`;

    if (badgesContainer) {
      badgesContainer.classList.remove('hidden');
      badgesContainer.className = 'mt-3 pt-3 border-t border-sakura-100/70 space-y-2';
      badgesContainer.innerHTML = `
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <!-- Onyomi Badge -->
          <div class="flex flex-col gap-0.5 px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200/70" title="เสียงอ่านแบบจีน มักใช้ในคำประสม">
            <div class="flex items-center gap-1.5">
              <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-600 text-white font-thai flex items-center gap-1">
                <span class="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>เสียงอง (音)
              </span>
              <span class="font-jp font-bold text-rose-900">${onyomiStr}</span>
            </div>
            <div class="flex items-center gap-1.5 text-[10px] text-sumi-500 pl-1 flex-wrap">
              <span class="reading-romaji font-mono text-sumi-600 font-medium">${onyomiR}</span>
              <span class="reading-th font-thai text-rose-700 font-bold">[${onyomiTh}]</span>
            </div>
          </div>

          <!-- Kunyomi Badge -->
          <div class="flex flex-col gap-0.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200/70" title="เสียงอ่านแบบญี่ปุ่นแท้ มักใช้เดี่ยวๆ">
            <div class="flex items-center gap-1.5">
              <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-600 text-white font-thai flex items-center gap-1">
                <span class="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>เสียงคุง (訓)
              </span>
              <span class="font-jp font-bold text-emerald-900">${kunyomiStr}</span>
            </div>
            <div class="flex items-center gap-1.5 text-[10px] text-sumi-500 pl-1 flex-wrap">
              <span class="reading-romaji font-mono text-sumi-600 font-medium">${kunyomiR}</span>
              <span class="reading-th font-thai text-emerald-700 font-bold">[${kunyomiTh}]</span>
            </div>
          </div>

          <!-- JLPT Badge -->
          <div class="px-3 py-2 rounded-xl bg-indigo-50 border border-indigo-200/70 text-indigo-800 font-thai text-[11px] font-bold flex items-center gap-1">
            <span>🈸 ระดับ: JLPT N5</span>
            <span class="text-indigo-500 font-mono">(${charData.strokes} ขีด)</span>
          </div>
        </div>
      `;
    }

    document.getElementById('char-stroke-rule').textContent = charData.rule || 'ลากเส้นตามลำดับหมายเลขจาก KanjiVG';

    const sample = charData.sample || {};
    document.getElementById('char-sample-jp').textContent = sample.jp || charData.k;
    document.getElementById('char-sample-kana').textContent = sample.kana || sample.r || '';
    document.getElementById('char-sample-romaji').textContent = sample.r || '';
    
    const sampleThaiEl = document.getElementById('char-sample-thai');
    if (sampleThaiEl) {
      sampleThaiEl.innerHTML = `
        ${sample.th_read ? `<span class="reading-th text-torii font-semibold mr-1">[${sample.th_read}]</span>` : ''}
        <span>${sample.th || charData.th}</span>
      `;
    }

  } else {
    // Kana specific view
    document.getElementById('char-romaji-large').textContent = charData.r;
    document.getElementById('char-thai-large').textContent = charData.th;

    if (badgesContainer) {
      badgesContainer.classList.add('hidden');
      badgesContainer.className = 'hidden';
      badgesContainer.innerHTML = '';
    }

    document.getElementById('char-stroke-rule').textContent = charData.rule || 'ลากเส้นจากซ้ายไปขวา และบนลงล่างตามแบบฉบับอักษรญี่ปุ่น';

    const sample = charData.sample || { jp: charData.k, r: charData.r, th: charData.th };
    document.getElementById('char-sample-jp').textContent = sample.jp;
    document.getElementById('char-sample-kana').textContent = charData.k;
    document.getElementById('char-sample-romaji').textContent = sample.r;
    document.getElementById('char-sample-thai').textContent = sample.th;
  }

  clearCanvas();
  renderStrokeStepStrip(charData);
}

/* =========================================================================
   6. STEP-BY-STEP PREVIEW STRIP (AUTHENTIC KANJIVG PATHS & NUMBERING)
   ========================================================================= */
function renderStrokeStepStrip(charData) {
  const strip = document.getElementById('stroke-steps-strip');
  const badge = document.getElementById('stroke-step-count-badge');
  if (!strip) return;

  const entry = getKanaStrokeEntry(charData.k);
  const strokes = entry ? entry.strokes : [];

  if (badge) badge.textContent = `จำนวน ${strokes.length} ขีด`;

  if (strokes.length === 0) {
    strip.innerHTML = `
      <div class="py-4 text-xs text-sumi-400 font-thai text-center w-full">
        กำลังโหลดข้อมูลลำดับขีด...
      </div>
    `;
    return;
  }

  let html = '';

  strokes.forEach((stroke, idx) => {
    const stepNum = idx + 1;
    const numPos = stroke.number;
    const arrow = calculatePathDirectionArrow(stroke.path, stroke.transform);

    html += `
      <div class="flex-shrink-0 flex flex-col items-center">
        <div class="genkou-box w-24 h-24 sm:w-28 sm:h-28 rounded-xl shadow-sm relative overflow-hidden flex items-center justify-center border border-sumi-300">
          <svg viewBox="0 0 109 109" class="w-full h-full">
            <!-- 4-Quadrant Guidelines -->
            <line x1="0" y1="54.5" x2="109" y2="54.5" stroke="#fca5a5" stroke-width="0.8" stroke-dasharray="3 3" opacity="0.6" />
            <line x1="54.5" y1="0" x2="54.5" y2="109" stroke="#fca5a5" stroke-width="0.8" stroke-dasharray="3 3" opacity="0.6" />

            <!-- Previous Strokes in Faded Gray -->
            ${strokes.slice(0, idx).map(prev => renderSvgStrokePath(prev, '#cbd5e1', 7)).join('')}

            <!-- Current Stroke in Solid Dark Sumi Black -->
            ${renderSvgStrokePath(stroke, '#0f172a', 7.5)}

            <!-- Prominent Red Direction Arrow -->
            ${arrow ? `
              <g transform="translate(${arrow.x}, ${arrow.y}) rotate(${arrow.angle})">
                <polygon points="-5,-4 4,0 -5,4" fill="#e11d48" stroke="#ffffff" stroke-width="0.8" />
              </g>
            ` : ''}

            <!-- Bold Red Numbered Label Circle (1, 2, 3...) -->
            <circle cx="${numPos.x}" cy="${numPos.y}" r="6.5" fill="#e11d48" />
            <text x="${numPos.x}" y="${numPos.y + 2.5}" fill="#ffffff" font-size="7.5" font-weight="bold" font-family="Outfit, sans-serif" text-anchor="middle">${stepNum}</text>
          </svg>
        </div>
        <span class="text-[11px] font-thai font-semibold text-sumi-600 mt-1.5">ขีดที่ ${stepNum}</span>
      </div>
    `;
  });

  // Final Completed Character Box
  html += `
    <div class="flex-shrink-0 flex flex-col items-center">
      <div class="genkou-box w-24 h-24 sm:w-28 sm:h-28 rounded-xl shadow-sm relative overflow-hidden flex items-center justify-center border-2 border-emerald-300 bg-emerald-50/20">
        <svg viewBox="0 0 109 109" class="w-full h-full">
          <line x1="0" y1="54.5" x2="109" y2="54.5" stroke="#a7f3d0" stroke-width="0.8" stroke-dasharray="3 3" />
          <line x1="54.5" y1="0" x2="54.5" y2="109" stroke="#a7f3d0" stroke-width="0.8" stroke-dasharray="3 3" />
          ${strokes.map(s => renderSvgStrokePath(s, '#0f172a', 7.5)).join('')}
        </svg>
        <div class="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[9px] font-thai font-bold">
          สมบูรณ์
        </div>
      </div>
      <span class="text-[11px] font-thai font-bold text-emerald-600 mt-1.5">ตัวเต็ม</span>
    </div>
  `;

  strip.innerHTML = html;
}

// Helper: Render SVG Path with optional group transform
function renderSvgStrokePath(strokeObj, color, width) {
  if (strokeObj.transform) {
    const t = strokeObj.transform;
    return `
      <g transform="translate(${t.dx}, ${t.dy}) scale(${t.scale})">
        <path d="${strokeObj.path}" fill="none" stroke="${color}" stroke-width="${width / t.scale}" stroke-linecap="round" stroke-linejoin="round" />
      </g>
    `;
  }
  return `<path d="${strokeObj.path}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" />`;
}

// Calculate path direction arrow taking transform into account
function calculatePathDirectionArrow(pathStr, transform) {
  try {
    const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', pathStr);
    tempSvg.appendChild(pathEl);
    document.body.appendChild(tempSvg);

    const totalLen = pathEl.getTotalLength();
    if (totalLen > 0) {
      const sampleDist = Math.min(totalLen * 0.35, 25);
      const p1 = pathEl.getPointAtLength(Math.max(0, sampleDist - 2));
      const p2 = pathEl.getPointAtLength(sampleDist);
      document.body.removeChild(tempSvg);

      let x1 = p1.x;
      let y1 = p1.y;
      let x2 = p2.x;
      let y2 = p2.y;

      if (transform) {
        x1 = x1 * transform.scale + transform.dx;
        y1 = y1 * transform.scale + transform.dy;
        x2 = x2 * transform.scale + transform.dx;
        y2 = y2 * transform.scale + transform.dy;
      }

      const dx = x2 - x1;
      const dy = y2 - y1;
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      return { x: x2, y: y2, angle };
    }
    document.body.removeChild(tempSvg);
  } catch (e) {
    // Fallback
  }
  return null;
}

/* =========================================================================
   7. "DEMONSTRATE (สาธิตวิธีเขียน)" ANIMATION ENGINE
   ========================================================================= */
function demonstrateStroke() {
  if (APP_STATE.stroke.animating) return;
  APP_STATE.stroke.animating = true;

  clearCanvas();

  const entry = getKanaStrokeEntry(APP_STATE.stroke.currentChar);
  if (!entry || !entry.strokes || entry.strokes.length === 0) {
    APP_STATE.stroke.animating = false;
    return;
  }

  const strokes = entry.strokes;
  const btnDemo = document.getElementById('btn-demonstrate');
  if (btnDemo) {
    btnDemo.innerHTML = `
      <svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
      <span>กำลังสาธิต...</span>
    `;
  }

  let strokeIndex = 0;

  function animateNextStroke() {
    if (strokeIndex >= strokes.length) {
      APP_STATE.stroke.animating = false;
      if (btnDemo) {
        btnDemo.innerHTML = `
          <svg class="w-4 h-4 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          <span>สาธิตวิธีเขียน (Demonstrate)</span>
        `;
      }
      playSuccessChime();
      showToast('เสร็จสิ้นการสาธิต ลองคัดตามได้เลย!', '✨');
      return;
    }

    const stroke = strokes[strokeIndex];
    const pathD = stroke.path;
    const transform = stroke.transform;

    const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', pathD);
    tempSvg.appendChild(pathEl);
    document.body.appendChild(tempSvg);

    const totalLength = pathEl.getTotalLength();
    const durationMs = Math.max(350, Math.min(totalLength * 8, 850));
    const startTime = performance.now();

    function getCanvasPoint(rawPt) {
      if (transform) {
        const transX = rawPt.x * transform.scale + transform.dx;
        const transY = rawPt.y * transform.scale + transform.dy;
        return { x: transX * SCALE_FACTOR, y: transY * SCALE_FACTOR };
      }
      return { x: rawPt.x * SCALE_FACTOR, y: rawPt.y * SCALE_FACTOR };
    }

    let lastPoint = getCanvasPoint(pathEl.getPointAtLength(0));

    function step(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      const currentLength = progress * totalLength;

      const currentPoint = getCanvasPoint(pathEl.getPointAtLength(currentLength));

      ctx.lineWidth = 8.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0f172a';

      ctx.beginPath();
      ctx.moveTo(lastPoint.x, lastPoint.y);
      ctx.lineTo(currentPoint.x, currentPoint.y);
      ctx.stroke();

      lastPoint = currentPoint;

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        document.body.removeChild(tempSvg);
        strokeIndex++;
        setTimeout(animateNextStroke, 180);
      }
    }

    requestAnimationFrame(step);
  }

  animateNextStroke();
}

function speakCurrentStrokeChar() {
  if (APP_STATE.stroke.currentChar) {
    speakJapanese(APP_STATE.stroke.currentChar);
  }
}

function speakSampleWord() {
  const charData = APP_STATE.stroke.data;
  if (charData && charData.sample) {
    speakJapanese(charData.sample.jp);
  }
}

// Global Keyboard Shortcuts
window.addEventListener('keydown', (e) => {
  if (APP_STATE.activeTab === 'stroke') {
    if (e.key === 'ArrowLeft') {
      prevStrokeChar();
    } else if (e.key === 'ArrowRight') {
      nextStrokeChar();
    }
  } else if (APP_STATE.activeTab === 'flashcards') {
    if (e.code === 'Space') {
      e.preventDefault();
      flipFlashcard();
    } else if (e.key === '1') {
      recordFlashcard(false);
    } else if (e.key === '2') {
      recordFlashcard(true);
    }
  }
});

/* =========================================================================
   8. FLASHCARD SYSTEM (TAB 3 - LEITNER ACTIVE RECALL)
   ========================================================================= */
function setFlashcardDeck(deckName) {
  APP_STATE.flashcards.deckName = deckName;
  document.querySelectorAll('#tab-flashcards button[id^="fc-deck-"]').forEach(btn => {
    btn.className = 'px-3 py-1.5 rounded-xl text-xs font-medium text-sumi-600 bg-sumi-100 hover:bg-sumi-200 transition-all';
  });
  const activeBtn = document.getElementById(
    deckName === 'hiragana-basic' ? 'fc-deck-hira' :
    deckName === 'katakana-basic' ? 'fc-deck-kata' : 'fc-deck-dakuon'
  );
  if (activeBtn) {
    activeBtn.className = 'px-3 py-1.5 rounded-xl text-xs font-semibold bg-sakura-600 text-white shadow-sm transition-all';
  }
  initFlashcards();
}

function initFlashcards() {
  let rawList = [];
  if (APP_STATE.flashcards.deckName === 'hiragana-basic') {
    rawList = [...KANA_DATA.hiragana.basic];
  } else if (APP_STATE.flashcards.deckName === 'katakana-basic') {
    rawList = [...KANA_DATA.katakana.basic];
  } else {
    rawList = [...KANA_DATA.hiragana.dakuon, ...KANA_DATA.hiragana.yoon];
  }

  APP_STATE.flashcards.cards = rawList;
  APP_STATE.flashcards.currentIndex = 0;
  APP_STATE.flashcards.isFlipped = false;
  APP_STATE.flashcards.masteredSet.clear();
  APP_STATE.flashcards.reviewSet.clear();

  updateFlashcardView();
}

function shuffleFlashcards() {
  const array = APP_STATE.flashcards.cards;
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  APP_STATE.flashcards.currentIndex = 0;
  APP_STATE.flashcards.isFlipped = false;
  updateFlashcardView();
  showToast('สลับลำดับการ์ดเรียบร้อย', '🔀');
}

function resetFlashcards() {
  initFlashcards();
  showToast('รีเซ็ตการ์ดคำศัพท์เรียบร้อย', '🔄');
}

function flipFlashcard() {
  APP_STATE.flashcards.isFlipped = !APP_STATE.flashcards.isFlipped;
  const inner = document.getElementById('flashcard-inner');
  if (inner) {
    if (APP_STATE.flashcards.isFlipped) {
      inner.classList.add('is-flipped');
      speakFlashcardAudio();
    } else {
      inner.classList.remove('is-flipped');
    }
  }
}

function updateFlashcardView() {
  const cards = APP_STATE.flashcards.cards;
  const idx = APP_STATE.flashcards.currentIndex;
  const inner = document.getElementById('flashcard-inner');

  if (inner) {
    inner.classList.remove('is-flipped');
    APP_STATE.flashcards.isFlipped = false;
  }

  if (cards.length === 0 || idx >= cards.length) {
    showDeckFinished();
    return;
  }

  const card = cards[idx];

  document.getElementById('fc-front-char').textContent = card.k;
  document.getElementById('fc-front-tag').textContent = 
    APP_STATE.flashcards.deckName.includes('hiragana') ? 'ฮิรางานะ' : 'คาตาคานะ';

  document.getElementById('fc-back-char').textContent = card.k;
  document.getElementById('fc-back-romaji').textContent = card.r;
  document.getElementById('fc-back-thai').textContent = card.th;

  const sample = card.sample || { jp: card.k, r: card.r, th: card.th };
  document.getElementById('fc-back-word-jp').textContent = sample.jp;
  document.getElementById('fc-back-word-ro').textContent = sample.r;
  document.getElementById('fc-back-word-th').textContent = `= ${sample.th}`;

  document.getElementById('fc-stat-current').textContent = `${idx + 1} / ${cards.length}`;
  document.getElementById('fc-stat-mastered').textContent = APP_STATE.flashcards.masteredSet.size;
  document.getElementById('fc-stat-review').textContent = APP_STATE.flashcards.reviewSet.size;
  document.getElementById('fc-stat-remaining').textContent = cards.length - (idx + 1);

  const percent = ((idx) / cards.length) * 100;
  document.getElementById('fc-progress-bar').style.width = `${percent}%`;
}

function recordFlashcard(mastered) {
  const cards = APP_STATE.flashcards.cards;
  const idx = APP_STATE.flashcards.currentIndex;
  if (idx >= cards.length) return;

  const currentCard = cards[idx];
  if (mastered) {
    APP_STATE.flashcards.masteredSet.add(currentCard.k);
    APP_STATE.flashcards.reviewSet.delete(currentCard.k);
    playTone(660, 'sine', 0.1);
  } else {
    APP_STATE.flashcards.reviewSet.add(currentCard.k);
    cards.push(currentCard);
    playTone(330, 'triangle', 0.15);
  }

  APP_STATE.flashcards.currentIndex++;
  updateFlashcardView();
}

function speakFlashcardAudio() {
  const card = APP_STATE.flashcards.cards[APP_STATE.flashcards.currentIndex];
  if (card) {
    speakJapanese(card.k);
  }
}

function showDeckFinished() {
  if (typeof confetti === 'function') {
    confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
  }
  playSuccessChime();
  showToast('เยี่ยมมาก! ทบทวนครบชุดการ์ดแล้ว', '🎉');
}

/* =========================================================================
   9. SPEED QUIZ DRILL (TAB 4 - 10 TIMED QUESTIONS)
   ========================================================================= */
function startQuiz() {
  APP_STATE.quiz.charset = document.getElementById('quiz-charset')?.value || 'hiragana';
  APP_STATE.quiz.mode = document.getElementById('quiz-mode')?.value || 'kana-to-sound';
  APP_STATE.quiz.currentIndex = 0;
  APP_STATE.quiz.score = 0;
  APP_STATE.quiz.mistakes = [];

  let pool = [];
  if (APP_STATE.quiz.charset === 'hiragana') {
    pool = [...KANA_DATA.hiragana.basic];
  } else if (APP_STATE.quiz.charset === 'katakana') {
    pool = [...KANA_DATA.katakana.basic];
  } else if (APP_STATE.quiz.charset === 'mixed') {
    pool = [...KANA_DATA.hiragana.basic, ...KANA_DATA.katakana.basic];
  } else {
    pool = [...KANA_DATA.hiragana.dakuon, ...KANA_DATA.hiragana.yoon];
  }

  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, 10);

  APP_STATE.quiz.questions = selected.map(target => {
    const wrongs = pool.filter(c => c.k !== target.k).sort(() => Math.random() - 0.5).slice(0, 3);
    const choices = [target, ...wrongs].sort(() => Math.random() - 0.5);
    return {
      target,
      choices,
      correctIdx: choices.findIndex(c => c.k === target.k)
    };
  });

  document.getElementById('quiz-start-screen')?.classList.add('hidden');
  document.getElementById('quiz-result-screen')?.classList.add('hidden');
  document.getElementById('quiz-active-screen')?.classList.remove('hidden');

  loadQuizQuestion();
}

function loadQuizQuestion() {
  clearInterval(APP_STATE.quiz.timer);
  const q = APP_STATE.quiz.questions[APP_STATE.quiz.currentIndex];
  if (!q) {
    finishQuiz();
    return;
  }

  document.getElementById('quiz-q-counter').textContent = `ข้อที่ ${APP_STATE.quiz.currentIndex + 1} / 10`;
  document.getElementById('quiz-score-live').textContent = `คะแนน: ${APP_STATE.quiz.score}`;

  const promptText = document.getElementById('quiz-prompt-text');
  const hint = document.getElementById('quiz-question-type-hint');
  const audioBtn = document.getElementById('quiz-audio-btn-wrapper');

  if (APP_STATE.quiz.mode === 'kana-to-sound') {
    hint.textContent = 'ตัวอักษรนี้อ่านออกเสียงว่าอย่างไร?';
    promptText.textContent = q.target.k;
    promptText.style.display = 'block';
    audioBtn.classList.add('hidden');
  } else if (APP_STATE.quiz.mode === 'sound-to-kana') {
    hint.textContent = 'เลือกตัวอักษรที่ตรงกับเสียงอ่าน:';
    promptText.textContent = `${q.target.r} (${q.target.th})`;
    promptText.style.display = 'block';
    audioBtn.classList.add('hidden');
  } else {
    hint.textContent = 'ฟังเสียงและเลือกตัวอักษรที่ได้ยิน:';
    promptText.style.display = 'none';
    audioBtn.classList.remove('hidden');
    playQuizAudioPrompt();
  }

  for (let i = 0; i < 4; i++) {
    const btn = document.getElementById(`quiz-btn-${i}`);
    if (!btn) continue;
    const choice = q.choices[i];
    btn.disabled = false;
    btn.className = 'quiz-btn p-4 rounded-2xl border-2 border-sumi-200 hover:border-amber-400 hover:bg-amber-50/50 text-center font-bold text-lg text-sumi-800 transition-all active:scale-98';

    if (APP_STATE.quiz.mode === 'kana-to-sound') {
      btn.innerHTML = `<span class="font-mono text-xl">${choice.r}</span> <span class="text-xs text-sumi-500 font-thai">(${choice.th})</span>`;
    } else {
      btn.innerHTML = `<span class="font-jp text-3xl">${choice.k}</span>`;
    }
  }

  APP_STATE.quiz.timeLeft = 10;
  updateQuizTimerBar();
  APP_STATE.quiz.timer = setInterval(() => {
    APP_STATE.quiz.timeLeft -= 0.1;
    if (APP_STATE.quiz.timeLeft <= 0) {
      clearInterval(APP_STATE.quiz.timer);
      handleQuizTimeout();
    } else {
      updateQuizTimerBar();
    }
  }, 100);
}

function updateQuizTimerBar() {
  const bar = document.getElementById('quiz-timer-bar');
  const text = document.getElementById('quiz-timer-text');
  const pct = Math.max(0, (APP_STATE.quiz.timeLeft / 10) * 100);
  if (bar) bar.style.width = `${pct}%`;
  if (text) text.textContent = `${Math.ceil(APP_STATE.quiz.timeLeft)}s`;
}

function playQuizAudioPrompt() {
  const q = APP_STATE.quiz.questions[APP_STATE.quiz.currentIndex];
  if (q) speakJapanese(q.target.k);
}

function selectQuizChoice(selectedIdx) {
  clearInterval(APP_STATE.quiz.timer);
  const q = APP_STATE.quiz.questions[APP_STATE.quiz.currentIndex];
  if (!q) return;

  for (let i = 0; i < 4; i++) {
    document.getElementById(`quiz-btn-${i}`).disabled = true;
  }

  const isCorrect = (selectedIdx === q.correctIdx);
  const chosenBtn = document.getElementById(`quiz-btn-${selectedIdx}`);
  const correctBtn = document.getElementById(`quiz-btn-${q.correctIdx}`);

  if (isCorrect) {
    chosenBtn.className = 'quiz-btn p-4 rounded-2xl border-2 border-emerald-500 bg-emerald-50 text-center font-bold text-lg text-emerald-700 transition-all animate-bounce';
    APP_STATE.quiz.score++;
    playSuccessChime();
  } else {
    chosenBtn.className = 'quiz-btn p-4 rounded-2xl border-2 border-rose-500 bg-rose-50 text-center font-bold text-lg text-rose-700 transition-all';
    correctBtn.className = 'quiz-btn p-4 rounded-2xl border-2 border-emerald-500 bg-emerald-50 text-center font-bold text-lg text-emerald-700 transition-all';
    APP_STATE.quiz.mistakes.push({
      target: q.target,
      yourChoice: q.choices[selectedIdx]
    });
    playErrorBuzz();
  }

  setTimeout(() => {
    APP_STATE.quiz.currentIndex++;
    loadQuizQuestion();
  }, 1100);
}

function handleQuizTimeout() {
  const q = APP_STATE.quiz.questions[APP_STATE.quiz.currentIndex];
  if (!q) return;

  for (let i = 0; i < 4; i++) {
    document.getElementById(`quiz-btn-${i}`).disabled = true;
  }
  const correctBtn = document.getElementById(`quiz-btn-${q.correctIdx}`);
  correctBtn.className = 'quiz-btn p-4 rounded-2xl border-2 border-emerald-500 bg-emerald-50 text-center font-bold text-lg text-emerald-700 transition-all';

  APP_STATE.quiz.mistakes.push({
    target: q.target,
    yourChoice: { k: 'หมดเวลา', r: 'Timeout', th: 'หมดเวลา' }
  });
  playErrorBuzz();

  setTimeout(() => {
    APP_STATE.quiz.currentIndex++;
    loadQuizQuestion();
  }, 1200);
}

function finishQuiz() {
  clearInterval(APP_STATE.quiz.timer);
  document.getElementById('quiz-active-screen')?.classList.add('hidden');
  document.getElementById('quiz-result-screen')?.classList.remove('hidden');

  const score = APP_STATE.quiz.score;
  const pct = Math.round((score / 10) * 100);

  document.getElementById('quiz-final-score').textContent = score;
  document.getElementById('quiz-final-accuracy').textContent = `${pct}%`;

  const badge = document.getElementById('quiz-badge-icon');
  const rating = document.getElementById('quiz-rating-text');

  if (score === 10) {
    badge.textContent = '🎌';
    rating.textContent = 'ยอดเยี่ยมไร้ที่ติ! คุณคือระดับเซียนภาษาญี่ปุ่น';
    if (typeof confetti === 'function') {
      confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
    }
    playSuccessChime();
  } else if (score >= 7) {
    badge.textContent = '⭐';
    rating.textContent = 'เก่งมาก! พื้นฐานตัวอักษรของคุณแน่นหนามาก';
    playSuccessChime();
  } else {
    badge.textContent = '💪';
    rating.textContent = 'ฝึกฝนอีกนิดนะ! ลองกลับไปดูตารางคานะแล้วลองใหม่';
  }

  const mistakesWrapper = document.getElementById('quiz-mistakes-wrapper');
  const mistakesList = document.getElementById('quiz-mistakes-list');
  if (APP_STATE.quiz.mistakes.length > 0) {
    mistakesWrapper.classList.remove('hidden');
    mistakesList.innerHTML = APP_STATE.quiz.mistakes.map(m => `
      <div class="p-2.5 rounded-xl bg-rose-50/70 border border-rose-100 flex items-center justify-between text-xs font-thai">
        <div class="flex items-center gap-2">
          <span class="font-jp font-bold text-base text-sumi-900">${m.target.k}</span>
          <span class="font-mono text-sumi-600">${m.target.r}</span>
          <span class="text-rose-600 font-medium">(${m.target.th})</span>
        </div>
        <button onclick="speakJapanese('${m.target.k}')" class="text-xs text-sumi-400 hover:text-sakura-600">🔊 ฟังเสียง</button>
      </div>
    `).join('');
  } else {
    mistakesWrapper.classList.add('hidden');
  }
}

function restartQuiz() {
  startQuiz();
}

/* =========================================================================
   10. VOCABULARY BANK (TAB 5)
   ========================================================================= */
function setVocabCategory(cat) {
  APP_STATE.vocab.activeCategory = cat;
  document.querySelectorAll('.vc-btn').forEach(btn => {
    btn.className = 'vc-btn px-3.5 py-1.5 rounded-xl text-xs font-medium bg-white text-sumi-600 border border-sumi-200 hover:bg-matcha-50 transition-all';
  });
  const activeBtn = document.getElementById(`vc-${cat}`);
  if (activeBtn) {
    activeBtn.className = 'vc-btn px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-matcha-600 text-white shadow-sm transition-all';
  }
  renderVocabGrid();
}

function filterVocabList() {
  renderVocabGrid();
}

function renderVocabGrid() {
  const grid = document.getElementById('vocab-grid');
  const badge = document.getElementById('vocab-count-badge');
  if (!grid) return;

  const search = (document.getElementById('vocabSearch')?.value || '').trim().toLowerCase();
  const cat = APP_STATE.vocab.activeCategory;

  const filtered = VOCAB_DATA.filter(item => {
    const matchCat = (cat === 'all' || item.cat === cat);
    const matchSearch = !search || (
      item.jp.includes(search) ||
      item.ro.toLowerCase().includes(search) ||
      item.th.includes(search) ||
      (item.furi && item.furi.includes(search))
    );
    return matchCat && matchSearch;
  });

  if (badge) badge.textContent = `แสดง ${filtered.length} คำ`;

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full py-12 text-center text-sumi-400 font-thai">
        <div class="text-4xl mb-2">📖</div>
        <p>ไม่พบคำศัพท์ที่ตรงกับการค้นหา</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(item => `
    <div class="bg-white rounded-2xl p-5 border border-sumi-200 hover:border-matcha-300 hover:shadow-card transition-all duration-200 flex flex-col justify-between">
      <div>
        <div class="flex items-start justify-between">
          <div>
            <span class="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${
              item.cat === 'anime' ? 'bg-sakura-100 text-sakura-700' :
              item.cat === 'greetings' ? 'bg-amber-100 text-amber-700' :
              item.cat === 'food' ? 'bg-orange-100 text-orange-700' : 'bg-matcha-100 text-matcha-700'
            } font-thai">
              ${
                item.cat === 'anime' ? '🌸 วลีอนิเมะ' :
                item.cat === 'greetings' ? '👋 ทักทาย' :
                item.cat === 'food' ? '🍱 อาหาร' :
                item.cat === 'verbs' ? '🚶 กริยา N5' : '🏫 N5 ประจำวัน'
              }
            </span>
            <div class="mt-2 flex items-baseline gap-2">
              <h3 class="font-jp font-bold text-2xl text-sumi-900">${item.jp}</h3>
              ${item.furi ? `<span class="font-jp text-xs text-sumi-400">(${item.furi})</span>` : ''}
            </div>
            <div class="font-mono text-xs font-semibold text-matcha-700">${item.ro}</div>
          </div>

          <button onclick="speakJapanese('${item.jp}')" title="ฟังการออกเสียง" class="p-2.5 rounded-xl bg-matcha-50 text-matcha-700 hover:bg-matcha-600 hover:text-white transition-all shadow-sm">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"></path></svg>
          </button>
        </div>

        <p class="text-xs sm:text-sm font-thai font-medium text-sumi-700 mt-2.5">
          ${item.th}
        </p>
      </div>

      <div class="mt-4 pt-3 border-t border-sumi-100 text-xs font-thai text-sumi-500 bg-washi-50/60 p-2.5 rounded-xl flex items-center justify-between">
        <span class="truncate mr-2">💬 ${item.ex}</span>
        <button onclick="speakJapanese('${item.ex.split('=')[0].trim()}')" title="ฟังประโยค" class="text-sumi-400 hover:text-matcha-600 flex-shrink-0">
          🔊
        </button>
      </div>
    </div>
  `).join('');
}

/* =========================================================================
   11. 4-WEEK STUDY ROADMAP & TRACKER (TAB 6 - LOCALSTORAGE)
   ========================================================================= */
const ROADMAP_STORAGE_KEY = 'nihongo_master_roadmap_v2';

function loadRoadmapStorage() {
  try {
    const raw = localStorage.getItem(ROADMAP_STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      APP_STATE.roadmap.completedTasks = new Set(arr);
    }
  } catch (e) {
    console.warn('LocalStorage load error:', e);
  }
}

function saveRoadmapStorage() {
  try {
    const arr = Array.from(APP_STATE.roadmap.completedTasks);
    localStorage.setItem(ROADMAP_STORAGE_KEY, JSON.stringify(arr));
  } catch (e) {
    console.warn('LocalStorage save error:', e);
  }
}

function toggleRoadmapTask(taskId) {
  if (APP_STATE.roadmap.completedTasks.has(taskId)) {
    APP_STATE.roadmap.completedTasks.delete(taskId);
  } else {
    APP_STATE.roadmap.completedTasks.add(taskId);
    playTone(700, 'sine', 0.1);
  }
  saveRoadmapStorage();
  renderRoadmap();
}

function resetRoadmapProgress() {
  if (confirm('คุณต้องการรีเซ็ตความคืบหน้าของแผนการเรียนทั้งหมดใช่หรือไม่?')) {
    APP_STATE.roadmap.completedTasks.clear();
    saveRoadmapStorage();
    renderRoadmap();
    showToast('รีเซ็ตความคืบหน้าเรียบร้อย', '🔄');
  }
}

function renderRoadmap() {
  const weeks = ['w1', 'w2', 'w3', 'w4'];
  let totalCompleted = 0;
  const totalTasks = 28;

  weeks.forEach(wKey => {
    const listContainer = document.getElementById(`roadmap-${wKey}-list`);
    const countBadge = document.getElementById(`${wKey}-count`);
    if (!listContainer) return;

    const tasks = ROADMAP_DATA[wKey] || [];
    let wCompleted = 0;

    listContainer.innerHTML = tasks.map(task => {
      const isDone = APP_STATE.roadmap.completedTasks.has(task.id);
      if (isDone) {
        wCompleted++;
        totalCompleted++;
      }
      return `
        <div class="flex items-start gap-3 p-3 rounded-2xl ${isDone ? 'bg-emerald-50/60 border border-emerald-200' : 'bg-sumi-50/50 hover:bg-sumi-100/50 border border-transparent'} transition-all cursor-pointer" onclick="toggleRoadmapTask('${task.id}')">
          <input type="checkbox" ${isDone ? 'checked' : ''} class="w-4 h-4 mt-1 text-emerald-600 rounded focus:ring-emerald-500 cursor-pointer pointer-events-none">
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-sumi-500 font-mono">${task.day}:</span>
              <h4 class="text-xs sm:text-sm font-bold ${isDone ? 'line-through text-sumi-400' : 'text-sumi-800'} font-thai">${task.title}</h4>
            </div>
            <p class="text-[11px] text-sumi-500 font-thai mt-0.5">${task.detail}</p>
          </div>
        </div>
      `;
    }).join('');

    if (countBadge) {
      countBadge.textContent = `${wCompleted}/${tasks.length} วัน`;
      if (wCompleted === tasks.length) {
        countBadge.className = 'text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 font-thai';
      }
    }
  });

  const percent = Math.round((totalCompleted / totalTasks) * 100);
  const progressBar = document.getElementById('roadmap-progress-bar');
  const percentText = document.getElementById('roadmap-percent');
  const completedText = document.getElementById('roadmap-tasks-completed');

  if (progressBar) progressBar.style.width = `${percent}%`;
  if (percentText) percentText.textContent = `${percent}%`;
  if (completedText) completedText.textContent = `สำเร็จแล้ว ${totalCompleted} / ${totalTasks} บทเรียน`;

  if (percent === 100 && typeof confetti === 'function') {
    confetti({ particleCount: 150, spread: 90, origin: { y: 0.5 } });
  }
}

/* =========================================================================
   11. DJT KANA FAST TYPING DRILL ENGINE (REALKANA FAST SYSTEM)
   ========================================================================= */

const DJT_ROMAJI_MAP = {
  'し': ['shi', 'si'], 'シ': ['shi', 'si'],
  'ち': ['chi', 'ti'], 'チ': ['chi', 'ti'],
  'つ': ['tsu', 'tu'], 'ツ': ['tsu', 'tu'],
  'ふ': ['fu', 'hu'], 'フ': ['fu', 'hu'],
  'じ': ['ji', 'zi'], 'ジ': ['ji', 'zi'],
  'ず': ['zu', 'du'], 'ズ': ['zu', 'du'],
  'ぢ': ['ji', 'di', 'zi', 'dzi'], 'ヂ': ['ji', 'di', 'zi', 'dzi'],
  'づ': ['zu', 'du', 'dzu'], 'ヅ': ['zu', 'du', 'dzu'],
  'ん': ['n', 'nn'], 'ン': ['n', 'nn'],
  'を': ['wo', 'o'], 'ヲ': ['wo', 'o'],
  'しゃ': ['sha', 'sya'], 'シャ': ['sha', 'sya'],
  'しゅ': ['shu', 'syu'], 'シュ': ['shu', 'syu'],
  'しょ': ['sho', 'syo'], 'ショ': ['sho', 'syo'],
  'ちゃ': ['cha', 'tya', 'cya'], 'チャ': ['cha', 'tya', 'cya'],
  'ちゅ': ['chu', 'tyu', 'cyu'], 'チュ': ['chu', 'tyu', 'cyu'],
  'ちょ': ['cho', 'tyo', 'cyo'], 'チョ': ['cho', 'tyo', 'cyo'],
  'じゃ': ['ja', 'jya', 'zya'], 'ジャ': ['ja', 'jya', 'zya'],
  'じゅ': ['ju', 'jyu', 'zyu'], 'ジュ': ['ju', 'jyu', 'zyu'],
  'じょ': ['jo', 'jyo', 'zyo'], 'ジョ': ['jo', 'jyo', 'zyo']
};

function getDjtAcceptedRomaji(item) {
  if (!item) return [];
  const custom = DJT_ROMAJI_MAP[item.k];
  if (custom) return custom;
  return [(item.r || '').toLowerCase()];
}

function initDjtMatrix() {
  const hiraContainer = document.getElementById('djt-hira-rows-container');
  const kataContainer = document.getElementById('djt-kata-rows-container');
  if (!hiraContainer || !kataContainer) return;
  if (typeof GOJUON_STRUCTURE === 'undefined') return;

  // Build Hiragana Rows
  let hiraHtml = '';
  hiraHtml += `<div class="text-[11px] font-bold text-sakura-600 uppercase tracking-wider mb-1 mt-1">เสียงพื้นฐาน 46 (Seion)</div>`;
  GOJUON_STRUCTURE.basic.rows.forEach(r => {
    const rowKey = `hira_${r.id}`;
    const chars = (r.hira || []).filter(Boolean);
    const checked = APP_STATE.djt.selectedRows.has(rowKey) ? 'checked' : '';
    hiraHtml += renderDjtRowItem(rowKey, r.name, r.romaji, chars, checked);
  });

  hiraHtml += `<div class="text-[11px] font-bold text-amber-600 uppercase tracking-wider mb-1 mt-3">เสียงขุ่น (Dakuon)</div>`;
  GOJUON_STRUCTURE.dakuon.rows.forEach(r => {
    const rowKey = `hira_${r.id}`;
    const chars = (r.hira || []).filter(Boolean);
    const checked = APP_STATE.djt.selectedRows.has(rowKey) ? 'checked' : '';
    hiraHtml += renderDjtRowItem(rowKey, r.name, r.romaji, chars, checked);
  });

  hiraHtml += `<div class="text-[11px] font-bold text-indigo-600 uppercase tracking-wider mb-1 mt-3">เสียงควบ (Yoon)</div>`;
  GOJUON_STRUCTURE.yoon.rows.forEach(r => {
    const rowKey = `hira_${r.id}`;
    const chars = (r.hira || []).filter(Boolean);
    const checked = APP_STATE.djt.selectedRows.has(rowKey) ? 'checked' : '';
    hiraHtml += renderDjtRowItem(rowKey, r.name, r.romaji, chars, checked);
  });
  hiraContainer.innerHTML = hiraHtml;

  // Build Katakana Rows
  let kataHtml = '';
  kataHtml += `<div class="text-[11px] font-bold text-sumi-600 uppercase tracking-wider mb-1 mt-1">เสียงพื้นฐาน 46 (Seion)</div>`;
  GOJUON_STRUCTURE.basic.rows.forEach(r => {
    const rowKey = `kata_${r.id}`;
    const chars = (r.kata || []).filter(Boolean);
    const checked = APP_STATE.djt.selectedRows.has(rowKey) ? 'checked' : '';
    kataHtml += renderDjtRowItem(rowKey, r.name, r.romaji, chars, checked);
  });

  kataHtml += `<div class="text-[11px] font-bold text-amber-600 uppercase tracking-wider mb-1 mt-3">เสียงขุ่น (Dakuon)</div>`;
  GOJUON_STRUCTURE.dakuon.rows.forEach(r => {
    const rowKey = `kata_${r.id}`;
    const chars = (r.kata || []).filter(Boolean);
    const checked = APP_STATE.djt.selectedRows.has(rowKey) ? 'checked' : '';
    kataHtml += renderDjtRowItem(rowKey, r.name, r.romaji, chars, checked);
  });

  kataHtml += `<div class="text-[11px] font-bold text-indigo-600 uppercase tracking-wider mb-1 mt-3">เสียงควบ (Yoon)</div>`;
  GOJUON_STRUCTURE.yoon.rows.forEach(r => {
    const rowKey = `kata_${r.id}`;
    const chars = (r.kata || []).filter(Boolean);
    const checked = APP_STATE.djt.selectedRows.has(rowKey) ? 'checked' : '';
    kataHtml += renderDjtRowItem(rowKey, r.name, r.romaji, chars, checked);
  });

  kataHtml += `<div class="text-[11px] font-bold text-rose-600 uppercase tracking-wider mb-1 mt-3">เสียงพิเศษสากล (Tokushuon)</div>`;
  GOJUON_STRUCTURE.tokushuon.rows.forEach(r => {
    const rowKey = `kata_${r.id}`;
    const chars = (r.kata || []).filter(Boolean).concat(r.extra || []);
    const checked = APP_STATE.djt.selectedRows.has(rowKey) ? 'checked' : '';
    kataHtml += renderDjtRowItem(rowKey, r.name, r.romaji, chars, checked);
  });
  kataContainer.innerHTML = kataHtml;

  updateDjtSelectedCount();
}

function renderDjtRowItem(rowKey, name, romaji, chars, checked) {
  return `
    <div onclick="toggleDjtRow('${rowKey}')" class="p-2 sm:p-2.5 rounded-xl border border-sumi-200/80 hover:border-indigo-300 hover:bg-indigo-50/20 cursor-pointer flex items-center justify-between gap-2 transition-all select-none">
      <div class="flex items-center gap-2">
        <input type="checkbox" id="chk-${rowKey}" ${checked} onclick="event.stopPropagation(); toggleDjtRow('${rowKey}')" class="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-400">
        <div>
          <span class="text-xs font-bold text-sumi-800 font-thai">${name}</span>
          <span class="text-[10px] sm:text-[11px] font-mono text-sumi-400 ml-1">(${romaji}-)</span>
        </div>
      </div>
      <div class="flex items-center gap-1 font-jp text-xs font-bold text-sumi-700 bg-sumi-50 px-2 py-0.5 rounded-lg border border-sumi-100">
        ${chars.map(c => `<span>${c}</span>`).join(' ')}
      </div>
    </div>
  `;
}

function toggleDjtRow(rowKey) {
  if (APP_STATE.djt.selectedRows.has(rowKey)) {
    APP_STATE.djt.selectedRows.delete(rowKey);
  } else {
    APP_STATE.djt.selectedRows.add(rowKey);
  }
  const chk = document.getElementById(`chk-${rowKey}`);
  if (chk) chk.checked = APP_STATE.djt.selectedRows.has(rowKey);
  updateDjtSelectedCount();
}

function toggleDjtScriptAll(script, selectAll) {
  const prefix = script === 'hira' ? 'hira_' : 'kata_';
  const allRowKeys = [];
  if (typeof GOJUON_STRUCTURE !== 'undefined') {
    ['basic', 'dakuon', 'yoon'].forEach(grp => {
      (GOJUON_STRUCTURE[grp]?.rows || []).forEach(r => allRowKeys.push(`${prefix}${r.id}`));
    });
    if (script === 'kata') {
      (GOJUON_STRUCTURE.tokushuon?.rows || []).forEach(r => allRowKeys.push(`kata_${r.id}`));
    }
  }

  allRowKeys.forEach(k => {
    if (selectAll) {
      APP_STATE.djt.selectedRows.add(k);
    } else {
      APP_STATE.djt.selectedRows.delete(k);
    }
    const chk = document.getElementById(`chk-${k}`);
    if (chk) chk.checked = selectAll;
  });

  updateDjtSelectedCount();
}

function selectDjtPreset(preset) {
  APP_STATE.djt.selectedRows.clear();

  if (typeof GOJUON_STRUCTURE !== 'undefined') {
    if (preset === 'hira_basic') {
      GOJUON_STRUCTURE.basic.rows.forEach(r => APP_STATE.djt.selectedRows.add(`hira_${r.id}`));
    } else if (preset === 'kata_basic') {
      GOJUON_STRUCTURE.basic.rows.forEach(r => APP_STATE.djt.selectedRows.add(`kata_${r.id}`));
    } else if (preset === 'vowels_only') {
      APP_STATE.djt.selectedRows.add('hira_a');
      APP_STATE.djt.selectedRows.add('kata_a');
    } else if (preset === 'dakuon_all') {
      ['dakuon', 'yoon'].forEach(grp => {
        GOJUON_STRUCTURE[grp].rows.forEach(r => {
          APP_STATE.djt.selectedRows.add(`hira_${r.id}`);
          APP_STATE.djt.selectedRows.add(`kata_${r.id}`);
        });
      });
    } else if (preset === 'all') {
      ['basic', 'dakuon', 'yoon'].forEach(grp => {
        GOJUON_STRUCTURE[grp].rows.forEach(r => {
          APP_STATE.djt.selectedRows.add(`hira_${r.id}`);
          APP_STATE.djt.selectedRows.add(`kata_${r.id}`);
        });
      });
      GOJUON_STRUCTURE.tokushuon.rows.forEach(r => APP_STATE.djt.selectedRows.add(`kata_${r.id}`));
    }
  }

  document.querySelectorAll('[id^="chk-"]').forEach(chk => {
    const key = chk.id.replace('chk-', '');
    chk.checked = APP_STATE.djt.selectedRows.has(key);
  });

  updateDjtSelectedCount();
}

function getDjtSelectedPool() {
  const pool = [];
  if (typeof GOJUON_STRUCTURE === 'undefined') return pool;

  function findItem(k, type, grp) {
    return KANA_DATA[type]?.[grp]?.find(x => x.k === k) || { k, r: '', th: '' };
  }

  APP_STATE.djt.selectedRows.forEach(rowKey => {
    const [script, rowId] = rowKey.split('_');
    const type = script === 'hira' ? 'hiragana' : 'katakana';

    for (const grp of ['basic', 'dakuon', 'yoon', 'tokushuon']) {
      const g = GOJUON_STRUCTURE[grp];
      if (!g) continue;
      const row = g.rows.find(r => r.id === rowId);
      if (row) {
        let chars = script === 'hira' ? row.hira : row.kata;
        if (!chars && script === 'kata' && grp === 'tokushuon') chars = row.kata;
        if (chars) {
          chars.filter(Boolean).concat(script === 'kata' && row.extra ? row.extra : []).forEach(c => {
            const item = findItem(c, type, grp);
            pool.push({
              ...item,
              script: script === 'hira' ? 'ฮิรางานะ' : 'คาตาคานะ',
              rowName: row.name,
              type,
              grp
            });
          });
        }
        break;
      }
    }
  });

  return pool;
}

function updateDjtSelectedCount() {
  const pool = getDjtSelectedPool();
  const badge = document.getElementById('djt-selected-count');
  const topBadge = document.getElementById('djt-top-btn-count');
  if (badge) badge.textContent = pool.length;
  if (topBadge) topBadge.textContent = pool.length;
}

function showDjtSetup() {
  document.getElementById('djt-setup-screen')?.classList.remove('hidden');
  document.getElementById('djt-drill-screen')?.classList.add('hidden');
  document.getElementById('djt-result-screen')?.classList.add('hidden');
}

function startDjtDrill(customPool = null) {
  const pool = customPool || getDjtSelectedPool();
  if (pool.length === 0) {
    showToast('กรุณาเลือกอย่างน้อย 1 วรรคเพื่อเริ่มการฝึกพิมพ์', '⚠️');
    return;
  }

  const countSelect = document.getElementById('djt-opt-count');
  const countVal = (countSelect && countSelect.value) ? countSelect.value : '46';
  let targetCount = countVal === 'endless' ? Infinity : (parseInt(countVal, 10) || 46);

  let queue = [];
  if (customPool) {
    queue = [...customPool].sort(() => Math.random() - 0.5);
    targetCount = queue.length;
  } else if (targetCount === Infinity) {
    queue = [...pool].sort(() => Math.random() - 0.5);
  } else {
    while (queue.length < targetCount) {
      const chunk = [...pool].sort(() => Math.random() - 0.5);
      queue = queue.concat(chunk);
    }
    queue = queue.slice(0, targetCount);
  }

  APP_STATE.djt.pool = pool;
  APP_STATE.djt.queue = queue;
  APP_STATE.djt.targetCount = targetCount;
  APP_STATE.djt.currentIndex = 0;
  APP_STATE.djt.streak = 0;
  APP_STATE.djt.maxStreak = 0;
  APP_STATE.djt.correctCount = 0;
  APP_STATE.djt.mistakeCount = 0;
  APP_STATE.djt.totalAnswered = 0;
  APP_STATE.djt.mistakes = [];
  APP_STATE.djt.startTime = Date.now();
  APP_STATE.djt.audioEnabled = document.getElementById('djt-opt-audio')?.checked ?? true;

  document.getElementById('djt-setup-screen')?.classList.add('hidden');
  document.getElementById('djt-drill-screen')?.classList.remove('hidden');
  document.getElementById('djt-result-screen')?.classList.add('hidden');

  updateDjtAudioButton();
  loadNextDjtChar();
}

function loadNextDjtChar() {
  const djt = APP_STATE.djt;
  if (djt.queue.length === 0) {
    if (djt.targetCount === Infinity && djt.pool.length > 0) {
      djt.queue = [...djt.pool].sort(() => Math.random() - 0.5);
    } else {
      finishDjtDrill();
      return;
    }
  }

  djt.currentChar = djt.queue.shift();
  djt.currentIndex++;

  const charDisplay = document.getElementById('djt-char-display');
  const scriptBadge = document.getElementById('djt-badge-script');
  const rowBadge = document.getElementById('djt-badge-row');
  const input = document.getElementById('djt-input');
  const feedback = document.getElementById('djt-feedback-box');
  const arenaCard = document.getElementById('djt-arena-card');

  if (charDisplay) {
    charDisplay.textContent = djt.currentChar.k;
    charDisplay.classList.remove('font-djt-maru', 'font-djt-sans', 'font-djt-serif', 'font-djt-hand');
    charDisplay.classList.add(`font-djt-${djt.font || 'maru'}`);
  }
  if (scriptBadge) scriptBadge.textContent = djt.currentChar.script || 'คานะ';
  if (rowBadge) rowBadge.textContent = djt.currentChar.rowName || '';
  if (feedback) feedback.textContent = '';
  if (arenaCard) {
    arenaCard.classList.remove('shake-error', 'flash-correct', 'border-rose-400', 'border-emerald-400');
    arenaCard.classList.add('border-sumi-200');
  }

  // Update hover hint
  const hintRomaji = document.getElementById('djt-hint-romaji');
  const hintTh = document.getElementById('djt-hint-th');
  if (hintRomaji) hintRomaji.textContent = djt.currentChar.r.toUpperCase();
  if (hintTh) hintTh.textContent = `(${djt.currentChar.th || ''})`;

  // Close stroke modal if open
  toggleDjtStrokeModal(false);

  if (input) {
    input.value = '';
    input.disabled = false;
    input.focus();
  }

  updateDjtHud();
}

function playDjtCurrentAudio() {
  const djt = APP_STATE.djt;
  if (!djt.currentChar) return;
  speakJapanese(djt.currentChar.k);
  const input = document.getElementById('djt-input');
  if (input) input.focus();
}

function toggleDjtRevealHint() {
  const hint = document.getElementById('djt-hover-hint');
  if (!hint) return;
  hint.classList.toggle('opacity-0');
  hint.classList.toggle('opacity-100');
  setTimeout(() => {
    hint.classList.add('opacity-0');
    hint.classList.remove('opacity-100');
  }, 2500);
}

function cycleDjtFont() {
  const djt = APP_STATE.djt;
  const fonts = [
    { id: 'maru', label: 'กลม (Maru)' },
    { id: 'sans', label: 'โกธิค (Gothic)' },
    { id: 'serif', label: 'มินโช (Mincho)' },
    { id: 'hand', label: 'ลายมือ (Hand)' }
  ];
  const curIdx = fonts.findIndex(f => f.id === (djt.font || 'maru'));
  const nextFont = fonts[(curIdx + 1) % fonts.length];
  djt.font = nextFont.id;

  const fontLabel = document.getElementById('djt-font-label');
  if (fontLabel) fontLabel.textContent = nextFont.label;

  const charDisplay = document.getElementById('djt-char-display');
  if (charDisplay) {
    charDisplay.classList.remove('font-djt-maru', 'font-djt-sans', 'font-djt-serif', 'font-djt-hand');
    charDisplay.classList.add(`font-djt-${nextFont.id}`);
  }

  const input = document.getElementById('djt-input');
  if (input) input.focus();
}

function toggleDjtStrokeModal(forceState) {
  const modal = document.getElementById('djt-stroke-modal');
  if (!modal) return;
  const shouldOpen = typeof forceState === 'boolean' ? forceState : modal.classList.contains('hidden');
  
  if (!shouldOpen) {
    modal.classList.add('hidden');
    const input = document.getElementById('djt-input');
    if (input) input.focus();
    return;
  }

  const djt = APP_STATE.djt;
  if (!djt.currentChar) return;

  modal.classList.remove('hidden');
  const titleEl = document.getElementById('djt-stroke-modal-title');
  const contentEl = document.getElementById('djt-stroke-modal-content');
  if (titleEl) titleEl.textContent = `${djt.currentChar.k} (${djt.currentChar.r.toUpperCase()})`;

  const strokeData = getKanaStrokeEntry(djt.currentChar.k);
  if (!strokeData || !strokeData.strokes || strokeData.strokes.length === 0) {
    if (contentEl) {
      contentEl.innerHTML = `<div class="text-xs text-sumi-500 font-thai py-2">ไม่มีข้อมูลเวกเตอร์ลำดับขีดสำหรับตัวอักษรนี้</div>`;
    }
    return;
  }

  const strokes = strokeData.strokes;
  let fullSvg = `
    <div class="flex flex-col items-center gap-2">
      <div class="text-[11px] font-bold text-sumi-600 font-thai">ภาพรวม (${strokes.length} ขีด):</div>
      <div class="w-28 h-28 bg-white rounded-2xl border-2 border-indigo-100 shadow-sm p-1.5 relative">
        <svg viewBox="0 0 109 109" class="w-full h-full">
          <line x1="0" y1="54.5" x2="109" y2="54.5" stroke="#f1f5f9" stroke-dasharray="2 2" stroke-width="1" />
          <line x1="54.5" y1="0" x2="54.5" y2="109" stroke="#f1f5f9" stroke-dasharray="2 2" stroke-width="1" />
          ${strokes.map(s => renderSvgStrokePath(s, '#0f172a', 6.5)).join('')}
          ${strokes.map(s => s.number ? `<text x="${s.number.x}" y="${s.number.y}" font-size="10" font-family="Outfit, sans-serif" font-weight="900" fill="#e11d48">${s.number.num}</text>` : '').join('')}
        </svg>
      </div>
    </div>
  `;

  let stepsHtml = `
    <div class="flex flex-col items-center sm:items-start gap-1.5 max-w-sm">
      <div class="text-[11px] font-bold text-sumi-600 font-thai">ลำดับการลากทีละเส้น:</div>
      <div class="flex flex-wrap items-center gap-1.5 overflow-x-auto py-1">
        ${strokes.map((stroke, idx) => `
          <div class="flex flex-col items-center">
            <div class="w-10 h-10 bg-white rounded-xl border border-sumi-200 shadow-2xs p-1">
              <svg viewBox="0 0 109 109" class="w-full h-full">
                ${strokes.slice(0, idx).map(prev => renderSvgStrokePath(prev, '#cbd5e1', 5.5)).join('')}
                ${renderSvgStrokePath(stroke, '#4f46e5', 6.5)}
              </svg>
            </div>
            <span class="text-[9px] font-mono font-bold text-sumi-500 mt-0.5">#${idx + 1}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  if (contentEl) {
    contentEl.innerHTML = fullSvg + stepsHtml;
  }
}

function handleDjtInput(e) {
  const djt = APP_STATE.djt;
  const input = document.getElementById('djt-input');
  const arenaCard = document.getElementById('djt-arena-card');
  const feedback = document.getElementById('djt-feedback-box');
  if (!input || !djt.currentChar) return;

  const val = input.value.trim().toLowerCase();
  if (!val) return;

  const accepted = getDjtAcceptedRomaji(djt.currentChar);

  // 1. Correct Match
  if (accepted.includes(val)) {
    input.disabled = true;
    djt.correctCount++;
    djt.totalAnswered++;
    djt.streak++;
    if (djt.streak > djt.maxStreak) djt.maxStreak = djt.streak;

    if (arenaCard) {
      arenaCard.classList.remove('border-sumi-200', 'shake-error');
      arenaCard.classList.add('flash-correct', 'border-emerald-400');
    }

    if (feedback) {
      feedback.className = 'h-8 flex items-center justify-center text-sm font-thai font-bold text-emerald-600 transition-all';
      feedback.textContent = `✓ ถูกต้อง! ${djt.currentChar.r.toUpperCase()} (${djt.currentChar.th || ''})`;
    }

    playTone(659.25, 'triangle', 0.08);
    if (djt.audioEnabled) {
      speakJapanese(djt.currentChar.k);
    }

    updateDjtHud();
    setTimeout(() => {
      loadNextDjtChar();
    }, 140);
    return;
  }

  // 2. Valid Prefix (User is typing)
  if (accepted.some(a => a.startsWith(val))) {
    return;
  }

  // 3. Incorrect Input
  djt.mistakeCount++;
  djt.totalAnswered++;
  djt.streak = 0;

  if (!djt.mistakes.find(x => x.k === djt.currentChar.k)) {
    djt.mistakes.push(djt.currentChar);
  }
  djt.queue.push(djt.currentChar);

  playTone(220, 'sawtooth', 0.15);

  if (arenaCard) {
    arenaCard.classList.remove('border-sumi-200', 'flash-correct');
    arenaCard.classList.add('shake-error', 'border-rose-400');
  }

  if (feedback) {
    feedback.className = 'h-8 flex items-center justify-center text-sm font-thai font-bold text-rose-600 transition-all';
    feedback.textContent = `เฉลย: ${djt.currentChar.r.toUpperCase()} (${djt.currentChar.th || ''})`;
  }

  updateDjtHud();

  input.disabled = true;
  setTimeout(() => {
    input.value = '';
    input.disabled = false;
    input.focus();
    if (arenaCard) arenaCard.classList.remove('shake-error', 'border-rose-400');
  }, 550);
}

function handleDjtKeyDown(e) {
  if (e.code === 'Space' || e.code === 'Enter') {
    if (!e.target.value || e.target.disabled) {
      e.preventDefault();
      skipDjtChar();
    }
  }
}

function skipDjtChar() {
  const djt = APP_STATE.djt;
  if (!djt.currentChar) return;

  djt.mistakeCount++;
  djt.totalAnswered++;
  djt.streak = 0;

  if (!djt.mistakes.find(x => x.k === djt.currentChar.k)) {
    djt.mistakes.push(djt.currentChar);
  }
  djt.queue.push(djt.currentChar);

  const feedback = document.getElementById('djt-feedback-box');
  if (feedback) {
    feedback.className = 'h-8 flex items-center justify-center text-sm font-thai font-bold text-amber-600 transition-all';
    feedback.textContent = `ข้าม: ${djt.currentChar.r.toUpperCase()} (${djt.currentChar.th || ''})`;
  }

  updateDjtHud();
  setTimeout(() => {
    loadNextDjtChar();
  }, 450);
}

function updateDjtHud() {
  const djt = APP_STATE.djt;
  const streakElem = document.getElementById('djt-hud-streak');
  const accElem = document.getElementById('djt-hud-acc');
  const cpmElem = document.getElementById('djt-hud-cpm');
  const progressElem = document.getElementById('djt-hud-progress');

  if (streakElem) streakElem.textContent = djt.streak;

  const total = djt.correctCount + djt.mistakeCount;
  const acc = total === 0 ? 100 : Math.round((djt.correctCount / total) * 100);
  if (accElem) accElem.textContent = `${acc}%`;

  const elapsedMinutes = (Date.now() - (djt.startTime || Date.now())) / 60000;
  const cpm = elapsedMinutes > 0 ? Math.round(djt.correctCount / elapsedMinutes) : 0;
  if (cpmElem) cpmElem.textContent = cpm;

  if (progressElem) {
    if (djt.targetCount === Infinity) {
      progressElem.textContent = `${djt.correctCount} (Endless)`;
    } else {
      progressElem.textContent = `${djt.currentIndex} / ${djt.targetCount}`;
    }
  }
}

function toggleDjtAudio() {
  APP_STATE.djt.audioEnabled = !APP_STATE.djt.audioEnabled;
  updateDjtAudioButton();
  showToast(APP_STATE.djt.audioEnabled ? 'เปิดเสียงอ่านอัตโนมัติแล้ว' : 'ปิดเสียงอ่านอัตโนมัติแล้ว', '🔊');
}

function updateDjtAudioButton() {
  const btn = document.getElementById('btn-djt-audio-toggle');
  if (!btn) return;
  if (APP_STATE.djt.audioEnabled) {
    btn.className = 'p-2 rounded-xl text-indigo-600 bg-indigo-50 transition-colors';
    btn.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"></path></svg>`;
  } else {
    btn.className = 'p-2 rounded-xl text-sumi-400 hover:text-sumi-600 transition-colors';
    btn.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"></path></svg>`;
  }
}

function abortDjtDrill() {
  showDjtSetup();
}

function finishDjtDrill() {
  const djt = APP_STATE.djt;
  document.getElementById('djt-drill-screen')?.classList.add('hidden');
  document.getElementById('djt-result-screen')?.classList.remove('hidden');

  const total = djt.correctCount + djt.mistakeCount;
  const acc = total === 0 ? 100 : Math.round((djt.correctCount / total) * 100);
  const elapsedMinutes = (Date.now() - (djt.startTime || Date.now())) / 60000;
  const cpm = elapsedMinutes > 0 ? Math.round(djt.correctCount / elapsedMinutes) : 0;

  const accElem = document.getElementById('djt-result-acc');
  const cpmElem = document.getElementById('djt-result-cpm');
  const streakElem = document.getElementById('djt-result-streak');
  const totalElem = document.getElementById('djt-result-total');
  const ratingElem = document.getElementById('djt-result-rating');

  if (accElem) accElem.textContent = `${acc}%`;
  if (cpmElem) cpmElem.textContent = cpm;
  if (streakElem) streakElem.textContent = djt.maxStreak;
  if (totalElem) totalElem.textContent = djt.correctCount;

  if (ratingElem) {
    if (acc >= 95 && cpm >= 40) {
      ratingElem.textContent = 'ระดับปรมาจารย์! พิมพ์เร็วและจำแม่นยำมาก 🎌';
    } else if (acc >= 85) {
      ratingElem.textContent = 'ยอดเยี่ยมมาก! พื้นฐานคานะแน่นปึ้ก 🎉';
    } else {
      ratingElem.textContent = 'ทำได้ดี! ฝึกซ้ำบ่อยๆ เพื่อสร้าง Muscle Memory 💪';
    }
  }

  const mistakesWrapper = document.getElementById('djt-mistakes-wrapper');
  const mistakesList = document.getElementById('djt-mistakes-list');
  if (mistakesWrapper && mistakesList) {
    if (djt.mistakes.length > 0) {
      mistakesWrapper.classList.remove('hidden');
      mistakesList.innerHTML = djt.mistakes.map(m => `
        <div class="p-2 rounded-xl bg-white border border-rose-200 flex items-center justify-between shadow-2xs">
          <div class="flex items-center gap-2">
            <span class="font-jp font-black text-xl text-sumi-900">${m.k}</span>
            <div>
              <span class="font-mono text-xs font-bold text-sumi-700 uppercase">${m.r}</span>
              <span class="text-[10px] font-thai text-sumi-400 block">${m.th || ''}</span>
            </div>
          </div>
          <button onclick="speakJapanese('${m.k}')" class="p-1 text-sumi-400 hover:text-sakura-600">🔊</button>
        </div>
      `).join('');
    } else {
      mistakesWrapper.classList.add('hidden');
    }
  }

  if (acc >= 90 && typeof confetti === 'function') {
    confetti({ particleCount: 120, spread: 80, origin: { y: 0.5 } });
  }
}

function startDjtMistakesOnly() {
  const djt = APP_STATE.djt;
  if (djt.mistakes.length === 0) return;
  startDjtDrill([...djt.mistakes]);
}

/* =========================================================================
   11. SETTINGS SYSTEM & DYNAMIC CUSTOMIZATION
   ========================================================================= */
const DEFAULT_SETTINGS = {
  fontFamily: 'zenmaru',
  fontSizeScale: 'normal',
  volume: 1.0,
  speechRate: 0.85,
  speechPitch: 1.05,
  showThaiReading: true,
  showRomajiReading: true
};

function loadSettingsStorage() {
  try {
    const saved = localStorage.getItem('nihongo_master_settings');
    if (saved) {
      APP_STATE.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    } else {
      APP_STATE.settings = { ...DEFAULT_SETTINGS };
    }
  } catch (e) {
    console.warn('Failed to load settings from storage:', e);
    APP_STATE.settings = { ...DEFAULT_SETTINGS };
  }
  applySettingsToDOM();
}

function saveSettingsStorage() {
  try {
    localStorage.setItem('nihongo_master_settings', JSON.stringify(APP_STATE.settings));
  } catch (e) {
    console.warn('Failed to save settings to localStorage:', e);
  }
}

function applySettingsToDOM() {
  const s = APP_STATE.settings || DEFAULT_SETTINGS;
  const body = document.body;
  if (!body) return;

  // Font family
  body.classList.remove('font-family-zenmaru', 'font-family-notosans', 'font-family-notoserif', 'font-family-kleeone');
  body.classList.add(`font-family-${s.fontFamily || 'zenmaru'}`);

  // Font size scale
  body.classList.remove('font-scale-compact', 'font-scale-normal', 'font-scale-large', 'font-scale-xlarge');
  body.classList.add(`font-scale-${s.fontSizeScale || 'normal'}`);

  // Reading visibility toggles
  if (s.showThaiReading === false) {
    body.classList.add('hide-thai-reading');
  } else {
    body.classList.remove('hide-thai-reading');
  }

  if (s.showRomajiReading === false) {
    body.classList.add('hide-romaji-reading');
  } else {
    body.classList.remove('hide-romaji-reading');
  }

  updateSettingsModalUI();
}

function updateSettingsModalUI() {
  const s = APP_STATE.settings || DEFAULT_SETTINGS;

  // Font family cards selection highlight
  document.querySelectorAll('.setting-font-card').forEach(card => {
    const val = card.getAttribute('data-font');
    if (val === s.fontFamily) {
      card.classList.add('border-sakura-500', 'bg-sakura-50/70', 'ring-2', 'ring-sakura-300');
      card.classList.remove('border-sumi-200', 'bg-white');
    } else {
      card.classList.remove('border-sakura-500', 'bg-sakura-50/70', 'ring-2', 'ring-sakura-300');
      card.classList.add('border-sumi-200', 'bg-white');
    }
  });

  // Font scale buttons
  document.querySelectorAll('.setting-scale-btn').forEach(btn => {
    const val = btn.getAttribute('data-scale');
    if (val === s.fontSizeScale) {
      btn.classList.add('bg-sakura-600', 'text-white', 'shadow-sm');
      btn.classList.remove('bg-sumi-100', 'text-sumi-700');
    } else {
      btn.classList.remove('bg-sakura-600', 'text-white', 'shadow-sm');
      btn.classList.add('bg-sumi-100', 'text-sumi-700');
    }
  });

  // Audio sliders
  const volSlider = document.getElementById('setting-volume');
  const volVal = document.getElementById('setting-volume-val');
  if (volSlider) volSlider.value = Math.round((s.volume ?? 1) * 100);
  if (volVal) volVal.textContent = `${Math.round((s.volume ?? 1) * 100)}%`;

  const rateSlider = document.getElementById('setting-rate');
  const rateVal = document.getElementById('setting-rate-val');
  if (rateSlider) rateSlider.value = s.speechRate ?? 0.85;
  if (rateVal) rateVal.textContent = `${Number(s.speechRate ?? 0.85).toFixed(2)}x`;

  const pitchSlider = document.getElementById('setting-pitch');
  const pitchVal = document.getElementById('setting-pitch-val');
  if (pitchSlider) pitchSlider.value = s.speechPitch ?? 1.05;
  if (pitchVal) pitchVal.textContent = `${Number(s.speechPitch ?? 1.05).toFixed(2)}`;

  // Toggles
  const thaiToggle = document.getElementById('setting-toggle-thai');
  if (thaiToggle) thaiToggle.checked = s.showThaiReading !== false;

  const romajiToggle = document.getElementById('setting-toggle-romaji');
  if (romajiToggle) romajiToggle.checked = s.showRomajiReading !== false;

  // Live font preview label
  const livePreview = document.getElementById('setting-font-live-preview');
  if (livePreview) {
    const fontNames = {
      zenmaru: 'Zen Maru Gothic (ทรงกลมมน)',
      notosans: 'Noto Sans JP (เส้นตรงทันสมัย)',
      notoserif: 'Noto Serif JP (พู่กันหรูหรา)',
      kleeone: 'Klee One (ลายมือเขียนจริง)'
    };
    livePreview.textContent = `あいうえお • 漢字 日本語 (JLPT N5) — ${fontNames[s.fontFamily] || ''}`;
  }
}

function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;
  updateSettingsModalUI();
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function setSettingFontFamily(font) {
  if (!APP_STATE.settings) APP_STATE.settings = { ...DEFAULT_SETTINGS };
  APP_STATE.settings.fontFamily = font;
  saveSettingsStorage();
  applySettingsToDOM();
}

function setSettingFontSize(scale) {
  if (!APP_STATE.settings) APP_STATE.settings = { ...DEFAULT_SETTINGS };
  APP_STATE.settings.fontSizeScale = scale;
  saveSettingsStorage();
  applySettingsToDOM();
}

function setSettingVolume(val) {
  if (!APP_STATE.settings) APP_STATE.settings = { ...DEFAULT_SETTINGS };
  const num = Math.max(0, Math.min(100, Number(val))) / 100;
  APP_STATE.settings.volume = num;
  const volVal = document.getElementById('setting-volume-val');
  if (volVal) volVal.textContent = `${Math.round(num * 100)}%`;
  saveSettingsStorage();
}

function setSettingRate(val) {
  if (!APP_STATE.settings) APP_STATE.settings = { ...DEFAULT_SETTINGS };
  const num = Math.max(0.5, Math.min(1.5, Number(val)));
  APP_STATE.settings.speechRate = num;
  const rateVal = document.getElementById('setting-rate-val');
  if (rateVal) rateVal.textContent = `${num.toFixed(2)}x`;
  saveSettingsStorage();
}

function setSettingPitch(val) {
  if (!APP_STATE.settings) APP_STATE.settings = { ...DEFAULT_SETTINGS };
  const num = Math.max(0.5, Math.min(1.5, Number(val)));
  APP_STATE.settings.speechPitch = num;
  const pitchVal = document.getElementById('setting-pitch-val');
  if (pitchVal) pitchVal.textContent = `${num.toFixed(2)}`;
  saveSettingsStorage();
}

function toggleSettingThaiReading(checked) {
  if (!APP_STATE.settings) APP_STATE.settings = { ...DEFAULT_SETTINGS };
  APP_STATE.settings.showThaiReading = checked;
  saveSettingsStorage();
  applySettingsToDOM();
}

function toggleSettingRomajiReading(checked) {
  if (!APP_STATE.settings) APP_STATE.settings = { ...DEFAULT_SETTINGS };
  APP_STATE.settings.showRomajiReading = checked;
  saveSettingsStorage();
  applySettingsToDOM();
}

function resetSettingsToDefault() {
  APP_STATE.settings = { ...DEFAULT_SETTINGS };
  saveSettingsStorage();
  applySettingsToDOM();
  showToast('คืนค่าการตั้งค่าเริ่มต้นเรียบร้อยแล้ว', '🔄');
}

/* =========================================================================
   12. GLOBAL INITIALIZATION
   ========================================================================= */
window.addEventListener('DOMContentLoaded', () => {
  loadRoadmapStorage();
  loadSettingsStorage();
  setKanaType('hiragana');
  setKanaGroup('basic');

  if ('speechSynthesis' in window) {
    window.speechSynthesis.getVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
      };
    }
  }

  console.log('🌸 Nihongo Master initialized with universal KanjiVG stroke engine & settings system.');
});

