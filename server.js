const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 5e6, // 5MB max for socket messages
  pingTimeout: 60000
});

// ====== SECURITY ======

// Helmet - secure HTTP headers (allow inline styles/scripts for our app)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:"]
    }
  }
}));

// Rate limiting for uploads
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // max 10 uploads per minute
  message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }
});

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer storage config with security
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    // Sanitize: only allow alphanumeric extension
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + ext;
    cb(null, uniqueName);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowedExt = /\.(jpeg|jpg|png|gif|webp)$/i;
    const allowedMime = /^image\/(jpeg|jpg|png|gif|webp)$/i;
    const extOk = allowedExt.test(path.extname(file.originalname));
    const mimeOk = allowedMime.test(file.mimetype);
    if (extOk && mimeOk) {
      cb(null, true);
    } else {
      cb(new Error('이미지 파일만 업로드 가능합니다. (jpg, png, gif, webp)'));
    }
  }
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Image upload endpoint with rate limiting
app.post('/upload', uploadLimiter, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({ filename: req.file.filename, path: '/uploads/' + req.file.filename });
});

// Error handler for multer
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: '파일 업로드 오류: ' + err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

// Auto-cleanup: delete uploaded images older than 2 hours
setInterval(() => {
  if (!fs.existsSync(uploadsDir)) return;
  const files = fs.readdirSync(uploadsDir);
  const now = Date.now();
  files.forEach(file => {
    const filePath = path.join(uploadsDir, file);
    try {
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > 2 * 60 * 60 * 1000) {
        fs.unlinkSync(filePath);
      }
    } catch (e) { /* ignore */ }
  });
}, 30 * 60 * 1000); // check every 30 minutes

// Room management
const rooms = new Map();

function generateRoomCode() {
  let code;
  do {
    code = Math.random().toString(36).substring(2, 8).toUpperCase();
  } while (rooms.has(code));
  return code;
}

// Socket.io
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  let currentRoom = null;
  let playerName = null;

  // Input sanitization helper
  function sanitize(str, maxLen = 20) {
    if (typeof str !== 'string') return '';
    return str.replace(/[<>"'&]/g, '').trim().substring(0, maxLen);
  }

  socket.on('create-room', (data, callback) => {
    if (typeof callback !== 'function') return;
    const roomCode = generateRoomCode();
    playerName = sanitize(data.name) || 'Host';
    currentRoom = roomCode;
    const gridSize = Math.min(10, Math.max(3, parseInt(data.gridSize) || 4));

    rooms.set(roomCode, {
      host: socket.id,
      players: new Map([[socket.id, { name: playerName, color: getPlayerColor(0) }]]),
      puzzleState: null,
      imageUrl: data.imageUrl,
      gridSize: gridSize,
      pieces: [],
      started: false
    });

    socket.join(roomCode);
    callback({ success: true, roomCode, playerId: socket.id });
    console.log(`Room ${roomCode} created by ${playerName}`);
  });

  socket.on('join-room', (data, callback) => {
    const { roomCode, name } = data;
    const room = rooms.get(roomCode);

    if (!room) {
      return callback({ success: false, error: '존재하지 않는 방 코드입니다.' });
    }
    if (room.players.size >= 30) {
      return callback({ success: false, error: '방이 가득 찼습니다. (최대 30명)' });
    }

    playerName = sanitize(name) || 'Player';
    currentRoom = roomCode;
    const playerIndex = room.players.size;

    room.players.set(socket.id, { name: playerName, color: getPlayerColor(playerIndex) });
    socket.join(roomCode);

    // Send current state to new player
    callback({
      success: true,
      roomCode,
      playerId: socket.id,
      imageUrl: room.imageUrl,
      gridSize: room.gridSize,
      pieces: room.pieces,
      started: room.started
    });

    // Notify everyone about updated player list
    broadcastPlayerList(roomCode);
    console.log(`${playerName} joined room ${roomCode}`);
  });

  socket.on('start-puzzle', (data) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.host !== socket.id) return;

    room.pieces = data.pieces;
    room.started = true;

    io.to(currentRoom).emit('puzzle-started', {
      pieces: data.pieces,
      imageUrl: room.imageUrl,
      gridSize: room.gridSize
    });
  });

  socket.on('piece-move', (data) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    const playerInfo = room ? room.players.get(socket.id) : null;
    socket.to(currentRoom).emit('piece-moved', {
      pieceId: data.pieceId,
      x: data.x,
      y: data.y,
      playerId: socket.id,
      playerName: playerName,
      playerColor: playerInfo ? playerInfo.color : '#6c5ce7'
    });
  });

  socket.on('piece-place', (data) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    // Update piece position in room state
    const piece = room.pieces.find(p => p.id === data.pieceId);
    if (piece) {
      piece.currentX = data.x;
      piece.currentY = data.y;
      piece.placed = data.placed;
      piece.placedBy = data.placed ? socket.id : null;
    }

    io.to(currentRoom).emit('piece-placed', {
      pieceId: data.pieceId,
      x: data.x,
      y: data.y,
      placed: data.placed,
      playerId: socket.id,
      playerName: playerName
    });

    // Check completion
    if (room.pieces.length > 0 && room.pieces.every(p => p.placed)) {
      io.to(currentRoom).emit('puzzle-complete', { message: '🎉 퍼즐 완성!' });
    }
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    if (currentRoom) {
      const room = rooms.get(currentRoom);
      if (room) {
        room.players.delete(socket.id);
        if (room.players.size === 0) {
          // Clean up uploaded image
          if (room.imageUrl) {
            const imgPath = path.join(__dirname, 'public', room.imageUrl);
            if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
          }
          rooms.delete(currentRoom);
          console.log(`Room ${currentRoom} deleted (empty)`);
        } else {
          // Transfer host if needed
          if (room.host === socket.id) {
            room.host = room.players.keys().next().value;
          }
          broadcastPlayerList(currentRoom);
        }
      }
    }
  });
});

function broadcastPlayerList(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const players = [];
  room.players.forEach((val, id) => {
    players.push({ id, name: val.name, color: val.color, isHost: id === room.host });
  });
  io.to(roomCode).emit('player-list', players);
}

const PLAYER_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
  '#BB8FCE', '#85C1E9', '#F8C471', '#82E0AA'
];

function getPlayerColor(index) {
  return PLAYER_COLORS[index % PLAYER_COLORS.length];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🧩 Puzzle server running at http://localhost:${PORT}`);
});
