window.trackEvent = window.trackEvent || function() {};
window.primeResponsiveSfx = window.primeResponsiveSfx || function() {};

(function () {
  var CONFIG = {
    baseWidth: 390,
    baseHeight: 844,
    boardSize: 6,
    handSize: 3,
    handTileSize: 52,
    handTileGap: 2,
    startingLives: 3,
    storageKey: "blastmath.highscore",
    classicSaveKey: "blastmath.save.classic",
    dailySaveKey: "blastmath.save.daily",

    dailyStartCoverage: 24,
    dailyStartGemCount: 10,
    dailyStartWallCount: 14,
    dailyStartRows: 4,

    dailyChallenges: {
      easy: {
        id: 'easy',
        label: 'Easy',
        gemTarget: 8,
        startRows: 3,
        wallDropRate: 4,
        icon: 'images/tiles/easy.svg'
      },
      medium: {
        id: 'medium',
        label: 'Medium',
        gemTarget: 10,
        startRows: 4,
        wallDropRate: 3,
        icon: 'images/tiles/medium.svg'
      },
      hard: {
        id: 'hard',
        label: 'Hard',
        gemTarget: 12,
        startRows: 4,
        topExtraCells: 2,
        wallDropRate: 2,
        icon: 'images/tiles/hard.svg'
      }
    },

    heartChanceScaleAt2Lives: 2,
    heartChanceScaleAt1Life: 3,

    maxBombTilesOnBoard: 2,
    maxHeartTilesOnBoard: 2,
    maxSkullTilesOnBoard: 2
  };

  var SFX_VOLUME = {
    pickup: 0.2,
    place: 0.4,
    blast: 0.6,
    combo: 0.6,
    lose: 0.8,
    start: 0.8
  };
  
  var SFX_URLS = {
    pickup: 'sounds/pickup.mp3',
    place: 'sounds/place.mp3',
    blast: 'sounds/blast.mp3',
    combo: 'sounds/combo.mp3',
    lose: 'sounds/lose.mp3',
    start: 'sounds/start.mp3'
  };
  
  var audioCtx = null;
  var SFX_BUFFERS = {};
  var SFX_LOADING = {};
  var lastSfxAt = {};
  var audioUnlocked = false;
  
  function ensureAudioContext() {
    if (!audioCtx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
  
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(function () {});
    }
  
    return audioCtx;
  }
  
  function loadSfxBuffer(name) {
    var ctx = ensureAudioContext();
    if (!ctx || SFX_BUFFERS[name] || SFX_LOADING[name]) return;
  
    SFX_LOADING[name] = true;
  
    fetch(SFX_URLS[name])
      .then(function (res) {
        if (!res.ok) throw new Error('SFX failed: ' + name);
        return res.arrayBuffer();
      })
      .then(function (buf) { return ctx.decodeAudioData(buf); })
      .then(function (decoded) {
        SFX_BUFFERS[name] = decoded;
      })
      .catch(function (err) {
        console.warn(err);
      })
      .finally(function () {
        SFX_LOADING[name] = false;
      });
  }
  
  function primeAllSfx() {
    Object.keys(SFX_URLS).forEach(loadSfxBuffer);
  }

  function unlockSfx() {
    if (audioUnlocked) return;
  
    var ctx = ensureAudioContext();
    if (!ctx) return;
  
    var done = function () {
      audioUnlocked = true;
      primeAllSfx();
    };
  
    if (ctx.state === 'suspended') {
      ctx.resume().then(done).catch(function () {});
    } else {
      done();
    }
  }
  
  function playSfx(name) {
    unlockSfx();
  
    var ctx = ensureAudioContext();
    var buffer = SFX_BUFFERS[name];
  
    if (!ctx) return;
  
    if (!buffer) {
      loadSfxBuffer(name);
      return;
    }
  
    var now = Date.now();
    var minGap = name === 'start' ? 350 : 25;
  
    if (lastSfxAt[name] && now - lastSfxAt[name] < minGap) return;
    lastSfxAt[name] = now;
  
    try {
      var source = ctx.createBufferSource();
      var gain = ctx.createGain();
  
      source.buffer = buffer;
      gain.gain.value = (SFX_VOLUME[name] != null) ? SFX_VOLUME[name] : 1;
  
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start(0);
    } catch (e) {}
  }

  function forceIntroPickupSfx(state) {
    playSfx('pickup');
  }

  var BOOT_POP_IN_MS = 525;
  var BOOT_HOLD_MS = 2150;
  var BOOT_POP_OUT_MS = 450;
  var BOOT_TOTAL_MS = BOOT_POP_IN_MS + BOOT_HOLD_MS + BOOT_POP_OUT_MS;
  var INTRO_QUERY_VALUE = "1";
  var INTRO_MESSAGE_TO_NEXT_STEP_DELAY = 250;
  var CHAIN_NEXT_BLAST_DELAY = 500;
  var INTRO_THUMB_POP_DELAY = 500;
  var INTRO_THUMB_POP_DURATION = 2500;
  var INTRO_BLAST_TO_MESSAGE_DELAY = INTRO_THUMB_POP_DELAY + INTRO_THUMB_POP_DURATION;
  var BLAST_MESSAGE_STEP_DELAY = 420;
  var BLAST_PRIMARY_MESSAGE_DELAY = INTRO_THUMB_POP_DELAY + BLAST_MESSAGE_STEP_DELAY;
  var BLAST_SECONDARY_MESSAGE_DELAY = BLAST_PRIMARY_MESSAGE_DELAY + BLAST_MESSAGE_STEP_DELAY;
  var POINTS_MESSAGE_EXTRA_DELAY = 400;
  var POINTS_MESSAGE_DURATION = 2400;

  var LEVELS = [
    {
      id: 1,
      minScore: 0,
      maxScore: 1000,
      wallDropRate: 4,
      pieceBias: 'easy',
      features: {
        bombs: false,
        skulls: false,
        hearts: false
      }
    },
    {
      id: 2,
      minScore: 1000,
      maxScore: 2000,
      wallDropRate: 4,
      pieceBias: 'double',
      features: {
        bombs: true,
        skulls: false,
        hearts: false
      }
    },
    {
      id: 3,
      minScore: 2000,
      maxScore: 3000,
      wallDropRate: 4,
      pieceBias: 'mixed',
      features: {
        bombs: true,
        skulls: true,
        skullChance: 0.10,
        hearts: true,
        heartChance: 0.05
      }
    },
    {
      id: 4,
      minScore: 3000,
      maxScore: Infinity,
      wallDropRate: 4,
      pieceBias: 'mixed',
      features: {
        bombs: true,
        skulls: true,
        skullChance: 0.12,
        hearts: true,
        heartChance: 0.08
      }
    }
  ];

  function getCurrentLevel(state) {
    var score = state && typeof state.score === 'number' ? state.score : 0;

    for (var i = 0; i < LEVELS.length; i++) {
      var level = LEVELS[i];
      if (score >= level.minScore && score < level.maxScore) {
        return level;
      }
    }

    return LEVELS[LEVELS.length - 1];
  }

  function isIntroMode() {
    try {
      var params = new URLSearchParams(window.location.search);
      if (params.get("intro") === INTRO_QUERY_VALUE) return true;
      if (params.has("intro-step")) return true;

      for (var i = 1; i <= 20; i++) {
        if (params.has("intro-step-" + i)) return true;
      }

      return false;
    } catch (e) {
      return false;
    }
  }

  function getIntroStartStep() {
    try {
      var params = new URLSearchParams(window.location.search);

      var explicitStep = params.get("intro-step");
      if (explicitStep != null) {
        var parsedExplicit = Number(explicitStep);
        if (INTRO_STEPS[parsedExplicit]) return parsedExplicit;
      }

      for (var i = 1; i <= 20; i++) {
        if (params.has("intro-step-" + i)) {
          if (INTRO_STEPS[i]) return i;
        }
      }

      return 1;
    } catch (e) {
      return 1;
    }
  }

  function resetStandardGameState(state) {
    state.screen = "game";
    state.score = 0;
    state.displayScore = 0;
    state.comboStep = 0;
    state.lives = CONFIG.startingLives;
    state.boardSize = CONFIG.boardSize;
    state.board = createEmptyBoard(CONFIG.boardSize);
    state.currentLevel = LEVELS[0];
    state.levelId = 1;
    state.level2BombInjected = false;
    seedBoardForCurrentLevel(state);
    state.hand = generateHand(state.board, state.boardSize, state);
    state.animMap = null;
    state.blastIndices = [];
    state.isResolving = false;
    state.boardMessage = "";
    state.moveCount = 0;
    state.handCount = 0;
    state.pendingBombSpawn = false;
    state.wallSpawnsSinceBomb = 0;
    state.pendingComboPoints = 0;
    state.pendingPostResolveDrops = [];
    state.justDealtNewHand = false;
    state.classicGameOverModal = null;
    state.classicBeatHighScore = false;
    state.classicPaywall = {
      shown: false,
      losses: 0,
      startedAt: Date.now(),
      reason: ''
    };

    state.intro = {
      active: false,
      step: 0,
      title: "",
      sourceIndex: null,
      allowedTargetIndex: null,
      hoveringValid: false,
      completed: false,
      direction: "horizontal",
      targetQueue: [],
      targetCursor: 0
    };
  }

  function makeIntroPiece(valueOrCells, id) {
    var cells = Array.isArray(valueOrCells)
      ? valueOrCells.map(function (cell) {
          return makeCellAt(cell.x || 0, cell.y || 0, cell.value);
        })
      : [makeCellAt(0, 0, valueOrCells)];

    var width = 1;
    var height = 1;

    cells.forEach(function (cell) {
      width = Math.max(width, cell.x + 1);
      height = Math.max(height, cell.y + 1);
    });

    return {
      id: id || ("intro-" + Date.now()),
      group: "intro",
      rank: cells.length,
      width: width,
      height: height,
      cells: cells
    };
  }

  var INTRO_STEPS = {
    1: {
      step: 1,
      title: "Make 10 to Blast!",

      boardCells: [
        { x: 2, y: 5, value: 1 }
      ],

      handValues: [9],

      targets: [
        { x: 3, y: 5, direction: "horizontal" }
      ]
    },

    2: {
      step: 2,
      title: "Blast all directions!",

      boardCells: [
        { x: 2, y: 5, value: 2 }
      ],

      handValues: [8],

      targets: [
        { x: 2, y: 4, direction: "vertical" }
      ]
    },

    3: {
      step: 3,
      title: "Blast a row!",

      boardCells: [
        { x: 2, y: 5, value: 3 }
      ],

      handPieces: [[
        { x: 0, y: 0, value: 2 },
        { x: 1, y: 0, value: 5 }
      ]],

      targets: [
        { x: 3, y: 5, direction: "horizontal" },
        { x: 4, y: 5, direction: "horizontal" }
      ]
    },

    4: {
      step: 4,
      title: "Tiles fall down!",

      boardCells: [
        { x: 2, y: 5, value: 3 }
      ],

      handValues: [7],

      targets: [
        { x: 2, y: 0, direction: "vertical" }
      ]
    },

    5: {
      step: 5,
      title: "Blasts can combo!",

      boardCells: [
        { x: 2, y: 5, kind: "number", value: 4 },
        { x: 3, y: 5, kind: "number", value: 5 },
        { x: 3, y: 4, kind: "number", value: 6 }
      ],

      handValues: [5],

      targets: [{ x: 4, y: 5, direction: "horizontal" }]
    },

    6: {
      step: 6,
      title: "Blast through walls!",

      boardCells: [
        { x: 3, y: 2, kind: "number", value: 8 },
        { x: 3, y: 3, kind: "number", value: 9 },

        { x: 2, y: 4, kind: "neutral" },
        { x: 3, y: 4, kind: "neutral" },

        { x: 2, y: 5, kind: "neutral" },
        { x: 3, y: 5, kind: "number", value: 2 }
      ],

      handValues: [1],

      targets: [{ x: 2, y: 3 }]
    }
  };

  function setupIntroStepByNumber(state, stepNumber) {

    var def = INTRO_STEPS[stepNumber];
    var board = createEmptyBoard(CONFIG.boardSize);
    var i;
    var sourceCell = null;

    if (!def) return;

    for (i = 0; i < def.boardCells.length; i++) {
      var bc = def.boardCells[i];
      var index = (bc.y * CONFIG.boardSize) + bc.x;

      if (bc.kind === "neutral") {
        board[index] = makeNeutralCell();
      } else {
        board[index] = makeCell(bc.value);
      }
    }

    if (def.targets.length) {
      var anchor = def.targets[0];
      if (anchor.direction === "horizontal") {
        sourceCell = { x: anchor.x - 1, y: anchor.y };
      } else {
        sourceCell = { x: anchor.x, y: anchor.y + 1 };
      }
    }

    var sourceIndex = sourceCell
      ? (sourceCell.y * CONFIG.boardSize) + sourceCell.x
      : null;

    state.screen = "game";
    state.score = 0;
    state.displayScore = 0;
    state.comboStep = 0;
    state.lives = CONFIG.startingLives;
    state.boardSize = CONFIG.boardSize;
    state.board = board;
    state.hand = (def.handPieces || def.handValues || []).map(function (pieceDef, idx) {
      return makeIntroPiece(pieceDef, "intro-" + stepNumber + "-" + idx);
    });
    state.blastIndices = [];
    state.isResolving = false;
    state.boardMessage = "";
    state.animMap = {};

    for (i = 0; i < board.length; i++) {
      if (!board[i]) continue;

      var row = Math.floor(i / CONFIG.boardSize);

      state.animMap[i] = {
        type: "drop-land",
        distance: (row + 5.5) * 44,
        duration: 420
      };
    }

    state.intro = {
      active: true,
      step: def.step,
      title: def.title,
      sourceIndex: sourceIndex,
      allowedTargetIndex: def.targets.length
        ? ((def.targets[0].y * CONFIG.boardSize) + def.targets[0].x)
        : null,
      hoveringValid: false,
      completed: false,
      equationAnchor: null,
      direction: def.targets.length ? def.targets[0].direction : "horizontal",
      targetQueue: def.targets.map(function (t) {
        return {
          x: t.x,
          y: t.y,
          index: (t.y * CONFIG.boardSize) + t.x,
          direction: t.direction
        };
      }),
      targetCursor: 0
    };
  }

  function makeCellAt(x, y, value) {
    return {
      x: x,
      y: y,
      value: value,
      tone: toneForValue(value)
    };
  }

  var INTRO_SEEN_KEY = "blastmath.introSeen";

  var BOOT_SEEN_KEY = "blastmath.bootSeen";

  function hasSeenBoot() {
    try { return localStorage.getItem(BOOT_SEEN_KEY) === "1"; }
    catch (e) { return false; }
  }

  function markBootSeen() {
    try { localStorage.setItem(BOOT_SEEN_KEY, "1"); }
    catch (e) {}
  }

  function hasSeenIntro() {
    try { return localStorage.getItem(INTRO_SEEN_KEY) === "1"; }
    catch (e) { return false; }
  }

  function markIntroSeen() {
    try { localStorage.setItem(INTRO_SEEN_KEY, "1"); }
    catch (e) {}
  }

  var HELPER_SEEN_KEY = "blastmath.helperSeen";

function readHelperSeen() {
  try { return JSON.parse(localStorage.getItem(HELPER_SEEN_KEY) || "{}"); }
  catch (e) { return {}; }
}

function hasSeenHelper(id) {
  var seen = readHelperSeen();
  return seen[id] === 1;
}

function markHelperSeen(id) {
  try {
    var seen = readHelperSeen();
    seen[id] = 1;
    localStorage.setItem(HELPER_SEEN_KEY, JSON.stringify(seen));
  } catch (e) {}
}

var DAILY_COMPLETED_KEY = "blastmath.daily.completed";

function getDailyCompletionKey(challengeId) {
  return getCurrentDailyPuzzleKey() + ":" + getCurrentDailyVariantSeed() + ":" + challengeId;
}

function readCompletedDailyMap() {
  try { return JSON.parse(localStorage.getItem(DAILY_COMPLETED_KEY) || "{}"); }
  catch (e) { return {}; }
}

function markDailyChallengeCompleted(challengeId) {
  try {
    var map = readCompletedDailyMap();
    map[getDailyCompletionKey(challengeId)] = 1;
    localStorage.setItem(DAILY_COMPLETED_KEY, JSON.stringify(map));
  } catch (e) {}
}

function isDailyChallengeCompleted(challengeId) {
  var map = readCompletedDailyMap();
  return map[getDailyCompletionKey(challengeId)] === 1;
}

function isCurrentDailyCompleted() {
  return (
    isDailyChallengeCompleted('easy') &&
    isDailyChallengeCompleted('medium') &&
    isDailyChallengeCompleted('hard')
  );
}

function shouldShowDailyRibbon(state) {
  if (state && state.daily && state.daily.active) return true;
  return !isCurrentDailyCompleted();
}

function openDailyCompletedLanding(state) {
  var challengeId = 'hard';

  if (state && state.daily && state.daily.challengeId) {
    challengeId = state.daily.challengeId;
  }

  state.dailyCompletedLanding = {
    challengeId: challengeId,
    puzzleKey: getCurrentDailyPuzzleKey() + ":" + getCurrentDailyVariantSeed()
  };
  state.screen = 'daily-complete';
}

function openDailyPaywall(state) {
  state.screen = 'daily-paywall';
}

function openClassicPaywall(state, reason) {
  if (!state || state.isPaid) return false;
  if (state.intro && state.intro.active) return false;
  if (isDailyMode(state)) return false;

  state.classicPaywall = state.classicPaywall || {};
  state.classicPaywall.shown = true;
  state.classicPaywall.reason = reason || 'unknown';
  lockClassicPaywall();
  state.screen = 'classic-paywall';

  if (window.posthog) {
    trackEvent('classic_paywall_shown', {
      reason: state.classicPaywall.reason,
      score: state.score,
      losses: state.classicPaywall.losses || 0,
      moves: state.moveCount || 0
    });
  }

  return true;
}

function maybeOpenClassicPaywall(root, state, render, reason) {
  if (!state || state.isPaid) return false;
  if (state.screen !== 'game') return false;
  if (state.intro && state.intro.active) return false;
  if (isDailyMode(state)) return false;

  state.classicPaywall = state.classicPaywall || {
    shown: false,
    losses: 0,
    startedAt: Date.now(),
    reason: ''
  };

  if (state.classicPaywall.shown) return false;

  var elapsedMs = Date.now() - (state.classicPaywall.startedAt || Date.now());
  var shouldGate =
    (state.classicPaywall.losses >= 2) ||
    (state.score >= 3000) ||
    (elapsedMs >= 7 * 60 * 1000);

  if (!shouldGate && reason !== 'debug') return false;

  transitionScreen(root, function () {
    openClassicPaywall(state, reason || (
      state.classicPaywall.losses >= 2 ? 'two_losses' :
      state.score >= 3000 ? 'score_3000' :
      'time_7_min'
    ));
    render();
  });

  return true;
}

var CLASSIC_PAYWALL_LOCK_KEY = 'blastmath.classic.paywall.locked';

function isClassicPaywallLocked() {
  try {
    return localStorage.getItem(CLASSIC_PAYWALL_LOCK_KEY) === '1';
  } catch (e) {
    return false;
  }
}

function lockClassicPaywall() {
  try {
    localStorage.setItem(CLASSIC_PAYWALL_LOCK_KEY, '1');
  } catch (e) {}
}

function clearClassicPaywallLock() {
  try {
    localStorage.removeItem(CLASSIC_PAYWALL_LOCK_KEY);
  } catch (e) {}
}

function readUserIsPaid() {
  try {
    return localStorage.getItem('bm_user_valid') === 'true';
  } catch (e) {
    return false;
  }
}

  function readHighScore() {
    try { return Number(localStorage.getItem(CONFIG.storageKey) || 0) || 0; }
    catch (e) { return 0; }
  }

  function getSaveKeyForScreen(screen) {
    if (screen === 'daily') return CONFIG.dailySaveKey;
    return CONFIG.classicSaveKey;
  }

  function getActiveSaveKey(state) {
    if (state && state.daily && state.daily.active) return CONFIG.dailySaveKey;
    return CONFIG.classicSaveKey;
  }

  function clonePieceForSave(piece) {
    if (!piece) return null;

    return {
      id: piece.id,
      group: piece.group,
      rank: piece.rank,
      width: piece.width,
      height: piece.height,
      cells: (piece.cells || []).map(function (cell) {
        return {
          x: cell.x,
          y: cell.y,
          value: cell.value,
          tone: cell.tone
        };
      })
    };
  }

  function cloneHandForSave(hand) {
    return (hand || []).map(function (piece) {
      return clonePieceForSave(piece);
    });
  }

  function cloneBoardForSave(board) {
    return (board || []).map(function (cell) {
      if (!cell) return null;
      return Object.assign({}, cell);
    });
  }

  function sanitizeSavedState(saved) {
    if (!saved || typeof saved !== 'object') return null;
    if (!saved.screen) return null;
    if (!Array.isArray(saved.board)) return null;
    if (!Array.isArray(saved.hand)) return null;
    return saved;
  }

  function readSavedGame(screen) {
    try {
      var key = getSaveKeyForScreen(screen);
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      return sanitizeSavedState(JSON.parse(raw));
    } catch (e) {
      return null;
    }
  }

  function clearSavedGame(screen) {
    try {
      localStorage.removeItem(getSaveKeyForScreen(screen));
    } catch (e) {}
  }

  function writeSavedGame(state) {
    try {
      if (!state) return;
      
      if (state.screen === 'daily-complete' || state.screen === 'daily-paywall') {
        return;
      }

      if (state.screen === 'home') {
        return;
      }

      if (state.intro && state.intro.active) {
        clearSavedGame('game');
        return;
      }

      var payload = {
        screen: state.screen,
        highScore: state.highScore,
        score: state.score,
        displayScore: state.displayScore,
        comboStep: state.comboStep,
        lives: state.lives,
        boardSize: state.boardSize,
        moveCount: state.moveCount,
        handCount: state.handCount,
        justDealtNewHand: state.justDealtNewHand,
        levelId: state.levelId,
        currentLevelId: state.currentLevel ? state.currentLevel.id : 1,
        board: cloneBoardForSave(state.board),
        hand: cloneHandForSave(state.hand),
        pendingBombSpawn: state.pendingBombSpawn,
        wallSpawnsSinceBomb: state.wallSpawnsSinceBomb,
        pendingComboPoints: state.pendingComboPoints,
        classicPaywall: state.classicPaywall || null,
        dailyStats: state.dailyStats || createDailyStatsMap(),
        daily: state.daily ? {
          active: !!state.daily.active,
          puzzleId: state.daily.puzzleId,
          challengeId: state.daily.challengeId,
          gemTarget: state.daily.gemTarget,
          gemsRemaining: state.daily.gemsRemaining,
          completed: !!state.daily.completed,
          failed: !!state.daily.failed,
          variantSeed: state.daily.variantSeed,
          layoutIndices: state.daily.layoutIndices || [],
          tries: state.daily.tries || 1,
          startedAt: state.daily.startedAt || 0,
          finishedAt: state.daily.finishedAt || 0,
          showingLossModal: !!state.daily.showingLossModal,
          showingResultScreen: !!state.daily.showingResultScreen
        } : null
      };

      localStorage.setItem(getActiveSaveKey(state), JSON.stringify(payload));
    } catch (e) {}
  }

  function restoreSavedGame(state, saved) {
    if (!saved) return false;

    state.screen = saved.screen || 'home';
    state.highScore = typeof saved.highScore === 'number' ? saved.highScore : state.highScore;
    state.score = typeof saved.score === 'number' ? saved.score : 0;
    state.displayScore = typeof saved.displayScore === 'number' ? saved.displayScore : state.score;
    state.comboStep = typeof saved.comboStep === 'number' ? saved.comboStep : 0;
    state.lives = typeof saved.lives === 'number' ? saved.lives : CONFIG.startingLives;
    state.boardSize = typeof saved.boardSize === 'number' ? saved.boardSize : CONFIG.boardSize;
    state.moveCount = typeof saved.moveCount === 'number' ? saved.moveCount : 0;
    state.handCount = typeof saved.handCount === 'number' ? saved.handCount : 0;
    state.justDealtNewHand = !!saved.justDealtNewHand;
    state.levelId = typeof saved.levelId === 'number' ? saved.levelId : 1;
    state.currentLevel = LEVELS.filter(function (level) {
      return level.id === (saved.currentLevelId || state.levelId);
    })[0] || LEVELS[0];
    state.board = cloneBoardForSave(saved.board);
    state.hand = cloneHandForSave(saved.hand);
    state.pendingBombSpawn = !!saved.pendingBombSpawn;
    state.wallSpawnsSinceBomb = typeof saved.wallSpawnsSinceBomb === 'number' ? saved.wallSpawnsSinceBomb : 0;
    state.pendingComboPoints = typeof saved.pendingComboPoints === 'number' ? saved.pendingComboPoints : 0;
    state.animMap = null;
    state.blastIndices = [];
    state.isResolving = false;
    state.boardMessage = '';
    state.classicPaywall = saved.classicPaywall || {
      shown: false,
      losses: 0,
      startedAt: Date.now(),
      reason: ''
    };

    state.intro = {
      active: false,
      step: 0,
      title: "",
      sourceIndex: null,
      allowedTargetIndex: null,
      hoveringValid: false,
      completed: false,
      direction: "horizontal",
      targetQueue: [],
      targetCursor: 0
    };

    state.dailyStats = createDailyStatsMap(saved.dailyStats);

    state.daily = saved.daily ? {
      active: !!saved.daily.active,
      puzzleId: saved.daily.puzzleId,
      challengeId: saved.daily.challengeId || 'easy',
      gemTarget: saved.daily.gemTarget,
      gemsRemaining: saved.daily.gemsRemaining,
      completed: !!saved.daily.completed,
      failed: !!saved.daily.failed,
      variantSeed: saved.daily.variantSeed,
      layoutIndices: saved.daily.layoutIndices || [],
      tries: saved.daily.tries || 1,
      startedAt: saved.daily.startedAt || 0,
      finishedAt: saved.daily.finishedAt || 0,
      showingLossModal: !!saved.daily.showingLossModal,
      showingResultScreen: !!saved.daily.showingResultScreen
    } : {
      active: false,
      puzzleId: null,
      challengeId: 'easy',
      gemTarget: 0,
      gemsRemaining: 0,
      completed: false,
      failed: false,
      variantSeed: null,
      layoutIndices: [],
      tries: 1,
      startedAt: 0,
      finishedAt: 0,
      showingLossModal: false,
      showingResultScreen: false
    };

    if (state.daily && state.daily.active) {
      state.screen = 'daily';
    }

    return true;
  }

  function getCurrent12HourWindowIndex() {
    if (typeof DAILY_WINDOW_OVERRIDE === 'number') {
      return DAILY_WINDOW_OVERRIDE;
    }

    return Math.floor(Date.now() / (12 * 60 * 60 * 1000));
  }

  function getDailyPuzzleIds() {
    return ['daily-seeded'];
  }

  function getCurrentDailyPuzzleKey() {
    return 'daily-seeded';
  }

  var DAILY_WINDOW_OVERRIDE = null;
  var DAILY_VARIANT_OVERRIDE = null;

  function getCurrentDailyVariantSeed() {
    if (typeof DAILY_VARIANT_OVERRIDE === 'number') {
      return DAILY_VARIANT_OVERRIDE;
    }

    return getCurrent12HourWindowIndex();
  }

  function makeSeededRng(seed) {
    var value = (seed >>> 0) || 1;

    return function () {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 4294967296;
    };
  }

  function shuffleWithSeed(list, rng) {
    var out = list.slice();

    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var temp = out[i];
      out[i] = out[j];
      out[j] = temp;
    }

    return out;
  }

  function buildSeededDailyBoard(seed, challenge) {
    var board = createEmptyBoard(CONFIG.boardSize);
    var rng = makeSeededRng(seed ^ 0x9e3779b9);
    var size = CONFIG.boardSize;
    var startRows = challenge.startRows || 4;
    var topExtraCells = challenge.topExtraCells || 0;

    var baseIndices = [];
    var extraRowIndices = [];
    var startRow = size - startRows;

    for (var y = startRow; y < size; y++) {
      for (var x = 0; x < size; x++) {
        baseIndices.push((y * size) + x);
      }
    }

    if (topExtraCells > 0 && startRow - 1 >= 0) {
      for (var extraX = 0; extraX < size; extraX++) {
        extraRowIndices.push(((startRow - 1) * size) + extraX);
      }
      extraRowIndices = shuffleWithSeed(extraRowIndices, rng).slice(0, topExtraCells);
    }

    var candidateIndices = shuffleWithSeed(baseIndices.concat(extraRowIndices), rng);
    var coverage = baseIndices.length + extraRowIndices.length;
    var chosen = candidateIndices.slice(0, coverage);

    var gemCount = Math.min(challenge.gemTarget, chosen.length);
    var gemIndices = chosen.slice(0, gemCount);
    var wallIndices = chosen.slice(gemCount);

    gemIndices.forEach(function (index) {
      board[index] = makeGemCell();
    });

    wallIndices.forEach(function (index) {
      board[index] = makeNeutralCell();
    });

    return {
      board: board,
      gemTarget: gemIndices.length,
      chosenIndices: chosen.slice()
    };
  }

  function syncRealViewportHeight() {
    var vh = (window.visualViewport ? window.visualViewport.height : window.innerHeight) * 0.01;
    document.documentElement.style.setProperty('--bm-real-vh', vh + 'px');
  }

  function syncUiScale() {
    syncRealViewportHeight();
  
    var root = document.documentElement;
    var SHELL_PADDING = 24; 
    var stage = document.querySelector('.bm-stage');
    var rect = stage ? stage.getBoundingClientRect() : null;
    
    var usableW = rect ? rect.width : window.innerWidth;
    var usableH = rect ? rect.height : window.innerHeight;
    var scale = Math.min(usableW / CONFIG.baseWidth, usableH / CONFIG.baseHeight, 1.22);
    root.style.setProperty("--bm-ui-scale", String(scale.toFixed(4)));
  }

  function createEmptyBoard(size) {
    return Array.from({ length: size * size }, function () { return null; });
  }

  function findBlastGroups(board, size) {
    var groups = [];

    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var sum = 0;
        var cells = [];

        for (var k = x; k < size; k++) {
          var cell = board[y * size + k];
          if (!cell) break;

          sum += cell.value;
          cells.push(y * size + k);

          if (sum === 10) {
            groups.push({
              axis: 'h',
              indices: cells.slice()
            });
          }

          if (sum >= 10) break;
        }
      }
    }

    for (var x = 0; x < size; x++) {
      for (var y = 0; y < size; y++) {
        var sum = 0;
        var cells = [];

        for (var k = y; k < size; k++) {
          var cell = board[k * size + x];
          if (!cell) break;

          sum += cell.value;
          cells.push(k * size + x);

          if (sum === 10) {
            groups.push({
              axis: 'v',
              indices: cells.slice()
            });
          }

          if (sum >= 10) break;
        }
      }
    }

    return groups;
  }

  function getOrthoNeighborIndices(index, size) {
    var x = index % size;
    var y = Math.floor(index / size);
    var out = [];

    if (x > 0) out.push(index - 1);
    if (x < size - 1) out.push(index + 1);
    if (y > 0) out.push(index - size);
    if (y < size - 1) out.push(index + size);

    return out;
  }

  function collectAdjacentBlastBonusIndices(board, size, seedIndices) {
    var seen = new Set();
    var out = [];

    seedIndices.forEach(function (seed) {
      var neighbors = getOrthoNeighborIndices(seed, size);

      neighbors.forEach(function (neighborIndex) {
        var cell = board[neighborIndex];
        if (!isAdjacentBlastBonusCell(cell)) return;
        if (seen.has(neighborIndex)) return;

        seen.add(neighborIndex);
        out.push(neighborIndex);
      });
    });

    return out;
  }

  function classifyBlastPhase(board, size, comboStep) {
    var groups = findBlastGroups(board, size);
    var blastIndices = [];
    var normalBlastIndices = [];
    var bombBlastIndices = [];
    var seen = new Set();
    var normalSeen = new Set();
    var bombSeen = new Set();
    var horizontalGroups = 0;
    var verticalGroups = 0;
    var totalGroups = 0;
    var i, j, index;

    for (i = 0; i < groups.length; i++) {
      if (groups[i].axis === 'h') horizontalGroups += 1;
      if (groups[i].axis === 'v') verticalGroups += 1;

      for (j = 0; j < groups[i].indices.length; j++) {
        index = groups[i].indices[j];

        if (!seen.has(index)) {
          seen.add(index);
          blastIndices.push(index);
        }

        if (!normalSeen.has(index)) {
          normalSeen.add(index);
          normalBlastIndices.push(index);
        }
      }
    }

    totalGroups = horizontalGroups + verticalGroups;

    if (!blastIndices.length) {
      return {
        hasBlast: false,
        blastIndices: [],
        neutralBlastIndices: [],
        clearedCount: 0,
        horizontalGroups: 0,
        verticalGroups: 0,
        totalGroups: 0,
        comboStep: comboStep,
        blastLabel: '',
        comboLabel: '',
        scoreValue: 0
      };
    }

    var neutralBlastIndices = collectAdjacentBlastBonusIndices(board, size, blastIndices);

    neutralBlastIndices.forEach(function (neutralIndex) {
      if (!seen.has(neutralIndex)) {
        seen.add(neutralIndex);
        blastIndices.push(neutralIndex);
      }

      if (!normalSeen.has(neutralIndex)) {
        normalSeen.add(neutralIndex);
        normalBlastIndices.push(neutralIndex);
      }
    });

    var triggeredBombIndices = blastIndices.filter(function (index) {
      return isBombCell(board[index]);
    });

    triggeredBombIndices.forEach(function (bombIndex) {
      getBombBlastIndices(bombIndex, size).forEach(function (index) {
        if (!board[index]) return;

        if (!seen.has(index)) {
          seen.add(index);
          blastIndices.push(index);
        }

        if (!normalSeen.has(index) && !bombSeen.has(index)) {
          bombSeen.add(index);
          bombBlastIndices.push(index);
        }
      });
    });

    var clearedCount = blastIndices.length;
    var scoreValue = 0;
    var blastLabel = '';
    var comboLabel = '';

    if (comboStep >= 2) {
      var comboDisplay = Math.min(comboStep, 4);
      comboLabel = 'Combo ' + comboDisplay + 'x';
      scoreValue = clearedCount * (12 + ((comboStep - 1) * 4));
    } else {
      if (totalGroups <= 1) {
        blastLabel = '';
        scoreValue = clearedCount * 10;
      } else if (totalGroups === 2) {
        blastLabel = 'Blast 2x';
        scoreValue = clearedCount * 16;
      } else if (totalGroups === 3) {
        blastLabel = 'Blast 3x';
        scoreValue = clearedCount * 20;
      } else {
        blastLabel = 'Max Blast';
        scoreValue = clearedCount * 24;
      }
    }

    return {
      hasBlast: true,
      blastIndices: blastIndices,
      normalBlastIndices: normalBlastIndices,
      bombBlastIndices: bombBlastIndices,
      neutralBlastIndices: neutralBlastIndices,
      clearedCount: clearedCount,
      horizontalGroups: horizontalGroups,
      verticalGroups: verticalGroups,
      totalGroups: totalGroups,
      comboStep: comboStep,
      blastLabel: blastLabel,
      comboLabel: comboLabel,
      scoreValue: scoreValue
    };
  }

  function applyBlast(board, indices) {
    indices.forEach(function (i) {
      board[i] = null;
    });
  }

  function applyGravity(board, size) {
    var moved = [];
    var movedAny = true;

    while (movedAny) {
      movedAny = false;

      for (var y = size - 2; y >= 0; y--) {
        for (var x = 0; x < size; x++) {
          var fromIndex = (y * size) + x;
          var toIndex = ((y + 1) * size) + x;

          if (!board[fromIndex]) continue;
          if (board[toIndex]) continue;

          board[toIndex] = board[fromIndex];
          board[fromIndex] = null;

          moved.push({
            x: x,
            fromY: y,
            toY: y + 1
          });

          movedAny = true;
        }
      }
    }

    return collapseGravityMoves(moved);
  }

  function collapseGravityMoves(moves) {
    var collapsed = [];

    moves.forEach(function (move) {
      var existing = null;

      for (var i = 0; i < collapsed.length; i++) {
        if (
          collapsed[i].x === move.x &&
          collapsed[i].toY === move.fromY
        ) {
          existing = collapsed[i];
          break;
        }
      }

      if (existing) {
        existing.toY = move.toY;
      } else {
        collapsed.push({
          x: move.x,
          fromY: move.fromY,
          toY: move.toY
        });
      }
    });

    return collapsed;
  }

  function buildSpawnAnimMap(root, state, spawns) {
    var map = {};
    if (!spawns || !spawns.length) return map;

    var boardEl = root.querySelector('.bm-board');
    var cellEl = boardEl ? boardEl.querySelector('.bm-cell') : null;
    if (!boardEl || !cellEl) return map;

    var cellSize = cellEl.getBoundingClientRect().width;
    var gap = parseFloat(getComputedStyle(boardEl).gap) || 0;
    var step = cellSize + gap;

    spawns.forEach(function (spawn) {
      if (!spawn) return;

      map[spawn.index] = {
        type: 'drop-land',
        distance: (spawn.toRow - spawn.fromRow) * step,
        duration: 520
      };
    });

    return map;
  }

  function buildPlacementAnimMap(root, state, moved, placedIndices) {
    var map = {};
    var boardEl = root.querySelector('.bm-board');
    if (!boardEl) return map;

    var cellEl = boardEl.querySelector('.bm-cell');
    if (!cellEl) return map;

    var cellSize = cellEl.getBoundingClientRect().width;
    var gap = parseFloat(getComputedStyle(boardEl).gap) || 0;
    var step = cellSize + gap;

    var movedToSet = new Set();

    moved.forEach(function (move) {
      var toIndex = (move.toY * state.boardSize) + move.x;
      movedToSet.add(toIndex);

      map[toIndex] = {
        type: 'drop-land',
        distance: (move.toY - move.fromY) * step,
        duration: 360
      };
    });

    (placedIndices || []).forEach(function (index) {
      if (movedToSet.has(index)) return;

      map[index] = {
        type: 'place-pop'
      };
    });

    return map;
  }

  function toneForValue(value) {
    return 'c' + Math.max(1, Math.min(9, value));
  }

  function makeCell(value) {
    return {
      kind: 'number',
      value: value,
      tone: toneForValue(value)
    };
  }

  function makeNeutralCell() {
    return {
      kind: 'neutral',
      tone: 'neutral'
    };
  }

  function makeBombCell() {
    return {
      kind: 'bomb',
      tone: 'special'
    };
  }

  function makeSkullCell() {
    return {
      kind: 'skull',
      tone: 'special'
    };
  }

  function makeHeartCell() {
    return {
      kind: 'heart',
      tone: 'special'
    };
  }

  function makeGemCell() {
    return {
      kind: 'gem',
      tone: 'special'
    };
  }

  function isGemCell(cell) {
    return !!(cell && cell.kind === 'gem');
  }

  function isBombCell(cell) {
    return !!(cell && cell.kind === 'bomb');
  }

  function isSkullCell(cell) {
    return !!(cell && cell.kind === 'skull');
  }

  function isHeartCell(cell) {
    return !!(cell && cell.kind === 'heart');
  }

  function isSpecialIconCell(cell) {
    return isBombCell(cell) || isSkullCell(cell) || isHeartCell(cell);
  }

  function isNeutralCell(cell) {
    return !!(cell && cell.kind === 'neutral');
  }

  function isAdjacentBlastBonusCell(cell) {
    return isNeutralCell(cell) || isBombCell(cell) || isSkullCell(cell) || isHeartCell(cell) || isGemCell(cell);
  }

  function countBoardTilesByKind(board, kind) {
    var count = 0;

    for (var i = 0; i < board.length; i++) {
      if (board[i] && board[i].kind === kind) {
        count += 1;
      }
    }

    return count;
  }

  function getDropLandingRow(board, size, column) {
    for (var y = size - 1; y >= 0; y--) {
      var index = (y * size) + column;
      if (!board[index]) return y;
    }
    return -1;
  }

  function dropRandomNeutralTile(state) {
    var availableColumns = [];

    for (var x = 0; x < state.boardSize; x++) {
      if (getDropLandingRow(state.board, state.boardSize, x) >= 0) {
        availableColumns.push(x);
      }
    }

    if (!availableColumns.length) {
      return null;
    }

    var column = availableColumns[Math.floor(Math.random() * availableColumns.length)];
    var landingRow = getDropLandingRow(state.board, state.boardSize, column);
    var landingIndex = (landingRow * state.boardSize) + column;

    state.board[landingIndex] = makeNeutralCell();

    return {
      index: landingIndex,
      fromRow: -6,
      toRow: landingRow,
      column: column
    };
  }

  function maybeDropWall(state) {
    if (!state) return false;
    if (state.moveCount <= 0) return false;

    if (isDailyMode(state)) {
      var dailyChallenge = getDailyChallengeConfig(state.daily && state.daily.challengeId);
      var dailyWallRate = dailyChallenge.wallDropRate || 3;
      if (state.moveCount % dailyWallRate !== 0) return false;
      return dropRandomNeutralTile(state);
    }

    if (!state.currentLevel) return false;
    if (!state.currentLevel.wallDropRate) return false;
    if (state.moveCount % state.currentLevel.wallDropRate !== 0) return false;

    return dropRandomNeutralTile(state);
  }

  function dropRandomBombTile(state) {
    if (countBoardTilesByKind(state.board, 'bomb') >= CONFIG.maxBombTilesOnBoard) {
      return null;
    }
    var availableColumns = [];

    for (var x = 0; x < state.boardSize; x++) {
      if (getDropLandingRow(state.board, state.boardSize, x) >= 0) {
        availableColumns.push(x);
      }
    }

    if (!availableColumns.length) {
      return null;
    }

    var column = availableColumns[Math.floor(Math.random() * availableColumns.length)];
    var landingRow = getDropLandingRow(state.board, state.boardSize, column);
    var landingIndex = (landingRow * state.boardSize) + column;

    state.board[landingIndex] = makeBombCell();

    return {
      index: landingIndex,
      fromRow: -6,
      toRow: landingRow,
      column: column
    };
  }

  function dropRandomSpecialTile(state, kind) {
    if (kind === 'heart' && countBoardTilesByKind(state.board, 'heart') >= CONFIG.maxHeartTilesOnBoard) {
      return null;
    }

    if (kind === 'skull' && countBoardTilesByKind(state.board, 'skull') >= CONFIG.maxSkullTilesOnBoard) {
      return null;
    }
    var availableColumns = [];

    for (var x = 0; x < state.boardSize; x++) {
      if (getDropLandingRow(state.board, state.boardSize, x) >= 0) {
        availableColumns.push(x);
      }
    }

    if (!availableColumns.length) {
      return null;
    }

    var column = availableColumns[Math.floor(Math.random() * availableColumns.length)];
    var landingRow = getDropLandingRow(state.board, state.boardSize, column);
    var landingIndex = (landingRow * state.boardSize) + column;

    if (kind === 'skull') state.board[landingIndex] = makeSkullCell();
    else if (kind === 'heart') state.board[landingIndex] = makeHeartCell();
    else return null;

    return {
      index: landingIndex,
      fromRow: -6,
      toRow: landingRow,
      column: column
    };
  }
  function maybeDropSpecialTile(state) {
    if (!state || !state.currentLevel || !state.currentLevel.features) return false;

    var features = state.currentLevel.features;
    if (!features.skulls && !features.hearts) return false;

    var levelId = state.currentLevel ? state.currentLevel.id : 1;

    if (levelId === 3 && state.handCount % 2 !== 0) {
      return false;
    }

    var skullChance = features.skullChance || 0;
    var baseHeartChance = features.heartChance || 0;
    var heartChance = baseHeartChance;

    if (state.lives === 2) {
      heartChance = baseHeartChance * CONFIG.heartChanceScaleAt2Lives;
    } else if (state.lives === 1) {
      heartChance = baseHeartChance * CONFIG.heartChanceScaleAt1Life;
    }

    var rolledSkull = !!features.skulls && Math.random() < skullChance;
    var rolledHeart = !!features.hearts && Math.random() < heartChance;

    if (!rolledSkull && !rolledHeart) return false;

    if (rolledSkull && rolledHeart) {
      if (state.lives >= CONFIG.startingLives) {
        return dropRandomSpecialTile(state, 'skull');
      }
      return dropRandomSpecialTile(state, 'heart');
    }

    if (rolledHeart) return dropRandomSpecialTile(state, 'heart');
    return dropRandomSpecialTile(state, 'skull');
  }

  function queuePostResolveDrops(state) {
    if (!state || (state.intro && state.intro.active)) return;

    var queued = [];

    if (isDailyMode(state)) {
      var wallSpawn = maybeDropWall(state);

      if (wallSpawn) {
        state.board[wallSpawn.index] = null;
        queued.push('wall');
      }

      state.pendingBombSpawn = false;
      state.wallSpawnsSinceBomb = 0;
      state.justDealtNewHand = false;
      state.pendingPostResolveDrops = queued;
      return;
    }

    var canUseBombCycle = !!(state.currentLevel && state.currentLevel.id >= 2);

    if (canUseBombCycle && state.pendingBombSpawn) {
      queued.push('bomb');
      state.pendingBombSpawn = false;
    } else {
      var wallSpawn = maybeDropWall(state);

      if (wallSpawn) {
        state.board[wallSpawn.index] = null;
        queued.push('wall');

        if (canUseBombCycle) {
          state.wallSpawnsSinceBomb = (state.wallSpawnsSinceBomb || 0) + 1;

          if (state.wallSpawnsSinceBomb >= 3) {
            state.wallSpawnsSinceBomb = 0;
            state.pendingBombSpawn = true;
          }
        }
      }

      if (state.justDealtNewHand) {
        var specialSpawn = maybeDropSpecialTile(state);

        if (specialSpawn) {
          var spawnedCell = state.board[specialSpawn.index];
          state.board[specialSpawn.index] = null;

          if (isSkullCell(spawnedCell)) {
            queued.push('skull');
          } else if (isHeartCell(spawnedCell)) {
            queued.push('heart');
          }
        }

        state.justDealtNewHand = false;
      }
    }

    state.pendingPostResolveDrops = queued;
  }

  function hasQueuedWallDrop(state) {
    var queued = state && state.pendingPostResolveDrops;
    return !!(queued && queued.indexOf('wall') !== -1);
  }

  function runPostResolveDrops(root, state, render) {
    if (!state || (state.intro && state.intro.active)) return;

    var spawns = [];
    var queued = state.pendingPostResolveDrops || [];

    queued.forEach(function (kind) {
      var spawn = null;

      if (kind === 'bomb') {
        spawn = dropRandomBombTile(state);
        if (spawn) {
          spawns.push(spawn);
          maybeOpenTileHelper(state, 'bomb');
        }
        return;
      }

      if (kind === 'wall') {
        spawn = dropRandomNeutralTile(state);
        if (spawn) spawns.push(spawn);
        return;
      }

      if (kind === 'skull' || kind === 'heart') {
        spawn = dropRandomSpecialTile(state, kind);

        if (spawn) {
          spawns.push(spawn);

          if (kind === 'skull') {
            maybeOpenTileHelper(state, 'skull');
          } else if (kind === 'heart') {
            maybeOpenTileHelper(state, 'heart');
          }
        }
      }
    });

    state.pendingPostResolveDrops = [];

    if (!spawns.length) {
      state.comboStep = 0;

      if (isDailyMode(state)) {
        checkDailyEndState(root, state, render);
      } else {
        checkPostMoveState(root, state, render);
      }

      return;
    }

    state.animMap = null;
    state.animMap = buildSpawnAnimMap(root, state, spawns);
    renderGame(root, state, render);

    window.setTimeout(function () {
      state.animMap = null;

      if (isDailyMode(state)) {
        checkDailyEndState(root, state, render);
      } else {
        checkPostMoveState(root, state, render);
      }
    }, 540);
  }

  function getBombBlastIndices(index, size) {
    var x = index % size;
    var y = Math.floor(index / size);
    var out = [];
    var seen = new Set();
    var i;
    var idx;

    for (i = 0; i < size; i++) {
      idx = (y * size) + i;
      if (!seen.has(idx)) {
        seen.add(idx);
        out.push(idx);
      }
    }

    for (i = 0; i < size; i++) {
      idx = (i * size) + x;
      if (!seen.has(idx)) {
        seen.add(idx);
        out.push(idx);
      }
    }

    return out;
  }

  function applySpecialBlastEffects(state, normalBlastIndices) {
    var skullsCleared = 0;
    var heartsCleared = 0;

    (normalBlastIndices || []).forEach(function (index) {
      var cell = state.board[index];
      if (isSkullCell(cell)) skullsCleared += 1;
      if (isHeartCell(cell)) heartsCleared += 1;
    });

    var lifeDelta = heartsCleared - skullsCleared;

    if (lifeDelta !== 0) {
      state.lives = Math.max(0, Math.min(CONFIG.startingLives, state.lives + lifeDelta));
    
      if (lifeDelta < 0) {
        openClassicLifeLossModal(state);
      }
    }

    return {
      skullsCleared: skullsCleared,
      heartsCleared: heartsCleared,
      lifeDelta: lifeDelta
    };
  }

  function hasAnyPlayableHand(state) {
    if (!state || !state.hand) return false;

    for (var i = 0; i < state.hand.length; i++) {
      var piece = state.hand[i];
      if (!piece) continue;

      if (getLegalPlacements(state.board, state.boardSize, piece).length > 0) {
        return true;
      }
    }

    return false;
  }

  function getAllOccupiedIndices(board) {
    var out = [];
    for (var i = 0; i < board.length; i++) {
      if (board[i]) out.push(i);
    }
    return out;
  }

  function seedLevelOneOpeningWalls(state) {
    state.board = createEmptyBoard(state.boardSize);

    var preset = [
      { x: 1, y: 4 },
      { x: 1, y: 5 },
      { x: 4, y: 4 },
      { x: 4, y: 5 }
    ];

    preset.forEach(function (cell) {
      state.board[(cell.y * state.boardSize) + cell.x] = makeNeutralCell();
    });
  }

  function seedBoardForCurrentLevel(state) {
    if (state.currentLevel && state.currentLevel.id === 1) {
      seedLevelOneOpeningWalls(state);
      return;
    }

    state.board = createEmptyBoard(state.boardSize);

    var wallCount = 6;
    for (var i = 0; i < wallCount; i++) {
      dropRandomNeutralTile(state);
    }
  }

  function isBoardGravityStable(board, size) {
    for (var x = 0; x < size; x++) {
      var foundEmpty = false;

      for (var y = size - 1; y >= 0; y--) {
        var index = (y * size) + x;
        var cell = board[index];

        if (!cell) {
          foundEmpty = true;
        } else if (foundEmpty) {
          return false;
        }
      }
    }

    return true;
  }

  var DAILY_CHALLENGE_ORDER = ['easy', 'medium', 'hard'];

