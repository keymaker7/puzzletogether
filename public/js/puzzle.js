/**
 * Puzzle Engine - Varied jigsaw shapes, player labels, placement effects
 */
class PuzzleEngine {
  constructor(container, boardEl) {
    this.container = container;
    this.board = boardEl;
    this.pieces = [];
    this.image = null;
    this.gridSize = 4;
    this.pieceWidth = 0;
    this.pieceHeight = 0;
    this.pad = 0;
    this.targetAreaX = 0;
    this.targetAreaY = 0;
    this.draggingPiece = null;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;
    this.snapThreshold = 25;
    this.onPieceMove = null;
    this.onPiecePlace = null;
    this.totalPieces = 0;
    this.placedPieces = 0;

    this._boundMouseDown = this._handleMouseDown.bind(this);
    this._boundMouseMove = this._handleMouseMove.bind(this);
    this._boundMouseUp = this._handleMouseUp.bind(this);
    this._boundTouchStart = this._handleTouchStart.bind(this);
    this._boundTouchMove = this._handleTouchMove.bind(this);
    this._boundTouchEnd = this._handleTouchEnd.bind(this);
  }

  // ====== JIGSAW EDGE with variation ======

  _drawJigsawEdge(ctx, x0, y0, x1, y1, tabCfg) {
    const dir = typeof tabCfg === 'number' ? tabCfg : tabCfg.dir;
    if (dir === 0) { ctx.lineTo(x1, y1); return; }

    const off = (typeof tabCfg === 'object' ? tabCfg.offset : 0) || 0;
    const sc = (typeof tabCfg === 'object' ? tabCfg.scale : 1) || 1;
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    const nx = dy / len, ny = -dx / len;
    const d = dir;

    const pt = (along, perp) => [
      x0 + dx * along + nx * d * perp * sc * len,
      y0 + dy * along + ny * d * perp * sc * len
    ];

    const o = off;
    ctx.lineTo(...pt(0.34 + o, 0));
    ctx.bezierCurveTo(...pt(0.34 + o, 0.02), ...pt(0.35 + o, 0.06), ...pt(0.37 + o, 0.08));
    ctx.bezierCurveTo(...pt(0.32 + o, 0.10), ...pt(0.30 + o, 0.16), ...pt(0.34 + o, 0.20));
    ctx.bezierCurveTo(...pt(0.38 + o, 0.24), ...pt(0.44 + o, 0.265), ...pt(0.50 + o, 0.265));
    ctx.bezierCurveTo(...pt(0.56 + o, 0.265), ...pt(0.62 + o, 0.24), ...pt(0.66 + o, 0.20));
    ctx.bezierCurveTo(...pt(0.70 + o, 0.16), ...pt(0.68 + o, 0.10), ...pt(0.63 + o, 0.08));
    ctx.bezierCurveTo(...pt(0.65 + o, 0.06), ...pt(0.66 + o, 0.02), ...pt(0.66 + o, 0));
    ctx.lineTo(x1, y1);
  }

