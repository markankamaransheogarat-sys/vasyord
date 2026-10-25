const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Persistent SQLite-free JSON storage for room messages
const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const DB_FILE = path.join(DATA_DIR, 'messages.json');

let roomMessages = {};
try {
  if (fs.existsSync(DB_FILE)) {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    roomMessages = JSON.parse(raw);
    console.log(`[Vasyord DB] Loaded persistent messages for rooms: ${Object.keys(roomMessages).join(', ')}`);
  }
} catch (e) {
  console.error('[Vasyord DB] Error loading messages:', e);
  roomMessages = {};
}

function saveMessagesToFile() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(roomMessages, null, 2), 'utf-8');
  } catch (e) {
    console.error('[Vasyord DB] Error saving messages:', e);
  }
}

// Serve static frontend in production
const clientDistPath = path.join(__dirname, '../client/dist');
app.use(express.static(clientDistPath));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// In-memory room and peer state
const rooms = {};

io.on('connection', (socket) => {
  console.log(`[Vasyord] Client connected: ${socket.id}`);

  // Join Voice & Text Room
  socket.on('join-room', ({ roomId, username, avatar, isMuted }) => {
    socket.join(roomId);
    socket.roomId = roomId;

    if (!rooms[roomId]) {
      rooms[roomId] = {};
    }
    if (!roomMessages[roomId]) {
      roomMessages[roomId] = [];
    }

    const peerInfo = {
      id: socket.id,
      username: username || `User_${socket.id.slice(0, 4)}`,
      avatar: avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${socket.id}`,
      isMuted: isMuted || false,
      isDeafened: false,
      isScreenSharing: false,
      joinedAt: Date.now(),
    };

    rooms[roomId][socket.id] = peerInfo;

    // Send existing peers & persistent chat history
    const otherPeers = Object.values(rooms[roomId]).filter((p) => p.id !== socket.id);
    socket.emit('room-peers', {
      peers: otherPeers,
      messages: roomMessages[roomId].slice(-100), // Last 100 messages preserved
    });

    // Notify other peers
    socket.to(roomId).emit('peer-joined', peerInfo);
    console.log(`[Vasyord] ${peerInfo.username} joined room: ${roomId}`);
  });

  // WebRTC Signaling: Forward offer
  socket.on('signal-offer', ({ targetPeerId, sdp }) => {
    io.to(targetPeerId).emit('signal-offer', {
      callerPeerId: socket.id,
      sdp,
    });
  });

  // WebRTC Signaling: Forward answer
  socket.on('signal-answer', ({ callerPeerId, sdp }) => {
    io.to(callerPeerId).emit('signal-answer', {
      targetPeerId: socket.id,
      sdp,
    });
  });

  // WebRTC Signaling: Exchange ICE candidates
  socket.on('signal-ice-candidate', ({ targetPeerId, candidate }) => {
    io.to(targetPeerId).emit('signal-ice-candidate', {
      senderPeerId: socket.id,
      candidate,
    });
  });

  // Peer State update (Mute / Deafen / ScreenShare)
  socket.on('update-peer-state', (stateUpdate) => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId] && rooms[roomId][socket.id]) {
      Object.assign(rooms[roomId][socket.id], stateUpdate);
      socket.to(roomId).emit('peer-state-updated', {
        peerId: socket.id,
        ...stateUpdate,
      });
    }
  });

  // Voice Speaking indicator
  socket.on('peer-speaking', ({ isSpeaking }) => {
    const roomId = socket.roomId;
    if (roomId) {
      socket.to(roomId).emit('peer-speaking', {
        peerId: socket.id,
        isSpeaking,
      });
    }
  });

  // Typing status (as in Telegram)
  socket.on('user-typing', ({ isTyping }) => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId] && rooms[roomId][socket.id]) {
      const username = rooms[roomId][socket.id].username;
      socket.to(roomId).emit('user-typing', {
        userId: socket.id,
        username,
        isTyping,
      });
    }
  });

  // Text or Audio Chat Message (Saved permanently to disk)
  socket.on('send-message', ({ text, audioUrl, duration }) => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId] && rooms[roomId][socket.id]) {
      const peer = rooms[roomId][socket.id];
      const message = {
        id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        senderId: socket.id,
        username: peer.username,
        avatar: peer.avatar,
        text: text || '',
        audioUrl: audioUrl || null,
        duration: duration || null,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      if (!roomMessages[roomId]) roomMessages[roomId] = [];
      roomMessages[roomId].push(message);
      if (roomMessages[roomId].length > 300) roomMessages[roomId].shift();

      saveMessagesToFile();

      io.to(roomId).emit('new-message', message);
    }
  });

  // Handle Disconnection
  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId] && rooms[roomId][socket.id]) {
      const username = rooms[roomId][socket.id].username;
      delete rooms[roomId][socket.id];

      socket.to(roomId).emit('peer-left', { peerId: socket.id });
      console.log(`[Vasyord] ${username} (${socket.id}) left room: ${roomId}`);

      if (Object.keys(rooms[roomId]).length === 0) {
        delete rooms[roomId];
      }
    }
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'Vasyord Voice & WebRTC Server',
    activeRooms: Object.keys(rooms).length,
    timestamp: new Date().toISOString(),
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`[Vasyord Server] Running on http://localhost:${PORT}`);
});