function getDailyChallengeConfig(challengeId) {
  return CONFIG.dailyChallenges[challengeId] || CONFIG.dailyChallenges.easy;
}

function getNextDailyChallengeId(challengeId) {
  var index = DAILY_CHALLENGE_ORDER.indexOf(challengeId);
  if (index < 0 || index >= DAILY_CHALLENGE_ORDER.length - 1) return null;
  return DAILY_CHALLENGE_ORDER[index + 1];
}

function formatDailyElapsedTime(startedAt, finishedAt) {
  var start = Number(startedAt) || Date.now();
  var end = Number(finishedAt) || Date.now();
  var totalSeconds = Math.max(0, Math.floor((end - start) / 1000));
  var minutes = Math.floor(totalSeconds / 60);
  var seconds = totalSeconds % 60;
  return minutes + ':' + String(seconds).padStart(2, '0');
}

function createDailyStatsMap(stats) {
  return {
    easy: Object.assign({ tries: 1, startedAt: 0, finishedAt: 0, completed: false }, stats && stats.easy),
    medium: Object.assign({ tries: 1, startedAt: 0, finishedAt: 0, completed: false }, stats && stats.medium),
    hard: Object.assign({ tries: 1, startedAt: 0, finishedAt: 0, completed: false }, stats && stats.hard)
  };
}

