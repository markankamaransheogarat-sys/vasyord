import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  Mic,
  MicOff,
  Headphones,
  Volume2,
  MessageSquare,
  Hash,
  VolumeX,
  Plus,
  Compass,
  Settings,
  PhoneOff,
  Share2
} from 'lucide-react';
import './index.css';

interface Peer {
  id: string;
  username: string;
  avatar: string;
  isMuted: boolean;
  isDeafened: boolean;
  isSpeaking?: boolean;
}

interface Message {
  id: string;
  senderId: string;
  username: string;
  avatar: string;
  text: string;
  timestamp: string;
}

export function App() {
  const [username] = useState(() => localStorage.getItem('vasyord_user') || `Patsan_${Math.floor(Math.random() * 899 + 100)}`);
  const [roomId, setRoomId] = useState('general-voice');
  const [connected, setConnected] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  
  // Audio Controls
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [showChat, setShowChat] = useState(true);

  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<{ [peerId: string]: RTCPeerConnection }>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const myAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`;

  useEffect(() => {
    localStorage.setItem('vasyord_user', username);
  }, [username]);

  // Connect to Room
  function joinVoiceRoom(targetRoom: string) {
    if (connected && targetRoom === roomId) return;
    leaveVoiceRoom();

    setRoomId(targetRoom);

    // Initialize Socket
    const socket = io(window.location.origin, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    // Get Microhpone stream
    navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    }).then((stream) => {
      localStreamRef.current = stream;

      socket.emit('join-room', {
        roomId: targetRoom,
        username,
        avatar: myAvatar,
      });

      setConnected(true);
    }).catch((err) => {
      console.warn("Microphone access denied or error:", err);
      // Still allow join in listen-only mode
      socket.emit('join-room', {
        roomId: targetRoom,
        username,
        avatar: myAvatar,
      });
      setConnected(true);
      setIsMuted(true);
    });

    // Handle existing peers
    socket.on('room-peers', ({ peers: initialPeers, messages: initialMessages }: { peers: Peer[]; messages: Message[] }) => {
      setPeers(initialPeers);
      setMessages(initialMessages);

      // Create WebRTC Offer for each existing peer
      initialPeers.forEach((p) => {
        createPeerConnection(p.id, true);
      });
    });

    // When someone joins
    socket.on('peer-joined', (newPeer: Peer) => {
      setPeers((prev) => [...prev.filter((p) => p.id !== newPeer.id), newPeer]);
    });

    // WebRTC Signaling: Incoming Offer
    socket.on('signal-offer', async ({ callerPeerId, sdp }) => {
      const pc = createPeerConnection(callerPeerId, false);
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit('signal-answer', {
        callerPeerId,
        sdp: answer,
      });
    });

    // WebRTC Signaling: Incoming Answer
    socket.on('signal-answer', async ({ targetPeerId, sdp }) => {
      const pc = peerConnectionsRef.current[targetPeerId];
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      }
    });

    // WebRTC Signaling: ICE Candidate
    socket.on('signal-ice-candidate', async ({ senderPeerId, candidate }) => {
      const pc = peerConnectionsRef.current[senderPeerId];
      if (pc && candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error("Error adding ice candidate:", e);
        }
      }
    });

    // Peer State changes (mute/deaf)
    socket.on('peer-state-updated', ({ peerId, ...updatedState }) => {
      setPeers((prev) =>
        prev.map((p) => (p.id === peerId ? { ...p, ...updatedState } : p))
      );
    });

    // Speaking indicator
    socket.on('peer-speaking', ({ peerId, isSpeaking }) => {
      setPeers((prev) =>
        prev.map((p) => (p.id === peerId ? { ...p, isSpeaking } : p))
      );
    });

    // Chat Message
    socket.on('new-message', (msg: Message) => {
      setMessages((prev) => [...prev, msg]);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    });

    // Peer Left
    socket.on('peer-left', ({ peerId }) => {
      setPeers((prev) => prev.filter((p) => p.id !== peerId));
      if (peerConnectionsRef.current[peerId]) {
        peerConnectionsRef.current[peerId].close();
        delete peerConnectionsRef.current[peerId];
      }
    });
  }

  // Create WebRTC PeerConnection
  function createPeerConnection(remotePeerId: string, isInitiator: boolean) {
    if (peerConnectionsRef.current[remotePeerId]) {
      return peerConnectionsRef.current[remotePeerId];
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });

    peerConnectionsRef.current[remotePeerId] = pc;

    // Add local mic audio tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    // When remote audio track arrives
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      const audioEl = new Audio();
      audioEl.srcObject = remoteStream;
      audioEl.autoplay = true;
      audioEl.play().catch(console.warn);
    };

    // Send local ICE candidates to remote peer
    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('signal-ice-candidate', {
          targetPeerId: remotePeerId,
          candidate: event.candidate,
        });
      }
    };

    // If caller, create offer
    if (isInitiator) {
      pc.createOffer().then(async (offer) => {
        await pc.setLocalDescription(offer);
        socketRef.current?.emit('signal-offer', {
          targetPeerId: remotePeerId,
          sdp: offer,
        });
      });
    }

    return pc;
  }

  function leaveVoiceRoom() {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    Object.values(peerConnectionsRef.current).forEach((pc) => pc.close());
    peerConnectionsRef.current = {};
    setConnected(false);
    setPeers([]);
  }

  function toggleMute() {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        const newMuted = !audioTrack.enabled;
        setIsMuted(newMuted);
        socketRef.current?.emit('update-peer-state', { isMuted: newMuted });
      }
    }
  }

  function toggleDeafen() {
    const nextDeafen = !isDeafened;
    setIsDeafened(nextDeafen);
    if (nextDeafen && !isMuted) toggleMute();
    socketRef.current?.emit('update-peer-state', { isDeafened: nextDeafen });
  }

  function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!inputText.trim() || !socketRef.current) return;
    socketRef.current.emit('send-message', { text: inputText });
    setInputText('');
  }

  return (
    <div className="vasyord-app">
      {/* 1. Server Icons Sidebar */}
      <nav className="servers-sidebar">
        <div className="server-icon active" title="Vasyord Home">
          <Compass size={24} />
        </div>
        <div style={{ width: 32, height: 2, background: 'var(--border-subtle)', borderRadius: 1 }} />
        <div className="server-icon" title="Пацанский сервер">
          VY
        </div>
        <div className="server-icon" title="Dota 2 / CS2 Party">
          🎮
        </div>
        <div className="server-icon" title="Create Room">
          <Plus size={20} />
        </div>
      </nav>

      {/* 2. Channels Sidebar */}
      <aside className="channels-sidebar">
        <div className="guild-header">
          <span>⚡ Vasyord Voice</span>
          <span style={{ fontSize: 11, background: 'var(--online-green)', color: '#fff', padding: '2px 6px', borderRadius: 10 }}>P2P</span>
        </div>

        <div className="channels-list">
          <div className="channel-category">Голосовые каналы</div>

          <div
            className={`channel-item ${connected && roomId === 'general-voice' ? 'active' : ''}`}
            onClick={() => joinVoiceRoom('general-voice')}
          >
            <Volume2 size={18} color="var(--online-green)" />
            <span>🔊 Общий войс</span>
          </div>

          <div
            className={`channel-item ${connected && roomId === 'gaming' ? 'active' : ''}`}
            onClick={() => joinVoiceRoom('gaming')}
          >
            <Volume2 size={18} color="var(--online-green)" />
            <span>🎮 Катка (CS2 / Dota)</span>
          </div>

          <div
            className={`channel-item ${connected && roomId === 'chill' ? 'active' : ''}`}
            onClick={() => joinVoiceRoom('chill')}
          >
            <Volume2 size={18} color="var(--online-green)" />
            <span>☕ Чилл комната</span>
          </div>

          <div className="channel-category" style={{ marginTop: 12 }}>Текстовые каналы</div>

          <div className="channel-item active">
            <Hash size={18} />
            <span>флудилка</span>
          </div>
          <div className="channel-item">
            <Hash size={18} />
            <span>мемы</span>
          </div>
        </div>

        {/* User Footer Controls (Discord style) */}
        <div className="user-footer">
          <div className="user-profile">
            <img src={myAvatar} alt="Avatar" className="avatar" />
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-header)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {username}
              </span>
              <span style={{ fontSize: 11, color: connected ? 'var(--online-green)' : 'var(--text-muted)' }}>
                {connected ? 'В сети' : 'Не в войсе'}
              </span>
            </div>
          </div>

          <button className={`control-btn ${isMuted ? 'active-danger' : ''}`} onClick={toggleMute} title="Заглушить микрофон">
            {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          <button className={`control-btn ${isDeafened ? 'active-danger' : ''}`} onClick={toggleDeafen} title="Заглушить звук">
            {isDeafened ? <VolumeX size={18} /> : <Headphones size={18} />}
          </button>
          <button className="control-btn" title="Настройки">
            <Settings size={18} />
          </button>
        </div>
      </aside>

      {/* 3. Main Stage */}
      <main className="main-stage">
        <header className="voice-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Volume2 size={20} color="var(--online-green)" />
            <span style={{ fontSize: 16 }}>{roomId}</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              ({connected ? peers.length + 1 : 0} в войсе)
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="control-btn"
              onClick={() => {
                navigator.clipboard.writeText(window.location.href);
                alert("Ссылка на комнату скопирована в буфер!");
              }}
              title="Поделиться инвайтом"
            >
              <Share2 size={18} />
            </button>
            <button
              className={`control-btn ${showChat ? 'active' : ''}`}
              onClick={() => setShowChat(!showChat)}
              title="Чат комнаты"
            >
              <MessageSquare size={18} />
            </button>
            {connected && (
              <button
                className="control-btn active-danger"
                style={{ background: 'var(--danger-red)', color: '#fff', borderRadius: 4, padding: '4px 10px', gap: 6 }}
                onClick={leaveVoiceRoom}
              >
                <PhoneOff size={16} /> Отключиться
              </button>
            )}
          </div>
        </header>

        <div className="stage-content">
          {/* Voice Participants Grid */}
          <section className="voice-grid">
            {/* My own card */}
            <div className={`peer-card ${!isMuted ? 'speaking' : ''}`}>
              <div className="peer-status-icons">
                {isMuted && <MicOff size={16} color="var(--danger-red)" />}
                {isDeafened && <VolumeX size={16} color="var(--danger-red)" />}
              </div>
              <img src={myAvatar} alt="My Avatar" className="peer-avatar" />
              <div className="peer-name">{username} (Вы)</div>
            </div>

            {/* Remote Peers */}
            {peers.map((peer) => (
              <div key={peer.id} className={`peer-card ${peer.isSpeaking ? 'speaking' : ''}`}>
                <div className="peer-status-icons">
                  {peer.isMuted && <MicOff size={16} color="var(--danger-red)" />}
                  {peer.isDeafened && <VolumeX size={16} color="var(--danger-red)" />}
                </div>
                <img src={peer.avatar} alt={peer.username} className="peer-avatar" />
                <div className="peer-name">{peer.username}</div>
              </div>
            ))}

            {!connected && (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-muted)' }}>
                <h2>Вы не подключены к голосовому каналу</h2>
                <p style={{ marginTop: 8 }}>Нажмите на любой канал слева, чтобы зайти с пацанами в войс 🎙️</p>
                <button
                  style={{ marginTop: 16, padding: '10px 20px', background: 'var(--bg-accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => joinVoiceRoom('general-voice')}
                >
                  ⚡ Быстрое подключение в «Общий войс»
                </button>
              </div>
            )}
          </section>

          {/* Right Text Chat Drawer */}
          {showChat && (
            <aside className="chat-drawer">
              <div className="chat-messages">
                {messages.length === 0 && (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: 40, fontSize: 13 }}>
                    Пока сообщений нет. Напишите первое сообщение в чат комнаты!
                  </div>
                )}
                {messages.map((m) => (
                  <div key={m.id} className="message-item">
                    <img src={m.avatar} alt="Avatar" className="avatar" style={{ width: 36, height: 36 }} />
                    <div className="message-content">
                      <div className="message-meta">
                        <span className="message-user">{m.username}</span>
                        <span className="message-time">{m.timestamp}</span>
                      </div>
                      <div className="message-text">{m.text}</div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <form className="chat-input-box" onSubmit={handleSendMessage}>
                <input
                  type="text"
                  className="chat-input"
                  placeholder={`Написать в #${roomId}...`}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                />
              </form>
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
