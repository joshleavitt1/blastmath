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
    gravityMs: 460,
    blastBreathMs: 70,
    chainDelayMs: 55,
    placeResolveDelayMs: 35,
    firstAssistMoves: 10,
    primeCellCount: 3,
    earlyAssistBoost: 0.55,
    primePlacementBoost: 0.34,
    primeAdjacentBoost: 0.18,
    boostDecayPerMove: 0.08,
    openingWallChance: 0.34,

    earlyComboMoves: 12,
    earlyComboRefillBoost: 0.88,
    earlyComboWallReduction: 0.38,

    hugeComboTarget: 8,
    hugeComboEveryMoves: 8,
    hugeComboChargeStart: 5,
    hugeComboRefillBoost: 0.94,
    hugeComboWallReduction: 0.46
  };

  var GEM_TYPES = ['star', 'diamond', 'pent'];
  var HAND_GEM_TYPES = ['diamond', 'pent', 'star', 'hex'];
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

  function isBombGem(cell) {
    return isGemCell(cell) && cell.gemType === 'hex';
  }

  function makeWallCell(type) {
    return {
      kind: 'wall',
      wallType: type || 'brick'
    };
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

  function wouldCreateOpeningMatch(board, size, index, gemType) {
    var x = index % size;
    var y = Math.floor(index / size);

    function typeAt(xx, yy) {
      if (xx < 0 || xx >= size || yy < 0 || yy >= size) return null;

      var cell = board[(yy * size) + xx];

      return isGemCell(cell) ? cell.gemType : null;
    }

    var horizontal =
      (typeAt(x - 2, y) === gemType && typeAt(x - 1, y) === gemType) ||
      (typeAt(x - 1, y) === gemType && typeAt(x + 1, y) === gemType) ||
      (typeAt(x + 1, y) === gemType && typeAt(x + 2, y) === gemType);

    var vertical =
      (typeAt(x, y - 2) === gemType && typeAt(x, y - 1) === gemType) ||
      (typeAt(x, y - 1) === gemType && typeAt(x, y + 1) === gemType) ||
      (typeAt(x, y + 1) === gemType && typeAt(x, y + 2) === gemType);

    return horizontal || vertical;
  }

  function createOpeningBoard() {
    var size = CONFIG.boardSize;
    var board = createEmptyBoard(size);

    for (var i = 0; i < board.length; i++) {
      if (Math.random() < CONFIG.openingWallChance) {
        board[i] = makeWallCell();
        continue;
      }

      var options = GEM_TYPES.slice();

      for (var tries = 0; tries < 8; tries++) {
        var type = options[Math.floor(Math.random() * options.length)];

        if (!wouldCreateOpeningMatch(board, size, i, type)) {
          board[i] = makeGemCell(type);
          break;
        }
      }

      if (!board[i]) {
        board[i] = makeGemCell(GEM_TYPES[Math.floor(Math.random() * GEM_TYPES.length)]);
      }
    }

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

  function makeSingleGemPiece(gemType, slotIndex) {
    return {
      id: 'single-' + gemType + '-' + slotIndex + '-' + Date.now(),
      shapeId: 'single',
      rank: 1,
      width: 1,
      height: 1,
      cells: [{ x: 0, y: 0, kind: 'gem', gemType: gemType }]
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

      // Normal hand tiles can only replace gems.
      // Hex bomb can be placed over ANY board tile (gem or wall).
      if (source.gemType !== 'hex' && !isGemCell(board[index])) return null;
      if (source.gemType === 'hex' && !board[index]) return null;

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
    return HAND_GEM_TYPES.map(function (gemType, index) {
      var piece = makeSingleGemPiece(gemType, index);
      return hasLegalPlacement(board, size, piece) ? piece : null;
    });
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

  function getSquareBlastIndices(centerIndex, size) {
    var cx = centerIndex % size;
    var cy = Math.floor(centerIndex / size);
    var out = [];

    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        var x = cx + dx;
        var y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) {
          out.push((y * size) + x);
        }
      }
    }

    return out;
  }


  function isAdjacentIndex(a, b, size) {
    var ax = a % size;
    var ay = Math.floor(a / size);
    var bx = b % size;
    var by = Math.floor(b / size);

    return Math.abs(ax - bx) + Math.abs(ay - by) === 1;
  }

  function scorePlacementOpportunity(board, size, index, gemType) {
    if (!isGemCell(board[index]) && gemType !== 'hex') return -999;

    var test = board.slice();
    test[index] = makeGemCell(gemType);

    var result = classifyBlastPhase(test, size, 1);
    var score = 0;

    if (result.hasBlast) score += 100;
    if (result.totalGroups >= 2) score += 80;

    getNeighborIndices(index, size).forEach(function (neighbor) {
      var cell = board[neighbor];

      if (isGemCell(cell) && cell.gemType === gemType) score += 18;
      if (isWallCell(cell)) score += 10;
    });

    if (gemType === 'hex') score += 35;

    return score + Math.random() * 12;
  }

  function chooseAssistTarget(board, hand, size) {
    var best = null;

    hand.forEach(function (piece, slotIndex) {
      if (!piece) return;

      var gemType = piece.cells[0].gemType;

      for (var i = 0; i < board.length; i++) {
        var placed = getPlacementCells(board, size, piece, i % size, Math.floor(i / size));
        if (!placed) continue;

        var score = scorePlacementOpportunity(board, size, placed[0].index, gemType);

        if (!best || score > best.score) {
          best = {
            index: placed[0].index,
            gemType: gemType,
            slotIndex: slotIndex,
            score: score
          };
        }
      }
    });

    return best;
  }

  function choosePrimeCells(board, hand, size) {
    var candidates = [];

    hand.forEach(function (piece, slotIndex) {
      if (!piece) return;

      var gemType = piece.cells[0].gemType;

      for (var i = 0; i < board.length; i++) {
        var placed = getPlacementCells(board, size, piece, i % size, Math.floor(i / size));
        if (!placed) continue;

        candidates.push({
          index: placed[0].index,
          gemType: gemType,
          slotIndex: slotIndex,
          score: scorePlacementOpportunity(board, size, placed[0].index, gemType)
        });
      }
    });

    candidates.sort(function (a, b) {
      return b.score - a.score;
    });

    var picked = [];
    var used = new Set();

    candidates.forEach(function (candidate) {
      if (picked.length >= CONFIG.primeCellCount) return;
      if (used.has(candidate.index)) return;

      used.add(candidate.index);
      picked.push(candidate);
    });

    return picked;
  }

  function updateAssistSystem() {
    if (!state || state.resolving) return;

    var assist = chooseAssistTarget(state.board, state.hand, state.boardSize);
    var primes = choosePrimeCells(state.board, state.hand, state.boardSize);

    if (state.moveCount < CONFIG.firstAssistMoves && assist) {
      state.assistTargetIndex = assist.index;
      state.assistGemType = assist.gemType;
      state.assistSlotIndex = assist.slotIndex;
      state.primeCells = [];
    } else {
      state.assistTargetIndex = null;
      state.assistGemType = null;
      state.assistSlotIndex = null;
      state.primeCells = primes;
    }
  }

  function getPlacementBoost(placedCells) {
    var boost = 0;

    placedCells.forEach(function (cell) {
      if (state.assistTargetIndex === cell.index) {
        boost += CONFIG.earlyAssistBoost;
      }

      (state.primeCells || []).forEach(function (prime) {
        if (prime.index === cell.index) {
          boost += CONFIG.primePlacementBoost;
        } else if (isAdjacentIndex(prime.index, cell.index, state.boardSize)) {
          boost += CONFIG.primeAdjacentBoost;
        }
      });
    });

    return Math.min(0.75, boost);
  }

  function buildChainReactionIndices(result) {
    var size = state.boardSize;
    var start = result.gemBlastIndices && result.gemBlastIndices.length
      ? result.gemBlastIndices
      : result.blastIndices;
  
    var visited = new Set();
    var queue = start.map(function (index) {
      return { index: index, depth: 0 };
    });
  
    var out = [];
  
    while (queue.length) {
      var item = queue.shift();
      if (visited.has(item.index)) continue;
  
      visited.add(item.index);
  
      if (state.board[item.index]) {
        out.push({
          index: item.index,
          depth: item.depth
        });
      }
  
      getNeighborIndices(item.index, size).forEach(function (neighbor) {
        if (!visited.has(neighbor) && state.board[neighbor] && item.depth < 3) {
          queue.push({
            index: neighbor,
            depth: item.depth + 1
          });
        }
      });
    }
  
    return out;
  }
  
  function triggerChainReaction(result, comboStep, isFinalBlast) {
    // Chain flash/pulse/spark animation removed entirely.
    // Blasts still resolve, score, confetti, and gravity still run normally.
    return 0;
  }
  
  function spawnChainSpark(index) {
    var layer = document.body.querySelector('.bm-chain-spark-layer');
  
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'bm-chain-spark-layer';
      document.body.appendChild(layer);
    }
  
    var center = getCellCenter(index);
    var spark = document.createElement('div');
  
    spark.className = 'bm-chain-spark';
    spark.style.left = center.x + 'px';
    spark.style.top = center.y + 'px';
    spark.style.setProperty('--bm-chain-spark-size', Math.max(5, center.size * 0.13) + 'px');
  
    layer.appendChild(spark);
  
    window.setTimeout(function () {
      if (spark.parentNode) spark.parentNode.removeChild(spark);
  
      if (!layer.querySelector('.bm-chain-spark') && layer.parentNode) {
        layer.parentNode.removeChild(layer);
      }
    }, 760);
  }

  function classifyBlastPhase(board, size, comboStep) {
    var groups = findBlastGroups(board, size);
    var blastSet = new Set();
    var gemBlastSet = new Set();
    var wallSet = new Set();
    var bombSet = new Set();
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

    if (state.pendingBombIndices && state.pendingBombIndices.length) {
      state.pendingBombIndices.forEach(function (bombIndex) {
        getSquareBlastIndices(bombIndex, size).forEach(function (targetIndex) {
          if (board[targetIndex]) {
            blastSet.add(targetIndex);
            if (isGemCell(board[targetIndex])) gemBlastSet.add(targetIndex);
            if (isWallCell(board[targetIndex])) wallSet.add(targetIndex);
          }
        });
        bombSet.add(bombIndex);
      });
    }

    if (!blastSet.size) {
      return { hasBlast: false, blastIndices: [], gemBlastIndices: [], wallRevealIndices: [], bombIndices: [] };
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
      bombIndices: Array.from(bombSet),
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
        var boost = state.placementBoost || 0;

        if (state.moveCount <= CONFIG.earlyComboMoves) {
          boost = Math.max(boost, CONFIG.earlyComboRefillBoost);
          wallChance = Math.max(0, wallChance - CONFIG.earlyComboWallReduction);
        }

        if ((state.turnsSinceHugeCombo || 0) >= CONFIG.hugeComboChargeStart) {
          boost = Math.max(boost, CONFIG.hugeComboRefillBoost);
          wallChance = Math.max(0, wallChance - CONFIG.hugeComboWallReduction);
        }

        if (boost > 0) {
          wallChance = Math.max(0, wallChance - (boost * 0.28));
        }

        var nearTypes = getNearMatchGemTypes(board, size);
        var shouldSpawnWall = Math.random() < wallChance;
        var spawn;

        if (shouldSpawnWall) {
          spawn = makeWallCell();
        } else if (boost > 0 && nearTypes.length && Math.random() < boost) {
          spawn = makeGemCell(nearTypes[Math.floor(Math.random() * nearTypes.length)]);
        } else {
          spawn = makeGemCell();
        }

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
      chainBlastCount: 0,
      maxChainBlastCount: 0,
      pendingWallPenalty: false,
      chainWallChance: null,
      pendingBombIndices: [],
      assistTargetIndex: null,
      assistGemType: null,
      assistSlotIndex: null,
      primeCells: [],
      placementBoost: 0,
      turnsSinceHugeCombo: 0
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
    var bm = boardMetrics || cacheBoardMetrics();
  
    if (!bm) {
      return {
        cellSize: 48,
        gap: 4,
        step: 52,
        width: 48,
        height: 48
      };
    }
  
    var cellSize = bm.cellSize;
    var gap = bm.gap;
  
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
  
    var cells = piece.cells.map(function (cell) {
      var left = 'calc(' + cell.x + ' * (var(--bm-board-tile-size) + var(--bm-cell-gap)))';
      var top = 'calc(' + cell.y + ' * (var(--bm-board-tile-size) + var(--bm-cell-gap)))';
  
      return '<div class="bm-mini bm-mini--gem" style="left:' + left + ';top:' + top + ';">' +
        '<img class="bm-mini__gem-icon" src="' + TILE_PATH + escapeHtml(cell.gemType) + '.svg" alt="" />' +
      '</div>';
    }).join('');
  
    var shapeW = 'calc((' + piece.width + ' * var(--bm-board-tile-size)) + (' + (piece.width - 1) + ' * var(--bm-cell-gap)))';
    var shapeH = 'calc((' + piece.height + ' * var(--bm-board-tile-size)) + (' + (piece.height - 1) + ' * var(--bm-cell-gap)))';
  
    return '<div class="bm-piece" data-piece>' +
      '<div class="bm-piece__shape" style="width:' + shapeW + ';height:' + shapeH + ';">' + cells + '</div>' +
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
      var isAssistTarget = state.assistTargetIndex === index;
      var isPrimeTarget = (state.primeCells || []).some(function (prime) {
        return prime.index === index;
      });

      var cellClass = 'bm-cell' +
        (blasting ? ' bm-cell--blasting' : '') +
        (isAssistTarget ? ' bm-cell--assist-target' : '') +
        (isPrimeTarget ? ' bm-cell--prime-target' : '');
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
    updateAssistSystem();
  
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
          var slotClass = 'bm-hand-slot' + (state.assistSlotIndex === index ? ' bm-hand-slot--assist' : '');

          return '<div class="' + slotClass + '" data-hand-slot-index="' + index + '">' + renderPiece(piece) + '</div>';
        }).join('') + '</div>' +
      '</section>';
  
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

    var gameEl = rootEl.querySelector('[data-game]');
    var gameStyles = gameEl ? getComputedStyle(gameEl) : null;

    if (gameStyles) {
      ghost.style.setProperty('--bm-board-tile-size', gameStyles.getPropertyValue('--bm-board-tile-size'));
      ghost.style.setProperty('--bm-cell-gap', gameStyles.getPropertyValue('--bm-cell-gap'));
    }
    
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

    var anchor = getAnchorFromPointer(drag.piece, x, y);

    var ghostX = x;
    var ghostY = y;

    if (anchor && boardMetrics) {
      var pieceW = (drag.piece.width * boardMetrics.cellSize) + ((drag.piece.width - 1) * boardMetrics.gap);
      var pieceH = (drag.piece.height * boardMetrics.cellSize) + ((drag.piece.height - 1) * boardMetrics.gap);

      ghostX = boardMetrics.left + boardMetrics.padding + (anchor.x * boardMetrics.step) + (pieceW / 2);
      ghostY = boardMetrics.top + boardMetrics.padding + (anchor.y * boardMetrics.step) + (pieceH / 2);
    }

    drag.ghost.style.transform =
      'translate3d(' + Math.round(ghostX) + 'px,' + Math.round(ghostY) + 'px,0) translate(-50%,-50%)';
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

    board.querySelectorAll('.bm-hover-bomb-zone').forEach(function (node) {
      node.classList.remove('bm-hover-bomb-zone');
    });
  }

  function renderPreview(anchor) {
    clearPreview();
    if (!anchor) return;

    anchor.placed.forEach(function (cell) {
      var cellEl = rootEl.querySelector('[data-cell-index="' + cell.index + '"]');
      if (!cellEl) return;

      cellEl.classList.add('bm-hover-valid');
      if (cell.gemType === 'hex') {
        getSquareBlastIndices(cell.index, state.boardSize).forEach(function (targetIndex) {
          // Keep the placed bomb itself clean/readable.
          // Only the surrounding blast radius gets the red danger hover.
          if (targetIndex === cell.index) return;

          var targetEl = rootEl.querySelector('[data-cell-index="' + targetIndex + '"]');
          if (targetEl) targetEl.classList.add('bm-hover-bomb-zone');
        });
      }
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

    state.pendingBombIndices = placedCells
      .filter(function (cell) { return cell.gemType === 'hex'; })
      .map(function (cell) { return cell.index; });

    state.hand[slotIndex] = null;
    state.moveCount++;
    state.placementBoost = getPlacementBoost(placedCells);

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
    state.pendingBombIndices = [];
    addScore(result.scoreValue);

    state.chainBlastCount = comboStep;
    state.maxChainBlastCount = Math.max(state.maxChainBlastCount || 0, comboStep);

    spawnBlastConfetti(result);
    playSfx(comboStep >= 2 ? 'combo' : 'blast');
    
    var nextBoard = state.board.slice();
    applyBlast(nextBoard, result);
    applyGravityWithRefill(nextBoard, state.boardSize);
    var nextResult = classifyBlastPhase(nextBoard, state.boardSize, comboStep + 1);
    var isFinalBlast = !nextResult.hasBlast;

    renderApp();
    
    var chainReactionMs = triggerChainReaction(result, comboStep, isFinalBlast);
    
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

          window.setTimeout(function () {
            runBlastChain(comboStep + 1);
          }, CONFIG.chainDelayMs);
        }, CONFIG.gravityMs + 35);
      }, CONFIG.blastBreathMs);
    }, comboStep >= 2 ? 210 : 170);
  }

  function finishResolve() {
    var finalChainCount = state.maxChainBlastCount || 0;

    if (finalChainCount >= CONFIG.hugeComboTarget) {
      state.turnsSinceHugeCombo = 0;
    } else {
      state.turnsSinceHugeCombo = (state.turnsSinceHugeCombo || 0) + 1;
    }
  
    if (finalChainCount >= 2) {
      showBoardMessage('BLAST x' + finalChainCount, 'chain');
  
      window.setTimeout(function () {
        continueFinishResolveAfterChainPayoff();
      }, 1360);
  
      return;
    }
  
    continueFinishResolveAfterChainPayoff();
  }
  
  function continueFinishResolveAfterChainPayoff() {
    var shouldSpawnWall = true;
  
    state.chainScore = 0;
    state.chainMessage = '';
    state.chainBlastCount = 0;
    state.maxChainBlastCount = 0;
  
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
    state.pendingBombIndices = [];
    state.comboStep = 0;
    state.resolving = false;
  
    if (state.hand.every(function (piece) { return !piece; })) {
      state.hand = generateHand(state.board, state.boardSize);
    } else if (!hasAnyPlayableHand()) {
      state.hand = generateHand(state.board, state.boardSize);
    }

    state.placementBoost = Math.max(0, (state.placementBoost || 0) - CONFIG.boostDecayPerMove);
  
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
  var scoreAnimFrame = 0;

  function animateScore(from, to, duration) {
    if (scoreAnimFrame) {
      cancelAnimationFrame(scoreAnimFrame);
      scoreAnimFrame = 0;
    }
  
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
        scoreAnimFrame = requestAnimationFrame(tick);
      } else {
        scoreAnimFrame = 0;
        state.displayScore = to;
  
        if (scoreEl) {
          scoreEl.textContent = to;
          scoreEl.classList.remove('is-score-counting');
          scoreEl.classList.add('is-score-hit');
  
          setTimeout(function () {
            scoreEl.classList.remove('is-score-hit');
          }, 180);
        }
      }
    }
  
    scoreAnimFrame = requestAnimationFrame(tick);
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

    for (var i = 0; i < 16; i++) {
      var debris = document.createElement('div');
    
      debris.style.position = 'absolute';
      debris.style.left = '50%';
      debris.style.top = '50%';
    
      debris.style.width = (10 + Math.random() * 14) + 'px';
      debris.style.height = (4 + Math.random() * 8) + 'px';
    
      debris.style.borderRadius = '2px';
    
      debris.style.background =
        Math.random() < 0.5
          ? 'linear-gradient(135deg,#ffcc55,#ff7a00)'
          : 'linear-gradient(135deg,#8b8f98,#d3d7df)';
    
      var dx = (Math.random() - 0.5) * 180;
      var dy = (Math.random() - 0.5) * 120;
    
      debris.animate([
        {
          opacity: 0,
          transform: 'translate(-50%,-50%) scale(.4)'
        },
        {
          opacity: 1,
          transform:
            'translate(calc(-50% + ' + (dx * .5) + 'px), calc(-50% + ' + (dy * .3) + 'px)) scale(1.1)'
        },
        {
          opacity: 0,
          transform:
            'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px)) scale(.9)'
        }
      ], {
        duration: 700 + Math.random() * 220,
        easing: 'cubic-bezier(.16,.84,.24,1)',
        fill: 'forwards'
      });
    
      msg.appendChild(debris);
    }

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
    }, 1680);
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