function getDailyChallengeStats(state, challengeId) {
  if (!state.dailyStats) {
    state.dailyStats = createDailyStatsMap();
  }

  if (!state.dailyStats[challengeId]) {
    state.dailyStats[challengeId] = { tries: 1, startedAt: 0, finishedAt: 0, completed: false };
  }

  return state.dailyStats[challengeId];
}

function resetDailyChallengeStats(state, challengeId) {
  if (!state.dailyStats) {
    state.dailyStats = createDailyStatsMap();
  }

  state.dailyStats[challengeId] = {
    tries: 1,
    startedAt: 0,
    finishedAt: 0,
    completed: false
  };
}

function startDailyGame(state, challengeId, options) {
  options = options || {};

  var resolvedPuzzleId = getCurrentDailyPuzzleKey() || 'daily-seeded';
  var variantSeed = getCurrentDailyVariantSeed();
  var challenge = getDailyChallengeConfig(challengeId || 'easy');
  state.dailyStats = createDailyStatsMap(state.dailyStats);
  var challengeStats = getDailyChallengeStats(state, challenge.id);
  var resolvedStartedAt = options.startedAt || challengeStats.startedAt || Date.now();
  var resolvedFinishedAt = options.finishedAt || challengeStats.finishedAt || 0;
  var resolvedTries = options.tries || challengeStats.tries || 1;
  var seeded = buildSeededDailyBoard(variantSeed, challenge);

  state.screen = 'daily';
  state.score = 0;
  state.displayScore = 0;
  state.comboStep = 0;
  state.lives = CONFIG.startingLives;
  state.boardSize = CONFIG.boardSize;
  state.currentLevel = LEVELS[0];
  state.levelId = 1;
  state.moveCount = 0;
  state.handCount = 0;
  state.pendingBombSpawn = false;
  state.wallSpawnsSinceBomb = 0;
  state.pendingComboPoints = 0;
  state.justDealtNewHand = false;
  state.animMap = null;
  state.blastIndices = [];
  state.isResolving = false;
  state.boardMessage = "";
  state.pendingPostResolveDrops = [];

  state.intro = {
    active: false,
    step: 0,
    title: "",
    sourceIndex: null,
    allowedTargetIndex: null,
    hoveringValid: false,
    completed: false,
    direction: "horizontal",
    targetQueue: [],
    targetCursor: 0
  };

  state.daily = {
    active: true,
    puzzleId: resolvedPuzzleId,
    challengeId: challenge.id,
    gemTarget: seeded.gemTarget,
    gemsRemaining: seeded.gemTarget,
    completed: !!challengeStats.completed,
    failed: false,
    variantSeed: variantSeed,
    layoutIndices: seeded.chosenIndices,
    tries: resolvedTries,
    startedAt: resolvedStartedAt,
    finishedAt: resolvedFinishedAt,
    showingLossModal: false,
    showingResultScreen: false
  };

  state.board = seeded.board;

  if (!isBoardGravityStable(state.board, state.boardSize)) {
    applyGravity(state.board, state.boardSize);
  }

  state.animMap = null;
  state.hand = generateHand(state.board, state.boardSize, state);

  maybeOpenTileHelper(state, 'daily');
}

