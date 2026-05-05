window.trackEvent = window.trackEvent || function (eventName, props) {
  if (window.posthog && typeof window.posthog.capture === 'function') {
    window.posthog.capture(eventName, props || {});
  }
};

(function () {
  'use strict';

  var CONFIG = {
    baseWidth: 390,
    baseHeight: 844,
    boardSize: 7,
    handTileSize: 53,
    handTileGap: 6,
    storageKey: 'blastmath.prototype.highscore',
    wallChanceOnRefill: 0.65,
    gravityMs: 430,
    blastBreathMs: 260,
    chainDelayMs: 300,
    placeResolveDelayMs: 120
  };

  var GEM_TYPES = ['star', 'diamond', 'hex'];
  var TILE_PATH = 'images/tiles/';

  var SFX_VOLUME = {
    pickup: 0.20,
    place: 0.40,
    blast: 0.60,
    combo: 0.60,
    start: 0.80
  };

  var SFX_URLS = {
    pickup: 'sounds/pickup.mp3',
    place: 'sounds/place.mp3',
    blast: 'sounds/blast.mp3',
    combo: 'sounds/combo.mp3',
    start: 'sounds/start.mp3'
  };

  var audioCtx = null;
  var sfxBuffers = {};
  var sfxLoading = {};
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
    if (!ctx || sfxBuffers[name] || sfxLoading[name] || !SFX_URLS[name]) return;

    sfxLoading[name] = true;

    fetch(SFX_URLS[name])
      .then(function (res) {
        if (!res.ok) throw new Error('SFX failed: ' + name);
        return res.arrayBuffer();
      })
      .then(function (buf) { return ctx.decodeAudioData(buf); })
      .then(function (decoded) { sfxBuffers[name] = decoded; })
      .catch(function () {})
      .finally(function () { sfxLoading[name] = false; });
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
    var buffer = sfxBuffers[name];
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
      gain.gain.value = SFX_VOLUME[name] == null ? 1 : SFX_VOLUME[name];
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start(0);
    } catch (e) {}
  }

  function createEmptyBoard(size) {
    return Array.from({ length: size * size }, function () { return null; });
  }

  function makeGemCell(type) {
    type = type || randomGemType();
    return { kind: 'gem', gemType: type };
  }

  function makeWallCell(type) {
    var wallType;
  
    if (type) {
      wallType = type;
    } else {
      wallType = Math.random() < 0.6 ? 'brick_1' : 'brick_2';
    }
  
    return { kind: 'wall', wallType: wallType };
  }
  function turnRandomGemIntoWall() {
    var gemIndices = [];
  
    state.board.forEach(function (cell, index) {
      if (isGemCell(cell)) gemIndices.push(index);
    });
  
    if (!gemIndices.length) return null;
  
    var index = gemIndices[Math.floor(Math.random() * gemIndices.length)];
    state.board[index] = makeWallCell();
  
    return index;
  }

  function isGemCell(cell) {
    return !!(cell && cell.kind === 'gem');
  }

  function isWallCell(cell) {
    return !!(cell && cell.kind === 'wall');
  }

  function getAdaptiveWallChance(board) {
    var wallCount = 0;
  
    for (var i = 0; i < board.length; i++) {
      if (isWallCell(board[i])) wallCount++;
    }
  
    var ratio = wallCount / board.length;
  
    // 📊 tiered buckets
    if (ratio >= 0.60) return 0.00; // 60%+
    if (ratio >= 0.50) return 0.10; // 50%
    if (ratio >= 0.40) return 0.20; // 40%
    if (ratio >= 0.30) return 0.30; // 30%
    
    // 0%–30%
    return 0.40;
  }

  function randomGemType() {
    return GEM_TYPES[Math.floor(Math.random() * GEM_TYPES.length)];
  }

  function createOpeningBoard() {
    var board = createEmptyBoard(CONFIG.boardSize);
    var S = CONFIG.boardSize;

    function put(x, y, cell) {
      board[(y * S) + x] = cell;
    }

    var layout = [
      ['brick','brick','brick','star','star','star','brick'],
      ['brick','star','star','brick','diamond','brick','brick'],
      ['diamond','star','diamond','star','star','hex','star'],
      ['diamond','brick','star','diamond','brick','diamond','brick'],
      ['hex','brick','brick','hex','brick','hex','diamond'],
      ['diamond','brick','diamond','star','brick','diamond','hex'],
      ['brick','brick','star','diamond','brick','hex','hex']
    ];

    layout.forEach(function (row, y) {
      row.forEach(function (value, x) {
        put(x, y, value === 'brick' ? makeWallCell() : makeGemCell(value));
      });
    });

    return board;
  }

  var PIECE_LIBRARY = [
    { id: 'single', rank: 1, width: 1, height: 1, coords: [{ x: 0, y: 0 }] },
    { id: 'h2', rank: 2, width: 2, height: 1, coords: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
    { id: 'v2', rank: 2, width: 1, height: 2, coords: [{ x: 0, y: 0 }, { x: 0, y: 1 }] },
    { id: 'l3', rank: 3, width: 2, height: 2, coords: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
    { id: 'j3', rank: 3, width: 2, height: 2, coords: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
    { id: 'l3-tall', rank: 3, width: 2, height: 2, coords: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] },
    { id: 'j3-tall', rank: 3, width: 2, height: 2, coords: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] }
  ];

  function clonePieceDef(def) {
    return {
      id: def.id + '-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
      shapeId: def.id,
      rank: def.rank,
      width: def.width,
      height: def.height,
      cells: def.coords.map(function (coord) {
        return { x: coord.x, y: coord.y, kind: 'gem', gemType: randomGemType() };
      })
    };
  }

  function getNearMatchGemTypes(board, size) {
    var weighted = [];

    function push(type, times) {
      if (!type) return;
      for (var i = 0; i < times; i++) weighted.push(type);
    }

    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var cell = board[(y * size) + x];
        if (!isGemCell(cell)) continue;

        var right1 = x + 1 < size ? board[(y * size) + x + 1] : null;
        var right2 = x + 2 < size ? board[(y * size) + x + 2] : null;
        var down1 = y + 1 < size ? board[((y + 1) * size) + x] : null;
        var down2 = y + 2 < size ? board[((y + 2) * size) + x] : null;

        if (isGemCell(right1) && right1.gemType === cell.gemType) push(cell.gemType, 4);
        if (isGemCell(down1) && down1.gemType === cell.gemType) push(cell.gemType, 4);
        if (isGemCell(right2) && right2.gemType === cell.gemType) push(cell.gemType, 2);
        if (isGemCell(down2) && down2.gemType === cell.gemType) push(cell.gemType, 2);
      }
    }

    return weighted;
  }

  function biasPieceGemTypes(piece, board, size) {
    var near = getNearMatchGemTypes(board, size);

    piece.cells.forEach(function (cell) {
      cell.gemType = near.length && Math.random() < 0.72
        ? near[Math.floor(Math.random() * near.length)]
        : randomGemType();
    });

    return piece;
  }

  function getPlacementCells(board, size, piece, anchorX, anchorY) {
    if (!piece) return null;

    var placed = [];

    for (var i = 0; i < piece.cells.length; i++) {
      var source = piece.cells[i];
      var x = anchorX + source.x;
      var y = anchorY + source.y;

      if (x < 0 || x >= size || y < 0 || y >= size) return null;

      var index = (y * size) + x;
      if (!isGemCell(board[index])) return null;

      placed.push({
        index: index,
        x: x,
        y: y,
        kind: 'gem',
        gemType: source.gemType
      });
    }

    return placed;
  }

  function hasLegalPlacement(board, size, piece) {
    var maxX = size - piece.width;
    var maxY = size - piece.height;

    for (var y = 0; y <= maxY; y++) {
      for (var x = 0; x <= maxX; x++) {
        if (getPlacementCells(board, size, piece, x, y)) return true;
      }
    }

    return false;
  }

  function generatePiece(board, size, allowedIds) {
    var defs = PIECE_LIBRARY.filter(function (def) {
      return !allowedIds || allowedIds.indexOf(def.id) !== -1;
    });

    var candidates = [];

    defs.forEach(function (def) {
      for (var i = 0; i < 12; i++) {
        var piece = biasPieceGemTypes(clonePieceDef(def), board, size);
        if (hasLegalPlacement(board, size, piece)) candidates.push(piece);
      }
    });

    if (!candidates.length) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function generateHand(board, size) {
    return [
      generatePiece(board, size, ['single']),
      generatePiece(board, size, ['single']),
      generatePiece(board, size, ['single']),
      generatePiece(board, size, ['single'])
    ];
  }

  function findBlastGroups(board, size) {
    var groups = [];

    function keyAt(index) {
      var cell = board[index];
      return isGemCell(cell) ? cell.gemType : null;
    }

    for (var y = 0; y < size; y++) {
      var x = 0;
      while (x < size) {
        var key = keyAt((y * size) + x);
        var run = [];

        while (x < size && key && keyAt((y * size) + x) === key) {
          run.push((y * size) + x);
          x++;
        }

        if (run.length >= 3) groups.push({ axis: 'h', indices: run });
        if (!key) x++;
      }
    }

    for (var x2 = 0; x2 < size; x2++) {
      var y2 = 0;
      while (y2 < size) {
        var key2 = keyAt((y2 * size) + x2);
        var run2 = [];

        while (y2 < size && key2 && keyAt((y2 * size) + x2) === key2) {
          run2.push((y2 * size) + x2);
          y2++;
        }

        if (run2.length >= 3) groups.push({ axis: 'v', indices: run2 });
        if (!key2) y2++;
      }
    }

    return groups;
  }

  function getNeighborIndices(index, size) {
    var x = index % size;
    var y = Math.floor(index / size);
    var out = [];
    if (x > 0) out.push(index - 1);
    if (x < size - 1) out.push(index + 1);
    if (y > 0) out.push(index - size);
    if (y < size - 1) out.push(index + size);
    return out;
  }

  function classifyBlastPhase(board, size, comboStep) {
    var groups = findBlastGroups(board, size);
    var blastSet = new Set();
    var gemBlastSet = new Set();
    var wallSet = new Set();
    var horizontalGroups = 0;
    var verticalGroups = 0;

    groups.forEach(function (group) {
      if (group.axis === 'h') horizontalGroups++;
      if (group.axis === 'v') verticalGroups++;

      group.indices.forEach(function (index) {
        blastSet.add(index);
        gemBlastSet.add(index);
      });
    });

    if (!blastSet.size) {
      return { hasBlast: false, blastIndices: [], gemBlastIndices: [], wallRevealIndices: [] };
    }

    Array.from(gemBlastSet).forEach(function (index) {
      getNeighborIndices(index, size).forEach(function (neighbor) {
        if (isWallCell(board[neighbor])) {
          wallSet.add(neighbor);
          blastSet.add(neighbor);
        }
      });
    });

    var totalGroups = horizontalGroups + verticalGroups;
    var clearedCount = blastSet.size;
    var scoreValue;
    var label = '';

    if (comboStep >= 2) {
      var comboDisplay = Math.min(comboStep, 20);
      label = 'Combo ' + comboDisplay + 'x';
    
      if (comboStep === 2) scoreValue = 300;
      else if (comboStep === 3) scoreValue = 550;
      else if (comboStep === 4) scoreValue = 900;
      else if (comboStep === 5) scoreValue = 1300;
      else scoreValue = 1300 + ((comboDisplay - 5) * 300);
    } else {
      var blastDisplay = Math.min(totalGroups, 20);
    
      if (totalGroups <= 1) {
        scoreValue = 75;
      } else if (totalGroups === 2) {
        scoreValue = 250;
      } else if (totalGroups === 3) {
        scoreValue = 450;
      } else if (totalGroups === 4) {
        scoreValue = 700;
      } else {
        scoreValue = 700 + ((blastDisplay - 4) * 200);
      }
    }

    return {
      hasBlast: true,
      blastIndices: Array.from(blastSet),
      gemBlastIndices: Array.from(gemBlastSet),
      wallRevealIndices: Array.from(wallSet),
      totalGroups: totalGroups,
      clearedCount: clearedCount,
      label: label,
      scoreValue: scoreValue
    };
  }

  function applyBlast(board, result) {
    result.blastIndices.forEach(function (index) {
      board[index] = null;
    });
  }

  function applyGravityWithRefill(board, size) {
    var moved = [];
    var next = createEmptyBoard(size);

    for (var x = 0; x < size; x++) {
      var existing = [];

      for (var y = 0; y < size; y++) {
        var index = (y * size) + x;
        if (board[index]) existing.push({ cell: board[index], fromY: y });
      }

      var emptyCount = size - existing.length;

      for (var spawnY = 0; spawnY < emptyCount; spawnY++) {
        var wallChance = state.chainWallChance == null ? getAdaptiveWallChance(board) : state.chainWallChance;
        var spawn = Math.random() < wallChance ? makeWallCell() : makeGemCell();
        next[(spawnY * size) + x] = spawn;
        moved.push({ x: x, fromY: spawnY - emptyCount, toY: spawnY });
      }

      existing.forEach(function (item, i) {
        var toY = emptyCount + i;
        next[(toY * size) + x] = item.cell;
        if (item.fromY !== toY) moved.push({ x: x, fromY: item.fromY, toY: toY });
      });
    }

    for (var n = 0; n < board.length; n++) board[n] = next[n];
    return moved;
  }

  function readHighScore() {
    try { return Number(localStorage.getItem(CONFIG.storageKey) || 0) || 0; }
    catch (e) { return 0; }
  }

  function writeHighScore(score) {
    try { localStorage.setItem(CONFIG.storageKey, String(score)); }
    catch (e) {}
  }

  function createState() {
    var board = createOpeningBoard();
    return {
      score: 0,
      displayScore: 0,
      highScore: readHighScore(),
      boardSize: CONFIG.boardSize,
      board: board,
      hand: generateHand(board, CONFIG.boardSize),
      animMap: null,
      blastIndices: [],
      resolving: false,
      comboStep: 0,
      moveCount: 0,
      message: '',
      chainScore: 0,
      chainMessage: '',
      pendingWallPenalty: false,
      chainWallChance: null,
    };
  }

  var state = createState();
  var rootEl = null;
  var drag = null;
  var boardMetrics = null;
  var rafMove = 0;
  var latestPointer = null;

  function syncRealViewportHeight() {
    var vh = (window.visualViewport ? window.visualViewport.height : window.innerHeight) * 0.01;
    document.documentElement.style.setProperty('--bm-real-vh', vh + 'px');
  }

  function syncUiScale() {
    syncRealViewportHeight();
    var stage = document.querySelector('.bm-stage');
    var rect = stage ? stage.getBoundingClientRect() : null;
    var usableW = rect ? rect.width : window.innerWidth;
    var usableH = rect ? rect.height : window.innerHeight;
    var scale = Math.min(usableW / CONFIG.baseWidth, usableH / CONFIG.baseHeight, 1.22);
    document.documentElement.style.setProperty('--bm-ui-scale', String(scale.toFixed(4)));
  }

  function getScale() {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bm-ui-scale') || '1') || 1;
  }

  function getPieceMetrics(piece) {
    var scale = getScale();
    var cellSize = CONFIG.handTileSize * scale;
    var gap = CONFIG.handTileGap * scale;
    return {
      cellSize: cellSize,
      gap: gap,
      step: cellSize + gap,
      width: (piece.width * cellSize) + ((piece.width - 1) * gap),
      height: (piece.height * cellSize) + ((piece.height - 1) * gap)
    };
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderPiece(piece) {
    if (!piece) return '';

    var m = getPieceMetrics(piece);
    var cells = piece.cells.map(function (cell) {
      var left = Math.round(cell.x * m.step);
      var top = Math.round(cell.y * m.step);
      return '<div class="bm-mini bm-mini--gem" style="left:' + left + 'px;top:' + top + 'px;">' +
        '<img class="bm-mini__gem-icon" src="' + TILE_PATH + escapeHtml(cell.gemType) + '.svg" alt="" />' +
      '</div>';
    }).join('');

    return '<div class="bm-piece" data-piece>' +
      '<div class="bm-piece__shape" style="width:' + Math.round(m.width) + 'px;height:' + Math.round(m.height) + 'px;">' + cells + '</div>' +
    '</div>';
  }

  function animStyleFor(index, animMap) {
    var anim = animMap && animMap[index];
    if (!anim) return { className: '', style: '' };

    if (anim.type === 'place-pop') return { className: ' bm-place-pop', style: '' };
    if (anim.type === 'blast-pop') return { className: ' bm-blast-pop', style: '' };
    if (anim.type === 'drop-land') {
      return {
        className: ' bm-drop-land',
        style: ' style="--bm-drop-distance:' + Math.round(anim.distance) + 'px;--bm-drop-duration:' + (anim.duration || CONFIG.gravityMs) + 'ms;"'
      };
    }

    return { className: '', style: '' };
  }

  function renderBoard() {
    return state.board.map(function (cell, index) {
      var blasting = state.blastIndices.indexOf(index) !== -1;
      var cellClass = 'bm-cell' + (blasting ? ' bm-cell--blasting' : '');
      var anim = animStyleFor(index, state.animMap);
      var extraClass = anim.className + (blasting ? ' bm-blast-pop' : '');

      if (!cell) {
        return '<div class="' + cellClass + '" data-cell-index="' + index + '"></div>';
      }

      if (isWallCell(cell)) {
        return '<div class="' + cellClass + ' bm-cell--wall" data-cell-index="' + index + '">' +
        '<div class="bm-neutral-block bm-neutral-block--svg' + extraClass + '"' + anim.style + '>' +
          '<img class="bm-neutral-block__img" src="' + TILE_PATH + escapeHtml(cell.wallType) + '.svg" alt="" />' +
        '</div>' +
      '</div>';
      }

      return '<div class="' + cellClass + '" data-cell-index="' + index + '">' +
        '<div class="bm-gem-tile' + extraClass + '"' + anim.style + '>' +
          '<img class="bm-gem-tile__icon" src="' + TILE_PATH + escapeHtml(cell.gemType) + '.svg" alt="" />' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderApp() {
    syncUiScale();

    rootEl.innerHTML = '' +
      '<section class="bm-screen bm-game" data-game>' +
        '<div class="bm-hud">' +
          '<div class="bm-hud-stat bm-hud-stat--score">' +
            '<img src="images/hud/crown.svg" class="bm-hud-icon" alt="" />' +
            '<span class="bm-hud-value">' + state.highScore + '</span>' +
          '</div>' +
          '<button class="bm-settings-btn" type="button" aria-label="Reset" data-reset-game>' +
            '<img src="images/hud/settings.svg" class="bm-hud-icon bm-hud-icon--settings" alt="" />' +
          '</button>' +
        '</div>' +
        '<div class="bm-spacer" aria-hidden="true"></div>' +
        '<div class="bm-score">' +
          '<div class="bm-score__burst" data-score-burst></div>' +
          '<div class="bm-score__value" data-score-value>' + state.displayScore + '</div>' +
        '</div>' +
        '<div class="bm-spacer" aria-hidden="true"></div>' +
        '<div class="bm-board-wrap">' +
          '<div class="bm-board" data-board>' + renderBoard() + '</div>' +
        '</div>' +
        '<div class="bm-spacer" aria-hidden="true"></div>' +
        '<div class="bm-hand">' + state.hand.map(function (piece, index) {
          return '<div class="bm-hand-slot" data-hand-slot-index="' + index + '">' + renderPiece(piece) + '</div>';
        }).join('') + '</div>' +
      '</section>';

      if (state.message) {
        showBoardMessage(state.message, 'combo');
        state.message = '';
      }

    bindGame();
    state.animMap = null;
  }

  function bindGame() {
    var resetBtn = rootEl.querySelector('[data-reset-game]');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        state = createState();
        playSfx('start');
        renderApp();
      });
    }

    rootEl.querySelectorAll('[data-hand-slot-index]').forEach(function (slot) {
      var index = Number(slot.getAttribute('data-hand-slot-index'));
      var piece = state.hand[index];
      if (!piece) return;

      slot.addEventListener('pointerdown', function (e) {
        startDrag(e, index, piece, slot);
      });
    });
  }

  function cacheBoardMetrics() {
    var board = rootEl.querySelector('[data-board]');
    if (!board) return null;

    var rect = board.getBoundingClientRect();
    var cell = board.querySelector('.bm-cell');
    var cellRect = cell ? cell.getBoundingClientRect() : null;
    var styles = getComputedStyle(board);
    var gap = parseFloat(styles.gap) || 0;
    var padding = parseFloat(styles.paddingLeft) || 0;
    var cellSize = cellRect ? cellRect.width : (rect.width - (padding * 2) - ((CONFIG.boardSize - 1) * gap)) / CONFIG.boardSize;

    boardMetrics = {
      left: rect.left,
      top: rect.top,
      padding: padding,
      gap: gap,
      cellSize: cellSize,
      step: cellSize + gap
    };

    return boardMetrics;
  }

  function getAnchorFromPointer(piece, x, y) {
    var bm = boardMetrics || cacheBoardMetrics();
    if (!bm) return null;
  
    var originX = x - bm.left - bm.padding;
    var originY = y - bm.top - bm.padding;
  
    var pieceW = (piece.width * bm.cellSize) + ((piece.width - 1) * bm.gap);
    var pieceH = (piece.height * bm.cellSize) + ((piece.height - 1) * bm.gap);
  
    var topLeftX = originX - (pieceW / 2);
    var topLeftY = originY - (pieceH / 2);
  
    var anchorX = Math.round(topLeftX / bm.step);
    var anchorY = Math.round(topLeftY / bm.step);
  
    var placed = getPlacementCells(state.board, state.boardSize, piece, anchorX, anchorY);
    if (!placed) return null;
  
    return { x: anchorX, y: anchorY, placed: placed };
  }

  function startDrag(e, slotIndex, piece, slot) {
    if (state.resolving || drag) return;

    e.preventDefault();
    unlockSfx();
    playSfx('pickup');

    cacheBoardMetrics();

    var board = rootEl.querySelector('[data-board]');
if (board) board.classList.add('is-dragging');

    var pieceEl = slot.querySelector('[data-piece]');
    if (pieceEl) pieceEl.classList.add('is-held');

    var ghost = document.createElement('div');
    ghost.className = 'bm-drag-ghost';
    ghost.innerHTML = renderPiece(piece);
    document.body.appendChild(ghost);

    drag = {
      slotIndex: slotIndex,
      piece: piece,
      slot: slot,
      ghost: ghost,
      lastAnchorKey: '',
      liftY: 100 * getScale(),
      active: true
    };

    latestPointer = { x: e.clientX, y: e.clientY };
    updateDragNow();

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', endDrag, { once: true });
    window.addEventListener('pointercancel', cancelDrag, { once: true });
  }

  function onPointerMove(e) {
    if (!drag) return;
    e.preventDefault();
    latestPointer = { x: e.clientX, y: e.clientY };

    if (!rafMove) {
      rafMove = window.requestAnimationFrame(function () {
        rafMove = 0;
        updateDragNow();
      });
    }
  }

  function updateDragNow() {
    if (!drag || !latestPointer) return;

    var x = latestPointer.x;
    var y = latestPointer.y - drag.liftY;
    
    drag.ghost.style.transform =
      'translate3d(' + Math.round(x) + 'px,' + Math.round(y) + 'px,0) translate(-50%,-50%)';
    
    var anchor = getAnchorFromPointer(drag.piece, x, y);
    drag.anchor = anchor;
    drag.ghost.classList.toggle('is-snapped-to-board', !!anchor);

    var key = anchor
    ? anchor.placed.map(function (cell) { return cell.index + ':' + cell.gemType; }).join('|')
    : '';
    if (!boardMetrics) return;
    if (key === drag.lastAnchorKey) return;

    drag.lastAnchorKey = key;
    renderPreview(anchor);
  }

  function clearPreview() {
    var board = rootEl.querySelector('[data-board]');
    if (!board) return;
  
    board.querySelectorAll('.bm-preview-tile').forEach(function (node) {
      node.remove();
    });
  
    board.querySelectorAll('.bm-hover-valid').forEach(function (node) {
      node.classList.remove('bm-hover-valid');
    });
  }

  function renderPreview(anchor) {
    clearPreview();
    if (!anchor) return;

    anchor.placed.forEach(function (cell) {
      var cellEl = rootEl.querySelector('[data-cell-index="' + cell.index + '"]');
      if (!cellEl) return;

      cellEl.classList.add('bm-hover-valid');
      var preview = document.createElement('div');
      preview.className = 'bm-gem-tile bm-preview-tile';
      preview.innerHTML = '<img class="bm-gem-tile__icon" src="' + TILE_PATH + escapeHtml(cell.gemType) + '.svg" alt="" />';
      cellEl.appendChild(preview);
    });
  }

  function cancelDrag() {
    cleanupDrag(false);
  }

  function endDrag(e) {
    if (!drag) return;
    if (e) e.preventDefault();

    var anchor = drag.anchor;
    var slotIndex = drag.slotIndex;
    var piece = drag.piece;

    cleanupDrag(false);

    if (!anchor || state.resolving) return;

    commitPlacement(piece, slotIndex, anchor.placed);
  }

  function cleanupDrag(keepPreview) {
    window.removeEventListener('pointermove', onPointerMove);
    if (rafMove) {
      window.cancelAnimationFrame(rafMove);
      rafMove = 0;
    }

    if (drag) {
      if (drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
      var pieceEl = drag.slot && drag.slot.querySelector('[data-piece]');
      if (pieceEl) pieceEl.classList.remove('is-held');
    }

    var board = rootEl.querySelector('[data-board]');
if (board) board.classList.remove('is-dragging');

    drag = null;
    latestPointer = null;
    if (!keepPreview) clearPreview();
  }

  function buildPlacementAnimMap(placedIndices) {
    var map = {};
    placedIndices.forEach(function (index) {
      map[index] = { type: 'place-pop' };
    });
    return map;
  }

  function buildDropAnimMap(moved) {
    var bm = boardMetrics || cacheBoardMetrics();
    var step = bm ? bm.step : 48;
    var map = {};

    moved.forEach(function (move) {
      var toIndex = (move.toY * state.boardSize) + move.x;
      map[toIndex] = {
        type: 'drop-land',
        distance: move.fromY < 0
        ? (move.toY + state.boardSize) * step
        : (move.toY - move.fromY) * step,
        duration: CONFIG.gravityMs
      };
    });

    return map;
  }

  function commitPlacement(piece, slotIndex, placedCells) {
    state.resolving = true;
    playSfx('place');

    placedCells.forEach(function (cell) {
      state.board[cell.index] = makeGemCell(cell.gemType);
    });

    state.hand[slotIndex] = null;
    state.moveCount++;

    state.animMap = buildPlacementAnimMap(placedCells.map(function (cell) { return cell.index; }));
    renderApp();

    window.setTimeout(function () {
      state.animMap = null;
    
      var previewBlast = classifyBlastPhase(state.board, state.boardSize, 1);
    
      state.pendingWallPenalty = !previewBlast.hasBlast || previewBlast.totalGroups <= 1;
      state.chainWallChance = getAdaptiveWallChance(state.board);
      runBlastChain(1);
    }, CONFIG.placeResolveDelayMs);
  }

  function runBlastChain(comboStep) {
    var result = classifyBlastPhase(state.board, state.boardSize, comboStep);

    if (!result.hasBlast) {
      finishResolve();
      return;
    }

    state.comboStep = comboStep;
    state.blastIndices = result.blastIndices.slice();
    if (result.label) state.chainMessage = result.label;
    state.chainScore += result.scoreValue;

    spawnBlastConfetti(result);
    playSfx(comboStep >= 2 ? 'combo' : 'blast');

    renderApp();

    window.setTimeout(function () {
      applyBlast(state.board, result);
      state.blastIndices = [];
      state.message = '';
      state.animMap = null;
      renderApp();

      window.setTimeout(function () {
        var moved = applyGravityWithRefill(state.board, state.boardSize);
        state.animMap = buildDropAnimMap(moved);
        renderApp();

        window.setTimeout(function () {
          state.animMap = null;
          renderApp();

          window.setTimeout(function () {
            runBlastChain(comboStep + 1);
          }, CONFIG.chainDelayMs);
        }, CONFIG.gravityMs + 30);
      }, CONFIG.blastBreathMs);
    }, 250);
  }

  function finishResolve() {
    if (state.chainScore > 0) {
      addScore(state.chainScore);
  
      if (state.chainMessage) {
        state.message = state.chainMessage;
      }
    }
  
    var shouldSpawnWall = !state.chainMessage;
  
    // reset BEFORE wall logic so next turn is clean
    state.chainScore = 0;
    state.chainMessage = '';
  
    if (shouldSpawnWall) {
      var wallIndex = turnRandomGemIntoWall();
  
      if (wallIndex != null) {
        state.animMap = {};
        state.animMap[wallIndex] = { type: 'place-pop' };
        renderApp();
  
        window.setTimeout(function () {
          state.animMap = null;
          finishResolveFinal();
        }, 160);
  
        return;
      }
    }
  
    finishResolveFinal();
  }

  function finishResolveFinal() {
    state.chainWallChance = null;
    state.comboStep = 0;
    state.resolving = false;
  
    if (state.hand.every(function (piece) { return !piece; })) {
      state.hand = generateHand(state.board, state.boardSize);
    } else if (!hasAnyPlayableHand()) {
      state.hand = generateHand(state.board, state.boardSize);
    }
  
    renderApp();
  }

  function hasAnyPlayableHand() {
    return state.hand.some(function (piece) {
      return piece && hasLegalPlacement(state.board, state.boardSize, piece);
    });
  }

  function addScore(points) {
    var from = state.displayScore || 0;
    var to = state.score + points;
  
    state.score = to;
  
    if (state.score > state.highScore) {
      state.highScore = state.score;
      writeHighScore(state.highScore);
    }
  
    animateScore(from, to, 420);
  }

  function animateScore(from, to, duration) {
    var start = performance.now();
  
    function tick(now) {
      var t = Math.min((now - start) / duration, 1);
      var eased = 1 - Math.pow(1 - t, 3);
  
      state.displayScore = Math.round(from + ((to - from) * eased));
  
      var scoreEl = rootEl && rootEl.querySelector('[data-score-value]');
      if (scoreEl) {
        scoreEl.textContent = state.displayScore;
        scoreEl.classList.add('is-score-counting');
      }
  
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        state.displayScore = to;
        if (scoreEl) {
          scoreEl.textContent = to;
          scoreEl.classList.remove('is-score-counting');
          scoreEl.classList.add('is-score-hit');
          setTimeout(function () {
            scoreEl.classList.remove('is-score-hit');
          }, 220);
        }
      }
    }
  
    requestAnimationFrame(tick);
  }

  function getCellCenter(index) {
    var cell = rootEl.querySelector('[data-cell-index="' + index + '"]');
    if (!cell) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    var rect = cell.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, size: rect.width };
  }

  function spawnBlastConfetti(result) {
    var layer = document.createElement('div');
    layer.className = 'bm-confetti-layer';
    document.body.appendChild(layer);

    result.blastIndices.forEach(function (index) {
      var cell = state.board[index];
      var center = getCellCenter(index);
      var isWall = isWallCell(cell);
      var count = isWall ? 7 : 9;

      for (var i = 0; i < count; i++) {
        var frag = document.createElement(isWall ? 'div' : 'img');
        var angle = (Math.PI * 2 * i / count) + (Math.random() * 0.7);
        var dist = center.size * (1.0 + Math.random() * 1.3);
        var lift = center.size * (0.45 + Math.random() * 0.75);
        var dx = Math.cos(angle) * dist;
        var dy = Math.sin(angle) * dist + (center.size * 1.2);

        frag.className = isWall ? 'bm-blast-debris bm-blast-debris--brick' : 'bm-blast-confetti-gem';
        frag.style.left = center.x + 'px';
        frag.style.top = center.y + 'px';
        frag.style.width = (center.size * (isWall ? 0.20 : 0.28)) + 'px';
        frag.style.height = (center.size * (isWall ? 0.16 : 0.28)) + 'px';
        frag.style.setProperty('--bm-frag-dx', dx.toFixed(1) + 'px');
        frag.style.setProperty('--bm-frag-dy', dy.toFixed(1) + 'px');
        frag.style.setProperty('--bm-frag-lift', lift.toFixed(1) + 'px');
        frag.style.setProperty('--bm-frag-rot', (Math.floor(Math.random() * 540) - 270) + 'deg');
        frag.style.setProperty('--bm-frag-delay', Math.floor(Math.random() * 45) + 'ms');
        frag.style.setProperty('--bm-frag-duration', (isWall ? 760 : 620) + 'ms');

        if (!isWall) {
          frag.src = TILE_PATH + (cell && cell.gemType ? cell.gemType : randomGemType()) + '.svg';
          frag.alt = '';
        }

        layer.appendChild(frag);
      }
    });

    window.setTimeout(function () {
      if (layer.parentNode) layer.parentNode.removeChild(layer);
    }, 900);
  }

  function showBoardMessage(text, style) {
    if (!text) return;
  
    var old = document.body.querySelector('.bm-board-message');
    if (old) old.remove();
  
    var board = rootEl.querySelector('[data-board]');
    var rect = board ? board.getBoundingClientRect() : null;
    var x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    var y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
  
    var parts = String(text).split(' ');
    var topText = parts[0] || '';
    var bottomText = parts.slice(1).join(' ') || '';
  
    var msg = document.createElement('div');
    msg.className = 'bm-board-message';
    msg.style.left = x + 'px';
    msg.style.top = y + 'px';
  
    var inner = document.createElement('div');
    inner.className = 'bm-board-message__inner';
  
    inner.innerHTML =
      '<svg class="bm-board-message__svg" viewBox="0 0 420 170" aria-hidden="true">' +
        '<defs>' +
          '<linearGradient id="bmMsgTopGrad" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#FBE821"/>' +
            '<stop offset="100%" stop-color="#F7AF04"/>' +
          '</linearGradient>' +
          '<linearGradient id="bmMsgBottomGrad" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#FFFFFF"/>' +
            '<stop offset="100%" stop-color="#FFF7A2"/>' +
          '</linearGradient>' +
        '</defs>' +
        '<text class="bm-board-message__text bm-board-message__text--top" x="210" y="72" text-anchor="middle">' + escapeHtml(topText) + '</text>' +
        '<text class="bm-board-message__text bm-board-message__text--bottom" x="210" y="132" text-anchor="middle">' +
          '<tspan class="bm-board-message__bottom-italic">' + escapeHtml(bottomText) + '</tspan>' +
        '</text>' +
      '</svg>';
  
    msg.appendChild(inner);
    document.body.appendChild(msg);
  
    window.setTimeout(function () {
      if (msg.parentNode) msg.parentNode.removeChild(msg);
    }, 2000);
  }

  function boot() {
    rootEl = document.getElementById('app');
    if (!rootEl) return;

    if (!rootEl.querySelector('.bm-stage')) {
      rootEl.innerHTML = '<main class="bm-stage"></main>';
      rootEl = rootEl.querySelector('.bm-stage');
    } else {
      rootEl = rootEl.querySelector('.bm-stage');
    }

    syncUiScale();
    renderApp();
    window.addEventListener('resize', function () {
      syncUiScale();
      boardMetrics = null;
    });

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', function () {
        syncUiScale();
        boardMetrics = null;
      });
    }

    document.addEventListener('pointerdown', unlockSfx, { once: true });
    window.BM_DEBUG = {
      reset: function () { state = createState(); renderApp(); },
      getState: function () { return state; },
      blast: function () { state.resolving = true; runBlastChain(1); }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
