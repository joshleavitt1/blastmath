(function () {
  'use strict';

  const CONFIG = {
    baseWidth: 390,
    baseHeight: 844,
    maxStageWidth: 400,
    boardSize: 7,
    gap: 4,
    pad: 4,
    bg: 0x7588CB,
    boardFill: 0x000000,
    cellFill: 0xffffff,
    cellAlpha: 0.20,
    openingWallChance: 0.42,
    gravityMs: 460,
    blastMs: 185,
    blastBreathMs: 70,
    chainDelayMs: 55,
    earlyComboMoves: 12,
    earlyComboRefillBoost: 0.92,
    earlyComboWallReduction: 0.12,
    hugeComboTarget: 8,
    hugeComboChargeStart: 5,
    hugeComboRefillBoost: 0.96,
    hugeComboWallReduction: 0.16,
    boostDecayPerMove: 0.08,
    storageKey: 'blastmath.phaser.highscore'
  };

  const GEM_TYPES = ['star', 'diamond', 'pent', 'hex'];
  const HAND_TYPES = ['diamond', 'pent', 'star', 'hex'];
  const TILE_PATH = 'images/tiles/';
  const HUD_PATH = 'images/hud/';
  const SOUND_PATH = 'sounds/';

  // CRITICAL: do not load gems/walls through Phaser SVG loading. Phaser converts
  // SVGs into bitmap canvas textures. Gem/wall artwork is rendered as real
  // DOM <img src="*.svg"> elements in the SVG overlay below, so the browser
  // keeps the art vector-sharp at every size/DPR.
  const DPR = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);

  function track(eventName, props) {
    if (window.trackEvent) window.trackEvent(eventName, props || {});
  }

  class BlastMathScene extends Phaser.Scene {
    constructor() {
      super('BlastMathScene');
      this.state = null;
      this.layout = null;
      this.cells = [];
      this.handSlots = [];
      this.drag = null;
      this.audioUnlocked = false;
      this.dom = null;
      this.svgLayer = null;
      this.previewHiddenIndex = null;
      this.blastShardBudget = 0;
      this.blastDustBudget = 0;
      this.firstMoveGuideTimer = null;
      this.firstMoveGuideTargets = null;
      this.refillGemCounts = null;
      this.activeChainStep = 0;
      this.handSerial = 0;
    }

    preload() {
      ['pickup', 'place', 'blast', 'combo', 'start', 'lose'].forEach((key) => this.load.audio(key, SOUND_PATH + key + '.mp3'));
    }

    create() {
      this.input.addPointer(2);
      this.scale.on('resize', this.handleResize, this);
      this.input.on('pointerdown', () => this.unlockAudio(), this);
      this.input.on('pointermove', this.onPointerMove, this);
      this.input.on('pointerup', this.onPointerUp, this);
      this.resetState();
      this.buildScene();
      track('app_loaded', { engine: 'phaser' });
    }

    handleResize() {
      this.buildScene();
    }

    unlockAudio() {
      if (this.audioUnlocked) return;
      this.audioUnlocked = true;
      if (this.sound && this.sound.context && this.sound.context.state === 'suspended') {
        this.sound.context.resume().catch(() => {});
      }
    }

    playSfx(key) {
      this.unlockAudio();
      try { this.sound.play(key, { volume: key === 'start' ? 0.8 : key === 'pickup' ? 0.2 : 0.55 }); } catch (e) {}
    }

    resetState() {
      const board = this.createOpeningBoard();
      this.state = {
        board,
        score: 0,
        displayScore: 0,
        highScore: this.readHighScore(),
        hand: null,
        resolving: false,
        blastIndices: [],
        maxChain: 0,
        pendingBombIndices: [],
        moveCount: 0,
        placementBoost: 0,
        turnsSinceHugeCombo: 0,
        lastBlastIndices: [],
        chainWallChance: null,
        firstMoveGuideDone: false,
        chainLuck: 1,
        placementMadeBlast: false,
        postMoveWallCount: 2,
        earlyBigChainUsed: false,
        targetChainMin: 0,
        forcedChainUsedThisMove: 0
      };
      this.state.hand = this.makeNewHand(board);
    }

    readHighScore() {
      try { return Number(localStorage.getItem(CONFIG.storageKey) || 0) || 0; } catch (e) { return 0; }
    }

    writeHighScore() {
      try { localStorage.setItem(CONFIG.storageKey, String(this.state.highScore)); } catch (e) {}
    }

    createOpeningBoard() {
      const board = Array(CONFIG.boardSize * CONFIG.boardSize).fill(null);
      for (let i = 0; i < board.length; i++) {
        if (Math.random() < CONFIG.openingWallChance) {
          board[i] = { kind: 'wall', wallType: 'brick' };
          continue;
        }
        let type = this.randomGemType();
        for (let t = 0; t < 8 && this.wouldCreateOpeningMatch(board, i, type); t++) type = this.randomGemType();
        board[i] = { kind: 'gem', gemType: type };
      }
      return board;
    }

    randomGemType() {
      return GEM_TYPES[Math.floor(Math.random() * GEM_TYPES.length)];
    }

    isGem(cell) { return !!cell && cell.kind === 'gem'; }
    isWall(cell) { return !!cell && cell.kind === 'wall'; }

    getSvgLayer() {
      if (this.svgLayer) return this.svgLayer;
      let layer = document.getElementById('bm-svg-layer');
      if (!layer) {
        layer = document.createElement('div');
        layer.id = 'bm-svg-layer';
        layer.setAttribute('aria-hidden', 'true');
        document.body.appendChild(layer);
      }
      this.svgLayer = layer;
      return layer;
    }

    clearSvgLayer() {
      const layer = this.getSvgLayer();
      layer.replaceChildren();
    }

    svgPath(key) {
      return TILE_PATH + key + '.svg';
    }

    addSvgArt(key, size) {
      const img = document.createElement('img');
      img.className = 'bm-svg-art';
      img.src = this.svgPath(key);
      img.alt = '';
      img.draggable = false;
      img.dataset.key = key;
      img.style.width = `${Math.round(size)}px`;
      img.style.height = `${Math.round(size)}px`;
      this.getSvgLayer().appendChild(img);
      return img;
    }

    syncSvgArt(owner) {
      if (!owner || !owner.domArt) return;
      const art = owner.domArt;
      const size = Number(art.dataset.size || 0);
      const x = owner.x + (owner.domOffsetX || 0);
      const y = owner.y + (owner.domOffsetY || 0);
      const scale = owner.domScale == null ? (owner.scaleX == null ? 1 : owner.scaleX) : owner.domScale;
      const alpha = owner.domAlpha == null ? (owner.alpha == null ? 1 : owner.alpha) : owner.domAlpha;
      const rotation = owner.domRotation == null ? (owner.rotation || 0) : owner.domRotation;
      art.style.left = `${Math.round(x - size / 2)}px`;
      art.style.top = `${Math.round(y - size / 2)}px`;
      art.style.opacity = String(alpha);
      art.style.transform = `scale(${scale}) rotate(${rotation}rad)`;
    }

    attachSvgArt(owner, key, size, offsetX, offsetY, className) {
      const art = this.addSvgArt(key, size);
      if (className) art.classList.add(className);
      art.dataset.size = String(size);
      owner.domArt = art;
      owner.domOffsetX = offsetX || 0;
      owner.domOffsetY = offsetY || 0;
      owner.once('destroy', () => art.remove());
      this.syncSvgArt(owner);
      return art;
    }

    setCellArtHidden(index, hidden) {
      const cell = this.cells[index];
      if (!cell || !cell.domArt) return;
      cell.domAlpha = hidden ? 0 : 1;
      cell.domArt.classList.toggle('is-hover-hidden', !!hidden);
      this.syncSvgArt(cell);
    }

    restorePreviewHiddenCell() {
      if (this.previewHiddenIndex == null) return;
      this.setCellArtHidden(this.previewHiddenIndex, false);
      this.previewHiddenIndex = null;
    }

    stopFirstMoveGuide() {
      if (this.firstMoveGuideTimer) {
        this.firstMoveGuideTimer.remove(false);
        this.firstMoveGuideTimer = null;
      }
      (this.firstMoveGuideTargets || []).forEach((owner) => {
        if (!owner) return;
        owner.domScale = 1;
        owner.domRotation = 0;
        this.syncSvgArt(owner);
      });
      this.firstMoveGuideTargets = null;
    }

    pulseDomGem(owner, delay) {
      if (!owner || !owner.domArt) return;
      this.tweens.addCounter({
        from: 0,
        to: 1,
        duration: 620,
        delay,
        ease: 'Sine.easeInOut',
        onUpdate: (tw) => {
          const v = tw.getValue();
          const wave = Math.sin(v * Math.PI * 4);
          owner.domScale = 1 + Math.max(0, wave) * 0.21;
          owner.domRotation = Math.sin(v * Math.PI * 4) * 0.13;
          this.syncSvgArt(owner);
        },
        onComplete: () => {
          owner.domScale = 1;
          owner.domRotation = 0;
          this.syncSvgArt(owner);
        }
      });
    }

    destroyCell(index) {
      const old = this.cells[index];
      if (!old) return;
      if (old.domArt) old.domArt.remove();
      old.destroy();
      this.cells[index] = null;
    }

    addCrispText(x, y, text, style) {
      const scale = this.layout ? this.layout.scale : 1;
      const fontSize = Math.round(parseFloat(style.fontSize) || 24);
      const strokeThickness = Math.max(0, Math.round(style.strokeThickness || 0));
      const obj = this.add.text(Math.round(x), Math.round(y), text, {
        ...style,
        fontSize: `${fontSize}px`,
        strokeThickness
      });
      if (obj.setResolution) obj.setResolution(Math.max(2, DPR * 1.5));
      return obj;
    }

    wouldCreateOpeningMatch(board, index, gemType) {
      const size = CONFIG.boardSize;
      const x = index % size;
      const y = Math.floor(index / size);
      const at = (xx, yy) => {
        if (xx < 0 || xx >= size || yy < 0 || yy >= size) return null;
        const c = board[yy * size + xx];
        return this.isGem(c) ? c.gemType : null;
      };
      return (at(x - 2, y) === gemType && at(x - 1, y) === gemType) ||
        (at(x - 1, y) === gemType && at(x + 1, y) === gemType) ||
        (at(x + 1, y) === gemType && at(x + 2, y) === gemType) ||
        (at(x, y - 2) === gemType && at(x, y - 1) === gemType) ||
        (at(x, y - 1) === gemType && at(x, y + 1) === gemType) ||
        (at(x, y + 1) === gemType && at(x, y + 2) === gemType);
    }

    calcLayout() {
      const w = this.scale.width;
      const h = this.scale.height;
      const scale = Math.min(w / CONFIG.baseWidth, h / CONFIG.baseHeight, 1.22);

      // Equal-space vertical grouping:
      // [space] HUD [space] SCORE [space] BOARD [space] HAND [space]
      // This mirrors the responsive DOM layout from the non-Phaser build and
      // prevents the board/hand from drifting independently on short viewports.
      const minEdge = Math.round(12 * scale);
      const maxStageByWidth = Math.min(w - minEdge * 2, CONFIG.maxStageWidth);
      const hudH = Math.round(52 * scale);
      const scoreH = Math.round(72 * scale);
      const handH = Math.round(96 * scale);

      let stageW = Math.round(Math.max(280, Math.min(maxStageByWidth, CONFIG.maxStageWidth)));
      let tile = 0;
      let boardSize = 0;

      // Fit the square board inside the equal-space stack, then snap tile size
      // to a whole pixel so SVG gems stay sharp and grid math stays stable.
      for (let guard = 0; guard < 24; guard++) {
        tile = Math.floor((stageW - (CONFIG.pad * 2) - (CONFIG.gap * (CONFIG.boardSize - 1))) / CONFIG.boardSize);
        boardSize = tile * CONFIG.boardSize + CONFIG.gap * (CONFIG.boardSize - 1) + CONFIG.pad * 2;
        const minStackH = hudH + scoreH + boardSize + handH + minEdge * 5;
        if (minStackH <= h || stageW <= 280) break;
        stageW -= Math.ceil((minStackH - h) / 2);
      }

      tile = Math.floor((stageW - (CONFIG.pad * 2) - (CONFIG.gap * (CONFIG.boardSize - 1))) / CONFIG.boardSize);
      boardSize = tile * CONFIG.boardSize + CONFIG.gap * (CONFIG.boardSize - 1) + CONFIG.pad * 2;
      stageW = boardSize;

      const left = Math.round((w - stageW) / 2);
      const boardX = Math.round((w - boardSize) / 2);
      const freeH = Math.max(0, h - hudH - scoreH - boardSize - handH);
      const space = Math.max(minEdge, Math.floor(freeH / 5));
      const usedH = hudH + scoreH + boardSize + handH + space * 5;
      const stageTop = Math.round(Math.max(minEdge, (h - usedH) / 2 + space));
      const hudY = stageTop;
      const scoreY = Math.round(hudY + hudH + space);
      const boardY = Math.round(scoreY + scoreH + space);
      const handY = Math.round(boardY + boardSize + space);

      return {
        w, h, scale, stageW, left, stageTop, hudY, scoreY, hudH, scoreH, handH, space, tile, boardSize,
        boardX, boardY, boardInnerX: boardX + CONFIG.pad, boardInnerY: boardY + CONFIG.pad,
        handY
      };
    }

    buildScene() {
      this.stopFirstMoveGuide();
      this.children.removeAll();
      this.clearSvgLayer();
      this.cells = [];
      this.handSlots = [];
      this.previewHiddenIndex = null;
      this.layout = this.calcLayout();
      this.cameras.main.setBackgroundColor(CONFIG.bg);
      this.updateDomHud();
      this.buildBoard();
      this.buildHand();
      this.firstMoveGuideTimer = this.time.delayedCall(180, () => this.playFirstMoveGuide());
    }

    getDom() {
      if (this.dom) return this.dom;
      const root = document.getElementById('bm-dom-top');
      this.dom = {
        root,
        hud: document.getElementById('bm-dom-hud'),
        highScore: document.getElementById('bm-dom-high-score'),
        score: document.getElementById('bm-dom-score'),
        reset: document.getElementById('bm-dom-reset')
      };
      if (this.dom.reset) {
        this.dom.reset.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.playSfx('start');
          this.resetState();
          this.buildScene();
        }, { passive: false });
      }
      return this.dom;
    }

    updateDomHud() {
      const l = this.layout;
      const dom = this.getDom();
      if (!dom.root) return;
      dom.root.style.left = `${l.left}px`;
      dom.root.style.top = `${l.stageTop}px`;
      dom.root.style.width = `${l.stageW}px`;
      dom.root.style.height = `${Math.max(l.h - l.stageTop, l.h)}px`;
      dom.root.style.setProperty('--bm-scale', String(l.scale));
      dom.root.style.setProperty('--bm-board-size', `${Math.round(l.boardSize)}px`);
      dom.root.style.setProperty('--bm-score-top', `${Math.round(l.scoreY - l.stageTop)}px`);
      if (dom.highScore) dom.highScore.textContent = String(this.state.highScore);
      if (dom.score) dom.score.textContent = String(this.state.displayScore);
    }

    pulseDomScore() {
      const dom = this.getDom();
      if (!dom.score) return;
      dom.score.classList.remove('is-popping');
      void dom.score.offsetWidth;
      dom.score.classList.add('is-popping');
    }

    buildBoard() {
      const l = this.layout;
      this.boardLayer = this.add.container(0, 0);
      const bg = this.add.graphics();
      bg.fillStyle(CONFIG.boardFill, 1);
      bg.fillRoundedRect(l.boardX, l.boardY, l.boardSize, l.boardSize, 8 * l.scale);
      this.boardLayer.add(bg);
      for (let i = 0; i < this.state.board.length; i++) this.drawCell(i, false);
    }

    cellXY(index) {
      const l = this.layout;
      const x = index % CONFIG.boardSize;
      const y = Math.floor(index / CONFIG.boardSize);
      return {
        x: l.boardInnerX + x * (l.tile + CONFIG.gap),
        y: l.boardInnerY + y * (l.tile + CONFIG.gap),
        cx: l.boardInnerX + x * (l.tile + CONFIG.gap) + l.tile / 2,
        cy: l.boardInnerY + y * (l.tile + CONFIG.gap) + l.tile / 2
      };
    }

    drawCell(index, animate) {
      this.destroyCell(index);
      const l = this.layout;
      const p = this.cellXY(index);
      const cell = this.state.board[index];
      const cont = this.add.container(p.x, p.y);
      const g = this.add.graphics();
      g.fillStyle(CONFIG.cellFill, CONFIG.cellAlpha);
      g.fillRoundedRect(0, 0, l.tile, l.tile, 4 * l.scale);
      cont.add(g);
      if (cell) {
        const key = this.isWall(cell) ? 'brick' : cell.gemType;
        const size = this.isWall(cell) ? l.tile * 0.96 : l.tile * 0.68;
        this.attachSvgArt(cont, key, size, l.tile / 2, l.tile / 2);
      }
      this.cells[index] = cont;
      this.boardLayer.add(cont);
      if (animate) {
        cont.setScale(0.9);
        this.syncSvgArt(cont);
        this.tweens.add({ targets: cont, scale: 1, duration: 130, ease: 'Back.Out', onUpdate: () => this.syncSvgArt(cont), onComplete: () => this.syncSvgArt(cont) });
      }
      return cont;
    }

    findFirstMoveGuidePair() {
      if (!this.state || this.state.moveCount > 0 || this.state.firstMoveGuideDone) return null;
      const center = Math.floor(CONFIG.boardSize * CONFIG.boardSize / 2);
      const handSlots = this.state.hand
        .map((piece, slotIndex) => piece ? { slotIndex, gemType: piece.gemType } : null)
        .filter(Boolean);
      if (!handSlots.length) return null;

      const candidates = [];
      for (const hand of handSlots) {
        for (let index = 0; index < this.state.board.length; index++) {
          const cell = this.state.board[index];
          if (!this.isGem(cell)) continue; // never teach or allow replacement on walls
          const test = this.state.board.slice();
          test[index] = { kind: 'gem', gemType: hand.gemType };
          const groups = this.findBlastGroups(test);
          if (!groups.length) continue;
          const distance = Math.abs((index % CONFIG.boardSize) - (center % CONFIG.boardSize)) +
            Math.abs(Math.floor(index / CONFIG.boardSize) - Math.floor(center / CONFIG.boardSize));
          const biggest = groups.reduce((best, run) => Math.max(best, run.length), 0);
          candidates.push({ index, slotIndex: hand.slotIndex, distance, biggest, groupCount: groups.length });
        }
      }

      candidates.sort((a, b) =>
        (b.biggest - a.biggest) ||
        (b.groupCount - a.groupCount) ||
        (a.distance - b.distance)
      );
      return candidates[0] || null;
    }

    playFirstMoveGuide() {
      if (!this.state || this.state.firstMoveGuideDone || this.state.moveCount > 0 || this.drag || this.state.resolving) return;
      const pair = this.findFirstMoveGuidePair();
      if (!pair) return;
      const boardCell = this.cells[pair.index];
      const handSlot = this.handSlots[pair.slotIndex];
      if (!boardCell || !handSlot) return;

      // First move only: pulse the SVG gems themselves, not the tiles.
      // Repeats until the player actually makes a move, and only points at a move that creates a 3+ blast.
      this.firstMoveGuideTargets = [handSlot, boardCell];
      this.pulseDomGem(handSlot, 0);
      this.pulseDomGem(boardCell, 0);
      this.firstMoveGuideTimer = this.time.delayedCall(920, () => this.playFirstMoveGuide());
    }


    getBoardMatchTypes() {
      const out = [];
      if (!this.state || !this.state.board) return out;
      for (let index = 0; index < this.state.board.length; index++) {
        if (!this.isGem(this.state.board[index])) continue;
        GEM_TYPES.forEach((type) => {
          const test = this.state.board.slice();
          test[index] = { kind: 'gem', gemType: type };
          const groups = this.findBlastGroups(test);
          if (groups.some((run) => run.includes(index))) out.push(type);
        });
      }
      return out;
    }

    makeNewHand(boardOverride) {
      const oldState = this.state;
      if (boardOverride && (!this.state || this.state.board !== boardOverride)) {
        // Allows resetState() to generate a smart opening hand before buildScene exists.
        this.state = { ...(this.state || {}), board: boardOverride };
      }
      const matchTypes = this.getBoardMatchTypes();
      if (boardOverride && oldState !== this.state) this.state = oldState;

      const hand = Array.from({ length: 4 }, (_, i) => {
        const gemType = GEM_TYPES[Math.floor(Math.random() * GEM_TYPES.length)];
        this.handSerial++;
        return { id: gemType + '-' + i + '-' + Date.now() + '-' + this.handSerial, gemType };
      });

      if (matchTypes.length) {
        const skewCount = Math.min(2, Math.max(1, Math.random() < 0.62 ? 2 : 1));
        const slots = [0, 1, 2, 3].sort(() => Math.random() - 0.5).slice(0, skewCount);
        slots.forEach((slot, n) => {
          const gemType = matchTypes[Math.floor(Math.random() * matchTypes.length)];
          this.handSerial++;
          hand[slot] = { id: gemType + '-' + slot + '-' + Date.now() + '-' + this.handSerial + '-skew' + n, gemType };
        });
      }
      return hand;
    }

    buildHand() {
      const l = this.layout;
      const totalW = l.stageW;
      const slotStep = totalW / 4;
      this.state.hand.forEach((piece, i) => {
        const cx = Math.round(l.left + slotStep * (i + 0.5));
        const cy = Math.round(l.handY + 48 * l.scale);

        // Big invisible pickup pad. The visible tile stays exact, but the touch target is much more forgiving.
        const hitW = Math.max(l.tile + 54 * l.scale, slotStep * 0.92);
        const hitH = l.tile + 58 * l.scale;
        const hit = this.add.zone(cx, cy, hitW, hitH).setOrigin(0.5).setDepth(35);

        const cont = this.add.container(cx, cy).setDepth(40);
        const bg = this.add.graphics();
        bg.fillStyle(0x000000, 1);
        bg.fillRoundedRect(-l.tile / 2 - 4, -l.tile / 2 - 4, l.tile + 8, l.tile + 8, 6 * l.scale);
        cont.add(bg);
        const tile = this.add.graphics();
        tile.fillStyle(CONFIG.cellFill, CONFIG.cellAlpha);
        tile.fillRoundedRect(-l.tile / 2, -l.tile / 2, l.tile, l.tile, 4 * l.scale);
        cont.add(tile);
        if (piece) {
          this.attachSvgArt(cont, piece.gemType, l.tile * 0.68, 0, 0);
          hit.setInteractive({ useHandCursor: true });
          hit.on('pointerdown', (pointer) => this.startDrag(pointer, i, piece, cont));
          cont.setInteractive(new Phaser.Geom.Rectangle(-hitW / 2, -hitH / 2, hitW, hitH), Phaser.Geom.Rectangle.Contains);
          cont.on('pointerdown', (pointer) => this.startDrag(pointer, i, piece, cont));
        } else {
          cont.setAlpha(0.18);
        }
        this.handSlots[i] = cont;
      });
    }

    startDrag(pointer, slotIndex, piece, slot) {
      if (this.state.resolving || this.drag || !piece) return;
      const livePiece = this.state.hand[slotIndex];
      if (!livePiece || livePiece.id !== piece.id) return;
      this.stopFirstMoveGuide();
      this.playSfx('pickup');
      slot.setAlpha(0.34);
      slot.setScale(0.98);
      this.syncSvgArt(slot);
      const l = this.layout;
      const ghost = this.add.container(pointer.x, pointer.y - 86 * l.scale).setDepth(1000);
      const bg = this.add.graphics();
      bg.fillStyle(0x000000, 1);
      bg.fillRoundedRect(-l.tile / 2 - 4, -l.tile / 2 - 4, l.tile + 8, l.tile + 8, 6 * l.scale);
      ghost.add(bg);
      const tile = this.add.graphics();
      tile.fillStyle(CONFIG.cellFill, CONFIG.cellAlpha);
      tile.fillRoundedRect(-l.tile / 2, -l.tile / 2, l.tile, l.tile, 4 * l.scale);
      ghost.add(tile);
      this.attachSvgArt(ghost, piece.gemType, l.tile * 0.68, 0, 0);
      this.drag = { slotIndex, piece, slot, ghost, anchor: null, preview: [], liftY: 86 * l.scale };
      this.updateDrag(pointer);
    }

    onPointerMove(pointer) {
      if (this.drag) this.updateDrag(pointer);
    }

    onPointerUp(pointer) {
      if (!this.drag) return;
      const d = this.drag;
      const anchor = d.anchor;
      this.clearPreview();
      d.ghost.destroy();
      d.slot.setAlpha(1);
      d.slot.setScale(1);
      this.syncSvgArt(d.slot);
      this.drag = null;
      if (anchor == null || this.state.resolving) return;
      this.commitPlacement(d.slotIndex, d.piece.gemType, anchor);
    }

    updateDrag(pointer) {
      const d = this.drag;
      const l = this.layout;
      const liftY = d.liftY || 86 * l.scale;
      let gx = pointer.x;
      let gy = pointer.y - liftY;
      const overBoard = this.isPointOverBoard(gx, gy);
      const anchor = this.anchorFromPoint(gx, gy, d.piece.gemType);
      if (anchor != null) {
        const p = this.cellXY(anchor);
        gx = p.cx;
        gy = p.cy;
      }
      d.ghost.setPosition(Math.round(gx), Math.round(gy));
      d.ghost.setScale(anchor != null ? 1.02 : 1);
      d.ghost.setAlpha(anchor != null ? 0 : 1);
      d.ghost.domAlpha = anchor != null ? 0 : 1;
      this.syncSvgArt(d.ghost);
      if (anchor !== d.anchor || overBoard !== d.overBoard) {
        d.anchor = anchor;
        d.overBoard = overBoard;
        this.renderPreview(anchor, d.piece.gemType, overBoard);
      }
    }

    isPointOverBoard(x, y) {
      const l = this.layout;
      return x >= l.boardInnerX && x <= l.boardInnerX + (CONFIG.boardSize * l.tile + (CONFIG.boardSize - 1) * CONFIG.gap) &&
        y >= l.boardInnerY && y <= l.boardInnerY + (CONFIG.boardSize * l.tile + (CONFIG.boardSize - 1) * CONFIG.gap);
    }

    anchorFromPoint(x, y, gemType) {
      const l = this.layout;
      const bx = x - l.boardInnerX;
      const by = y - l.boardInnerY;
      const col = Math.round((bx - l.tile / 2) / (l.tile + CONFIG.gap));
      const row = Math.round((by - l.tile / 2) / (l.tile + CONFIG.gap));
      if (col < 0 || col >= CONFIG.boardSize || row < 0 || row >= CONFIG.boardSize) return null;
      const index = row * CONFIG.boardSize + col;
      const cell = this.state.board[index];
      // Gems can replace board gems only. Walls and empty cells reject placement.
      return this.isGem(cell) ? index : null;
    }

    clearPreview(keepBoardDimmer) {
      this.restorePreviewHiddenCell();
      if (!this.drag) return;
      if (!keepBoardDimmer && this.drag.boardDimmer) {
        const oldDimmer = this.drag.boardDimmer;
        this.tweens.add({ targets: oldDimmer, alpha: 0, duration: 120, ease: 'Sine.easeIn', onComplete: () => oldDimmer.destroy() });
        this.drag.boardDimmer = null;
      }
      if (!keepBoardDimmer && this.drag.domBoardDimmer) {
        const oldDomDimmer = this.drag.domBoardDimmer;
        oldDomDimmer.classList.add('is-leaving');
        window.setTimeout(() => oldDomDimmer.remove(), 130);
        this.drag.domBoardDimmer = null;
      }
      (this.drag.preview || []).forEach((o) => { if (o.domArt) o.domArt.remove(); o.destroy(); });
      this.drag.preview = [];
    }

    renderPreview(index, gemType, overBoard) {
      this.clearPreview(!!overBoard);
      if (!this.drag) return;
      const l = this.layout;

      if (overBoard && !this.drag.boardDimmer) {
        const dimmer = this.add.graphics().setDepth(940);
        dimmer.fillStyle(0x000000, 0.40);
        dimmer.fillRoundedRect(l.boardX, l.boardY, l.boardSize, l.boardSize, 8 * l.scale);
        dimmer.setAlpha(0);
        this.tweens.add({ targets: dimmer, alpha: 1, duration: 115, ease: 'Sine.easeOut' });
        this.drag.boardDimmer = dimmer;
      }

      if (overBoard && !this.drag.domBoardDimmer) {
        const domDimmer = document.createElement('div');
        domDimmer.className = 'bm-board-dimmer';
        domDimmer.style.left = `${l.boardX}px`;
        domDimmer.style.top = `${l.boardY}px`;
        domDimmer.style.width = `${l.boardSize}px`;
        domDimmer.style.height = `${l.boardSize}px`;
        domDimmer.style.borderRadius = `${Math.round(8 * l.scale)}px`;
        this.getSvgLayer().appendChild(domDimmer);
        this.drag.domBoardDimmer = domDimmer;
      }

      if (!overBoard || index == null) return;
      const p = this.cellXY(index);

      // Hide the existing board art quickly, then place only the hovering SVG gem on top.
      // Tile/background stay untouched, so the hover reads as “replace this piece,” not a tile highlight.
      this.previewHiddenIndex = index;
      this.setCellArtHidden(index, true);

      const c = this.add.container(p.x, p.y).setDepth(980);
      c.domAlpha = 0.96;
      c.domScale = 1.08;
      this.attachSvgArt(c, gemType, l.tile * 0.72, l.tile / 2, l.tile / 2, 'bm-svg-hover-art');
      this.drag.preview.push(c);
    }

    scorePlacementBoost(index, gemType) {
      const test = this.state.board.slice();
      test[index] = { kind: 'gem', gemType };
      const preview = this.classifyBlastPhase(test, 1);
      let boost = 0;
      if (preview.hasBlast) boost += 0.48;
      this.neighbors(index).forEach((n) => {
        const cell = this.state.board[n];
        if (this.isGem(cell) && cell.gemType === gemType) boost += 0.12;
        if (this.isWall(cell)) boost += 0.06;
      });
      return Math.min(0.75, boost);
    }

    commitPlacement(slotIndex, gemType, index) {

      const livePiece = this.state.hand[slotIndex];
      if (!livePiece || livePiece.gemType !== gemType || this.state.resolving) return;
      this.stopFirstMoveGuide();
      this.state.resolving = true;
      this.state.firstMoveGuideDone = true;
      this.state.moveCount++;
      this.playSfx('place');
      this.state.board[index] = { kind: 'gem', gemType };
      this.state.pendingBombIndices = [];
      this.state.hand[slotIndex] = null;

      // Every placed piece rolls 1–10. If the placement itself creates a blast,
      // that roll becomes the "chain luck" for refill bias. Low rolls stay fair;
      // high rolls deliberately seed more follow-up matches during gravity.
      this.state.chainLuck = Phaser.Math.Between(1, 10);
      const firstPhase = this.classifyBlastPhase(this.state.board, 1);
      this.state.placementMadeBlast = !!firstPhase.hasBlast;
      this.state.forcedChainUsedThisMove = 0;
      this.state.targetChainMin = 0;
      if (this.state.placementMadeBlast) {
        if (this.state.moveCount <= 3 && !this.state.earlyBigChainUsed) {
          this.state.chainLuck = 10;
          this.state.targetChainMin = Phaser.Math.Between(6, 8);
          this.state.earlyBigChainUsed = true;
        } else if (this.state.moveCount <= 10) {
          this.state.chainLuck = Math.max(this.state.chainLuck, Phaser.Math.Between(8, 10));
          this.state.targetChainMin = Phaser.Math.Between(2, 5);
        } else if (this.state.chainLuck >= 8) {
          this.state.targetChainMin = Phaser.Math.Between(3, 5);
        }
      }
      const luckBoost = this.state.placementMadeBlast ? (this.state.chainLuck / 10) : 0;

      this.state.chainWallChance = this.getAdaptiveWallChance(this.state.board);
      this.state.placementBoost = Math.max(this.scorePlacementBoost(index, gemType), luckBoost);
      this.drawCell(index, true);
      this.time.delayedCall(70, () => this.runBlastChain(1));
    }

    findBlastGroups(board) {
      const size = CONFIG.boardSize;
      const groups = [];
      const keyAt = (i) => this.isGem(board[i]) ? board[i].gemType : null;
      for (let y = 0; y < size; y++) {
        let x = 0;
        while (x < size) {
          const key = keyAt(y * size + x);
          const run = [];
          while (x < size && key && keyAt(y * size + x) === key) run.push(y * size + x++);
          if (run.length >= 3) groups.push(run);
          if (!key) x++;
        }
      }
      for (let x = 0; x < size; x++) {
        let y = 0;
        while (y < size) {
          const key = keyAt(y * size + x);
          const run = [];
          while (y < size && key && keyAt(y * size + x) === key) run.push(y++ * size + x);
          if (run.length >= 3) groups.push(run);
          if (!key) y++;
        }
      }
      return groups;
    }

    neighbors(index) {
      const size = CONFIG.boardSize;
      const x = index % size;
      const y = Math.floor(index / size);
      const out = [];
      if (x > 0) out.push(index - 1);
      if (x < size - 1) out.push(index + 1);
      if (y > 0) out.push(index - size);
      if (y < size - 1) out.push(index + size);
      return out;
    }

    squareBlastIndices(center) {
      const size = CONFIG.boardSize;
      const cx = center % size;
      const cy = Math.floor(center / size);
      const out = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) out.push(y * size + x);
      }
      return out;
    }

    classifyBlastPhase(board, comboStep) {
      const blast = new Set();
      const gemBlast = new Set();
      const groups = this.findBlastGroups(board);
      groups.forEach((run) => run.forEach((i) => { blast.add(i); gemBlast.add(i); }));
      (this.state.pendingBombIndices || []).forEach((i) => this.squareBlastIndices(i).forEach((target) => {
        if (board[target]) {
          blast.add(target);
          if (this.isGem(board[target])) gemBlast.add(target);
        }
      }));
      if (!blast.size) return { hasBlast: false, blastIndices: [], scoreValue: 0, totalGroups: 0 };
      Array.from(gemBlast).forEach((i) => this.neighbors(i).forEach((n) => { if (this.isWall(board[n])) blast.add(n); }));
      const totalGroups = groups.length;
      let scoreValue;
      if (comboStep >= 2) {
        if (comboStep === 2) scoreValue = 300;
        else if (comboStep === 3) scoreValue = 550;
        else if (comboStep === 4) scoreValue = 900;
        else if (comboStep === 5) scoreValue = 1300;
        else scoreValue = 1300 + ((Math.min(comboStep, 20) - 5) * 300);
      } else {
        if (totalGroups <= 1) scoreValue = 75;
        else if (totalGroups === 2) scoreValue = 250;
        else if (totalGroups === 3) scoreValue = 450;
        else if (totalGroups === 4) scoreValue = 700;
        else scoreValue = 700 + ((Math.min(totalGroups, 20) - 4) * 200);
      }
      scoreValue = Math.max(1, Math.round(scoreValue * 0.5));
      return { hasBlast: true, blastIndices: Array.from(blast), scoreValue, totalGroups };
    }

    runBlastChain(comboStep) {
      this.activeChainStep = comboStep;
      let result = this.classifyBlastPhase(this.state.board, comboStep);
      if (!result.hasBlast && this.shouldForceChainStep(comboStep)) {
        this.seedNaturalChainBlast();
        result = this.classifyBlastPhase(this.state.board, comboStep);
      }
      if (!result.hasBlast) return this.finishResolve();
      this.state.pendingBombIndices = [];
      this.state.lastBlastIndices = result.blastIndices.slice();
      this.state.maxChain = Math.max(this.state.maxChain || 0, comboStep);
      this.addScore(result.scoreValue);
      const vfxStep = Math.min(9, Math.max(1, comboStep));
      const vfxLevel = Math.max(0, vfxStep - 1);
      this.blastShardBudget = Math.min(440, 92 + vfxLevel * 40);
      this.blastDustBudget = Math.min(560, 120 + vfxLevel * 52);
      this.playSfx(comboStep >= 2 ? 'combo' : 'blast');
      if (comboStep >= 2) this.cameras.main.shake(Math.min(260, 82 + vfxLevel * 24), Math.min(0.012, 0.0032 + vfxLevel * 0.00105));
      this.animateBlast(result.blastIndices, () => {
        result.blastIndices.forEach((i) => { this.state.board[i] = null; this.destroyCell(i); });
        this.time.delayedCall(CONFIG.blastBreathMs, () => this.applyGravityWithRefill(() => {
          this.time.delayedCall(CONFIG.chainDelayMs, () => this.runBlastChain(comboStep + 1));
        }));
      });
    }


    shouldForceChainStep(comboStep) {
      if (!this.state.placementMadeBlast) return false;
      if (!this.state.targetChainMin || comboStep > this.state.targetChainMin) return false;
      if (comboStep > 9) return false;
      if ((this.state.forcedChainUsedThisMove || 0) > 7) return false;
      return this.state.moveCount <= 10 || (this.state.chainLuck || 0) >= 8;
    }

    seedNaturalChainBlast() {
      const board = this.state.board;
      const size = CONFIG.boardSize;
      const candidates = [];
      for (let y = 0; y < size; y++) {
        for (let x = 0; x <= size - 3; x++) {
          const indices = [y * size + x, y * size + x + 1, y * size + x + 2];
          if (indices.every((i) => this.isGem(board[i]))) candidates.push(indices);
        }
      }
      for (let x = 0; x < size; x++) {
        for (let y = 0; y <= size - 3; y++) {
          const indices = [y * size + x, (y + 1) * size + x, (y + 2) * size + x];
          if (indices.every((i) => this.isGem(board[i]))) candidates.push(indices);
        }
      }
      if (!candidates.length) return false;
      candidates.sort((a, b) => {
        const da = Math.min(...a.map((i) => this.distanceToNearestBlast(i)));
        const db = Math.min(...b.map((i) => this.distanceToNearestBlast(i)));
        return da - db;
      });
      const run = candidates[Math.floor(Math.random() * Math.min(8, candidates.length))];
      const neighborTypes = [];
      run.forEach((i) => this.neighbors(i).forEach((n) => {
        const c = board[n];
        if (this.isGem(c)) neighborTypes.push(c.gemType);
      }));
      const type = neighborTypes.length ? neighborTypes[Math.floor(Math.random() * neighborTypes.length)] : this.randomGemType();
      run.forEach((i) => {
        board[i] = { kind: 'gem', gemType: type };
        if (this.cells && this.cells[i]) this.drawCell(i, false);
      });
      this.state.forcedChainUsedThisMove = (this.state.forcedChainUsedThisMove || 0) + 1;
      return true;
    }

    animateBlast(indices, done) {
      let remaining = indices.length;
      if (!remaining) return done();
      const chainStep = Math.max(1, this.activeChainStep || 1);
      const blastScale = Math.min(1.62, 1.14 + chainStep * 0.055);
      const blastDuration = Math.min(320, CONFIG.blastMs + chainStep * 18);
      indices.forEach((i) => {
        this.spawnConfetti(i);
        const c = this.cells[i];
        if (!c) { if (--remaining === 0) done(); return; }
        this.tweens.add({
          targets: c,
          scale: { from: 1, to: blastScale },
          alpha: { from: 1, to: 0 },
          duration: blastDuration,
          ease: 'Quad.easeOut',
          onUpdate: () => this.syncSvgArt(c),
          onComplete: () => { this.syncSvgArt(c); if (--remaining === 0) done(); }
        });
      });
    }

    spawnDomGemShard(key, x, y, size, angle, distance, duration, delay) {
      if (this.blastShardBudget <= 0) return false;
      this.blastShardBudget--;
      const img = this.addSvgArt(key, size);
      img.classList.add('bm-svg-shard');
      img.dataset.size = String(size);
      img.style.left = `${Math.round(x - size / 2)}px`;
      img.style.top = `${Math.round(y - size / 2)}px`;
      img.style.opacity = '0.98';
      img.style.transition = `transform ${duration}ms cubic-bezier(.13,.72,.22,1), opacity ${duration}ms ease-out`;
      const startScale = Phaser.Math.FloatBetween(0.70, 1.05);
      const startRot = Phaser.Math.Between(-35, 35);
      const endScale = Phaser.Math.FloatBetween(0.28, 0.62);
      const endRot = Phaser.Math.Between(-620, 620);
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance + this.layout.tile * 0.86;
      img.style.transform = `translate3d(0,0,0) scale(${startScale}) rotate(${startRot}deg)`;
      window.setTimeout(() => {
        img.style.opacity = '0';
        img.style.transform = `translate3d(${Math.round(dx)}px,${Math.round(dy)}px,0) scale(${endScale}) rotate(${endRot}deg)`;
      }, delay);
      window.setTimeout(() => img.remove(), duration + delay + 80);
      return true;
    }

    chainVfxLevel() {
      const step = Math.min(9, Math.max(1, this.activeChainStep || 1));
      return step >= 2 ? step - 1 : 0;
    }

    tryUseDustBudget() {
      if (this.blastDustBudget <= 0) return false;
      this.blastDustBudget--;
      return true;
    }

    gemSparkColor(key) {
      if (key === 'diamond') return 0x63e7ff;
      if (key === 'star') return 0x73ff72;
      if (key === 'hex') return 0xff5757;
      if (key === 'pent') return 0xffc44a;
      return 0xffffff;
    }

    spawnDustBurst(index, juice, isGem) {
      const p = this.cellXY(index);
      const dustCount = (isGem ? 7 : 10) + juice * 4;
      for (let i = 0; i < dustCount; i++) {
        if (!this.tryUseDustBudget()) break;
        const angle = Math.random() * Math.PI * 2;
        const dist = this.layout.tile * Phaser.Math.FloatBetween(0.20, 1.00 + juice * 0.16);
        const size = this.layout.tile * Phaser.Math.FloatBetween(0.035, 0.085 + juice * 0.006);
        const roll = Math.random();
        const color = roll < 0.34 ? 0xffd18a : roll < 0.62 ? 0xff9f2a : roll < 0.84 ? 0xb9b2a6 : 0xffffff;
        const dust = this.add.circle(p.cx, p.cy, size, color, Phaser.Math.FloatBetween(0.15, 0.34)).setDepth(792);
        this.tweens.add({
          targets: dust,
          x: p.cx + Math.cos(angle) * dist,
          y: p.cy + Math.sin(angle) * dist + this.layout.tile * Phaser.Math.FloatBetween(0.25, 0.70),
          scale: Phaser.Math.FloatBetween(1.7, 3.4 + juice * 0.18),
          alpha: 0,
          duration: Phaser.Math.Between(360 + juice * 28, 620 + juice * 48),
          ease: 'Quad.easeOut',
          onComplete: () => dust.destroy()
        });
      }
    }

    spawnMicroFragments(index, gemKey, juice, isGem) {
      const p = this.cellXY(index);
      const count = (isGem ? 9 : 7) + juice * 5;
      const baseColor = isGem ? this.gemSparkColor(gemKey) : 0xaeb6c4;
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i / count) + Phaser.Math.FloatBetween(-0.25, 0.45);
        const dist = this.layout.tile * Phaser.Math.FloatBetween(0.75, 1.45 + juice * 0.22);
        const size = this.layout.tile * Phaser.Math.FloatBetween(0.035, 0.085 + juice * 0.004);
        const roll = Math.random();
        const color = roll < 0.52 ? baseColor : roll < 0.74 ? 0xffffff : roll < 0.90 ? 0xffcf49 : 0xff7a00;
        const frag = this.add.rectangle(
          p.cx,
          p.cy,
          size * Phaser.Math.FloatBetween(0.65, 1.85),
          size * Phaser.Math.FloatBetween(0.35, 0.95),
          color,
          Phaser.Math.FloatBetween(0.82, 1)
        ).setDepth(808);
        this.tweens.add({
          targets: frag,
          x: p.cx + Math.cos(angle) * dist,
          y: p.cy + Math.sin(angle) * dist + this.layout.tile * Phaser.Math.FloatBetween(0.55, 1.10),
          angle: Phaser.Math.Between(-720, 720),
          scale: Phaser.Math.FloatBetween(0.18, 0.58),
          alpha: 0,
          duration: Phaser.Math.Between(460 + juice * 34, 760 + juice * 62),
          ease: 'Cubic.easeOut',
          onComplete: () => frag.destroy()
        });
      }
    }

    spawnConfetti(index) {
      const cell = this.state.board[index];
      const p = this.cellXY(index);
      const isGem = this.isGem(cell);
      const gemKey = isGem ? cell.gemType : null;
      const chainStep = Math.min(9, Math.max(1, this.activeChainStep || 1));
      const juice = Math.max(0, chainStep - 1);

      this.spawnDustBurst(index, juice, isGem);

      const count = (this.isWall(cell) ? 12 : 18) + juice * 5;
      const domShardCount = isGem ? Math.min(22, 5 + juice * 2) : 0;

      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i / count) + Math.random() * 0.7;
        const dist = this.layout.tile * Phaser.Math.FloatBetween(0.86, isGem ? 1.75 + juice * 0.24 : 1.25 + juice * 0.13);
        const shardSize = this.layout.tile * Phaser.Math.FloatBetween(isGem ? 0.09 : 0.06, isGem ? 0.22 + juice * 0.008 : 0.17);
        const duration = Phaser.Math.Between(isGem ? 540 + juice * 22 : 430, isGem ? 760 + juice * 72 : 640 + juice * 38);

        if (isGem && i < domShardCount && this.spawnDomGemShard(gemKey, p.cx, p.cy, shardSize, angle, dist, duration, i * 5)) {
          continue;
        }

        const colorRoll = Math.random();
        const color = this.isWall(cell) ? 0xaeb6c4 : (colorRoll < 0.28 ? this.gemSparkColor(gemKey) : colorRoll < 0.50 ? 0xffffff : colorRoll < 0.70 ? 0xfff071 : colorRoll < 0.88 ? 0xffb000 : 0xff6b00);
        const frag = this.add.rectangle(
          p.cx,
          p.cy,
          shardSize * Phaser.Math.FloatBetween(0.55, 1.55),
          shardSize * Phaser.Math.FloatBetween(0.24, 0.82),
          color,
          0.96
        ).setDepth(805);
        this.tweens.add({
          targets: frag,
          x: p.cx + Math.cos(angle) * dist,
          y: p.cy + Math.sin(angle) * dist + this.layout.tile * Phaser.Math.FloatBetween(0.72, 1.16),
          angle: Phaser.Math.Between(-520 - juice * 35, 520 + juice * 35),
          alpha: 0,
          scale: Phaser.Math.FloatBetween(0.28, 0.72),
          duration,
          ease: 'Cubic.easeOut',
          onComplete: () => frag.destroy()
        });
      }

      this.spawnMicroFragments(index, gemKey, juice, isGem);

      const pop = this.add.circle(p.cx, p.cy, this.layout.tile * (0.15 + juice * 0.015), isGem ? 0xffffff : 0xffcf7a, isGem ? 0.42 : 0.28).setDepth(804);
      this.tweens.add({
        targets: pop,
        scale: 2.0 + juice * 0.24,
        alpha: 0,
        duration: 230 + juice * 28,
        ease: 'Quad.easeOut',
        onComplete: () => pop.destroy()
      });
    }


    getNearMatchGemTypes(board) {
      const size = CONFIG.boardSize;
      const weighted = [];
      const push = (type, times) => { if (type) for (let i = 0; i < times; i++) weighted.push(type); };
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const cell = board[y * size + x];
          if (!this.isGem(cell)) continue;
          const right1 = x + 1 < size ? board[y * size + x + 1] : null;
          const right2 = x + 2 < size ? board[y * size + x + 2] : null;
          const down1 = y + 1 < size ? board[(y + 1) * size + x] : null;
          const down2 = y + 2 < size ? board[(y + 2) * size + x] : null;
          if (this.isGem(right1) && right1.gemType === cell.gemType) push(cell.gemType, 5);
          if (this.isGem(down1) && down1.gemType === cell.gemType) push(cell.gemType, 5);
          if (this.isGem(right2) && right2.gemType === cell.gemType) push(cell.gemType, 2);
          if (this.isGem(down2) && down2.gemType === cell.gemType) push(cell.gemType, 2);
        }
      }
      return weighted;
    }

    distanceToNearestBlast(index) {
      if (!this.state.lastBlastIndices || !this.state.lastBlastIndices.length) return 999;
      const x = index % CONFIG.boardSize;
      const y = Math.floor(index / CONFIG.boardSize);
      let best = 999;
      this.state.lastBlastIndices.forEach((blastIndex) => {
        const bx = blastIndex % CONFIG.boardSize;
        const by = Math.floor(blastIndex / CONFIG.boardSize);
        best = Math.min(best, Math.abs(bx - x) + Math.abs(by - y));
      });
      return best;
    }

    getBlastMakingGemTypes(index, board) {
      const out = [];
      GEM_TYPES.forEach((type) => {
        const test = board.slice();
        test[index] = { kind: 'gem', gemType: type };
        const groups = this.findBlastGroups(test);
        if (groups.some((run) => run.includes(index))) out.push(type);
      });
      return out;
    }

    pickWeighted(items) {
      const total = items.reduce((sum, item) => sum + Math.max(0, item.weight || 0), 0);
      if (total <= 0) return items[Math.floor(Math.random() * items.length)]?.type;
      let roll = Math.random() * total;
      for (const item of items) {
        roll -= Math.max(0, item.weight || 0);
        if (roll <= 0) return item.type;
      }
      return items[items.length - 1]?.type;
    }

    chooseRefillGemType(targetIndex, boardBeforeColumn) {
      if (!this.refillGemCounts) {
        this.refillGemCounts = Object.fromEntries(GEM_TYPES.map((type) => [type, 0]));
      }
      const x = targetIndex % CONFIG.boardSize;
      const y = Math.floor(targetIndex / CONFIG.boardSize);
      const neighbors = [];
      const addNeighbor = (xx, yy) => {
        if (xx < 0 || xx >= CONFIG.boardSize || yy < 0 || yy >= CONFIG.boardSize) return;
        const c = boardBeforeColumn[yy * CONFIG.boardSize + xx];
        if (this.isGem(c)) neighbors.push(c.gemType);
      };
      addNeighbor(x - 1, y);
      addNeighbor(x + 1, y);
      addNeighbor(x, y + 1);
      addNeighbor(x, y - 1);

      const minCount = Math.min(...GEM_TYPES.map((type) => this.refillGemCounts[type] || 0));
      const pool = GEM_TYPES
        .map((type) => {
          let weight = 8 - Math.max(0, (this.refillGemCounts[type] || 0) - minCount) * 3;
          weight -= neighbors.filter((n) => n === type).length * 2.5;
          return { type, weight: Math.max(1, weight) };
        })
        .sort((a, b) => b.weight - a.weight);

      const topWeight = pool[0].weight;
      const top = pool.filter((item) => item.weight >= topWeight - 1.5);
      const pick = top[Math.floor(Math.random() * top.length)].type;
      this.refillGemCounts[pick] = (this.refillGemCounts[pick] || 0) + 1;
      return pick;
    }

    countSameNeighbors(index, type, board) {
      const x = index % CONFIG.boardSize;
      const y = Math.floor(index / CONFIG.boardSize);
      let count = 0;
      const check = (xx, yy) => {
        if (xx < 0 || xx >= CONFIG.boardSize || yy < 0 || yy >= CONFIG.boardSize) return;
        const c = board[yy * CONFIG.boardSize + xx];
        if (this.isGem(c) && c.gemType === type) count++;
      };
      check(x - 1, y);
      check(x + 1, y);
      check(x, y - 1);
      check(x, y + 1);
      return count;
    }

    canUseAssistType(index, type, board) {
      if (!type) return false;
      const counts = this.refillGemCounts || {};
      const values = GEM_TYPES.map((gemType) => counts[gemType] || 0);
      const min = Math.min(...values);
      const maxAllowed = min + 2;
      if ((counts[type] || 0) > maxAllowed) return false;
      if (this.countSameNeighbors(index, type, board) > 2) return false;
      return true;
    }

    rememberRefillGem(type) {
      if (!this.refillGemCounts) this.refillGemCounts = Object.fromEntries(GEM_TYPES.map((gemType) => [gemType, 0]));
      this.refillGemCounts[type] = (this.refillGemCounts[type] || 0) + 1;
    }

    pickNaturalAssistType(types, targetIndex, boardContext) {
      const viable = [...new Set(types)].filter((type) => this.canUseAssistType(targetIndex, type, boardContext));
      if (!viable.length) return null;
      const counts = this.refillGemCounts || {};
      const weighted = viable.map((type) => {
        const sameNeighbors = this.countSameNeighbors(targetIndex, type, boardContext);
        const used = counts[type] || 0;
        return { type, weight: Math.max(1, 10 - used * 3 - sameNeighbors * 2) };
      });
      return this.pickWeighted(weighted);
    }

    makeRefillCell(targetIndex, boardContext) {
      let wallChance = this.state.chainWallChance == null ? this.getAdaptiveWallChance(boardContext) : this.state.chainWallChance;
      let boost = this.state.placementBoost || 0;
      const luck = Math.max(1, Math.min(10, this.state.chainLuck || 1));
      const luckFactor = luck / 10;
      const chainStep = Math.max(1, this.activeChainStep || 1);
      const earlyHyper = this.state.moveCount <= 10;
      const assistDecay = earlyHyper && chainStep <= (this.state.targetChainMin || 0) ? 1 : Math.pow(0.72, Math.max(0, chainStep - 1));
      const assistAllowed = !!this.state.placementMadeBlast && chainStep <= 9;

      if (this.state.moveCount <= CONFIG.earlyComboMoves) {
        boost = Math.max(boost, CONFIG.earlyComboRefillBoost);
        wallChance = Math.max(0, wallChance - CONFIG.earlyComboWallReduction);
      }
      if ((this.state.turnsSinceHugeCombo || 0) >= CONFIG.hugeComboChargeStart) {
        boost = Math.max(boost, CONFIG.hugeComboRefillBoost);
        wallChance = Math.max(0, wallChance - CONFIG.hugeComboWallReduction);
      }

      if (assistAllowed) wallChance = Math.max(0.04, wallChance - (0.11 + luckFactor * 0.18) * assistDecay);
      else if (boost > 0) wallChance = Math.max(0.10, wallChance - boost * 0.14);

      const farFromBlast = this.distanceToNearestBlast(targetIndex) >= 3;
      if (farFromBlast && !assistAllowed) wallChance += 0.16;
      wallChance = Math.max(0.10, Math.min(0.60, wallChance));

      // Keep pressure visible. Even when the assist is strong, walls still sneak in
      // so the refill looks organic instead of like the game dumped one gem color.
      if (Math.random() < wallChance) return { kind: 'wall', wallType: 'brick' };

      // Curated chaos: high luck creates hidden opportunities, not obvious floods.
      // We prefer natural-looking blast completions, but only when variety guards allow it.
      const blastTypes = this.getBlastMakingGemTypes(targetIndex, boardContext);
      const blastPick = this.pickNaturalAssistType(blastTypes, targetIndex, boardContext);
      const blastChance = assistAllowed ? Math.min(0.74, (0.16 + luckFactor * 0.48) * assistDecay) : 0;
      if (blastPick && Math.random() < blastChance) {
        this.rememberRefillGem(blastPick);
        return { kind: 'gem', gemType: blastPick };
      }

      const nearTypes = this.getNearMatchGemTypes(boardContext);
      const nearPick = this.pickNaturalAssistType(nearTypes, targetIndex, boardContext);
      const nearChance = assistAllowed ? Math.min(0.68, (0.18 + luckFactor * 0.38) * assistDecay) : boost * 0.18;
      if (nearPick && Math.random() < nearChance) {
        this.rememberRefillGem(nearPick);
        return { kind: 'gem', gemType: nearPick };
      }

      return { kind: 'gem', gemType: this.chooseRefillGemType(targetIndex, boardContext) };
    }

    getAdaptiveWallChance(board) {
      const walls = board.filter((c) => this.isWall(c)).length;
      const r = walls / board.length;
      if (r >= 0.65) return 0.08;
      if (r >= 0.55) return 0.18;
      if (r >= 0.45) return 0.30;
      if (r >= 0.35) return 0.42;
      if (r >= 0.25) return 0.54;
      return 0.68;
    }

    applyGravityWithRefill(done) {
      const size = CONFIG.boardSize;
      const next = Array(size * size).fill(null);
      const moves = [];
      this.refillGemCounts = Object.fromEntries(GEM_TYPES.map((type) => [type, 0]));
      for (let x = 0; x < size; x++) {
        const existing = [];
        for (let y = 0; y < size; y++) {
          const i = y * size + x;
          if (this.state.board[i]) existing.push({ cell: this.state.board[i], fromY: y });
        }
        const empty = size - existing.length;
        for (let y = 0; y < empty; y++) {
          const targetIndex = y * size + x;
          next[targetIndex] = this.makeRefillCell(targetIndex, next.map((c, i) => c || this.state.board[i]));
          moves.push({ x, fromY: y - empty, toY: y });
        }
        existing.forEach((item, n) => {
          const toY = empty + n;
          next[toY * size + x] = item.cell;
          if (item.fromY !== toY) moves.push({ x, fromY: item.fromY, toY });
        });
      }
      this.state.board = next;
      this.refillGemCounts = null;
      this.boardLayer.removeAll(true);
      this.cells = [];
      const bg = this.add.graphics();
      bg.fillStyle(CONFIG.boardFill, 1);
      bg.fillRoundedRect(this.layout.boardX, this.layout.boardY, this.layout.boardSize, this.layout.boardSize, 8 * this.layout.scale);
      this.boardLayer.add(bg);
      for (let i = 0; i < next.length; i++) this.drawCell(i, false);
      moves.forEach((m) => {
        const i = m.toY * size + m.x;
        const c = this.cells[i];
        if (!c) return;
        c.y -= (m.toY - m.fromY) * (this.layout.tile + CONFIG.gap);
        this.syncSvgArt(c);
      });
      this.tweens.add({
        targets: this.cells.filter(Boolean),
        y: (target) => {
          const idx = this.cells.indexOf(target);
          return this.cellXY(idx).y;
        },
        duration: CONFIG.gravityMs,
        ease: 'Cubic.easeOut',
        onUpdate: () => this.cells.forEach((c) => this.syncSvgArt(c)),
        onComplete: () => { this.cells.forEach((c) => this.syncSvgArt(c)); done(); }
      });
    }

    addScore(points) {
      const from = this.state.displayScore;
      this.state.score += points;
      const to = this.state.score;
      if (to > this.state.highScore) { this.state.highScore = to; this.writeHighScore(); }
      this.tweens.addCounter({
        from, to, duration: 420, ease: 'Cubic.easeOut',
        onUpdate: (tw) => {
          this.state.displayScore = Math.round(tw.getValue());
          const dom = this.getDom();
          if (dom.score) dom.score.textContent = String(this.state.displayScore);
          if (dom.highScore) dom.highScore.textContent = String(this.state.highScore);
        },
        onComplete: () => {
          this.pulseDomScore();
        }
      });
    }

    finishResolve() {
      const chain = this.state.maxChain || 0;
      const afterMessage = () => {
        if (chain >= CONFIG.hugeComboTarget) this.state.turnsSinceHugeCombo = 0;
        else this.state.turnsSinceHugeCombo = (this.state.turnsSinceHugeCombo || 0) + 1;
        this.state.maxChain = 0;
        this.state.chainWallChance = null;
        this.state.placementBoost = Math.max(0, (this.state.placementBoost || 0) - CONFIG.boostDecayPerMove);
        if (this.state.hand.every((p) => !p) || !this.hasAnyPlayableHand()) {
          this.state.hand = this.makeNewHand();
        }
        const wallIndices = this.turnRandomGemsIntoWalls(this.state.postMoveWallCount || 2);
        this.state.resolving = false;
        this.buildScene();
        wallIndices.forEach((wallIndex, n) => {
          if (wallIndex != null && this.cells[wallIndex]) {
            this.tweens.add({
              targets: this.cells[wallIndex],
              scale: 1.12,
              yoyo: true,
              delay: n * 45,
              duration: 105,
              onUpdate: () => this.syncSvgArt(this.cells[wallIndex]),
              onComplete: () => this.syncSvgArt(this.cells[wallIndex])
            });
          }
        });
      };
      if (chain >= 2) this.showBoardMessage('Combo', chain + 'x', afterMessage);
      else afterMessage();
    }

    turnRandomGemsIntoWalls(count) {
      const gems = [];
      this.state.board.forEach((c, i) => { if (this.isGem(c)) gems.push(i); });
      const out = [];
      const maxWalls = Math.floor(this.state.board.length * 0.58);
      let currentWalls = this.state.board.filter((c) => this.isWall(c)).length;
      for (let n = 0; n < count && gems.length && currentWalls < maxWalls; n++) {
        const pickIndex = Math.floor(Math.random() * gems.length);
        const index = gems.splice(pickIndex, 1)[0];
        this.state.board[index] = { kind: 'wall', wallType: 'brick' };
        out.push(index);
        currentWalls++;
      }
      return out;
    }

    hasAnyPlayableHand() {
      return this.state.hand.some((p) => {
        if (!p) return false;
        return this.state.board.some((c) => this.isGem(c));
      });
    }

    showBoardMessage(top, bottom, done) {
      const l = this.layout;
      const cx = Math.round(l.boardX + l.boardSize / 2);
      const cy = Math.round(l.boardY + l.boardSize / 2);
      this.cameras.main.shake(180, 0.0052);
      this.cameras.main.flash(130, 255, 204, 64, false, null, null);

      const root = document.createElement('div');
      root.className = 'bm-blast-message';
      root.style.left = `${cx}px`;
      root.style.top = `${cy}px`;
      root.style.setProperty('--bm-scale', String(l.scale * 0.75));
      root.innerHTML = `
        <div class="bm-blast-shock"></div>
        <div class="bm-blast-rays"></div>
        <div class="bm-blast-core"></div>
        <div class="bm-blast-ring"></div>
        <div class="bm-blast-cloud c1"></div>
        <div class="bm-blast-cloud c2"></div>
        <div class="bm-blast-cloud c3"></div>
        <div class="bm-blast-text"><span class="bm-blast-top">${top}</span><b class="bm-blast-bottom">${bottom}</b></div>
      `;
      document.body.appendChild(root);

      for (let i = 0; i < 52; i++) {
        const ember = document.createElement('i');
        ember.className = 'bm-blast-ember';
        const a = Math.random() * Math.PI * 2;
        const r = Phaser.Math.FloatBetween(66, 205) * l.scale;
        ember.style.setProperty('--dx', `${Math.round(Math.cos(a) * r)}px`);
        ember.style.setProperty('--dy', `${Math.round(Math.sin(a) * r * 0.72)}px`);
        ember.style.setProperty('--rot', `${Phaser.Math.Between(-540, 540)}deg`);
        ember.style.setProperty('--delay', `${Phaser.Math.Between(0, 90)}ms`);
        ember.style.width = `${Phaser.Math.Between(5, 15) * l.scale}px`;
        ember.style.height = `${Phaser.Math.Between(3, 8) * l.scale}px`;
        root.appendChild(ember);
      }

      window.setTimeout(() => {
        root.classList.add('is-leaving');
        window.setTimeout(() => { root.remove(); if (done) done(); }, 280);
      }, 1120);
    }  }

  const config = {
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#7588CB',
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH, width: window.innerWidth, height: window.innerHeight },
    input: { activePointers: 3 },
    audio: { disableWebAudio: false },
    resolution: DPR,
    render: { antialias: true, pixelArt: false, roundPixels: true, transparent: false, powerPreference: 'high-performance' },
    scene: [BlastMathScene]
  };

  window.BM_PHASER_GAME = new Phaser.Game(config);
})();
