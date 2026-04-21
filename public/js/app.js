/**
 * App Controller - Handles screens, socket events, and UI interactions
 */
(function () {
  // ====== ELEMENTS ======
  const screens = {
    lobby: document.getElementById('screen-lobby'),
    create: document.getElementById('screen-create'),
    join: document.getElementById('screen-join'),
    puzzle: document.getElementById('screen-puzzle')
  };

  const el = {
    btnCreate: document.getElementById('btn-create'),
    btnJoin: document.getElementById('btn-join'),
    btnBackCreate: document.getElementById('btn-back-create'),
    btnBackJoin: document.getElementById('btn-back-join'),
    btnCreateRoom: document.getElementById('btn-create-room'),
    btnJoinRoom: document.getElementById('btn-join-room'),
    createName: document.getElementById('create-name'),
    joinName: document.getElementById('join-name'),
    joinCode: document.getElementById('join-code'),
    uploadArea: document.getElementById('upload-area'),
    imageUpload: document.getElementById('image-upload'),
    gridSize: document.getElementById('grid-size'),
    displayRoomCode: document.getElementById('display-room-code'),
    roomCodeDisplay: document.getElementById('room-code-display'),
    playerList: document.getElementById('player-list'),
    progressBar: document.getElementById('progress-bar'),
    progressText: document.getElementById('progress-text'),
    referenceImage: document.getElementById('reference-image'),
    btnToggleRef: document.getElementById('btn-toggle-ref'),
    btnLeave: document.getElementById('btn-leave'),
    completionOverlay: document.getElementById('completion-overlay'),
    btnNewGame: document.getElementById('btn-new-game'),
    puzzleContainer: document.getElementById('puzzle-container'),
    puzzleBoard: document.getElementById('puzzle-board')
  };

  // ====== STATE ======
  let socket = null;
  let engine = null;
  let uploadedImageUrl = null;
  let previewDataUrl = null;
  let currentRoomCode = null;
  let isHost = false;
  let playerId = null;

  // ====== SCREEN NAVIGATION ======
  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  el.btnCreate.addEventListener('click', () => showScreen('create'));
  el.btnJoin.addEventListener('click', () => showScreen('join'));
  el.btnBackCreate.addEventListener('click', () => showScreen('lobby'));
  el.btnBackJoin.addEventListener('click', () => showScreen('lobby'));

  // ====== IMAGE UPLOAD ======
  el.uploadArea.addEventListener('click', () => el.imageUpload.click());

  el.uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    el.uploadArea.style.borderColor = 'var(--accent)';
  });

  el.uploadArea.addEventListener('dragleave', () => {
    el.uploadArea.style.borderColor = '';
  });

  el.uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    el.uploadArea.style.borderColor = '';
    if (e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  el.imageUpload.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  });

  function handleFile(file) {
    if (!file.type.startsWith('image/')) {
      alert('이미지 파일만 업로드 가능합니다.');
      return;
    }

    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => {
      previewDataUrl = e.target.result;
      el.uploadArea.innerHTML = `<img src="${previewDataUrl}" alt="미리보기">`;
      el.uploadArea.classList.add('has-image');
      el.btnCreateRoom.disabled = false;
    };
    reader.readAsDataURL(file);

    // Upload to server
    const formData = new FormData();
    formData.append('image', file);
    fetch('/upload', { method: 'POST', body: formData })
      .then(res => res.json())
      .then(data => {
        uploadedImageUrl = data.path;
      })
      .catch(err => {
        console.error('Upload error:', err);
        alert('이미지 업로드에 실패했습니다.');
      });
  }

  // ====== SOCKET CONNECTION ======
  function connectSocket() {
    if (socket) return;
    socket = io();

    socket.on('player-list', (players) => {
      renderPlayerList(players);
    });

    socket.on('puzzle-started', async (data) => {
      await startPuzzleBoard(data.imageUrl, data.gridSize, data.pieces);
    });

    socket.on('piece-moved', (data) => {
      if (engine && data.playerId !== playerId) {
        engine.movePieceRemote(data.pieceId, data.x, data.y, data.playerName, data.playerColor);
      }
    });

    socket.on('piece-placed', (data) => {
      if (engine && data.playerId !== playerId) {
        engine.placePieceRemote(data.pieceId, data.x, data.y, data.placed);
      }
      if (data.placed && data.playerName) {
        showToast(`✅ ${data.playerName}님이 조각을 맞췄어요!`);
      }
      updateProgress();
    });

    socket.on('puzzle-complete', () => {
      showCompletion();
    });
  }

  // ====== CREATE ROOM ======
  el.btnCreateRoom.addEventListener('click', async () => {
    const name = el.createName.value.trim() || '선생님';
    const gridSize = parseInt(el.gridSize.value);

    if (!uploadedImageUrl) {
      alert('이미지를 먼저 업로드해주세요.');
      return;
    }

    connectSocket();

    socket.emit('create-room', { name, imageUrl: uploadedImageUrl, gridSize }, (res) => {
      if (res.success) {
        currentRoomCode = res.roomCode;
        playerId = res.playerId;
        isHost = true;

        el.displayRoomCode.textContent = currentRoomCode;
        showScreen('puzzle');

        // Show start overlay for host
        showStartOverlay(uploadedImageUrl, gridSize);
      }
    });
  });

  // ====== JOIN ROOM ======
  el.btnJoinRoom.addEventListener('click', () => {
    const name = el.joinName.value.trim() || '학생';
    const roomCode = el.joinCode.value.trim().toUpperCase();

    if (roomCode.length < 4) {
      alert('유효한 방 코드를 입력해주세요.');
      return;
    }

    connectSocket();

    socket.emit('join-room', { roomCode, name }, async (res) => {
      if (res.success) {
        currentRoomCode = res.roomCode;
        playerId = res.playerId;
        isHost = false;

        el.displayRoomCode.textContent = currentRoomCode;
        showScreen('puzzle');

        if (res.started && res.pieces.length > 0) {
          await startPuzzleBoard(res.imageUrl, res.gridSize, res.pieces);
        } else {
          showWaitingMessage();
        }
      } else {
        alert(res.error || '방에 참가할 수 없습니다.');
      }
    });
  });

  // ====== ROOM CODE COPY ======
  el.roomCodeDisplay.addEventListener('click', () => {
    if (currentRoomCode) {
      navigator.clipboard.writeText(currentRoomCode).then(() => {
        showToast('방 코드가 복사되었습니다!');
      });
    }
  });

  // ====== START OVERLAY (HOST) ======
  function showStartOverlay(imageUrl, gridSize) {
    const overlay = document.createElement('div');
    overlay.className = 'start-overlay';
    overlay.id = 'start-overlay';
    overlay.innerHTML = `
      <img class="preview-image" src="${previewDataUrl || imageUrl}" alt="퍼즐 이미지">
      <h2>퍼즐 준비 완료!</h2>
      <p>학생들이 입장하면 시작 버튼을 눌러주세요</p>
      <button class="btn btn-primary" id="btn-start-puzzle">🎮 퍼즐 시작!</button>
    `;
    el.puzzleContainer.appendChild(overlay);

    document.getElementById('btn-start-puzzle').addEventListener('click', async () => {
      overlay.remove();
      await initAndStartPuzzle(imageUrl, gridSize);
    });
  }

  function showWaitingMessage() {
    const msg = document.createElement('div');
    msg.className = 'waiting-message';
    msg.id = 'waiting-message';
    msg.innerHTML = `
      <div class="spinner"></div>
      <h2>선생님이 퍼즐을 시작할 때까지 기다려주세요...</h2>
    `;
    el.puzzleContainer.appendChild(msg);
  }

  // ====== PUZZLE INIT ======
  async function initAndStartPuzzle(imageUrl, gridSize) {
    engine = new PuzzleEngine(el.puzzleContainer, el.puzzleBoard);

    engine.onPieceMove = (pieceId, x, y) => {
      socket.emit('piece-move', { pieceId, x, y });
    };

    engine.onPiecePlace = (pieceId, x, y, placed) => {
      socket.emit('piece-place', { pieceId, x, y, placed });
      updateProgress();
    };

    const pieces = await engine.init(imageUrl, gridSize);

    // Set reference image
    el.referenceImage.src = previewDataUrl || imageUrl;

    // Strip imageData before sending - each client renders pieces locally
    // This reduces payload from several MB to just a few KB
    const piecesForSync = pieces.map(p => ({
      id: p.id, row: p.row, col: p.col,
      tabs: p.tabs,
      currentX: p.currentX, currentY: p.currentY,
      targetX: p.targetX, targetY: p.targetY,
      placed: p.placed
    }));
    socket.emit('start-puzzle', { pieces: piecesForSync });
    updateProgress();
  }

  async function startPuzzleBoard(imageUrl, gridSize, pieces) {
    // Remove waiting message
    const waitMsg = document.getElementById('waiting-message');
    if (waitMsg) waitMsg.remove();
    const startOvl = document.getElementById('start-overlay');
    if (startOvl) startOvl.remove();

    engine = new PuzzleEngine(el.puzzleContainer, el.puzzleBoard);

    engine.onPieceMove = (pieceId, x, y) => {
      socket.emit('piece-move', { pieceId, x, y });
    };

    engine.onPiecePlace = (pieceId, x, y, placed) => {
      socket.emit('piece-place', { pieceId, x, y, placed });
      updateProgress();
    };

    await engine.loadFromState(pieces, imageUrl, gridSize);

    el.referenceImage.src = imageUrl;
    updateProgress();
  }

  // ====== PLAYER LIST ======
  function renderPlayerList(players) {
    el.playerList.innerHTML = '';
    players.forEach(p => {
      const li = document.createElement('li');
      li.className = 'player-item';
      li.innerHTML = `
        <span class="player-dot" style="background:${p.color}"></span>
        <span class="player-name">${escapeHTML(p.name)}</span>
        ${p.isHost ? '<span class="player-host-badge">HOST</span>' : ''}
      `;
      el.playerList.appendChild(li);
    });
  }

  // ====== PROGRESS ======
  function updateProgress() {
    if (!engine) return;
    const { placed, total } = engine.getProgress();
    const pct = total > 0 ? Math.round((placed / total) * 100) : 0;
    el.progressBar.style.width = pct + '%';
    el.progressText.textContent = `${placed} / ${total} 조각 (${pct}%)`;
  }

  // ====== REFERENCE IMAGE TOGGLE ======
  let refVisible = false;
  el.btnToggleRef.addEventListener('click', () => {
    refVisible = !refVisible;
    el.referenceImage.style.display = refVisible ? 'block' : 'none';
    el.btnToggleRef.textContent = refVisible ? '🖼️ 원본 숨기기' : '🖼️ 원본 보기';
  });

  // ====== LEAVE ======
  el.btnLeave.addEventListener('click', () => {
    if (confirm('정말 방을 나가시겠습니까?')) {
      leaveRoom();
    }
  });

  function leaveRoom() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    if (engine) {
      engine.destroy();
      engine = null;
    }
    currentRoomCode = null;
    isHost = false;
    playerId = null;
    uploadedImageUrl = null;
    previewDataUrl = null;
    el.puzzleBoard.innerHTML = '';
    el.completionOverlay.style.display = 'none';

    // Reset upload area
    el.uploadArea.innerHTML = `
      <div class="upload-icon">📁</div>
      <div class="upload-text"><strong>클릭</strong> 또는 이미지를 <strong>드래그</strong>하세요</div>
    `;
    el.uploadArea.classList.remove('has-image');
    el.btnCreateRoom.disabled = true;

    showScreen('lobby');
  }

  // ====== COMPLETION ======
  function showCompletion() {
    el.completionOverlay.style.display = 'flex';
    launchConfetti();
  }

  el.btnNewGame.addEventListener('click', () => {
    leaveRoom();
  });

  function launchConfetti() {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#6c5ce7', '#ff9ff3'];
    for (let i = 0; i < 80; i++) {
      setTimeout(() => {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = Math.random() * 100 + 'vw';
        confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.width = (Math.random() * 10 + 5) + 'px';
        confetti.style.height = (Math.random() * 10 + 5) + 'px';
        confetti.style.animationDuration = (Math.random() * 2 + 2) + 's';
        document.body.appendChild(confetti);
        setTimeout(() => confetti.remove(), 4000);
      }, i * 30);
    }
  }

  // ====== UTILS ======
  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'copied-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ====== ENTER KEY SUPPORT ======
  el.joinCode.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') el.btnJoinRoom.click();
  });

  el.joinName.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') el.joinCode.focus();
  });

  el.createName.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') el.uploadArea.click();
  });

})();
