const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

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
// rooms[roomId] = { [socketId]: { id, username, avatar, isMuted, isDeafened, isScreenSharing } }
const rooms = {};
const roomMessages = {};

io.on('connection', (socket) => {
  console.log(`[Vasyord] Client connected: ${socket.id}`);

  // Join Voice & Text Room
  socket.on('join-room', ({ roomId, username, avatar }) => {
    socket.join(roomId);
    socket.roomId = roomId;

    if (!rooms[roomId]) {
      rooms[roomId] = {};
      roomMessages[roomId] = [];
    }

    const peerInfo = {
      id: socket.id,
      username: username || `User_${socket.id.slice(0, 4)}`,
      avatar: avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${socket.id}`,
      isMuted: false,
      isDeafened: false,
      isScreenSharing: false,
      joinedAt: Date.now(),
    };

    rooms[roomId][socket.id] = peerInfo;

    // Send existing peers in room to the newly joined peer
    const otherPeers = Object.values(rooms[roomId]).filter((p) => p.id !== socket.id);
    socket.emit('room-peers', {
      peers: otherPeers,
      messages: roomMessages[roomId].slice(-50), // Last 50 messages
    });

    // Notify other peers in room that a new peer joined
    socket.to(roomId).emit('peer-joined', peerInfo);

    console.log(`[Vasyord] ${peerInfo.username} (${socket.id}) joined room: ${roomId}`);
  });

  // WebRTC Signaling: Forward offer to specific target peer
  socket.on('signal-offer', ({ targetPeerId, sdp }) => {
    io.to(targetPeerId).emit('signal-offer', {
      callerPeerId: socket.id,
      sdp,
    });
  });

  // WebRTC Signaling: Forward answer to caller peer
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

  // Text or Audio Chat Message
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
      if (roomMessages[roomId].length > 200) roomMessages[roomId].shift();

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

// SPA fallback for rooms
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Vasyord] 🚀 WebRTC Core running on http://0.0.0.0:${PORT}`);
});