function launchDailyChallenge(root, state, render, challengeId, options) {
  options = options || {};

  startDailyGame(state, challengeId, options);
  playSfx('start');

  if (window.posthog) {
    trackEvent('daily_started', {
      puzzle_id: state.daily && state.daily.puzzleId,
      challenge_id: state.daily && state.daily.challengeId
    });
  }

  render();
}

  function isDailyMode(state) {
    return !!(state && state.daily && state.daily.active);
  }

  function animateLifeDelta(root, delta) {
    if (!delta) return;

    var stat = root.querySelector('[data-lives-stat]');
    var icon = root.querySelector('[data-lives-icon]');
    var value = root.querySelector('[data-lives-value]');

    if (!stat || !icon || !value) return;

    stat.classList.remove('is-life-lost', 'is-life-gained');
    icon.classList.remove('is-life-lost-icon', 'is-life-gained-icon');
    value.classList.remove('is-life-lost-value', 'is-life-gained-value');

    stat.removeAttribute('data-life-delta');

    void stat.offsetWidth;

    if (delta < 0) {
      stat.classList.add('is-life-lost');
      icon.classList.add('is-life-lost-icon');
      value.classList.add('is-life-lost-value');
      stat.setAttribute('data-life-delta', String(delta));
    } else {
      stat.classList.add('is-life-gained');
      icon.classList.add('is-life-gained-icon');
      value.classList.add('is-life-gained-value');
      stat.setAttribute('data-life-delta', '+' + String(delta));
    }

    window.setTimeout(function () {
      var liveStat = root.querySelector('[data-lives-stat]');
      var liveIcon = root.querySelector('[data-lives-icon]');
      var liveValue = root.querySelector('[data-lives-value]');

      if (liveStat) {
        liveStat.classList.remove('is-life-lost', 'is-life-gained');
        liveStat.removeAttribute('data-life-delta');
      }
      if (liveIcon) liveIcon.classList.remove('is-life-lost-icon', 'is-life-gained-icon');
      if (liveValue) liveValue.classList.remove('is-life-lost-value', 'is-life-gained-value');
    }, 950);
  }

  function syncDailyHudUi(root, state) {
    if (!root || !state || !state.daily) return;

    var fillEl = root.querySelector('[data-daily-progress-fill]');
    var valueEl = root.querySelector('[data-daily-progress-value]');

    if (!fillEl || !valueEl) return;

    var target = Math.max(1, state.daily.gemTarget || 1);
    var remaining = Math.max(0, state.daily.gemsRemaining || 0);
    var collected = Math.max(0, target - remaining);
    var pct = Math.max(0, Math.min(1, collected / target));

    fillEl.style.width = (pct * 100) + '%';

    valueEl.textContent = collected;
  }

  function resetBoardAfterLifeLoss(state) {
    state.moveCount = 0;
    state.handCount = 0;
    state.justDealtNewHand = false;
    seedBoardForCurrentLevel(state);
    state.hand = generateHand(state.board, state.boardSize, state);
    state.animMap = null;
    state.blastIndices = [];
    state.isResolving = false;
    state.comboStep = 0;
  }

  function setHomeResult(state, result) {
    state.homeResult = result || null;
  }

  function consumeHomeResult(state) {
    var result = state.homeResult;
    state.homeResult = null;
    return result;
  }

  function runDeathReset(root, state, render) {
    var blastIndices = getAllOccupiedIndices(state.board);
    var boardCenter = getBoardCenter(root);

    if (blastIndices.length) {
      spawnCenterUiBurst(root, 20, 2);
      hideBoardCells(root, blastIndices);
    }

    state.board = createEmptyBoard(state.boardSize);
    state.blastIndices = [];

    window.setTimeout(function () {
      state.lives = Math.max(0, state.lives - 1);

      state.classicPaywall = state.classicPaywall || {
        shown: false,
        losses: 0,
        startedAt: Date.now(),
        reason: ''
      };
      
      state.classicPaywall.losses = (state.classicPaywall.losses || 0) + 1;
      
      openClassicLifeLossModal(state);
      
      if (window.posthog) trackEvent('life_lost', { lives_remaining: state.lives, score: state.score });

      playSfx('lose');
      syncHudUi(root, state);

      if (state.lives <= 0) {
        transitionScreen(root, function () {
          setHomeResult(state, { reason: 'last-heart-loss' });
          resetStandardGameState(state);
          state.screen = 'home';
          render();
        });
        return;
      }

      resetBoardAfterLifeLoss(state);
      renderGame(root, state, render);
      animateLifeDelta(root, -1);
      window.setTimeout(function () {
        maybeOpenClassicPaywall(root, state, render, 'two_losses');
      }, 450);
    }, 320);
  }

  function runGameOverToHome(root, state, render) {
    var blastIndices = getAllOccupiedIndices(state.board);
  
    if (blastIndices.length) {
      spawnCenterUiBurst(root, 20, 2);
      hideBoardCells(root, blastIndices);
    }
  
    state.board = createEmptyBoard(state.boardSize);
    state.blastIndices = [];
  
    window.setTimeout(function () {
      playSfx('lose');
  
      if (window.posthog) {
        trackEvent('game_over', {
          score: state.score,
          high_score: state.highScore,
          level: state.levelId
        });
      }
  
      clearSavedGame('game');
  
      state.classicGameOverModal = state.classicBeatHighScore
        ? {
            title: 'Great job',
            body: 'You beat the high score.',
            button: 'Play Again'
          }
        : {
            title: 'So close',
            body: 'Beat your high score next run.',
            button: 'Try Again'
          };
  
      render();
    }, 320);
  }

  function checkPostMoveState(root, state, render) {
    if (state.intro && state.intro.active) return;

    if (state.lives <= 0) {
      runGameOverToHome(root, state, render);
      return;
    }

    if (hasAnyPlayableHand(state)) return;

    if (state.lives > 1) {
      runDeathReset(root, state, render);
    } else {
      runGameOverToHome(root, state, render);
    }
  }

  function checkDailyEndState(root, state, render) {
    if (!isDailyMode(state)) return false;
    if (state.intro && state.intro.active) return false;
    if (state.isResolving) return false;

    if (state.daily.gemsRemaining <= 0 && !state.daily.completed) {
      state.daily.completed = true;
      state.daily.failed = false;
      state.daily.finishedAt = Date.now();
      var completedStats = getDailyChallengeStats(state, state.daily.challengeId);
      completedStats.tries = state.daily.tries || 1;
      completedStats.startedAt = state.daily.startedAt || Date.now();
      completedStats.finishedAt = state.daily.finishedAt;
      completedStats.completed = true;
      state.daily.showingLossModal = false;
      state.daily.showingResultScreen = true;

      if (state.daily && state.daily.challengeId) {
        markDailyChallengeCompleted(state.daily.challengeId);
      }

      if (window.posthog) {
        trackEvent('daily_completed', {
          puzzle_id: state.daily.puzzleId,
          challenge_id: state.daily.challengeId,
          tries: state.daily.tries,
          elapsed_time: state.daily.finishedAt - state.daily.startedAt
        });
      }

      playSfx('combo');
      render();
      return true;
    }

    var noPlayableHand = !hasAnyPlayableHand(state);

    if (noPlayableHand && state.daily.gemsRemaining > 0 && !state.daily.showingLossModal) {
      state.daily.failed = true;
      state.daily.completed = false;
      state.daily.showingLossModal = true;
      state.daily.showingResultScreen = false;
      var failedStats = getDailyChallengeStats(state, state.daily.challengeId);
      failedStats.tries = (failedStats.tries || 1) + 1;
      state.daily.tries = failedStats.tries;

      if (window.posthog) {
        trackEvent('daily_failed', {
          puzzle_id: state.daily.puzzleId,
          challenge_id: state.daily.challengeId,
          gems_remaining: state.daily.gemsRemaining,
          tries: state.daily.tries
        });
      }

      playSfx('lose');
      render();
      return true;
    }

    return false;
  }

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function randomizeShapeValues(shapeDef) {
    return {
      id: shapeDef.id,
      group: shapeDef.group,
      rank: shapeDef.rank,
      width: shapeDef.width,
      height: shapeDef.height,
      cells: shapeDef.coords.map(function (coord) {
        var value = randInt(1, 9);
        return {
          x: coord.x,
          y: coord.y,
          value: value,
          tone: toneForValue(value)
        };
      })
    };
  }

  function getPieceCellAt(piece, x, y) {
    for (var i = 0; i < piece.cells.length; i++) {
      var cell = piece.cells[i];
      if (cell.x === x && cell.y === y) return cell;
    }
    return null;
  }

  function pieceHasSelfBlast(piece) {
    var x, y, k, sum, run, cell;

    for (y = 0; y < piece.height; y++) {
      for (x = 0; x < piece.width; x++) {
        sum = 0;
        run = [];

        for (k = x; k < piece.width; k++) {
          cell = getPieceCellAt(piece, k, y);
          if (!cell) break;

          sum += cell.value;
          run.push(cell);

          if (sum === 10 && run.length > 0) return true;
          if (sum >= 10) break;
        }
      }
    }

    for (x = 0; x < piece.width; x++) {
      for (y = 0; y < piece.height; y++) {
        sum = 0;
        run = [];

        for (k = y; k < piece.height; k++) {
          cell = getPieceCellAt(piece, x, k);
          if (!cell) break;

          sum += cell.value;
          run.push(cell);

          if (sum === 10 && run.length > 0) return true;
          if (sum >= 10) break;
        }
      }
    }

    return false;
  }

  function getPlacementCells(board, boardSize, piece, anchorX, anchorY) {
    if (!piece) return null;

    var placed = [];

    for (var i = 0; i < piece.cells.length; i++) {
      var cell = piece.cells[i];
      var x = anchorX + cell.x;
      var y = anchorY + cell.y;

      if (x < 0 || x >= boardSize || y < 0 || y >= boardSize) {
        return null;
      }

      if (board[(y * boardSize) + x]) {
        return null;
      }

      placed.push({
        x: x,
        y: y,
        value: cell.value,
        tone: cell.tone
      });
    }

    return placed;
  }

  function getLegalPlacements(board, boardSize, piece) {
    var legal = [];
    var maxX = boardSize - piece.width;
    var maxY = boardSize - piece.height;

    for (var y = 0; y <= maxY; y++) {
      for (var x = 0; x <= maxX; x++) {
        var placed = getPlacementCells(board, boardSize, piece, x, y);
        if (!placed) continue;

        legal.push({
          x: x,
          y: y,
          placed: placed
        });
      }
    }

    return legal;
  }

  function getBoardFillRatio(board) {
    var filled = 0;
    for (var i = 0; i < board.length; i++) {
      if (board[i]) filled += 1;
    }
    return filled / board.length;
  }

  var PIECE_LIBRARY = {
    simple: [
      {
        id: 'single',
        rank: 1,
        width: 1,
        height: 1,
        coords: [{ x: 0, y: 0 }]
      },
      {
        id: 'h2',
        rank: 2,
        width: 2,
        height: 1,
        coords: [{ x: 0, y: 0 }, { x: 1, y: 0 }]
      },
      {
        id: 'v2',
        rank: 2,
        width: 1,
        height: 2,
        coords: [{ x: 0, y: 0 }, { x: 0, y: 1 }]
      }
    ],

    complex: [
      {
        id: 'l3',
        rank: 3,
        width: 2,
        height: 2,
        coords: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]
      },
      {
        id: 'j3',
        rank: 3,
        width: 2,
        height: 2,
        coords: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]
      },
      {
        id: 'l3-tall',
        rank: 3,
        width: 2,
        height: 2,
        coords: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]
      },
      {
        id: 'j3-tall',
        rank: 3,
        width: 2,
        height: 2,
        coords: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]
      },
      {
        id: 'square4',
        rank: 4,
        width: 2,
        height: 2,
        coords: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]
      }
    ]
  };

  function getAllShapeDefs() {
    var all = [];

    Object.keys(PIECE_LIBRARY).forEach(function (group) {
      PIECE_LIBRARY[group].forEach(function (shape) {
        if (shape.width > 3 || shape.height > 3) return;

        all.push({
          id: shape.id,
          group: group,
          rank: shape.rank,
          width: shape.width,
          height: shape.height,
          coords: shape.coords
        });
      });
    });

    return all;
  }

  function pickRandom(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function pickSlot12Rule(pieceBias) {
    var roll = Math.random() * 100;

    if (pieceBias === 'easy') {
      if (roll < 55) return { allowedIds: ['single'], maxRank: 1 };
      if (roll < 88) return { allowedIds: ['h2', 'v2'], maxRank: 2 };
    }

    if (pieceBias === 'double') {
      if (roll < 18) return { allowedIds: ['single'], maxRank: 1 };
      if (roll < 58) return { allowedIds: ['h2', 'v2'], maxRank: 2 };
      return { allowedIds: ['l3', 'j3', 'l3-tall', 'j3-tall'], maxRank: 3 };
    }

    if (pieceBias === 'mixed') {
      if (roll < 20) return { allowedIds: ['single'], maxRank: 1 };
      if (roll < 48) return { allowedIds: ['h2', 'v2'], maxRank: 2 };
      if (roll < 90) return { allowedIds: ['l3', 'j3', 'l3-tall', 'j3-tall'], maxRank: 3 };
      return { allowedIds: ['square4'], maxRank: 4 };
    }

    if (roll < 42) return { allowedIds: ['single'], maxRank: 1 };
    if (roll < 72) return { allowedIds: ['h2', 'v2'], maxRank: 2 };
    if (roll < 94) return { allowedIds: ['l3', 'j3', 'l3-tall', 'j3-tall'], maxRank: 3 };
    return { allowedIds: ['square4'], maxRank: 4 };
  }

  function pickSlot3Rule(board, pieceBias) {
    var fillRatio = getBoardFillRatio(board);
    var roll = Math.random() * 100;

    if (pieceBias === 'easy') {
      if (roll < 36) return { allowedIds: ['single'], maxRank: 1 };
      if (roll < 70) return { allowedIds: ['h2', 'v2'], maxRank: 2 };
      return { allowedIds: ['l3', 'j3', 'l3-tall', 'j3-tall'], maxRank: 3 };
    }

    if (pieceBias === 'double') {
      if (roll < 16) return { allowedIds: ['single'], maxRank: 1 };
      if (roll < 40) return { allowedIds: ['h2', 'v2'], maxRank: 2 };
      if (roll < 90) return { allowedIds: ['l3', 'j3', 'l3-tall', 'j3-tall'], maxRank: 3 };
      return { allowedIds: ['square4'], maxRank: 4 };
    }

    if (pieceBias === 'mixed') {
      if (roll < 12) return { allowedIds: ['single'], maxRank: 1 };
      if (roll < 34) return { allowedIds: ['h2', 'v2'], maxRank: 2 };
      if (roll < 82) return { allowedIds: ['l3', 'j3', 'l3-tall', 'j3-tall'], maxRank: 3 };
      return { allowedIds: ['square4'], maxRank: 4 };
    }

    if (fillRatio >= 0.6) {
      if (roll < 28) return { allowedIds: ['single'], maxRank: 1 };
      if (roll < 56) return { allowedIds: ['h2', 'v2'], maxRank: 2 };
      if (roll < 94) return { allowedIds: ['l3', 'j3', 'l3-tall', 'j3-tall'], maxRank: 3 };
      return { allowedIds: ['square4'], maxRank: 4 };
    }

    if (roll < 18) return { allowedIds: ['single'], maxRank: 1 };
    if (roll < 42) return { allowedIds: ['h2', 'v2'], maxRank: 2 };
    if (roll < 88) return { allowedIds: ['l3', 'j3', 'l3-tall', 'j3-tall'], maxRank: 3 };
    return { allowedIds: ['square4'], maxRank: 4 };
  }

  function generateHand(board, boardSize, state) {
    var hand = [];
    var pieceBias = state && state.currentLevel ? state.currentLevel.pieceBias : null;

    var slot1 = generatePiece(board, boardSize, pickSlot12Rule(pieceBias));
    var slot2 = generatePiece(board, boardSize, pickSlot12Rule(pieceBias));
    var slot3 = generatePiece(board, boardSize, pickSlot3Rule(board, pieceBias));

    hand.push(slot1);
    hand.push(slot2);
    hand.push(slot3);

    for (var i = 0; i < 2; i++) {
      if (!hand[i]) {
        hand[i] = generatePiece(board, boardSize, {
          allowedIds: ['single', 'h2', 'v2'],
          maxRank: 2
        });
        continue;
      }

      if (hand[i].rank > 2) {
        hand[i] = generatePiece(board, boardSize, {
          allowedIds: ['single', 'h2', 'v2'],
          maxRank: 2
        });
      }
    }

    if (!hand[2]) {
      hand[2] = generatePiece(board, boardSize, {
        allowedIds: ['h2', 'v2', 'l3', 'j3', 'l3-tall', 'j3-tall', 'square4'],
        maxRank: 4
      });
    }

    var playableCount = hand.filter(function (piece) {
      return piece && getLegalPlacements(board, boardSize, piece).length > 0;
    }).length;

    if (playableCount < 2) {
      hand[0] = generatePiece(board, boardSize, {
        allowedIds: ['single', 'h2', 'v2'],
        maxRank: 2
      });
      hand[1] = generatePiece(board, boardSize, {
        allowedIds: ['single', 'h2', 'v2'],
        maxRank: 2
      });
    }

    return hand;
  }

  function pieceFitsCatalogRules(piece) {
    if (!piece) return false;
    if (piece.width > 3 || piece.height > 3) return false;
    return true;
  }

  function generatePiece(board, boardSize, rule) {
    rule = rule || {};

    var defs = getAllShapeDefs().filter(function (def) {
      if (def.width > 3 || def.height > 3) return false;

      if (rule.groups && rule.groups.indexOf(def.group) === -1) return false;
      if (rule.maxRank && def.rank > rule.maxRank) return false;
      if (rule.allowedIds && rule.allowedIds.indexOf(def.id) === -1) return false;
      if (rule.maxCells && def.coords.length > rule.maxCells) return false;
      if (rule.minCells && def.coords.length < rule.minCells) return false;

      return true;
    });

    var candidates = [];

    defs.forEach(function (def) {
      for (var tries = 0; tries < 16; tries++) {
        var piece = randomizeShapeValues(def);

        if (!pieceFitsCatalogRules(piece)) continue;

        if (pieceHasSelfBlast(piece)) continue;

        if (board && boardSize) {
          var legalPlacements = getLegalPlacements(board, boardSize, piece);
          if (!legalPlacements.length) continue;
        }

        candidates.push(piece);
      }
    });

    if (!candidates.length) {
      var fallbackDefs = getAllShapeDefs().filter(function (def) {
        return (
          def.id === 'single' ||
          def.id === 'h2' ||
          def.id === 'v2'
        );
      });

      for (var i = 0; i < fallbackDefs.length; i++) {
        for (var n = 0; n < 16; n++) {
          var fallback = randomizeShapeValues(fallbackDefs[i]);

          if (pieceHasSelfBlast(fallback)) continue;
          if (board && boardSize && !getLegalPlacements(board, boardSize, fallback).length) continue;

          return fallback;
        }
      }

      return null;
    }

    return pickRandom(candidates);
  }

  function renderPiece(piece) {
    var scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bm-ui-scale') || 1);
    var cellSize = CONFIG.handTileSize * scale;
    var gap = CONFIG.handTileGap * scale;
    var width = (piece.width * cellSize) + ((piece.width - 1) * gap);
    var height = (piece.height * cellSize) + ((piece.height - 1) * gap);
    var cells = piece.cells.map(function (cell) {
      var left = Math.round(cell.x * (cellSize + gap));
      var top = Math.round(cell.y * (cellSize + gap));
      var className = 'bm-mini bm-mini--' + cell.tone;

      return '<div class="' + className + '" style="left:' + left + 'px; top:' + top + 'px;"><span class="bm-tile__label">' + cell.value + '</span></div>';
    }).join('');
    return '<div class="bm-piece" data-piece>' +
    '<div class="bm-piece__shape" style="width:' + Math.round(width) + 'px; height:' + Math.round(height) + 'px;">' +
    cells +
    '</div></div>';
  }

  function bindIntroSkip(root, state, render) {
    if (!(state.intro && state.intro.active)) return;

    var skipBtn = root.querySelector('[data-skip-intro]');
    if (!skipBtn) return;

    var skipIntro = function (e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }

      clearIntroTimers(state);

      if (state.boardMessageTimer) {
        window.clearTimeout(state.boardMessageTimer);
        state.boardMessageTimer = null;
      }

      var oldMsg = document.body.querySelector('.bm-board-message');
      if (oldMsg) oldMsg.remove();

      if (window.posthog) trackEvent('intro_skipped', { intro_step: state.intro && state.intro.step });
      runIntroExitToFreshBoard(root, state, render, { playComboSfx: true });
    };

    skipBtn.addEventListener('click', skipIntro);
  }

  function maybeOpenClassicIntroHelper(state) {
    return openHelperModal(state, {
      id: 'classic-intro',
      icon: '',
      title: 'Classic Mode',
      body: 'Blast tiles and beat your high score. Run out of moves and lose a life!'
    });
  }

  function openClassicLifeLossModal(state) {
    if (isDailyMode(state)) return false;
    if (state.lives <= 0) return false;
  
    return openHelperModal(state, {
      id: 'classic-life-loss',
      icon: '',
      title: 'Keep Going',
      body: 'You lost a life, but the game’s not over. Play until your hearts run out.'
    });
  }

  function isBigBlastMoment(blastResult, comboStep) {
    if (!blastResult) return false;
    return blastResult.totalGroups > 1 || comboStep >= 2;
  }

  function maybeOpenTileHelper(state, kind) {
    if (!state) return false;

    if (kind === 'bomb') {
      return openHelperModal(state, {
        id: 'bomb',
        icon: 'bomb',
        title: 'Bomb Tile',
        body: 'Blast beside it to clear the whole row and column!'
      });
    }

    if (kind === 'skull') {
      return openHelperModal(state, {
        id: 'skull',
        icon: 'skull',
        title: 'Skull Tile',
        body: 'Blast it and lose a life. Avoid it!'
      });
    }

    if (kind === 'heart') {
      return openHelperModal(state, {
        id: 'heart',
        icon: 'heart',
        title: 'Heart Tile',
        body: 'Blast it to gain a life!'
      });
    }

    if (kind === 'daily') {
      return openHelperModal(state, {
        id: 'daily',
        icon: '',
        title: 'Daily Challenge',
        body: 'Blast all the gems before you run out of moves. 3 rounds. Can you beat them all?'
      });
    }

    return false;
  }

  function openHelperModal(state, helper) {
    if (!state || !helper || !helper.id) return false;
    if (hasSeenHelper(helper.id)) return false;
    if (state.helperModal) return false;

    markHelperSeen(helper.id);

    state.helperModal = {
      id: helper.id,
      icon: helper.icon || '',
      title: helper.title || '',
      body: helper.body || ''
    };

    return true;
  }

  function closeHelperModal(state) {
    if (!state || !state.helperModal) return;
    state.helperModal = null;
  }

  function renderHelperModal(state) {
    if (!state || !state.helperModal) return '';

    var helper = state.helperModal;
    var isDaily = helper.id === 'daily';

    return '' +
      '<div class="bm-helper-modal" data-helper-modal>' +
       '<div class="bm-helper-modal__card" role="dialog" aria-modal="true" aria-label="' + helper.title + '">' +
  (helper.icon
    ? '<div class="bm-helper-modal__icon"><img src="images/tiles/' + helper.icon + '.svg" alt="" /></div>'
    : '') +
  '<div class="bm-helper-modal__title">' + helper.title + '</div>' +
  '<div class="bm-helper-modal__desc' + (isDaily ? ' bm-helper-modal__desc--daily' : '') + '">' + helper.body + '</div>' +
  '<button class="bm-btn bm-btn--classic bm-helper-modal__btn" type="button" data-helper-close>Got It</button>' +
        '</div>' +
      '</div>';
  }

  function bindHelperModal(root, state, render) {
    if (!state || !state.helperModal) return;

    var nodes = root.querySelectorAll('[data-helper-dismiss], [data-helper-close]');
    if (!nodes.length) return;

    nodes.forEach(function (node) {
      node.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();

        var modal = root.querySelector('[data-helper-modal]');

        if (!modal) {
          closeHelperModal(state);
          render();
          return;
        }

        modal.classList.add('is-exiting');

        window.setTimeout(function () {
          closeHelperModal(state);
          render();
        }, 220);
      });
    });
  }

  function bindClassicGameOverModal(root, state, render) {
    var btn = root.querySelector('[data-classic-game-over-restart]');
    if (!btn) return;
  
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
  
      state.classicGameOverModal = null;
      resetStandardGameState(state);
      state.screen = 'game';
      render();
      playSfx('start');
    });
  }

  function bindDailyLossModal(root, state, render) {
    var tryAgain = root.querySelector('[data-daily-try-again]');
    if (!tryAgain) return;

    tryAgain.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();

      var retryStats = getDailyChallengeStats(state, state.daily.challengeId);

      spawnCenterGemBurst(root, getDailyChallengeConfig(state.daily.challengeId).icon, 20, 2);

      window.setTimeout(function () {
        transitionScreen(root, function () {
          launchDailyChallenge(root, state, render, state.daily.challengeId, {
            tries: retryStats.tries || state.daily.tries || 1,
            startedAt: retryStats.startedAt || state.daily.startedAt || Date.now()
          });
        });
      }, 120);
    });
  }

  function bindDailyResultScreen(root, state, render) {
    var nextBtn = root.querySelector('[data-daily-next-challenge]');
    if (!nextBtn) return;
  
    nextBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
  
      var currentChallengeId = state.daily && state.daily.challengeId;
      var nextChallengeId = getNextDailyChallengeId(currentChallengeId);
  
      if (nextChallengeId) {
        var isLockedNextChallenge = !state.isPaid && currentChallengeId === 'easy' && nextChallengeId === 'medium';
  
        if (isLockedNextChallenge) {
          transitionScreen(root, function () {
            openDailyPaywall(state);
            render();
          });
          return;
        }
  
        var nextStats = getDailyChallengeStats(state, nextChallengeId);
  
        spawnCenterGemBurst(
          root,
          getDailyChallengeConfig(nextChallengeId).icon,
          20,
          2
        );
  
        window.setTimeout(function () {
          transitionScreen(root, function () {
            launchDailyChallenge(root, state, render, nextChallengeId, {
              tries: nextStats.completed ? 1 : (nextStats.tries || 1),
              startedAt: nextStats.completed ? Date.now() : (nextStats.startedAt || Date.now()),
              finishedAt: nextStats.completed ? 0 : (nextStats.finishedAt || 0)
            });
          });
        }, 120);
  
        return;
      }
  
      clearSavedGame('daily');

      state.daily = {
        active: false,
        puzzleId: null,
        challengeId: 'easy',
        gemTarget: 0,
        gemsRemaining: 0,
        completed: false,
        failed: false,
        variantSeed: null,
        layoutIndices: [],
        tries: 1,
        startedAt: 0,
        finishedAt: 0,
        showingLossModal: false,
        showingResultScreen: false
      };
      
      state.dailyCompletedLanding = null;
      state.screen = 'home';
      render();
    });
  }

  function bindDailyCompletedLanding(root, state, render) {
    var homeBtn = root.querySelector('[data-daily-complete-home]');
    if (!homeBtn) return;

    homeBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();

      state.dailyCompletedLanding = null;
      state.screen = 'home';
      render();
    });
  }

  function setPaywallEmailModalOpen(root, isOpen) {
    var modal = root.querySelector('[data-paywall-email-modal]');
    if (!modal) return;
  
    modal.classList.toggle('is-open', !!isOpen);
  
    var input = root.querySelector('[data-paywall-email-input]');
    if (isOpen && input) {
      window.setTimeout(function () {
        input.focus();
      }, 120);
    }
  }

  function bindDailyPaywall(root, state, render) {
    var close = root.querySelector('[data-daily-paywall-close]');
    var cta = root.querySelector('[data-daily-paywall-cta]');
    var emailDismiss = root.querySelector('[data-paywall-email-dismiss]');
    var emailContinue = root.querySelector('[data-paywall-email-continue]');
  
    if (close) {
      close.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
  
        var modal = root.querySelector('[data-paywall-email-modal]');
        if (modal && modal.classList.contains('is-open')) {
          setPaywallEmailModalOpen(root, false);
          return;
        }
  
        state.screen = 'home';
        render();
      };
    }
  
    if (cta) {
      cta.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        setPaywallEmailModalOpen(root, true);
      };
    }
  
    if (emailDismiss) {
      emailDismiss.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        setPaywallEmailModalOpen(root, false);
      };
    }

    if (emailContinue) {
      emailContinue.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
    
        var input = root.querySelector('[data-paywall-email-input]');
        var email = input ? String(input.value || '').trim() : '';
    
        if (!email || !email.includes('@')) {
          if (input) input.focus();
          return;
        }
    
        localStorage.setItem('bm_user_email', email);
        localStorage.setItem('bm_user_valid', 'true');
        state.isPaid = true;
        clearClassicPaywallLock();
        state.daily = {
          active: false,
          puzzleId: null,
          challengeId: 'easy',
          gemTarget: 0,
          gemsRemaining: 0,
          completed: false,
          failed: false,
          variantSeed: null,
          layoutIndices: [],
          tries: 1,
          startedAt: 0,
          finishedAt: 0,
          showingLossModal: false,
          showingResultScreen: false
        };
    
        setPaywallEmailModalOpen(root, false);
    
        state.screen = 'home';
        render();
      };
    }
    
    var emailInput = root.querySelector('[data-paywall-email-input]');
    if (emailInput && emailContinue) {
      emailInput.onkeydown = function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          emailContinue.click();
        }
      };
    }
  }

  function bindClassicPaywall(root, state, render) {
    var close = root.querySelector('[data-classic-paywall-close]');
    var cta = root.querySelector('[data-classic-paywall-cta]');
    var emailDismiss = root.querySelector('[data-paywall-email-dismiss]');
    var emailContinue = root.querySelector('[data-paywall-email-continue]');
  
    if (close) {
      close.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
  
        var modal = root.querySelector('[data-paywall-email-modal]');
        if (modal && modal.classList.contains('is-open')) {
          setPaywallEmailModalOpen(root, false);
          return;
        }
  
        state.screen = 'home';
        render();
      };
    }
  
    if (cta) {
      cta.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        setPaywallEmailModalOpen(root, true);
      };
    }
  
    if (emailDismiss) {
      emailDismiss.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        setPaywallEmailModalOpen(root, false);
      };
    }
  
    if (emailContinue) {
      emailContinue.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
  
        var input = root.querySelector('[data-paywall-email-input]');
        var email = input ? String(input.value || '').trim() : '';
  
        if (!email || !email.includes('@')) {
          if (input) input.focus();
          return;
        }
  
        localStorage.setItem('bm_user_email', email);
        localStorage.setItem('bm_user_valid', 'true');
        state.isPaid = true;
        clearClassicPaywallLock();
  
        setPaywallEmailModalOpen(root, false);
  
        state.daily = {
          active: false,
          puzzleId: null,
          challengeId: 'easy',
          gemTarget: 0,
          gemsRemaining: 0,
          completed: false,
          failed: false,
          variantSeed: null,
          layoutIndices: [],
          tries: 1,
          startedAt: 0,
          finishedAt: 0,
          showingLossModal: false,
          showingResultScreen: false
        };
        
        state.screen = 'home';
        render();
      };
    }
  
    var emailInput = root.querySelector('[data-paywall-email-input]');
    if (emailInput && emailContinue) {
      emailInput.onkeydown = function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          emailContinue.click();
        }
      };
    }
  }

  function renderBoot(root) {
    root.innerHTML = '' +
      '<section class="bm-screen bm-boot">' +
        '<div class="bm-boot__center">' +
          '<div class="bm-logo bm-boot__logo" aria-label="Blast Math logo">' +
            '<img src="images/brand/logo.png" alt="Blast Math" class="bm-logo__img" />' +
          '</div>' +
        '</div>' +
      '</section>';
  }

  function renderHome(root, state) {
    root.innerHTML = '' +
      '<section class="bm-screen bm-home">' +
        '<div class="bm-home__center">' +
          '<div class="bm-logo bm-home__logo" aria-label="Blast Math logo">' +
            '<img src="images/brand/logo.png" alt="Blast Math" class="bm-logo__img" />' +
          '</div>' +
        '</div>' +
        '<div class="bm-home__actions">' +
          '<button class="bm-btn bm-btn--classic bm-home__btn bm-home__btn--classic" type="button" data-play>Classic</button>' +
          '<button class="bm-btn bm-btn--daily bm-home__btn bm-home__btn--daily" type="button" data-daily>' +
            '<span>Daily Challenge</span>' +
            (shouldShowDailyRibbon(state)
              ? '<span class="bm-daily-ribbon"><span class="bm-daily-ribbon__text">New</span></span>'
              : '') +
          '</button>' +
        '</div>' +
      '</section>';
  }

  function renderGame(root, state, renderApp) {
    var isDaily = isDailyMode(state);
    var isIntro = !!(state.intro && state.intro.active);
    var dailyChallenge = isDaily ? getDailyChallengeConfig(state.daily && state.daily.challengeId) : null;

    var hudHtml = isIntro
    ? (
      '<div class="bm-hud bm-hud--intro">' +
        '<button class="bm-btn bm-btn--daily bm-btn--skip" type="button" data-skip-intro>Skip</button>' +
      '</div>'
    )
    : isDaily
    ? (
      '<div class="bm-hud bm-hud--daily-empty"></div>'
    )
    : (
      '<div class="bm-hud">' +
        '<div class="bm-hud-side bm-hud-side--left">' +
          '<div class="bm-hud-stat bm-hud-stat--score">' +
            '<img src="images/hud/crown.svg" class="bm-hud-icon" alt="" />' +
            '<span class="bm-hud-value bm-hud-score-value">' + state.highScore + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="bm-hud-side bm-hud-side--right">' +
          '<div class="bm-hud-stat bm-hud-stat--lives" data-lives-stat>' +
            '<img src="images/hud/heart.svg" class="bm-hud-icon" data-lives-icon alt="" />' +
            '<span class="bm-hud-value bm-hud-lives-value" data-lives-value>' + state.lives + '</span>' +
          '</div>' +
        '</div>' +
      '</div>'
    );

    var scoreHtml = isIntro
    ? (
      '<div class="bm-score bm-score--intro">' +
        '<div class="bm-score__title" data-score-title>' + state.intro.title + '</div>' +
      '</div>'
    )
    : isDaily
    ? (
      '<div class="bm-daily-top">' +
      '<div class="bm-daily-progress">' +
       '<img class="bm-daily-progress__icon" src="' + (dailyChallenge ? dailyChallenge.icon : 'images/tiles/easy.svg') + '" alt="" />' +
        '<div class="bm-daily-progress__track">' +
          '<div class="bm-daily-progress__burst" data-daily-progress-burst></div>' +
          '<div class="bm-daily-progress__bar">' +
            '<div class="bm-daily-progress__fill bm-daily-progress__fill--' + (dailyChallenge ? dailyChallenge.id : 'easy') + '" data-daily-progress-fill></div>' +
          '</div>' +
        '</div>' +
        '<div class="bm-daily-progress__value" data-daily-progress-value>' +
          (state.daily ? Math.max(0, (state.daily.gemTarget || 0) - (state.daily.gemsRemaining || 0)) : 0) +
        '</div>' +
      '</div>' +
    '</div>'
    )
      : (
        '<div class="bm-score">' +
          '<div class="bm-score__burst" data-score-burst></div>' +
          '<div class="bm-score__value" data-score-value>' + state.displayScore + '</div>' +
        '</div>'
      );

      var introPieces = isIntro
      ? state.hand.filter(function (piece) { return !!piece; })
      : [];

    var handHtml = isIntro
      ? (
        '<div class="bm-hand bm-hand--intro">' +
          introPieces.map(function (piece, index) {
            return '<div class="bm-hand-slot bm-hand-slot--intro" data-hand-slot-index="' + index + '">' +
              renderPiece(piece) +
            '</div>';
          }).join('') +
        '</div>'
      )
  : (
    '<div class="bm-hand">' + state.hand.map(function (piece, index) {
      return '<div class="bm-hand-slot" data-hand-slot-index="' + index + '">' + (piece ? renderPiece(piece) : '') + '</div>';
    }).join('') + '</div>'
  );

  var layoutHtml = isDaily
  ? (
    '<section class="bm-screen bm-game bm-game--daily" data-game>' +
      '<div class="bm-spacer bm-spacer--daily-top" aria-hidden="true"></div>' +
      scoreHtml +
      '<div class="bm-spacer bm-spacer--daily-mid" aria-hidden="true"></div>' +
      '<div class="bm-board-wrap">' +
        '<div class="bm-board">' + renderBoard(state.boardSize, state.board, state.animMap, state.blastIndices, state) + '</div>' +
      '</div>' +
      '<div class="bm-spacer bm-spacer--daily-bottom" aria-hidden="true"></div>' +
      handHtml +
    '</section>'
  )
  : (
    '<section class="bm-screen bm-game" data-game>' +
      hudHtml +
      '<div class="bm-spacer" aria-hidden="true"></div>' +
      scoreHtml +
      '<div class="bm-spacer" aria-hidden="true"></div>' +
      '<div class="bm-board-wrap">' +
        '<div class="bm-board">' + renderBoard(state.boardSize, state.board, state.animMap, state.blastIndices, state) + '</div>' +
      '</div>' +
      '<div class="bm-spacer" aria-hidden="true"></div>' +
      handHtml +
    '</section>'
  );

  if (isDaily && state.daily && state.daily.showingResultScreen) {
    root.innerHTML = renderDailyResultScreen(state);
  } else {
    root.innerHTML = layoutHtml + renderHelperModal(state) + renderDailyLossModal(state) + renderClassicGameOverModal(state);
  }

  syncScoreUi(root, state);
  syncDailyHudUi(root, state);
  bindIntroSkip(root, state, renderApp);
  bindHelperModal(root, state, renderApp);

  bindDailyLossModal(root, state, renderApp);
  bindDailyResultScreen(root, state, renderApp);
  bindClassicGameOverModal(root, state, renderApp);

  if (state.intro && state.intro.active) {
    ensureAudioContext();
    primeAllSfx();
  }

  state.animMap = null;
  }

  function renderClassicGameOverModal(state) {
    if (!state || !state.classicGameOverModal) return '';
  
    var modal = state.classicGameOverModal;
  
    return '' +
      '<div class="bm-helper-modal bm-classic-game-over-modal" data-classic-game-over-modal>' +
        '<div class="bm-helper-modal__card" role="dialog" aria-modal="true" aria-label="' + modal.title + '">' +
          '<div class="bm-helper-modal__title">' + modal.title + '</div>' +
          '<div class="bm-helper-modal__desc">' + modal.body + '</div>' +
          '<button class="bm-btn bm-btn--classic bm-helper-modal__btn" type="button" data-classic-game-over-restart>' + modal.button + '</button>' +
        '</div>' +
      '</div>';
  }

  function renderDailyLossModal(state) {
    if (!state.daily || !state.daily.showingLossModal) return '';

    return '' +
      '<div class="bm-helper-modal bm-daily-loss-modal" data-daily-loss-modal>' +
        '<div class="bm-helper-modal__card" role="dialog" aria-modal="true" aria-label="Nice Try">' +
          '<div class="bm-helper-modal__title">Nice Try</div>' +
          '<div class="bm-helper-modal__desc">You didn’t clear all the gems this time. Get them on the next run.</div>' +
          '<button class="bm-btn bm-btn--classic bm-helper-modal__btn" type="button" data-daily-try-again>Try Again</button>' +
        '</div>' +
      '</div>';
  }

  function renderDailyResultScreen(state) {
    if (!state.daily || !state.daily.showingResultScreen) return '';
  
    var challenge = getDailyChallengeConfig(state.daily.challengeId);
    var nextChallengeId = getNextDailyChallengeId(state.daily.challengeId);
    var nextLabel = nextChallengeId ? getDailyChallengeConfig(nextChallengeId).label : 'Home';
    var elapsedTime = formatDailyElapsedTime(state.daily.startedAt, state.daily.finishedAt);
  
    var isLockedNextChallenge = !state.isPaid && challenge.id === 'easy' && nextChallengeId === 'medium';
    var ctaText = nextChallengeId ? ('Play ' + nextLabel) : 'Back Home';
  
    return '' +
    '<section class="bm-screen bm-daily-result" data-daily-result>' +
  
      '<div class="bm-daily-result__content">' +
  
        '<div class="bm-daily-result__icon-wrap">' +
          '<img class="bm-daily-result__icon" src="' + challenge.icon + '" alt="" />' +
        '</div>' +
  
        '<div class="bm-daily-result__title">' + challenge.label + ' Challenge Complete</div>' +
  
        '<div class="bm-daily-result__subtitle">You beat 68% of players on today’s ' + challenge.label + ' Challenge</div>' +
  
        '<div class="bm-daily-result__stats">' +
          '<div class="bm-daily-result__stat">' +
            '<div class="bm-daily-result__stat-head">Tries</div>' +
            '<div class="bm-daily-result__stat-body">' + (state.daily.tries || 1) + '</div>' +
          '</div>' +
          '<div class="bm-daily-result__stat">' +
            '<div class="bm-daily-result__stat-head">Time</div>' +
            '<div class="bm-daily-result__stat-body">' + elapsedTime + '</div>' +
          '</div>' +
        '</div>' +
  
      '</div>' +
  
      '<button class="bm-btn bm-btn--classic bm-daily-result__cta" type="button" data-daily-next-challenge>' +
        '<span>' + ctaText + '</span>' +
        (isLockedNextChallenge
          ? '<img class="bm-daily-result__lock" src="images/paywall/lock.svg" alt="" />'
          : '') +
      '</button>' +
  
    '</section>';
  }

  function renderDailyPaywallScreen(state) {
    return '' +
      '<section class="bm-screen bm-daily-paywall" data-daily-paywall>' +
  
        '<button class="bm-daily-paywall__close" type="button" data-daily-paywall-close aria-label="Close">' +
          '<img class="bm-daily-paywall__close-icon" src="images/paywall/close.svg" alt="" />' +
        '</button>' +
  
        '<div class="bm-daily-paywall__content">' +
  
          '<div class="bm-daily-paywall__title">Finish Today’s Challenge</div>' +
  
          '<img class="bm-daily-paywall__group-image" src="images/paywall/group.svg" alt="" />' +
  
          '<div class="bm-daily-paywall__benefits">' +
            '<div class="bm-daily-paywall__benefit">' +
              '<img class="bm-daily-paywall__benefit-icon" src="images/paywall/fire.svg" alt="" />' +
              '<div class="bm-daily-paywall__benefit-text">Play medium & hard levels</div>' +
            '</div>' +
  
            '<div class="bm-daily-paywall__benefit">' +
              '<img class="bm-daily-paywall__benefit-icon" src="images/paywall/play.svg" alt="" />' +
              '<div class="bm-daily-paywall__benefit-text">Complete today’s challenge</div>' +
            '</div>' +
  
            '<div class="bm-daily-paywall__benefit">' +
              '<img class="bm-daily-paywall__benefit-icon" src="images/paywall/trophy.svg" alt="" />' +
              '<div class="bm-daily-paywall__benefit-text">Earn full rewards</div>' +
            '</div>' +
          '</div>' +
  
        '</div>' +
  
        '<div class="bm-daily-paywall__bottom">' +
          '<div class="bm-daily-paywall__legal">$4.99/month • Cancel anytime</div>' +
          '<button class="bm-btn bm-btn--classic bm-daily-paywall__cta" type="button" data-daily-paywall-cta>Finish Challenge</button>' +
        '</div>' +
  
      '</section>' +
      renderPaywallEmailModal();
  }

  function renderClassicPaywallScreen(state) {
    var score = Math.max(0, Number(state.score) || 0);
  
    return '' +
      '<section class="bm-screen bm-daily-paywall bm-classic-paywall" data-classic-paywall>' +
  
        '<button class="bm-daily-paywall__close" type="button" data-classic-paywall-close aria-label="Close">' +
          '<img class="bm-daily-paywall__close-icon" src="images/paywall/close.svg" alt="" />' +
        '</button>' +
  
        '<div class="bm-daily-paywall__content bm-classic-paywall__content">' +
  
          '<div class="bm-daily-paywall__title bm-classic-paywall__title">Keep Your Streak Alive</div>' +
  
          '<div class="bm-classic-paywall__score-card">' +
            '<img class="bm-classic-paywall__score-icon" src="images/paywall/crown.svg" alt="" />' +
            '<div class="bm-classic-paywall__score-value">' + score + '</div>' +
          '</div>' +
  
          '<div class="bm-daily-paywall__benefits">' +
            '<div class="bm-daily-paywall__benefit">' +
              '<img class="bm-daily-paywall__benefit-icon" src="images/paywall/play.svg" alt="" />' +
              '<div class="bm-daily-paywall__benefit-text">Play anytime without limits</div>' +
            '</div>' +
  
            '<div class="bm-daily-paywall__benefit">' +
              '<img class="bm-daily-paywall__benefit-icon" src="images/paywall/fire.svg" alt="" />' +
              '<div class="bm-daily-paywall__benefit-text">Gain powerful upgrades</div>' +
            '</div>' +
  
            '<div class="bm-daily-paywall__benefit">' +
              '<img class="bm-daily-paywall__benefit-icon" src="images/paywall/trophy.svg" alt="" />' +
              '<div class="bm-daily-paywall__benefit-text">Score higher and go further</div>' +
            '</div>' +
          '</div>' +
  
        '</div>' +
  
        '<div class="bm-daily-paywall__bottom">' +
          '<div class="bm-daily-paywall__legal">$4.99 / Month • Cancel Anytime</div>' +
          '<button class="bm-btn bm-btn--classic bm-daily-paywall__cta" type="button" data-classic-paywall-cta>Keep Playing</button>' +
        '</div>' +
  
      '</section>' +
      renderPaywallEmailModal();
  }

  function renderPaywallEmailModal() {
    return '' +
      '<div class="bm-paywall-email-modal" data-paywall-email-modal>' +
        '<button class="bm-paywall-email-modal__backdrop" type="button" data-paywall-email-dismiss aria-label="Close"></button>' +
        '<div class="bm-paywall-email-modal__sheet">' +
          '<div class="bm-paywall-email-modal__title">One Last Step</div>' +
          '<div class="bm-paywall-email-modal__subtitle">Enter your email to continue, no password needed.</div>' +
          '<input class="bm-paywall-email-modal__input" type="email" inputmode="email" autocomplete="email" placeholder="Enter your email" data-paywall-email-input />' +
          '<button class="bm-btn bm-btn--classic bm-paywall-email-modal__cta" type="button" data-paywall-email-continue>Continue</button>' +
        '</div>' +
      '</div>';
  }