  _drawPiecePath(ctx, x, y, w, h, tabs) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    this._drawJigsawEdge(ctx, x, y, x + w, y, tabs.top);
    this._drawJigsawEdge(ctx, x + w, y, x + w, y + h, tabs.right);
    this._drawJigsawEdge(ctx, x + w, y + h, x, y + h, tabs.bottom);
    this._drawJigsawEdge(ctx, x, y + h, x, y, tabs.left);
    ctx.closePath();
  }

  // ====== TAB CONFIG with variation ======

  _generateTabConfig() {
    const config = [];
    const randEdge = (isFlat) => {
      if (isFlat) return { dir: 0, offset: 0, scale: 1 };
      return {
        dir: Math.random() > 0.5 ? 1 : -1,
        offset: (Math.random() - 0.5) * 0.06,
        scale: 0.85 + Math.random() * 0.3
      };
    };
    const mirror = (e) => ({ dir: -e.dir, offset: e.offset, scale: e.scale });

    for (let row = 0; row < this.gridSize; row++) {
      config[row] = [];
      for (let col = 0; col < this.gridSize; col++) {
        config[row][col] = {
          top: row === 0 ? randEdge(true) : mirror(config[row - 1][col].bottom),
          left: col === 0 ? randEdge(true) : mirror(config[row][col - 1].right),
          bottom: randEdge(row === this.gridSize - 1),
          right: randEdge(col === this.gridSize - 1)
        };
      }
    }
    return config;
  }

  // ====== PIECE RENDERING ======

  _renderPiece(row, col, tabs) {
    const w = this.pieceWidth, h = this.pieceHeight, pad = this.pad;
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = (w + pad * 2) * scale;
    canvas.height = (h + pad * 2) * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    ctx.save();
    this._drawPiecePath(ctx, pad, pad, w, h, tabs);
    ctx.clip();

    const srcPW = this.image.width / this.gridSize;
    const srcPH = this.image.height / this.gridSize;
    const padSrcX = pad * srcPW / w, padSrcY = pad * srcPH / h;
    ctx.drawImage(this.image,
      col * srcPW - padSrcX, row * srcPH - padSrcY,
      srcPW + 2 * padSrcX, srcPH + 2 * padSrcY,
      0, 0, w + pad * 2, h + pad * 2
    );
    ctx.restore();

    // Border
    this._drawPiecePath(ctx, pad, pad, w, h, tabs);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    this._drawPiecePath(ctx, pad, pad, w, h, tabs);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 0.7;
    ctx.stroke();

    return canvas.toDataURL('image/png');
  }

  // ====== INIT ======

  async init(imageUrl, gridSize) {
    this.gridSize = gridSize;
    this.board.innerHTML = '';
    this.pieces = [];
    this.placedPieces = 0;

    return new Promise((resolve, reject) => {
      this.image = new Image();
      this.image.crossOrigin = 'anonymous';
      this.image.onload = () => {
        this._calculateDimensions();
        this._addGhostImage(imageUrl);
        this._createTargetArea();
        const tabConfig = this._generateTabConfig();
        const piecesData = this._generatePieces(tabConfig);
        this._bindEvents();
        resolve(piecesData);
      };
      this.image.onerror = reject;
      this.image.src = imageUrl;
    });
  }

  _calculateDimensions() {
    const rect = this.container.getBoundingClientRect();
    const cw = rect.width, ch = rect.height;
    const imgAspect = this.image.width / this.image.height;
    const targetMaxW = cw * 0.5, targetMaxH = ch * 0.85;
    let targetW, targetH;
    if (targetMaxW / targetMaxH > imgAspect) { targetH = targetMaxH; targetW = targetH * imgAspect; }
    else { targetW = targetMaxW; targetH = targetW / imgAspect; }

    this.targetAreaX = (cw * 0.5 - targetW) / 2 + 20;
    this.targetAreaY = (ch - targetH) / 2;
    this.puzzleW = targetW;
    this.puzzleH = targetH;
    this.pieceWidth = targetW / this.gridSize;
    this.pieceHeight = targetH / this.gridSize;
    this.pad = Math.max(this.pieceWidth, this.pieceHeight) * 0.28;
    this.scatterMinX = cw * 0.52;
    this.scatterMaxX = cw - this.pieceWidth - 20;
    this.scatterMinY = 20;
    this.scatterMaxY = ch - this.pieceHeight - 20;
  }

  _addGhostImage(imageUrl) {
    const ghost = document.createElement('img');
    ghost.src = imageUrl;
    ghost.style.cssText = `position:absolute;left:${this.targetAreaX}px;top:${this.targetAreaY}px;
      width:${this.puzzleW}px;height:${this.puzzleH}px;opacity:0.12;pointer-events:none;border-radius:6px;`;
    this.board.appendChild(ghost);
  }

  _createTargetArea() {
    for (let row = 0; row < this.gridSize; row++) {
      for (let col = 0; col < this.gridSize; col++) {
        const t = document.createElement('div');
        t.className = 'puzzle-target';
        t.style.left = (this.targetAreaX + col * this.pieceWidth) + 'px';
        t.style.top = (this.targetAreaY + row * this.pieceHeight) + 'px';
        t.style.width = this.pieceWidth + 'px';
        t.style.height = this.pieceHeight + 'px';
        this.board.appendChild(t);
      }
    }
  }

  _generatePieces(tabConfig) {
    const piecesData = [];
    for (let row = 0; row < this.gridSize; row++) {
      for (let col = 0; col < this.gridSize; col++) {
        const id = `piece-${row}-${col}`;
        const tabs = tabConfig[row][col];
        const imageData = this._renderPiece(row, col, tabs);
        const scatterX = this.scatterMinX + Math.random() * (this.scatterMaxX - this.scatterMinX);
        const scatterY = this.scatterMinY + Math.random() * (this.scatterMaxY - this.scatterMinY);
        const targetX = this.targetAreaX + col * this.pieceWidth;
        const targetY = this.targetAreaY + row * this.pieceHeight;
        const pd = { id, row, col, tabs, currentX: scatterX, currentY: scatterY, targetX, targetY, placed: false, imageData };
        piecesData.push(pd);
        this._createPieceElement(pd);
      }
    }
    this.totalPieces = piecesData.length;
    return piecesData;
  }

  _createPieceElement(pd) {
    const pad = this.pad;
    const el = document.createElement('div');
    el.className = 'puzzle-piece';
    el.id = pd.id;
    el.dataset.row = pd.row;
    el.dataset.col = pd.col;
    el.style.width = (this.pieceWidth + pad * 2) + 'px';
    el.style.height = (this.pieceHeight + pad * 2) + 'px';
    el.style.backgroundImage = `url(${pd.imageData})`;
    el.style.backgroundSize = '100% 100%';

    if (pd.placed) {
      el.classList.add('placed');
      el.style.left = (pd.targetX - pad) + 'px';
      el.style.top = (pd.targetY - pad) + 'px';
    } else {
      el.style.left = (pd.currentX - pad) + 'px';
      el.style.top = (pd.currentY - pad) + 'px';
    }
    this.board.appendChild(el);
    this.pieces.push({ el, id: pd.id, row: pd.row, col: pd.col, targetX: pd.targetX, targetY: pd.targetY, placed: pd.placed });
  }

  // ====== LOAD FROM STATE ======

  loadFromState(piecesData, imageUrl, gridSize) {
    this.gridSize = gridSize;
    this.board.innerHTML = '';
    this.pieces = [];
    this.placedPieces = 0;

    return new Promise((resolve) => {
      this.image = new Image();
      this.image.crossOrigin = 'anonymous';
      this.image.onload = () => {
        this._calculateDimensions();
        this._addGhostImage(imageUrl);
        this._createTargetArea();

        piecesData.forEach(pd => {
          pd.targetX = this.targetAreaX + pd.col * this.pieceWidth;
          pd.targetY = this.targetAreaY + pd.row * this.pieceHeight;
          if (!pd.imageData && pd.tabs) pd.imageData = this._renderPiece(pd.row, pd.col, pd.tabs);
          if (!pd.placed) {
            pd.currentX = this.scatterMinX + Math.random() * (this.scatterMaxX - this.scatterMinX);
            pd.currentY = this.scatterMinY + Math.random() * (this.scatterMaxY - this.scatterMinY);
          } else {
            pd.currentX = pd.targetX;
            pd.currentY = pd.targetY;
            this.placedPieces++;
          }
          this._createPieceElement(pd);
        });

        this.totalPieces = piecesData.length;
        this._bindEvents();
        resolve();
      };
      this.image.src = imageUrl;
    });
  }

  // ====== EVENTS ======

  _bindEvents() {
    this.board.addEventListener('mousedown', this._boundMouseDown);
    document.addEventListener('mousemove', this._boundMouseMove);
    document.addEventListener('mouseup', this._boundMouseUp);
    this.board.addEventListener('touchstart', this._boundTouchStart, { passive: false });
    document.addEventListener('touchmove', this._boundTouchMove, { passive: false });
    document.addEventListener('touchend', this._boundTouchEnd);
  }

  destroy() {
    this.board.removeEventListener('mousedown', this._boundMouseDown);
    document.removeEventListener('mousemove', this._boundMouseMove);
    document.removeEventListener('mouseup', this._boundMouseUp);
    this.board.removeEventListener('touchstart', this._boundTouchStart);
    document.removeEventListener('touchmove', this._boundTouchMove);
    document.removeEventListener('touchend', this._boundTouchEnd);
  }

  _handleMouseDown(e) {
    const piece = e.target.closest('.puzzle-piece');
    if (!piece || piece.classList.contains('placed')) return;
    const rect = this.container.getBoundingClientRect();
    this.draggingPiece = piece;
    this.dragOffsetX = e.clientX - piece.offsetLeft - rect.left;
    this.dragOffsetY = e.clientY - piece.offsetTop - rect.top;
    piece.classList.add('dragging');
    piece.style.zIndex = 100;
  }

  _handleMouseMove(e) {
    if (!this.draggingPiece) return;
    e.preventDefault();
    const rect = this.container.getBoundingClientRect();
    const x = e.clientX - rect.left - this.dragOffsetX;
    const y = e.clientY - rect.top - this.dragOffsetY;
    this.draggingPiece.style.left = x + 'px';
    this.draggingPiece.style.top = y + 'px';
    if (!this._moveThrottle) {
      this._moveThrottle = true;
      setTimeout(() => { this._moveThrottle = false; }, 50);
      if (this.onPieceMove) this.onPieceMove(this.draggingPiece.id, x, y);
    }
  }

  _handleMouseUp() {
    if (!this.draggingPiece) return;
    this._placePiece(this.draggingPiece);
    this.draggingPiece.classList.remove('dragging');
    this.draggingPiece.style.zIndex = '';
    this.draggingPiece = null;
  }

  _handleTouchStart(e) {
    const touch = e.touches[0];
    const piece = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!piece || !piece.classList.contains('puzzle-piece') || piece.classList.contains('placed')) return;
    e.preventDefault();
    const rect = this.container.getBoundingClientRect();
    this.draggingPiece = piece;
    this.dragOffsetX = touch.clientX - piece.offsetLeft - rect.left;
    this.dragOffsetY = touch.clientY - piece.offsetTop - rect.top;
    piece.classList.add('dragging');
    piece.style.zIndex = 100;
  }

  _handleTouchMove(e) {
    if (!this.draggingPiece) return;
    e.preventDefault();
    const touch = e.touches[0];
    const rect = this.container.getBoundingClientRect();
    const x = touch.clientX - rect.left - this.dragOffsetX;
    const y = touch.clientY - rect.top - this.dragOffsetY;
    this.draggingPiece.style.left = x + 'px';
    this.draggingPiece.style.top = y + 'px';
    if (!this._moveThrottle) {
      this._moveThrottle = true;
      setTimeout(() => { this._moveThrottle = false; }, 50);
      if (this.onPieceMove) this.onPieceMove(this.draggingPiece.id, x, y);
    }
  }

  _handleTouchEnd() {
    if (!this.draggingPiece) return;
    this._placePiece(this.draggingPiece);
    this.draggingPiece.classList.remove('dragging');
    this.draggingPiece.style.zIndex = '';
    this.draggingPiece = null;
  }

  // ====== PLACEMENT + EFFECT ======

  _placePiece(pieceEl) {
    const pieceInfo = this.pieces.find(p => p.id === pieceEl.id);
    if (!pieceInfo) return;
    const pad = this.pad;
    const bodyX = parseFloat(pieceEl.style.left) + pad;
    const bodyY = parseFloat(pieceEl.style.top) + pad;
    const dx = Math.abs(bodyX - pieceInfo.targetX);
    const dy = Math.abs(bodyY - pieceInfo.targetY);

    if (dx < this.snapThreshold && dy < this.snapThreshold) {
      pieceEl.style.left = (pieceInfo.targetX - pad) + 'px';
      pieceEl.style.top = (pieceInfo.targetY - pad) + 'px';
      pieceEl.classList.add('placed');
      pieceInfo.placed = true;
      this.placedPieces++;
      this.showPlacementEffect(pieceEl.id);
      if (this.onPiecePlace) this.onPiecePlace(pieceEl.id, pieceInfo.targetX - pad, pieceInfo.targetY - pad, true);
    } else {
      const cx = parseFloat(pieceEl.style.left), cy = parseFloat(pieceEl.style.top);
      if (this.onPiecePlace) this.onPiecePlace(pieceEl.id, cx, cy, false);
    }
  }

  /**
   * Show sparkle + bounce effect when piece is placed correctly
   */
  showPlacementEffect(pieceId) {
    const el = document.getElementById(pieceId);
    if (!el) return;

    // Bounce animation
    el.classList.add('snap-effect');
    setTimeout(() => el.classList.remove('snap-effect'), 500);

    // Sparkle particles
    const rect = el.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();
    const cx = rect.left - containerRect.left + rect.width / 2;
    const cy = rect.top - containerRect.top + rect.height / 2;

    const colors = ['#FFD700', '#00D2D3', '#FF6B6B', '#A29BFE', '#FFEAA7', '#55EFC4'];
    for (let i = 0; i < 10; i++) {
      const spark = document.createElement('div');
      spark.className = 'snap-particle';
      const angle = (i / 10) * Math.PI * 2 + Math.random() * 0.3;
      const dist = 25 + Math.random() * 35;
      spark.style.left = cx + 'px';
      spark.style.top = cy + 'px';
      spark.style.background = colors[i % colors.length];
      spark.style.setProperty('--tx', Math.cos(angle) * dist + 'px');
      spark.style.setProperty('--ty', Math.sin(angle) * dist + 'px');
      this.container.appendChild(spark);
      setTimeout(() => spark.remove(), 700);
    }
  }

  // ====== REMOTE SYNC ======

  movePieceRemote(pieceId, x, y, playerName, playerColor) {
    const el = document.getElementById(pieceId);
    if (!el || el.classList.contains('placed')) return;
    el.style.left = x + 'px';
    el.style.top = y + 'px';

    // Show player name label
    let label = el.querySelector('.piece-player-label');
    if (!label) {
      label = document.createElement('div');
      label.className = 'piece-player-label';
      el.appendChild(label);
    }
    label.textContent = playerName || '???';
    if (playerColor) label.style.background = playerColor;

    el.classList.add('other-dragging');
    clearTimeout(el._remoteDragTimeout);
    el._remoteDragTimeout = setTimeout(() => {
      el.classList.remove('other-dragging');
      const lbl = el.querySelector('.piece-player-label');
      if (lbl) lbl.remove();
    }, 400);
  }

  placePieceRemote(pieceId, x, y, placed) {
    const el = document.getElementById(pieceId);
    if (!el) return;
    const pieceInfo = this.pieces.find(p => p.id === pieceId);
    // Remove label if any
    const lbl = el.querySelector('.piece-player-label');
    if (lbl) lbl.remove();

    if (placed && pieceInfo) {
      const pad = this.pad;
      el.style.left = (pieceInfo.targetX - pad) + 'px';
      el.style.top = (pieceInfo.targetY - pad) + 'px';
      el.classList.add('placed');
      if (!pieceInfo.placed) { pieceInfo.placed = true; this.placedPieces++; }
      this.showPlacementEffect(pieceId);
    } else {
      el.style.left = x + 'px'; el.style.top = y + 'px';
    }
    el.classList.remove('other-dragging');
  }

  getProgress() {
    return { placed: this.placedPieces, total: this.totalPieces };
  }
}