function renderDailyCompletedLanding(state) {
  var hard = getDailyChallengeConfig('hard');

  return '' +
    '<section class="bm-screen bm-daily-complete-landing" data-daily-complete-landing>' +
      '<div class="bm-daily-complete-landing__content">' +
        '<div class="bm-daily-complete-landing__icons" aria-hidden="true">' +
          '<img class="bm-daily-complete-landing__icon bm-daily-complete-landing__icon--easy" src="' + getDailyChallengeConfig('easy').icon + '" alt="" />' +
          '<img class="bm-daily-complete-landing__icon bm-daily-complete-landing__icon--medium" src="' + getDailyChallengeConfig('medium').icon + '" alt="" />' +
          '<img class="bm-daily-complete-landing__icon bm-daily-complete-landing__icon--hard" src="' + hard.icon + '" alt="" />' +
        '</div>' +

        '<div class="bm-daily-complete-landing__title">Daily Challenge Complete</div>' +

        '<div class="bm-daily-complete-landing__subtitle">You beat 68% of players on today’s Daily Challenge. See you tomorrow for a new challenge!</div>' +
      '</div>' +

      '<button class="bm-btn bm-btn--classic bm-daily-complete-landing__cta" type="button" data-daily-complete-home>Home</button>' +
    '</section>';
}

  function renderBoard(boardSize, board, animMap, blastIndices, state) {
    var dailyChallenge = (state && state.daily && state.daily.active)
  ? getDailyChallengeConfig(state.daily.challengeId)
  : null;

var gemIcon = dailyChallenge
  ? dailyChallenge.icon
  : 'images/tiles/gem.svg';
    animMap = animMap || {};
    blastIndices = blastIndices || [];
    state = state || {};

    var intro = state.intro || {};
    var isIntro = !!intro.active;

    return board.map(function (cell, index) {
      var cellClass = 'bm-cell';
      var extraClass = '';
      var extraStyle = '';

      if (isIntro && !cell && !intro.completed) {
        var isQueuedTarget = intro.targetQueue && intro.targetQueue.some(function (target) {
          return target.index === index;
        });

        if (isQueuedTarget) {
          cellClass += ' bm-intro-target-cell';
        }
      }

      if (!cell) {
        return '<div class="' + cellClass + '" data-cell-index="' + index + '"></div>';
      }

      var anim = animMap[index];
      var isBlasting = blastIndices.indexOf(index) !== -1;

      if (anim) {
        if (anim.type === 'place-pop') {
          extraClass = ' bm-place-pop';
        } else if (anim.type === 'drop-land') {
          extraClass = ' bm-drop-land';
          extraStyle =
          ' style="--bm-drop-distance:' + anim.distance + 'px;' +
          '--bm-drop-duration:' + (anim.duration || 320) + 'ms;"';
        } else if (anim.type === 'blast-pop') {
          extraClass = ' bm-blast-pop';
        }
      }

      if (isBlasting) {
        extraClass += ' bm-blast-pop';
      }

      if (isNeutralCell(cell)) {
        return '<div class="' + cellClass + '" data-cell-index="' + index + '">' +
          '<div class="bm-neutral-block' + extraClass + '"' + extraStyle + '></div>' +
        '</div>';
      }

      if (isGemCell(cell)) {
        return '<div class="' + cellClass + '" data-cell-index="' + index + '">' +
          '<div class="bm-gem-tile' + extraClass + '"' + extraStyle + '>' +
            '<img class="bm-gem-tile__icon" src="' + gemIcon + '" alt="" />' +
          '</div>' +
        '</div>';
      }

      if (isSpecialIconCell(cell)) {
        var iconName = isBombCell(cell)
          ? 'bomb'
          : isSkullCell(cell)
            ? 'skull'
            : isHeartCell(cell)
              ? 'heart'
              : 'gem';

        return '<div class="' + cellClass + '" data-cell-index="' + index + '">' +
          '<div class="bm-special-tile' + extraClass + '"' + extraStyle + '>' +
            '<img class="bm-special-tile__icon" src="images/tiles/' + iconName + '.svg" alt="" />' +
          '</div>' +
        '</div>';
      }

      return '<div class="' + cellClass + '" data-cell-index="' + index + '">' +
        '<div class="bm-tile bm-tile--' + cell.tone + extraClass + '"' + extraStyle + '><span class="bm-tile__label">' + cell.value + '</span></div>' +
      '</div>';
    }).join('');
  }

  function getBlastAnchor(root, blastIndices) {
    var board = root.querySelector('.bm-board');
    if (!board || !blastIndices || !blastIndices.length) return null;

    var minLeft = Infinity;
    var maxRight = -Infinity;
    var minTop = Infinity;
    var maxBottom = -Infinity;

    blastIndices.forEach(function (index) {
      var cellEl = board.querySelector('[data-cell-index="' + index + '"]');
      if (!cellEl) return;

      var rect = cellEl.getBoundingClientRect();
      minLeft = Math.min(minLeft, rect.left);
      maxRight = Math.max(maxRight, rect.right);
      minTop = Math.min(minTop, rect.top);
      maxBottom = Math.max(maxBottom, rect.bottom);
    });

    if (!isFinite(minLeft)) return null;

    return {
      left: (minLeft + maxRight) * 0.5,
      top: (minTop + maxBottom) * 0.5
    };
  }

  function getBoardCenter(root) {
    var board = root.querySelector('.bm-board');
    if (!board) return null;

    var rect = board.getBoundingClientRect();

    return {
      left: rect.left + (rect.width * 0.5),
      top: rect.top + (rect.height * 0.5)
    };
  }

  function getBoardCellRects(boardEl) {
    var rects = {};
    if (!boardEl) return rects;

    var cellEls = boardEl.querySelectorAll('.bm-cell');
    cellEls.forEach(function (cellEl, index) {
      rects[index] = cellEl.getBoundingClientRect();
    });

    return rects;
  }

  function getCellContentEl(cellEl) {
    if (!cellEl) return null;
    return cellEl.querySelector('.bm-tile, .bm-neutral-block, .bm-special-tile, .bm-gem-tile');
  }

  function hideBoardCells(root, indices) {
  var boardEl = root.querySelector('.bm-board');
  if (!boardEl || !indices || !indices.length) return;

  indices.forEach(function (index) {
    var cellEl = boardEl.querySelector('[data-cell-index="' + index + '"]');
    var contentEl = getCellContentEl(cellEl);
    if (contentEl) contentEl.style.visibility = 'hidden';
  });
}

  function renderBoardMarkupOnly(root, state) {
    var boardEl = root.querySelector('.bm-board');
    if (!boardEl) return null;

    boardEl.innerHTML = renderBoard(
      state.boardSize,
      state.board,
      null,
      state.blastIndices,
      state
    );

    return boardEl;
  }

  function animateGravityFall(root, state, moved) {


    var boardEl = root.querySelector('.bm-board');

    if (!boardEl || !moved || !moved.length) {
      return Promise.resolve();
    }

    var beforeRects = getBoardCellRects(boardEl);

    boardEl = renderBoardMarkupOnly(root, state);
    var afterRects = getBoardCellRects(boardEl);
    var cellEls = boardEl.querySelectorAll('.bm-cell');
    var clones = [];
    var duration = 300;

    moved.forEach(function (item) {
      var fromIndex = (item.fromY * state.boardSize) + item.x;
      var toIndex = (item.toY * state.boardSize) + item.x;

      var fromRect = beforeRects[fromIndex];
      var toRect = afterRects[toIndex];
      if (!fromRect || !toRect) return;

      var toCellEl = cellEls[toIndex];
      var toContentEl = getCellContentEl(toCellEl);
      if (!toContentEl) return;

      var clone = toContentEl.cloneNode(true);
      clone.classList.remove('bm-drop-land', 'bm-place-pop', 'bm-blast-pop');
      clone.style.position = 'fixed';
      clone.style.left = fromRect.left + 'px';
      clone.style.top = fromRect.top + 'px';
      clone.style.width = fromRect.width + 'px';
      clone.style.height = fromRect.height + 'px';
      clone.style.margin = '0';
      clone.style.zIndex = '30';
      clone.style.pointerEvents = 'none';
      clone.style.willChange = 'transform';
      clone.style.transform = 'translate3d(0,0,0)';

      toContentEl.style.visibility = 'hidden';

      document.body.appendChild(clone);
      clones.push({ clone: clone, target: toContentEl });

      var dx = toRect.left - fromRect.left;
      var dy = toRect.top - fromRect.top;

      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          clone.style.transition = 'transform ' + duration + 'ms cubic-bezier(.22,.61,.36,1)';
          clone.style.transform = 'translate3d(' + dx + 'px,' + dy + 'px,0)';
        });
      });
    });

    return new Promise(function (resolve) {
      window.setTimeout(function () {
        clones.forEach(function (entry) {
          if (entry.clone && entry.clone.parentNode) {
            entry.clone.parentNode.removeChild(entry.clone);
          }
          if (entry.target) {
            entry.target.style.visibility = '';
          }
        });

        resolve();
      }, duration + 30);
    });
  }

  function spawnBlastFragments(root, state, blastIndices) {
    var board = root.querySelector('.bm-board');
    if (!board || !blastIndices || !blastIndices.length) return;

    var boardRect = board.getBoundingClientRect();
    var comboStep = state && state.comboStep ? state.comboStep : 1;
    var launchMode = 'normal';

    blastIndices.forEach(function (index) {
      var cell = state.board[index];
      var cellEl = board.querySelector('[data-cell-index="' + index + '"]');
      if (!cellEl) return;

      var rect = cellEl.getBoundingClientRect();
      var size = rect.width;
      var pieces = 18;

      if (comboStep >= 2) {
        pieces = Math.max(8, Math.round(pieces * 0.45));
      }

      for (var i = 0; i < pieces; i++) {
        var frag = document.createElement('div');
        var fragSize = Math.max(5, size * (0.16 + Math.random() * 0.16));

        var startX = rect.left + (size * 0.12) + Math.random() * (size * 0.76);
        var startY = launchMode === 'life-loss'
          ? boardRect.top + (size * 2.0) + Math.random() * (size * 0.10)
          : rect.top + (size * 0.10) + Math.random() * (size * 0.30);

        var driftX = launchMode === 'life-loss'
          ? (-size * 1.45) + Math.random() * (size * 2.9)
          : (-size * 1.1) + Math.random() * (size * 2.2);
        var liftY = launchMode === 'life-loss'
          ? (size * 0.34) + Math.random() * (size * 0.36)
          : (size * 0.82) + Math.random() * (size * 1.08);
        var fallY = (size * 1.85) + Math.random() * (size * 2.15);
        var rot = (-38 + Math.random() * 76).toFixed(1);
        var delay = Math.round(Math.random() * 24);
        var duration = 880 + Math.round(Math.random() * 60);

        var fragVariant = 1 + Math.floor(Math.random() * 4);

        if (
          isNeutralCell(cell) ||
          isBombCell(cell) ||
          isSkullCell(cell) ||
          isHeartCell(cell) ||
          isGemCell(cell)
        ) {
          frag.className = 'bm-blast-frag bm-blast-frag--neutral bm-blast-frag--neutral-mix-' + fragVariant;
        } else {
          frag.className = 'bm-blast-frag bm-blast-frag--' + cell.tone + ' bm-blast-frag--mix-' + fragVariant;
        }

        frag.style.position = 'fixed';
        frag.style.left = Math.round(startX) + 'px';
        frag.style.top = Math.round(startY) + 'px';
        frag.style.width = Math.round(fragSize) + 'px';
        frag.style.height = Math.round(fragSize) + 'px';
        frag.style.zIndex = 9999;
        frag.style.setProperty('--bm-frag-dx', Math.round(driftX) + 'px');
        frag.style.setProperty('--bm-frag-lift', Math.round(liftY) + 'px');
        frag.style.setProperty('--bm-frag-dy', Math.round(fallY) + 'px');
        frag.style.setProperty('--bm-frag-rot', rot + 'deg');
        frag.style.setProperty('--bm-frag-delay', delay + 'ms');
        frag.style.setProperty('--bm-frag-duration', duration + 'ms');

        document.body.appendChild(frag);

        (function (node) {
          window.setTimeout(function () {
            if (node.parentNode) node.parentNode.removeChild(node);
          }, delay + duration + 80);
        })(frag);
      }
    });
  }

  function spawnCenterUiBurst(root, count, sizeMult) {
    count = typeof count === 'number' ? count : 20;
    sizeMult = typeof sizeMult === 'number' ? sizeMult : 2;

    var center = getBoardCenter(root);
    if (!center) {
      var rect = root.getBoundingClientRect();
    
      center = {
        left: rect.left + rect.width * 0.5,
        top: rect.top + rect.height * 0.55
      };
    }

    var baseSize = 58;

    for (var i = 0; i < count; i++) {
      var frag = document.createElement('div');
      var fragSize = Math.max(12, baseSize * (0.18 + Math.random() * 0.14) * sizeMult);

      var angle = Math.random() * Math.PI * 2;
      var distance = (baseSize * 1.4) + Math.random() * (baseSize * 2.4);
      var driftX = Math.cos(angle) * distance;
      var driftY = Math.sin(angle) * distance * 0.92 - (baseSize * 0.45);

      var rot = (-60 + Math.random() * 120).toFixed(1);
      var delay = Math.round(Math.random() * 24);
      var duration = 760 + Math.round(Math.random() * 90);

      var rainbowTones = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9'];
      var rainbowTone = rainbowTones[Math.floor(Math.random() * rainbowTones.length)];
      var fragVariant = 1 + Math.floor(Math.random() * 4);

      frag.className = 'bm-blast-frag bm-blast-frag--' + rainbowTone + ' bm-ui-burst-frag bm-blast-frag--mix-' + fragVariant;
      frag.style.position = 'fixed';
      frag.style.left = Math.round(center.left) + 'px';
      frag.style.top = Math.round(center.top) + 'px';
      frag.style.width = Math.round(fragSize) + 'px';
      frag.style.height = Math.round(fragSize) + 'px';
      frag.style.zIndex = 10020;
      frag.style.setProperty('--bm-frag-dx', Math.round(driftX) + 'px');
      frag.style.setProperty('--bm-frag-lift', Math.round(baseSize * 0.9) + 'px');
      frag.style.setProperty('--bm-frag-dy', Math.round(driftY) + 'px');
      frag.style.setProperty('--bm-frag-rot', rot + 'deg');
      frag.style.setProperty('--bm-frag-delay', delay + 'ms');
      frag.style.setProperty('--bm-frag-duration', duration + 'ms');

      document.body.appendChild(frag);

      (function (node, ttl) {
        window.setTimeout(function () {
          if (node.parentNode) node.parentNode.removeChild(node);
        }, ttl);
      })(frag, delay + duration + 120);
    }
  }

  function spawnCenterGemBurst(root, gemSrc, count, sizeMult) {
    count = typeof count === 'number' ? count : 20;
    sizeMult = typeof sizeMult === 'number' ? sizeMult : 2;
    gemSrc = gemSrc || 'images/tiles/gem.svg';

    var center = getBoardCenter(root);
    if (!center) {
      center = {
        left: window.innerWidth * 0.5,
        top: window.innerHeight * 0.5
      };
    }

    var baseSize = 58;

    for (var i = 0; i < count; i++) {
      var gem = document.createElement('img');
      var gemSize = Math.max(18, baseSize * (0.34 + Math.random() * 0.20) * sizeMult);

      var angle = Math.random() * Math.PI * 2;
      var distance = (baseSize * 1.1) + Math.random() * (baseSize * 2.0);
      var driftX = Math.cos(angle) * distance;
      var driftY = Math.sin(angle) * distance * 0.92 - (baseSize * 0.35);

      var rot = (-80 + Math.random() * 160).toFixed(1);
      var delay = Math.round(Math.random() * 24);
      var duration = 760 + Math.round(Math.random() * 90);

      gem.src = gemSrc;
      gem.alt = '';
      gem.className = 'bm-ui-burst-gem';
      gem.style.position = 'fixed';
      gem.style.left = Math.round(center.left) + 'px';
      gem.style.top = Math.round(center.top) + 'px';
      gem.style.width = Math.round(gemSize) + 'px';
      gem.style.height = Math.round(gemSize) + 'px';
      gem.style.zIndex = 10020;
      gem.style.setProperty('--bm-frag-dx', Math.round(driftX) + 'px');
      gem.style.setProperty('--bm-frag-lift', Math.round(baseSize * 0.9) + 'px');
      gem.style.setProperty('--bm-frag-dy', Math.round(driftY) + 'px');
      gem.style.setProperty('--bm-frag-rot', rot + 'deg');
      gem.style.setProperty('--bm-frag-delay', delay + 'ms');
      gem.style.setProperty('--bm-frag-duration', duration + 'ms');

      document.body.appendChild(gem);

      (function (node, ttl) {
        window.setTimeout(function () {
          if (node.parentNode) node.parentNode.removeChild(node);
        }, ttl);
      })(gem, delay + duration + 120);
    }
  }

  function spawnBlastThumbPops(root, state, blastIndices) {
    var board = root.querySelector('.bm-board');
    if (!board || !blastIndices || !blastIndices.length) return;

    blastIndices.forEach(function (index, order) {
      if (state.board[index]) return;

      var cellEl = board.querySelector('[data-cell-index="' + index + '"]');
      if (!cellEl) return;

      var rect = cellEl.getBoundingClientRect();

      var thumb = document.createElement('img');
      thumb.src = 'images/tiles/thumb.svg';
      thumb.alt = '';
      thumb.className = 'bm-blast-thumb-pop bm-blast-thumb-pop--fixed';
      thumb.style.left = Math.round(rect.left + (rect.width / 2)) + 'px';
      thumb.style.top = Math.round(rect.top + (rect.height / 2)) + 'px';
      thumb.style.setProperty('--bm-thumb-delay', (order * 60) + 'ms');

      document.body.appendChild(thumb);

      window.setTimeout(function () {
        if (thumb.parentNode) thumb.parentNode.removeChild(thumb);
      }, INTRO_THUMB_POP_DURATION + (order * 60) + 80);
    });
  }

  function spawnScoreStars(root) {
    var burst = root.querySelector('[data-score-burst]');
    if (!burst) return;
  
    burst.classList.remove('is-score-bursting');
    void burst.offsetWidth;
    burst.classList.add('is-score-bursting');
  
    var starCount = 12;

    for (var i = 0; i < starCount; i++) {
      var star = document.createElement('img');
      var size = 22 + Math.round(Math.random() * 25);
      var x = -140 + Math.round(Math.random() * 280);
      var y = -47 + Math.round(Math.random() * 94);
      var rot = -55 + Math.round(Math.random() * 110);
      var delay = Math.round(Math.random() * 70);

      star.src = 'images/hud/star.svg';
      star.className = 'bm-score-star';
      star.style.width = size + 'px';
      star.style.height = size + 'px';
      star.style.left = '50%';
      star.style.top = '50%';
      star.style.setProperty('--bm-star-x', x + 'px');
      star.style.setProperty('--bm-star-y', y + 'px');
      star.style.setProperty('--bm-star-rot', rot + 'deg');
      star.style.setProperty('--bm-star-delay', delay + 'ms');

      burst.appendChild(star);

      (function (node) {
        window.setTimeout(function () {
          if (node.parentNode) {
            node.parentNode.removeChild(node);
          }
        }, 1000);
      })(star);
    }
  }

  function spawnDailyProgressGems(root, state) {
    var burst = root.querySelector('[data-daily-progress-burst]');
    if (!burst) return;

    var challenge = getDailyChallengeConfig(
      state && state.daily ? state.daily.challengeId : 'easy'
    );
    var gemSrc = challenge && challenge.icon ? challenge.icon : 'images/tiles/gem.svg';

    burst.innerHTML = '';

    var gemCount = 18;

    for (var i = 0; i < gemCount; i++) {
      var gem = document.createElement('img');
      var size = 20 + Math.round(Math.random() * 18);
      var angle = Math.random() * Math.PI * 2;
      var radius = 34 + Math.random() * 72;
      var x = Math.round(Math.cos(angle) * radius);
      var y = Math.round(Math.sin(angle) * radius);
      var rot = -55 + Math.round(Math.random() * 110);
      var delay = Math.round(Math.random() * 70);

      gem.src = gemSrc;
      gem.className = 'bm-daily-progress-gem';
      gem.style.width = size + 'px';
      gem.style.height = size + 'px';
      gem.style.left = '50%';
      gem.style.top = '50%';
      gem.style.setProperty('--bm-star-x', x + 'px');
      gem.style.setProperty('--bm-star-y', y + 'px');
      gem.style.setProperty('--bm-star-rot', rot + 'deg');
      gem.style.setProperty('--bm-star-delay', delay + 'ms');

      burst.appendChild(gem);
    }

    burst.classList.remove('is-daily-progress-bursting');
    void burst.offsetWidth;
    burst.classList.add('is-daily-progress-bursting');

    window.setTimeout(function () {
      burst.classList.remove('is-daily-progress-bursting');
      burst.innerHTML = '';
    }, 1000);
  }

  function clearIntroTimers(state) {
    if (!state || !state.introTimers) return;

    state.introTimers.forEach(function (timerId) {
      window.clearTimeout(timerId);
    });

    state.introTimers = [];
  }

  function queueIntroTimer(state, fn, delay) {
    if (!state.introTimers) state.introTimers = [];

    var timerId = window.setTimeout(function () {
      state.introTimers = state.introTimers.filter(function (id) {
        return id !== timerId;
      });
      fn();
    }, delay);

    state.introTimers.push(timerId);
    return timerId;
  }

  function runIntroExitToFreshBoard(root, state, render, options) {
    options = options || {};
    clearIntroTimers(state);

    var oldMsg = document.body.querySelector('.bm-board-message');
    if (oldMsg) oldMsg.remove();

    var blastIndices = getAllOccupiedIndices(state.board);

    if (blastIndices.length) {
      spawnCenterUiBurst(root, 20, 2);
      hideBoardCells(root, blastIndices);
    }

    state.board = createEmptyBoard(state.boardSize);
    state.blastIndices = [];
    state.isResolving = true;

    window.setTimeout(function () {
      if (options.playComboSfx) {
        playSfx('combo');
      }

      markIntroSeen();
      if (window.posthog) trackEvent('intro_completed');

      clearSavedGame('game');

      state.helperModal = null;
      state.animMap = null;
      state.blastIndices = [];
      state.isResolving = false;
      state.boardMessage = '';
      state.pendingPostResolveDrops = [];
      state.introTimers = [];

      resetStandardGameState(state);
      state.screen = 'home';
      state.bootStarted = false;

      render();
    }, 320);
  }

  function runBlastPhase(root, state, placedIndices, comboStep, render) {
    var blastResult;

    comboStep = comboStep || 1;

    blastResult = classifyBlastPhase(state.board, state.boardSize, comboStep);
    state.blastIndices = blastResult.blastIndices;

    if (comboStep === 1) {
      state.pendingComboPoints = 0;
    }
    state.pendingComboPoints += blastResult.scoreValue;

    if (!blastResult.hasBlast) {

      state.blastIndices = [];
      renderGame(root, state, render);
      state.isResolving = false;
      state.comboStep = 0;

      if (!(state.intro && state.intro.active)) {
        if (isDailyMode(state)) {
          var dailyEnded = checkDailyEndState(root, state, render);
          if (!dailyEnded) {
            var noBlastDailyDelay = hasQueuedWallDrop(state) ? 900 : 0;

            window.setTimeout(function () {
              runPostResolveDrops(root, state, render);
            }, noBlastDailyDelay);
          }
        } else {
          runPostResolveDrops(root, state, render);
          window.setTimeout(function () {
            checkPostMoveState(root, state, render);
          }, 380);
        }
      }

      return;
    }

    playSfx('blast');

    var isIntroBlast = !!(state.intro && state.intro.active);

    renderGame(root, state, render);
    
    if (
      !isDailyMode(state) &&
      !isIntroBlast &&
      isBigBlastMoment(blastResult, comboStep)
    ) {
      spawnScoreStars(root);
    }

    var blastAnchor = getBlastAnchor(root, blastResult.blastIndices);

    if (isIntroBlast) {
      state.intro.equationAnchor = blastAnchor;
    }

    spawnBlastFragments(root, state, blastResult.blastIndices);

    var specialEffectResult = applySpecialBlastEffects(state, blastResult.normalBlastIndices);
    var specialLifeMessage = getLifeDeltaMessage(specialEffectResult);

    syncHudUi(root, state);

    var dailyGemsCleared = 0;

    if (isDailyMode(state)) {
      blastResult.blastIndices.forEach(function (index) {
        if (isGemCell(state.board[index])) {
          dailyGemsCleared += 1;
        }
      });
    }

    applyBlast(state.board, blastResult.blastIndices);

    if (isDailyMode(state) && dailyGemsCleared > 0) {
      state.daily.gemsRemaining = Math.max(0, state.daily.gemsRemaining - dailyGemsCleared);
    }

    hideBoardCells(root, blastResult.blastIndices);

    if (isDailyMode(state) && dailyGemsCleared > 0) {
      syncDailyHudUi(root, state);

      var valueEl = root.querySelector('[data-daily-progress-value]');

      if (valueEl) {
        valueEl.classList.remove('is-daily-progress-value-hit');
        void valueEl.offsetWidth;
        valueEl.classList.add('is-daily-progress-value-hit');
      }

      var fillEl = root.querySelector('[data-daily-progress-fill]');
      var barEl = root.querySelector('.bm-daily-progress__bar');

      if (fillEl) {
        fillEl.classList.remove('is-daily-progress-hit');
        void fillEl.offsetWidth;
        fillEl.classList.add('is-daily-progress-hit');
      }

      if (barEl) {
        barEl.classList.remove('is-daily-progress-bar-hit');
        void barEl.offsetWidth;
        barEl.classList.add('is-daily-progress-bar-hit');

        window.setTimeout(function () {
          barEl.classList.remove('is-daily-progress-bar-hit');
        }, 420);
      }

      spawnDailyProgressGems(root, state);
    }

    if (specialEffectResult.lifeDelta !== 0) {
      window.setTimeout(function () {
        animateLifeDelta(root, specialEffectResult.lifeDelta);
      }, 120);
    }

    window.setTimeout(function () {
      if (isIntroBlast || isBigBlastMoment(blastResult, comboStep)) {
        spawnBlastThumbPops(root, state, blastResult.blastIndices);
      }
    }, INTRO_THUMB_POP_DELAY);

    var pointsMessageDelay = BLAST_PRIMARY_MESSAGE_DELAY;

    if (blastResult.blastLabel) {
      window.setTimeout(function () {
        showBoardMessage(root, blastResult.blastLabel, blastAnchor, undefined, undefined, 'blast');
      }, BLAST_PRIMARY_MESSAGE_DELAY);

      pointsMessageDelay = BLAST_SECONDARY_MESSAGE_DELAY;
    }

    if (specialLifeMessage) {
      var specialLifeDelay = blastResult.blastLabel
        ? BLAST_SECONDARY_MESSAGE_DELAY
        : BLAST_PRIMARY_MESSAGE_DELAY;

      window.setTimeout(function () {
        showBoardMessage(
          root,
          specialLifeMessage,
          blastAnchor,
          -82,
          undefined,
          specialEffectResult.lifeDelta < 0 ? 'life-loss' : 'life-gain'
        );
      }, specialLifeDelay);

      pointsMessageDelay = Math.max(pointsMessageDelay, specialLifeDelay + BLAST_MESSAGE_STEP_DELAY);
    }

    if (window.posthog) trackEvent('blast_triggered', { tiles_cleared: blastResult.blastIndices.length, score_awarded: blastResult.scoreValue, combo_step: comboStep });
    addScore(root, state, blastResult.scoreValue, true);

    var moved = applyGravity(state.board, state.boardSize);

    state.blastIndices = [];
    state.comboStep = comboStep;

    animateGravityFall(root, state, moved).then(function () {

      var nextBlastResult = classifyBlastPhase(state.board, state.boardSize, comboStep + 1);

        if (nextBlastResult.hasBlast) {
          window.setTimeout(function () {
            runBlastPhase(root, state, [], comboStep + 1, render);
          }, CHAIN_NEXT_BLAST_DELAY);
        } else {
          if (comboStep >= 2) {
            var finalComboLabel = 'Combo ' + Math.min(comboStep, 4) + 'x';
            var finalComboAnchor = blastAnchor;
            var finalComboPoints = state.pendingComboPoints;
            if (window.posthog) trackEvent('combo_achieved', { combo_step: comboStep, total_score_awarded: finalComboPoints });

            window.setTimeout(function () {
              playSfx('combo');
              showBoardMessage(root, finalComboLabel, finalComboAnchor, undefined, undefined, 'combo');
            }, 220);

            if (!isIntroBlast && !isDailyMode(state)) {
              window.setTimeout(function () {
                showBoardMessage(
                  root,
                  formatPointsMessage(finalComboPoints),
                  finalComboAnchor,
                  undefined,
                  undefined,
                  'points',
                  POINTS_MESSAGE_DURATION
                );
              }, 220 + BLAST_MESSAGE_STEP_DELAY + POINTS_MESSAGE_EXTRA_DELAY);
            }
          } else {
            var finalSinglePoints = state.pendingComboPoints;

            if (!isIntroBlast && !isDailyMode(state)) {
              window.setTimeout(function () {
                showBoardMessage(
                  root,
                  formatPointsMessage(finalSinglePoints),
                  blastAnchor,
                  undefined,
                  undefined,
                  'points',
                  POINTS_MESSAGE_DURATION
                );
              }, pointsMessageDelay + POINTS_MESSAGE_EXTRA_DELAY);
            }
          }

          state.pendingComboPoints = 0;

          state.isResolving = false;
          state.comboStep = 0;

          if (!(state.intro && state.intro.active)) {
            if (isDailyMode(state)) {
              var dailyEnded = checkDailyEndState(root, state, render);
              if (!dailyEnded) {
                var dailyPostDropDelay = (dailyGemsCleared > 0 && hasQueuedWallDrop(state)) ? 900 : 0;

                window.setTimeout(function () {
                  runPostResolveDrops(root, state, render);
                }, dailyPostDropDelay);
              }
            } else {
              runPostResolveDrops(root, state, render);
              window.setTimeout(function () {
                checkPostMoveState(root, state, render);
              }, 380);
            }
          }

          if (state.intro && state.intro.active) {
            var nextStep = state.intro.step + 1;
            var introMessageDelay = INTRO_BLAST_TO_MESSAGE_DELAY;

            clearIntroTimers(state);

            queueIntroTimer(state, function () {
              renderGame(root, state, render);
            }, introMessageDelay);

            if (INTRO_STEPS[nextStep]) {
              queueIntroTimer(state, function () {
                setupIntroStepByNumber(state, nextStep);
                renderGame(root, state, render);
              }, introMessageDelay + INTRO_MESSAGE_TO_NEXT_STEP_DELAY);
            } else {
              queueIntroTimer(state, function () {
                runIntroExitToFreshBoard(root, state, render, { playComboSfx: false });
              }, introMessageDelay + INTRO_MESSAGE_TO_NEXT_STEP_DELAY);
            }
          }
        }
      });
  }

  function enableDrag(root, state, render) {
    var drag = null;

    function getBoardMetrics() {
      var board = root.querySelector('.bm-board');
      var cellEl = board ? board.querySelector('.bm-cell') : null;
      if (!board || !cellEl) return null;

      var boardRect = board.getBoundingClientRect();
      var cellRect = cellEl.getBoundingClientRect();
      var gap = parseFloat(getComputedStyle(board).gap) || 0;
      var padding = 4;
      var step = cellRect.width + gap;

      return {
        board: board,
        boardRect: boardRect,
        cellSize: cellRect.width,
        gap: gap,
        padding: padding,
        step: step,
        innerLeft: boardRect.left + padding,
        innerTop: boardRect.top + padding,
        innerWidth: (step * state.boardSize) - gap,
        innerHeight: (step * state.boardSize) - gap
      };
    }

    function createGhost(el) {
      var ghost = el.cloneNode(true);
      ghost.classList.add('bm-piece--ghost');
      ghost.style.position = 'fixed';
      ghost.style.pointerEvents = 'none';
      ghost.style.zIndex = 9999;
      ghost.style.left = '0px';
      ghost.style.top = '0px';
      ghost.style.visibility = 'visible';
      document.body.appendChild(ghost);
      return ghost;
    }

    function sizeGhostToBoard(ghost) {
      var metrics = getBoardMetrics();
      if (!metrics) return;

      var cellSize = metrics.cellSize;
      var gap = metrics.gap;
      var uiScale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bm-ui-scale') || 1);

      var boardSampleTile = document.querySelector('.bm-board .bm-tile');
      var boardFontSize = boardSampleTile
        ? parseFloat(getComputedStyle(boardSampleTile).fontSize)
        : (32 * uiScale);

      var shape = ghost.querySelector('.bm-piece__shape');
      if (!shape) return;

      var minis = ghost.querySelectorAll('.bm-mini');
      if (!minis.length) return;

      var scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bm-ui-scale') || 1);
      var handCell = CONFIG.handTileSize * scale;
      var handGap = CONFIG.handTileGap * scale;
      var handStep = handCell + handGap;

      var maxX = 0;
      var maxY = 0;

      minis.forEach(function (mini) {
        var left = parseFloat(mini.style.left) || 0;
        var top = parseFloat(mini.style.top) || 0;

        var gridX = Math.floor((left + handStep * 0.5) / handStep);
        var gridY = Math.floor((top + handStep * 0.5) / handStep);

        mini.style.width = cellSize + 'px';
        mini.style.height = cellSize + 'px';
        mini.style.left = Math.round(gridX * (cellSize + gap)) + 'px';
        mini.style.top = Math.round(gridY * (cellSize + gap)) + 'px';
        mini.style.fontSize = boardFontSize + 'px';
        mini.style.lineHeight = cellSize + 'px';
        mini.style.textShadow = '0 2px 2px rgba(0,0,0,0.5)';

        maxX = Math.max(maxX, gridX);
        maxY = Math.max(maxY, gridY);
      });

      shape.style.width = Math.round((maxX + 1) * cellSize + maxX * gap) + 'px';
      shape.style.height = Math.round((maxY + 1) * cellSize + maxY * gap) + 'px';
    }

    function setIntroHoverState(isActive) {
      if (!(state.intro && state.intro.active)) return;

      state.intro.hoveringValid = !!isActive;

      var sourceCell = root.querySelector('[data-cell-index="' + state.intro.sourceIndex + '"]');
      var targetCells = (state.intro.targetQueue || []).map(function (target) {
        return root.querySelector('[data-cell-index="' + target.index + '"]');
      }).filter(Boolean);

      root.querySelectorAll('.bm-intro-source-cell').forEach(function (el) {
        el.classList.remove('bm-intro-source-cell');
      });

      root.querySelectorAll('.bm-intro-target-cell').forEach(function (el) {
        el.classList.remove('is-hovered');
      });

      if (sourceCell) sourceCell.classList.add('bm-intro-source-cell');

      if (isActive) {
        targetCells.forEach(function (targetCell) {
          targetCell.classList.add('is-hovered');
        });
      }
    }

    function isIntroTargetPlacement(cells) {
      if (!(state.intro && state.intro.active)) return true;
      if (!cells || !cells.length) return false;

      if (cells.length === 1) {
        var onlyIndex = cells[0].y * state.boardSize + cells[0].x;
        return onlyIndex === state.intro.allowedTargetIndex;
      }

      return cells.every(function (cell) {
        var index = cell.y * state.boardSize + cell.x;
        return state.intro.targetQueue.some(function (target) {
          return target.index === index;
        });
      });
    }

    function clearPreview() {
      root.querySelectorAll('.is-preview-tile').forEach(function (el) {
        el.remove();
      });

      if (drag) drag.previewCells = null;
      setIntroHoverState(false);
    }

    function getAnchorFromPointer(piece, clientX, clientY) {
      var metrics = getBoardMetrics();
      if (!metrics || !piece) return null;

      if (
        clientX < metrics.innerLeft ||
        clientY < metrics.innerTop ||
        clientX > metrics.innerLeft + metrics.innerWidth ||
        clientY > metrics.innerTop + metrics.innerHeight
      ) {
        return null;
      }

      var localX = clientX - metrics.innerLeft;
      var localY = clientY - metrics.innerTop;

      var piecePixelWidth = (piece.width * metrics.cellSize) + ((piece.width - 1) * metrics.gap);
      var piecePixelHeight = (piece.height * metrics.cellSize) + ((piece.height - 1) * metrics.gap);

      var left = localX - (piecePixelWidth / 2);
      var top = localY - (piecePixelHeight / 2);

      var anchorX = Math.round(left / metrics.step);
      var anchorY = Math.round(top / metrics.step);

      anchorX = Math.max(0, Math.min(state.boardSize - piece.width, anchorX));
      anchorY = Math.max(0, Math.min(state.boardSize - piece.height, anchorY));

      return { x: anchorX, y: anchorY };
    }

    function getGhostCenter() {
      if (!drag || !drag.ghost) return null;

      var ghostRect = drag.ghost.getBoundingClientRect();

      return {
        x: ghostRect.left + (ghostRect.width * 0.5),
        y: ghostRect.top + (ghostRect.height * 0.5)
      };
    }

    function showPreview(piece, cells) {
      clearPreview();
    
      if (!piece || !cells || !cells.length) return;
    
      var isIntroValid = isIntroTargetPlacement(cells);
    
      cells.forEach(function (cell) {
        var index = cell.y * state.boardSize + cell.x;
        var cellEl = root.querySelector('[data-cell-index="' + index + '"]');
        if (!cellEl) return;
    
        var preview = document.createElement('div');
        preview.className = 'bm-tile bm-tile--' + cell.tone + ' is-preview-tile';
        preview.innerHTML = '<span class="bm-tile__label">' + cell.value + '</span>';
    
        cellEl.appendChild(preview);
      });
    
      drag.previewCells = cells;
      setIntroHoverState(isIntroValid);
    }

    function cleanupDrag() {
      clearPreview();

      if (!drag) return;

      if (drag.pieceEl) {
        drag.pieceEl.classList.remove('is-held');
      }

      if (drag.ghost && drag.ghost.parentNode) {
        drag.ghost.parentNode.removeChild(drag.ghost);
      }

      drag = null;
    }

    function commitPlacementFromPreview() {
      if (!drag || !drag.previewCells || !drag.previewCells.length) return false;
      if (state.intro && state.intro.active && !isIntroTargetPlacement(drag.previewCells)) return false;

      var placedCells = drag.previewCells;
      var placedIndices = placedCells.map(function (cell) {
        return cell.y * state.boardSize + cell.x;
      });

      var placementScore = placedCells.reduce(function (sum, cell) {
        return sum + cell.value;
      }, 0);

      placedCells.forEach(function (cell) {
        state.board[cell.y * state.boardSize + cell.x] = {
          kind: 'number',
          value: cell.value,
          tone: cell.tone
        };
      });

      state.hand[drag.pieceIndex] = null;

      if (!(state.intro && state.intro.active)) {
        state.moveCount += 1;
      }

      if (state.intro && state.intro.active) {
        state.intro.targetCursor += 1;
        state.intro.allowedTargetIndex = null;
        state.intro.hoveringValid = false;

        state.intro.completed = true;
        state.intro.targetQueue = [];
      }

      if (!(state.intro && state.intro.active)) {
        if (state.hand.every(function (piece) { return !piece; })) {
          state.hand = generateHand(state.board, state.boardSize, state);
          state.handCount += 1;
          state.justDealtNewHand = true;
        }
      }

      if (!(state.intro && state.intro.active)) {
        queuePostResolveDrops(state);
      }

      state.isResolving = true;

      var moved = applyGravity(state.board, state.boardSize);

      state.animMap = buildPlacementAnimMap(root, state, moved, placedIndices);
      state.blastIndices = [];

      if (drag.pieceEl) {
        drag.pieceEl.classList.remove('is-held');
      }

      if (drag.ghost && drag.ghost.parentNode) {
        drag.ghost.parentNode.removeChild(drag.ghost);
      }

      clearPreview();
      drag = null;

      renderGame(root, state, render);

      window.setTimeout(function () {
        runBlastPhase(root, state, placedIndices, 1, render);
      }, 280);

      window.setTimeout(function () {
        addScore(root, state, placementScore, true);
      }, 280);

      return true;
    }

    function beginDrag(e) {
      if (state.isResolving) return;
      if (state.helperModal) return;
      if (e.button !== undefined && e.button !== 0) return;

      var pieceEl = e.target.closest('[data-piece]');
      if (!pieceEl) return;

      var slotEl = pieceEl.closest('[data-hand-slot-index]');
      var pieceIndex = slotEl ? Number(slotEl.getAttribute('data-hand-slot-index')) : -1;
      if (pieceIndex < 0 || !state.hand[pieceIndex]) return;

      e.preventDefault();

      forceIntroPickupSfx(state);

      if (pieceEl.setPointerCapture) {
        pieceEl.setPointerCapture(e.pointerId);
      }

      document.querySelectorAll('.bm-piece--ghost').forEach(function (el) {
        el.remove();
      });

      var ghost = createGhost(pieceEl);
      sizeGhostToBoard(ghost);

      var ghostRect = ghost.getBoundingClientRect();
      var uiScale = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--bm-ui-scale') || 1
      );

      drag = {
        pointerId: e.pointerId,
        pieceIndex: pieceIndex,
        pieceEl: pieceEl,
        ghost: ghost,
        ghostHalfW: ghostRect.width * 0.5,
        ghostHalfH: ghostRect.height * 0.5,
        liftY: 96 * uiScale,
        previewCells: null
      };

      pieceEl.classList.add('is-held');

      ghost.style.left = (e.clientX - drag.ghostHalfW) + 'px';
      ghost.style.top = (e.clientY - drag.ghostHalfH - drag.liftY) + 'px';
    }

    function moveDrag(e) {
      if (!drag || e.pointerId !== drag.pointerId) return;

      e.preventDefault();

      var piece = state.hand[drag.pieceIndex];
      if (!piece) {
        cleanupDrag();
        return;
      }

      drag.ghost.style.left = (e.clientX - drag.ghostHalfW) + 'px';
      drag.ghost.style.top = (e.clientY - drag.ghostHalfH - drag.liftY) + 'px';

      var ghostCenter = getGhostCenter();
      var anchor = ghostCenter
        ? getAnchorFromPointer(piece, ghostCenter.x, ghostCenter.y)
        : null;

      if (!anchor) {
        drag.ghost.style.opacity = 1;
        clearPreview();
        return;
      }

      var previewCells = getPlacementCells(
        state.board,
        state.boardSize,
        piece,
        anchor.x,
        anchor.y
      );

      if (!previewCells || !previewCells.length) {
        drag.ghost.style.opacity = 1;
        clearPreview();
        return;
      }

      drag.ghost.style.opacity = 0;
      showPreview(piece, previewCells);
    }

    function endDrag(e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
    
      e.preventDefault();
    
      var didCommit = commitPlacementFromPreview();
    
      if (didCommit) {
        playSfx('place');
        return;
      }
    
      cleanupDrag();
    }

    function cancelDrag(e) {
      if (!drag) return;
      if (e && e.pointerId !== undefined && e.pointerId !== drag.pointerId) return;
      cleanupDrag();
    }

    root.addEventListener('pointerdown', beginDrag);
    root.addEventListener('pointermove', moveDrag);
    root.addEventListener('pointerup', endDrag);
    root.addEventListener('pointercancel', cancelDrag);
  }

  function getLifeDeltaMessage(effectResult) {
    if (!effectResult) return '';

    if (effectResult.lifeDelta < 0) {
      return 'Lose ' + Math.abs(effectResult.lifeDelta) + ' Life';
    }

    if (effectResult.lifeDelta > 0) {
      return 'Gain ' + effectResult.lifeDelta + ' Life';
    }

    return '';
  }

  function formatPointsMessage(points) {
    return '+' + (points || 0);
  }

  function showBoardMessage(root, text, anchor, yOffset, positionVariant, styleVariant, duration) {
    if (!text) return;

    var oldMsg = document.body.querySelector('.bm-board-message');
    if (oldMsg) oldMsg.remove();

    var msg = document.createElement('div');
    msg.className =
    'bm-board-message' +
    (positionVariant ? ' bm-board-message--' + positionVariant : '') +
    (styleVariant ? ' bm-board-message--style-' + styleVariant : '');

    var left = window.innerWidth * 0.5;
    var top = window.innerHeight * 0.5;
    var scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bm-ui-scale')) || 1;
    var textLen = String(text).length;

    if (anchor) {
      left = anchor.left;
      top = anchor.top + (typeof yOffset === 'number' ? yOffset : (-22 * scale));
    }

    var viewW = Math.max(320, Math.round(textLen * 54));
    var x = viewW / 2;

    msg.style.left = Math.round(left) + 'px';
    msg.style.top = Math.round(top) + 'px';

    msg.innerHTML =
      '<svg class="bm-board-message__svg" viewBox="0 0 ' + viewW + ' 120" aria-hidden="true">' +
        '<text class="bm-board-message__text" x="' + x + '" y="60" text-anchor="middle" dominant-baseline="middle">' +
          text +
        '</text>' +
      '</svg>';

    document.body.appendChild(msg);

    window.setTimeout(function () {
      if (msg.parentNode) msg.parentNode.removeChild(msg);
    }, duration || 1400);
  }

  function syncHudUi(root, state) {
    var highScoreEl = root.querySelector('.bm-hud-score-value');
    var livesEl = root.querySelector('.bm-hud-lives-value');

    if (highScoreEl) highScoreEl.textContent = state.highScore;
    if (livesEl) livesEl.textContent = state.lives;
  }

  function syncScoreUi(root, state) {
    var scoreEl = root.querySelector('[data-score-value]');
    if (!scoreEl) {
      syncHudUi(root, state);
      return;
    }

    scoreEl.textContent = state.displayScore;

    if (state.displayScore < state.score) {
      scoreEl.classList.add('is-scoring');
    } else {
      scoreEl.classList.remove('is-scoring');
    }

    syncHudUi(root, state);
  }

  function finishScorePulse(root, state) {
    var scoreEl = root.querySelector('[data-score-value]');
    if (!scoreEl) return;

    scoreEl.classList.remove('is-scoring');
    scoreEl.classList.remove('is-score-hit');

    void scoreEl.offsetWidth;
    scoreEl.classList.add('is-score-hit');

    if (state.scoreAnimDoneTimer) {
      window.clearTimeout(state.scoreAnimDoneTimer);
    }

    state.scoreAnimDoneTimer = window.setTimeout(function () {
      var liveEl = root.querySelector('[data-score-value]');
      if (liveEl) liveEl.classList.remove('is-score-hit');
      state.scoreAnimDoneTimer = null;
    }, 220);
  }

  function animateScoreTo(root, state) {
    if (state.scoreAnimFrame) return;

    function tick() {
      var remaining = state.score - state.displayScore;

      if (remaining <= 0) {
        state.scoreAnimFrame = null;
        syncScoreUi(root, state);
        finishScorePulse(root, state);
        return;
      }

      var step = 1;

      if (remaining > 80) step = 6;
      else if (remaining > 40) step = 4;
      else if (remaining > 15) step = 2;

      state.displayScore = Math.min(state.score, state.displayScore + step);
      syncScoreUi(root, state);
      state.scoreAnimFrame = window.setTimeout(tick, 45);
    }

    tick();
  }

  function writeHighScore(value) {
    try { localStorage.setItem(CONFIG.storageKey, String(value)); }
    catch (e) {}
  }

  function addScore(root, state, amount, skipRender) {
    if (!amount) return;

    state.score += amount;

    if (state.score > state.highScore) {
      state.classicBeatHighScore = true;
      var prevHighScore = state.highScore;
      state.highScore = state.score;
      writeHighScore(state.highScore);
      if (window.posthog) trackEvent('new_high_score', { score: state.score, previous_high_score: prevHighScore });
    }

    syncLevelProgression(root, state);

    if (skipRender) {
      syncHudUi(root, state);
    } else {
      syncHudUi(root, state);
    }

    animateScoreTo(root, state);

    if (!isDailyMode(state)) {
      window.setTimeout(function () {
        maybeOpenClassicPaywall(root, state, function () {
          renderGame(root, state);
        }, 'score_3000');
      }, 650);
    }
  }

  function syncLevelProgression(root, state) {
    if (!state || (state.intro && state.intro.active)) return;

    var previousLevelId = state.levelId;
    var nextLevel = getCurrentLevel(state);

    state.currentLevel = nextLevel;

    if (previousLevelId === nextLevel.id) return;

    state.levelId = nextLevel.id;

    if (previousLevelId < 2 && nextLevel.id >= 2) {
      state.pendingBombSpawn = true;
      state.wallSpawnsSinceBomb = 0;
    }

    if (window.posthog) trackEvent('level_up', { level: nextLevel.id, score: state.score });
    syncHudUi(root, state);
  }

  function transitionScreen(root, drawNext) {
    var current = root.querySelector('.bm-screen');

    if (!current) {
      drawNext();
      var nextNow = root.querySelector('.bm-screen');
      if (nextNow) {
        nextNow.classList.add('is-screen-hidden');
        requestAnimationFrame(function () {
          nextNow.classList.remove('is-screen-hidden');
        });
      }
      return;
    }

    current.classList.add('is-screen-hidden');

    window.setTimeout(function () {
      drawNext();

      var next = root.querySelector('.bm-screen');
      if (!next) return;

      next.classList.add('is-screen-hidden');

      requestAnimationFrame(function () {
        next.classList.remove('is-screen-hidden');
      });
    }, 220);
  }

  function createApp() {
    var mount = document.getElementById('app');
    if (!mount) throw new Error('Missing #app');
    mount.innerHTML = '<div class="bm-stage" data-stage></div>';
    var root = mount.querySelector('[data-stage]');
    var state = {
      isPaid: readUserIsPaid(),
      screen: 'boot',
      highScore: readHighScore(),
      score: 0,
      pendingComboPoints: 0,
      displayScore: 0,
      scoreAnimFrame: null,
      scoreAnimDoneTimer: null,
      comboStep: 0,
      lives: CONFIG.startingLives,
      boardSize: CONFIG.boardSize,
      moveCount: 0,
      handCount: 0,
      justDealtNewHand: false,
      levelId: 1,
      currentLevel: LEVELS[0],
      hand: generateHand(createEmptyBoard(CONFIG.boardSize), CONFIG.boardSize, null),
      board: createEmptyBoard(CONFIG.boardSize),
      dragBound: false,
      animMap: null,
      blastIndices: [],
      isResolving: false,
      boardMessage: '',
      boardMessageTimer: null,
      introTimers: [],
      bootStarted: false,
      bootTimer: null,
      homeResult: null,
      dailyCompletedLanding: null,
      helperModal: null,
      intro: {
        active: false,
        step: 0,
        title: "",
        sourceIndex: null,
        allowedTargetIndex: null,
        hoveringValid: false,
        completed: false,
        direction: "horizontal",
        targetQueue: [],
        targetCursor: 0
      },
      dailyStats: createDailyStatsMap(),
      daily: {
        active: false,
        puzzleId: null,
        challengeId: 'easy',
        gemTarget: 0,
        gemsRemaining: 0,
        completed: false,
        failed: false,
        variantSeed: null,
        layoutIndices: [],
        tries: 1,
        startedAt: 0,
        finishedAt: 0,
        showingLossModal: false,
        showingResultScreen: false
      },
    };

    document.body.addEventListener('pointerdown', unlockSfx, { once: true });
    document.body.addEventListener('touchstart', unlockSfx, { once: true, passive: true }); 

    function runBootFlow() {
      if (state.bootTimer) {
        window.clearTimeout(state.bootTimer);
        state.bootTimer = null;
      }

      state.bootStarted = true;

      state.bootTimer = window.setTimeout(function () {
        state.bootTimer = null;
        markBootSeen();

        transitionScreen(root, function () {
          if (isIntroMode()) {
            setupIntroStepByNumber(state, getIntroStartStep());
            state.screen = 'game';
            render();
            return;
          }

          if (!hasSeenIntro()) {
            setupIntroStepByNumber(state, 1);
            state.screen = 'game';
            render();
            return;
          }

          state.screen = 'home';
          render();
        });
      }, BOOT_TOTAL_MS);
    }

    function render() {
      if (state.screen === 'boot') {
        if (hasSeenBoot()) {
          state.screen = 'home';
          render();
          return;
        }

        renderBoot(root);

        if (!state.bootStarted) {
          runBootFlow();
        }

        return;
      }

      if (state.screen === 'home') {
        renderHome(root, state);

        var homeResult = consumeHomeResult(state);
        if (homeResult && homeResult.reason === 'last-heart-loss') {
          var homeEl = root.querySelector('.bm-home');
          if (homeEl) homeEl.classList.add('bm-home--heart-loss');
        }

        var play = root.querySelector('[data-play]');
        if (play) {
          play.addEventListener('click', function () {
            spawnCenterUiBurst(root, 20, 2);
          
            window.setTimeout(function () {
              transitionScreen(root, function () {
                if (!readUserIsPaid() && isClassicPaywallLocked()) {
                  state.isPaid = false;
                  openClassicPaywall(state, 'locked_reload');
                  render();
                  return;
                }
                
                var savedClassic = readSavedGame('game');
                
                if (savedClassic) {
                  restoreSavedGame(state, savedClassic);
                } else {
                  resetStandardGameState(state);
                }
          
                state.daily = {
                  active: false,
                  puzzleId: null,
                  challengeId: 'easy',
                  gemTarget: 0,
                  gemsRemaining: 0,
                  completed: false,
                  failed: false,
                  variantSeed: null,
                  layoutIndices: [],
                  tries: 1,
                  startedAt: 0,
                  finishedAt: 0,
                  showingLossModal: false,
                  showingResultScreen: false
                };
          
                state.screen = 'game';

                state.classicPaywall = state.classicPaywall || {
                  shown: false,
                  losses: 0,
                  startedAt: Date.now(),
                  reason: ''
                };
                
                if (!state.classicPaywall.startedAt) {
                  state.classicPaywall.startedAt = Date.now();
                }

                maybeOpenClassicIntroHelper(state);
                
                render();
                playSfx('start');

                window.setTimeout(function () {
                  maybeOpenClassicPaywall(root, state, render, 'time_7_min');
                }, 7 * 60 * 1000);
              });
            }, 120);
          });
        }

        var daily = root.querySelector('[data-daily]');
        if (daily) {
          daily.addEventListener('click', function () {
            var savedDaily = readSavedGame('daily');
            var hasActiveSavedDaily = !!(
              savedDaily &&
              savedDaily.daily &&
              savedDaily.daily.active &&
              savedDaily.daily.puzzleId === getCurrentDailyPuzzleKey() &&
              savedDaily.daily.variantSeed === getCurrentDailyVariantSeed()
            );

            if (isCurrentDailyCompleted() && !hasActiveSavedDaily) {
              transitionScreen(root, function () {
                openDailyCompletedLanding(state);
                render();
              });
              return;
            }

            var launchChallengeId = hasActiveSavedDaily
              ? (savedDaily.daily.challengeId || 'easy')
              : 'easy';

              spawnCenterGemBurst(
                root,
                getDailyChallengeConfig(launchChallengeId).icon,
                20,
                2
              );
              
              window.setTimeout(function () {
                transitionScreen(root, function () {
                  if (hasActiveSavedDaily) {
                    restoreSavedGame(state, savedDaily);
                    state.screen = 'daily';
                    render();
                    playSfx('start');
                  } else {
                    launchDailyChallenge(root, state, render, 'easy');
                  }
                });
              }, 120);
          });
        }

      } else if (state.screen === 'daily-complete') {
        root.innerHTML = renderDailyCompletedLanding(state);
        bindDailyCompletedLanding(root, state, render);
      } else if (state.screen === 'daily-paywall') {
        root.innerHTML = renderDailyPaywallScreen(state);
        bindDailyPaywall(root, state, render);
      } else if (state.screen === 'classic-paywall') {
        root.innerHTML = renderClassicPaywallScreen(state);
        bindClassicPaywall(root, state, render);
      } else {
        renderGame(root, state, render);

        if (!state.dragBound) {
          enableDrag(root, state, render);
          state.dragBound = true;
        }
      }
      

      writeSavedGame(state);
    }

    window.BM_DEBUG = {

      paywall: function () {
        openDailyPaywall(state);
        render();
      },

      classicPaywall: function () {
        openClassicPaywall(state, 'debug');
        render();
      },
      
      resetClassicPaywall: function () {
        clearClassicPaywallLock();
        render();
      },

      nextDailyPuzzle: function () {
        var current = typeof DAILY_WINDOW_OVERRIDE === 'number'
          ? DAILY_WINDOW_OVERRIDE
          : getCurrent12HourWindowIndex();

        DAILY_WINDOW_OVERRIDE = current + 1;
        DAILY_VARIANT_OVERRIDE = null;

        clearSavedGame('daily');

        state.daily = {
          active: false,
          puzzleId: null,
          challengeId: 'easy',
          gemTarget: 0,
          gemsRemaining: 0,
          completed: false,
          failed: false,
          variantSeed: null,
          layoutIndices: [],
          tries: 1,
          startedAt: 0,
          finishedAt: 0,
          showingLossModal: false,
          showingResultScreen: false
        };
        
        openDailyCompletedLanding(state);
        render();

        console.log('Advanced fake daily window to', DAILY_WINDOW_OVERRIDE);
      },

      randomDailyPuzzle: function () {
        var ids = getDailyPuzzleIds();
        if (!ids.length) return;

        var id = ids[Math.floor(Math.random() * ids.length)];
        DAILY_VARIANT_OVERRIDE = Math.floor(Math.random() * 1000000);
        startDailyGame(state, id);
        render();
      },

      setDailyWindow: function (n) {
        DAILY_WINDOW_OVERRIDE = Number(n) || 0;
        console.log('DAILY_WINDOW_OVERRIDE =', DAILY_WINDOW_OVERRIDE);
      },

      clearDailyWindowOverride: function () {
        DAILY_WINDOW_OVERRIDE = null;
        console.log('DAILY_WINDOW_OVERRIDE cleared');
      },

      setDailyVariant: function (n) {
        DAILY_VARIANT_OVERRIDE = Number(n) || 0;
        console.log('DAILY_VARIANT_OVERRIDE =', DAILY_VARIANT_OVERRIDE);
      },

      clearDailyVariantOverride: function () {
        DAILY_VARIANT_OVERRIDE = null;
        console.log('DAILY_VARIANT_OVERRIDE cleared');
      },

      startCurrentWindowDaily: function () {
        startDailyGame(state, getCurrentDailyPuzzleKey());
        render();
      },

      cycleFakeDay: function () {
        var current = typeof DAILY_WINDOW_OVERRIDE === 'number'
          ? DAILY_WINDOW_OVERRIDE
          : getCurrent12HourWindowIndex();

        DAILY_WINDOW_OVERRIDE = current + 1;
        startDailyGame(state, getCurrentDailyPuzzleKey());
        render();
      },

      logDailySetup: function () {
        console.log({
          puzzleId: state.daily && state.daily.puzzleId,
          variantSeed: state.daily && state.daily.variantSeed,
          gemTarget: state.daily && state.daily.gemTarget,
          gemsRemaining: state.daily && state.daily.gemsRemaining,
          layoutIndices: state.daily && state.daily.layoutIndices
        });
      },

      getCurrentDailyKey: function () {
        return getCurrentDailyPuzzleKey();
      },

      setDailyPuzzle: function (puzzleId) {
        startDailyGame(state, puzzleId);
        render();
      },

      startDaily: function (puzzleId) {
        startDailyGame(state, puzzleId || getCurrentDailyPuzzleKey());
        render();
      },

      setDailyGems: function (n) {
        state.daily.active = true;
        state.screen = 'daily';
        state.daily.gemsRemaining = Math.max(0, Number(n) || 0);
        render();
      },

      forceDailyWin: function () {
        state.daily.active = true;
        state.screen = 'daily';
        state.daily.gemsRemaining = 0;
        state.daily.completed = false;
        state.daily.failed = false;
        state.daily.showingLossModal = false;
        state.daily.showingResultScreen = false;
        checkDailyEndState(root, state, render);
      },

      forceDailyLoss: function () {
        state.daily.active = true;
        state.screen = 'daily';
        state.daily.failed = false;
        state.daily.completed = false;
        state.daily.showingLossModal = false;
        state.daily.showingResultScreen = false;
        state.hand = [null, null, null];
        checkDailyEndState(root, state, render);
      },

      getState: function () {
        return state;
      },

      render: function () {
        render();
      },

      resetGame: function () {
        resetStandardGameState(state);
        state.screen = 'game';
        render();
      },

      goHome: function () {
        state.screen = 'home';
        render();
      },

      setLives: function (n) {
        state.lives = Math.max(0, Math.min(CONFIG.startingLives, Number(n) || 0));
        render();
      },

      setScore: function (n) {
        state.score = Math.max(0, Number(n) || 0);
        state.displayScore = state.score;
        if (state.score > state.highScore) {
          state.highScore = state.score;
          writeHighScore(state.highScore);
        }
        syncLevelProgression(root, state);
        render();
      },

      setLevel: function (id) {
        var level = null;

        for (var i = 0; i < LEVELS.length; i++) {
          if (LEVELS[i].id === id) {
            level = LEVELS[i];
            break;
          }
        }

        if (!level) return;

        state.screen = 'game';

        state.currentLevel = level;
        state.levelId = level.id;

        if (level.id === 1) {
          state.score = 0;
        } else {
          state.score = level.minScore;
        }
        state.displayScore = state.score;

        state.moveCount = 0;
        state.handCount = 0;
        state.justDealtNewHand = false;
        state.comboStep = 0;
        state.animMap = null;
        state.blastIndices = [];
        state.isResolving = false;

        state.pendingBombSpawn = false;
        state.wallSpawnsSinceBomb = 0;

        if (level.id >= 2) {
          state.pendingBombSpawn = true;
        }

        seedBoardForCurrentLevel(state);
        state.hand = generateHand(state.board, state.boardSize, state);

        render();
      },

      clearBoard: function () {
        state.board = createEmptyBoard(state.boardSize);
        state.animMap = null;
        state.blastIndices = [];
        state.isResolving = false;
        render();
      },

      spawnBomb: function () {
        dropRandomBombTile(state);
        render();
      },

      setPendingBomb: function () {
        state.pendingBombSpawn = true;
        render();
      },

      setWallSpawnCount: function (n) {
        state.wallSpawnsSinceBomb = Math.max(0, Number(n) || 0);
        render();
      },

      spawnSkull: function () {
        dropRandomSpecialTile(state, 'skull');
        render();
      },

      spawnHeart: function () {
        dropRandomSpecialTile(state, 'heart');
        render();
      },

      spawnWall: function () {
        dropRandomNeutralTile(state);
        render();
      },

      forceNoMoves: function () {
        state.hand = [null, null, null];
        checkPostMoveState(root, state, render);
      },

      seedBoard: function (cells) {
        state.board = createEmptyBoard(state.boardSize);

        (cells || []).forEach(function (cell) {
          var index = (cell.y * state.boardSize) + cell.x;

          if (cell.kind === 'neutral') {
            state.board[index] = makeNeutralCell();
          } else if (cell.kind === 'bomb') {
            state.board[index] = makeBombCell();
          } else if (cell.kind === 'skull') {
            state.board[index] = makeSkullCell();
          } else if (cell.kind === 'heart') {
            state.board[index] = makeHeartCell();
          } else {
            state.board[index] = makeCell(cell.value);
          }
        });

        state.animMap = null;
        state.blastIndices = [];
        state.isResolving = false;
        render();
      }
    };

    window.addEventListener('pagehide', function () {
      writeSavedGame(state);
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        writeSavedGame(state);
      }
    });

    return { render: render };
  }

  window.addEventListener('DOMContentLoaded', function () {
    syncUiScale();
    window.addEventListener('resize', syncUiScale);
    window.addEventListener('orientationchange', syncUiScale);  
    var app = createApp();
    app.render();
  });
})();
