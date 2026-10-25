import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  Mic,
  MicOff,
  Headphones,
  Volume2,
  Volume1,
  MessageSquare,
  Hash,
  VolumeX,
  Plus,
  Compass,
  Settings,
  PhoneOff,
  Share2,
  Menu,
  X,
  Play,
  Square,
  Send,
  Tv
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
  text?: string;
  audioUrl?: string | null;
  duration?: number | null;
  timestamp: string;
}

interface ServerItem {
  id: string;
  name: string;
  icon: string;
  channels: { id: string; name: string; type: 'voice' | 'text' }[];
}

const DEFAULT_SERVERS: ServerItem[] = [
  {
    id: 'patsany',
    name: 'Пацанский сервер',
    icon: 'VY',
    channels: [
      { id: 'general-voice', name: '🎙️ Общий войс', type: 'voice' },
      { id: 'gaming', name: '🎮 Катка (CS2 / Dota)', type: 'voice' },
      { id: 'chill', name: '☕ Чилл комната', type: 'voice' },
      { id: 'fludilka', name: 'флудилка', type: 'text' },
      { id: 'memes', name: 'мемы-и-скрины', type: 'text' },
    ],
  },
  {
    id: 'gaming-party',
    name: 'Dota 2 / CS2 Party',
    icon: '🎮',
    channels: [
      { id: 'dota-lobby', name: '🏆 Дота Рейтинг', type: 'voice' },
      { id: 'cs-lobby', name: '🔫 CS2 Премьер', type: 'voice' },
      { id: 'tactic-chat', name: 'тактики-и-смоки', type: 'text' },
    ],
  },
];

export function App() {
  const [username, setUsername] = useState(() => localStorage.getItem('vasyord_user') || `Patsan_${Math.floor(Math.random() * 899 + 100)}`);
  const [servers, setServers] = useState<ServerItem[]>(DEFAULT_SERVERS);
  const [activeServerId, setActiveServerId] = useState('patsany');
  
  const [roomId, setRoomId] = useState('general-voice');
  const [activeTextChannel, setActiveTextChannel] = useState('fludilka');
  const [connected, setConnected] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  
  // UI & Mobile state
  const [showChat, setShowChat] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showCreateRoomModal, setShowCreateRoomModal] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomType, setNewRoomType] = useState<'voice' | 'text'>('voice');
  
  // Audio Controls & Volume per peer
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [peerVolumes, setPeerVolumes] = useState<{ [peerId: string]: number }>({});
  const [openVolumePeerId, setOpenVolumePeerId] = useState<string | null>(null);

  // Screen share
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);

  // Voice message recording (Telegram style)
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [currentlyPlayingAudio, setCurrentlyPlayingAudio] = useState<string | null>(null);

  // Typing status (Telegram style)
  const [typingUsers, setTypingUsers] = useState<{ [userId: string]: string }>({});
  const typingTimeoutRef = useRef<any>(null);

  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<{ [peerId: string]: RTCPeerConnection }>({});
  const remoteAudioElementsRef = useRef<{ [peerId: string]: HTMLAudioElement }>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // MediaRecorder refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<any>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  const myAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`;
  const currentServer = servers.find((s) => s.id === activeServerId) || servers[0];

  useEffect(() => {
    localStorage.setItem('vasyord_user', username);
  }, [username]);

  // Auto-connect to chat and room on initial load
  useEffect(() => {
    joinVoiceRoom('general-voice');
    return () => {
      leaveVoiceRoom();
    };
  }, []);

  // Connect socket and audio room
  async function joinVoiceRoom(targetRoom: string) {
    if (connected && roomId === targetRoom) return;

    if (connected) {
      leaveVoiceRoom();
    }

    setRoomId(targetRoom);
    setMobileSidebarOpen(false);

    let hasMic = false;
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        localStreamRef.current = stream;
        setupSpeakingDetector(stream);
        hasMic = true;
      }
    } catch (err: any) {
      console.warn("No mic or permission denied, joining listen-only:", err);
      setIsMuted(true);
      localStreamRef.current = null;
    }

    const socket = io('/', {
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    setupSocketEvents(socket, targetRoom, !hasMic);
    setConnected(true);
  }

  // Detect speech to illuminate speaking border
  function setupSpeakingDetector(stream: MediaStream) {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      analyser.fftSize = 256;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      let speaking = false;

      const checkAudio = () => {
        if (!localStreamRef.current) {
          audioCtx.close();
          return;
        }
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;

        const isNowSpeaking = average > 18 && !isMuted;
        if (isNowSpeaking !== speaking) {
          speaking = isNowSpeaking;
          socketRef.current?.emit('peer-speaking', { isSpeaking: speaking });
        }
        requestAnimationFrame(checkAudio);
      };
      checkAudio();
    } catch (e) {
      console.warn("Speech detector unsupported in current context", e);
    }
  }

  // Play authentic ICQ "Uh-oh!" incoming message sound via Web Audio synthesis
  function playIcqSound() {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      // Uh-oh dual tone frequency modulation
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(260, now + 0.12);
      osc.frequency.setValueAtTime(440, now + 0.15);
      osc.frequency.exponentialRampToValueAtTime(360, now + 0.32);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.36);
    } catch (e) {
      console.warn("Could not play ICQ sound:", e);
    }
  }

  function setupSocketEvents(socket: Socket, currentRoom: string, initialMuted: boolean = false) {
    socket.on('connect', () => {
      socket.emit('join-room', {
        roomId: currentRoom,
        username,
        avatar: myAvatar,
        isMuted: initialMuted,
      });
    });

    socket.on('room-peers', ({ peers: initialPeers, messages: initialMessages }: { peers: Peer[]; messages: Message[] }) => {
      setPeers(initialPeers);
      setMessages(initialMessages);

      initialPeers.forEach((p) => {
        createPeerConnection(p.id, true);
      });
    });

    socket.on('peer-joined', (newPeer: Peer) => {
      setPeers((prev) => [...prev.filter((p) => p.id !== newPeer.id), newPeer]);
    });

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

    socket.on('signal-answer', async ({ targetPeerId, sdp }) => {
      const pc = peerConnectionsRef.current[targetPeerId];
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      }
    });

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

    socket.on('peer-state-updated', ({ peerId, ...updatedState }) => {
      setPeers((prev) =>
        prev.map((p) => (p.id === peerId ? { ...p, ...updatedState } : p))
      );
    });

    socket.on('peer-speaking', ({ peerId, isSpeaking }) => {
      setPeers((prev) =>
        prev.map((p) => (p.id === peerId ? { ...p, isSpeaking } : p))
      );
    });

    // Listen for typing events (Telegram style)
    socket.on('user-typing', ({ userId, username, isTyping }) => {
      setTypingUsers((prev) => {
        const copy = { ...prev };
        if (isTyping) {
          copy[userId] = username;
        } else {
          delete copy[userId];
        }
        return copy;
      });
    });

    socket.on('new-message', (msg: Message) => {
      setMessages((prev) => [...prev, msg]);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

      // Play ICQ incoming sound if message is from someone else
      if (socketRef.current && msg.senderId !== socketRef.current.id) {
        playIcqSound();
      }
    });

    socket.on('peer-left', ({ peerId }) => {
      setPeers((prev) => prev.filter((p) => p.id !== peerId));
      if (peerConnectionsRef.current[peerId]) {
        peerConnectionsRef.current[peerId].close();
        delete peerConnectionsRef.current[peerId];
      }
      if (remoteAudioElementsRef.current[peerId]) {
        delete remoteAudioElementsRef.current[peerId];
      }
    });
  }

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

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      const audioEl = new Audio();
      audioEl.srcObject = remoteStream;
      audioEl.autoplay = true;
      const currentVol = peerVolumes[remotePeerId] !== undefined ? peerVolumes[remotePeerId] : 100;
      audioEl.volume = isDeafened ? 0 : currentVol / 100;
      audioEl.play().catch(console.warn);
      remoteAudioElementsRef.current[remotePeerId] = audioEl;
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('signal-ice-candidate', {
          targetPeerId: remotePeerId,
          candidate: event.candidate,
        });
      }
    };

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
    if (screenTrackRef.current) {
      screenTrackRef.current.stop();
      screenTrackRef.current = null;
      setIsScreenSharing(false);
    }
    Object.values(peerConnectionsRef.current).forEach((pc) => pc.close());
    peerConnectionsRef.current = {};
    remoteAudioElementsRef.current = {};
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
    } else {
      setIsMuted(!isMuted);
    }
  }

  function toggleDeafen() {
    const nextDeafen = !isDeafened;
    setIsDeafened(nextDeafen);
    if (nextDeafen && !isMuted) toggleMute();

    // Mute all remote audio elements
    Object.keys(remoteAudioElementsRef.current).forEach((peerId) => {
      const el = remoteAudioElementsRef.current[peerId];
      if (el) {
        const userVol = peerVolumes[peerId] !== undefined ? peerVolumes[peerId] : 100;
        el.volume = nextDeafen ? 0 : userVol / 100;
      }
    });

    socketRef.current?.emit('update-peer-state', { isDeafened: nextDeafen });
  }

  // Adjust volume for specific peer
  function handleVolumeChange(peerId: string, value: number) {
    setPeerVolumes((prev) => ({ ...prev, [peerId]: value }));
    const audioEl = remoteAudioElementsRef.current[peerId];
    if (audioEl && !isDeafened) {
      audioEl.volume = Math.max(0, Math.min(1, value / 100));
    }
  }

  // Screen share (демонстрация экрана)
  async function toggleScreenShare() {
    if (isScreenSharing) {
      if (screenTrackRef.current) {
        screenTrackRef.current.stop();
        screenTrackRef.current = null;
      }
      setIsScreenSharing(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const screenTrack = stream.getVideoTracks()[0];
      screenTrackRef.current = screenTrack;
      setIsScreenSharing(true);

      screenTrack.onended = () => {
        setIsScreenSharing(false);
        screenTrackRef.current = null;
      };

      // Add track to all active peer connections
      Object.values(peerConnectionsRef.current).forEach((pc) => {
        pc.addTrack(screenTrack, stream);
      });
    } catch (err) {
      console.warn("Screen share cancelled or failed:", err);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInputText(e.target.value);

    // Notify others that user is typing (Telegram style)
    if (socketRef.current) {
      socketRef.current.emit('user-typing', { isTyping: true });
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socketRef.current?.emit('user-typing', { isTyping: false });
      }, 2000);
    }
  }

  function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!inputText.trim() || !socketRef.current) return;
    socketRef.current.emit('send-message', { text: inputText });
    socketRef.current.emit('user-typing', { isTyping: false });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    setInputText('');
  }

  async function startVoiceRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64Audio = reader.result as string;
          if (socketRef.current) {
            socketRef.current.emit('send-message', {
              audioUrl: base64Audio,
              duration: recordDuration || 1,
            });
          }
        };
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorder.start();
      setIsRecordingVoice(true);
      setRecordDuration(0);
      recordTimerRef.current = setInterval(() => {
        setRecordDuration((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      alert("Не удалось запустить запись аудио: " + (err.message || err));
    }
  }

  function stopVoiceRecording(send: boolean = true) {
    if (mediaRecorderRef.current && isRecordingVoice) {
      clearInterval(recordTimerRef.current);
      if (!send) {
        audioChunksRef.current = [];
      }
      mediaRecorderRef.current.stop();
      setIsRecordingVoice(false);
    }
  }

  function togglePlayAudio(msgId: string, url: string) {
    if (currentlyPlayingAudio === msgId) {
      audioPlayerRef.current?.pause();
      setCurrentlyPlayingAudio(null);
      return;
    }

    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
    }

    const audio = new Audio(url);
    audioPlayerRef.current = audio;
    setCurrentlyPlayingAudio(msgId);

    audio.onended = () => {
      setCurrentlyPlayingAudio(null);
    };
    audio.play().catch(console.warn);
  }

  function handleCreateRoom(e: React.FormEvent) {
    e.preventDefault();
    if (!newRoomName.trim()) return;

    const newChannel = {
      id: `${newRoomType}-${Date.now().toString(36)}`,
      name: newRoomName.trim(),
      type: newRoomType,
    };

    setServers((prev) =>
      prev.map((s) =>
        s.id === activeServerId
          ? { ...s, channels: [...s.channels, newChannel] }
          : s
      )
    );

    setNewRoomName('');
    setShowCreateRoomModal(false);

    if (newRoomType === 'voice') {
      joinVoiceRoom(newChannel.id);
    } else {
      setActiveTextChannel(newChannel.id);
    }
  }

  return (
    <div className="vasyord-app">
      {/* 1. Server Icons Sidebar */}
      <nav className="servers-sidebar">
        <div
          className={`server-icon ${activeServerId === 'home' ? 'active' : ''}`}
          onClick={() => setActiveServerId('patsany')}
          title="Главная"
        >
          <Compass size={22} />
        </div>
        <div style={{ width: 28, height: 2, background: 'var(--border-subtle)', borderRadius: 1 }} />

        {servers.map((s) => (
          <div
            key={s.id}
            className={`server-icon ${activeServerId === s.id ? 'active' : ''}`}
            onClick={() => {
              setActiveServerId(s.id);
            }}
            title={s.name}
          >
            {s.icon}
          </div>
        ))}

        <div
          className="server-icon"
          onClick={() => {
            const name = prompt("Название нового сервера:");
            if (name && name.trim()) {
              const newServer: ServerItem = {
                id: `server-${Date.now()}`,
                name: name.trim(),
                icon: name.trim().slice(0, 2).toUpperCase(),
                channels: [
                  { id: `voice-${Date.now()}`, name: '🎙️ Общий войс', type: 'voice' },
                  { id: `text-${Date.now()}`, name: 'основной-чат', type: 'text' },
                ],
              };
              setServers([...servers, newServer]);
              setActiveServerId(newServer.id);
            }
          }}
          title="Добавить сервер"
        >
          <Plus size={18} />
        </div>
      </nav>

      {/* Mobile Overlay */}
      {mobileSidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setMobileSidebarOpen(false)} />
      )}

      {/* 2. Channels Sidebar */}
      <aside className={`channels-sidebar ${mobileSidebarOpen ? 'mobile-open' : ''}`}>
        <div className="guild-header">
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {currentServer.name}
          </span>
          <button
            className="control-btn"
            style={{ padding: 4 }}
            onClick={() => setShowCreateRoomModal(true)}
            title="Создать канал"
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="channels-list">
          {/* Voice Channels */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 4 }}>
            <span className="channel-category">Голосовые комнаты</span>
            <button
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              onClick={() => {
                setNewRoomType('voice');
                setShowCreateRoomModal(true);
              }}
              title="Создать голосовой канал"
            >
              <Plus size={14} />
            </button>
          </div>

          {currentServer.channels
            .filter((c) => c.type === 'voice')
            .map((c) => (
              <div
                key={c.id}
                className={`channel-item ${connected && roomId === c.id ? 'active' : ''}`}
                onClick={() => joinVoiceRoom(c.id)}
              >
                <Volume2 size={18} color="var(--online-green)" />
                <span>{c.name}</span>
              </div>
            ))}

          {/* Text Channels */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 4, marginTop: 14 }}>
            <span className="channel-category">Текстовые темы</span>
            <button
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              onClick={() => {
                setNewRoomType('text');
                setShowCreateRoomModal(true);
              }}
              title="Создать текстовый канал"
            >
              <Plus size={14} />
            </button>
          </div>

          {currentServer.channels
            .filter((c) => c.type === 'text')
            .map((c) => (
              <div
                key={c.id}
                className={`channel-item ${activeTextChannel === c.id ? 'active' : ''}`}
                onClick={() => setActiveTextChannel(c.id)}
              >
                <Hash size={18} />
                <span>{c.name}</span>
              </div>
            ))}
        </div>

        {/* User Footer Controls (Discord style) */}
        <div className="user-footer">
          <div className="user-profile">
            <img src={myAvatar} alt="Avatar" className="avatar" />
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span
                style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-header)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }}
                onClick={() => setShowSettingsModal(true)}
                title="Настройки профиля"
              >
                {username}
              </span>
              <span style={{ fontSize: 11, color: connected ? 'var(--online-green)' : 'var(--text-muted)' }}>
                {connected ? 'В сети' : 'Не в войсе'}
              </span>
            </div>
          </div>

          <button className={`control-btn ${isMuted ? 'active-danger' : ''}`} onClick={toggleMute} title={isMuted ? "Включить микрофон" : "Заглушить микрофон"}>
            {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          <button className={`control-btn ${isDeafened ? 'active-danger' : ''}`} onClick={toggleDeafen} title={isDeafened ? "Включить звук" : "Заглушить наушники"}>
            {isDeafened ? <VolumeX size={18} /> : <Headphones size={18} />}
          </button>
          <button
            className="control-btn"
            onClick={() => setShowSettingsModal(true)}
            title="Настройки"
          >
            <Settings size={18} />
          </button>
        </div>
      </aside>

      {/* 3. Main Stage */}
      <main className="main-stage">
        <header className="voice-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              className="mobile-nav-toggle"
              onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
              title="Список каналов"
            >
              <Menu size={22} />
            </button>
            <Volume2 size={20} color="var(--online-green)" />
            <span style={{ fontWeight: 700, color: 'var(--text-header)', fontSize: 15 }}>
              #{roomId}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 6 }}>
              {peers.length + (connected ? 1 : 0)} в сети
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {connected && (
              <button
                className={`control-btn ${isScreenSharing ? 'active' : ''}`}
                onClick={toggleScreenShare}
                title={isScreenSharing ? "Остановить демонстрацию" : "Демонстрация экрана"}
                style={{ gap: 4 }}
              >
                <Tv size={17} color={isScreenSharing ? 'var(--online-green)' : 'inherit'} />
              </button>
            )}
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
              title="Открыть чат"
            >
              <MessageSquare size={18} />
            </button>
            {connected && (
              <button
                className="control-btn active-danger"
                style={{ background: 'var(--danger-red)', color: '#fff', borderRadius: 4, padding: '4px 8px', gap: 4, fontSize: 12 }}
                onClick={leaveVoiceRoom}
              >
                <PhoneOff size={15} /> Выйти
              </button>
            )}
          </div>
        </header>

        <div className="stage-content">
          {/* Voice Participants Grid */}
          <section className="voice-grid">
            {/* My own card */}
            <div className={`peer-card ${!isMuted && connected ? 'speaking' : ''}`}>
              <div className="peer-status-icons">
                {isMuted && <MicOff size={15} color="var(--danger-red)" />}
                {isDeafened && <VolumeX size={15} color="var(--danger-red)" />}
              </div>
              <img src={myAvatar} alt="My Avatar" className="peer-avatar" />
              <div className="peer-name">{username} (Вы)</div>
            </div>

            {/* Remote Peers with Volume Controls */}
            {peers.map((peer) => {
              const currentVol = peerVolumes[peer.id] !== undefined ? peerVolumes[peer.id] : 100;
              const isVolOpen = openVolumePeerId === peer.id;

              return (
                <div key={peer.id} className={`peer-card ${peer.isSpeaking ? 'speaking' : ''}`}>
                  <div className="peer-status-icons">
                    {peer.isMuted && <MicOff size={15} color="var(--danger-red)" />}
                    {peer.isDeafened && <VolumeX size={15} color="var(--danger-red)" />}
                    <button
                      className="control-btn"
                      style={{ padding: 2, background: isVolOpen ? 'rgba(0,0,0,0.6)' : 'transparent' }}
                      onClick={() => setOpenVolumePeerId(isVolOpen ? null : peer.id)}
                      title="Громкость пользователя"
                    >
                      {currentVol === 0 ? <VolumeX size={15} color="var(--danger-red)" /> : currentVol < 50 ? <Volume1 size={15} /> : <Volume2 size={15} />}
                    </button>
                  </div>

                  <img src={peer.avatar} alt={peer.username} className="peer-avatar" />
                  <div className="peer-name">{peer.username}</div>

                  {/* Volume Slider Popover */}
                  {isVolOpen && (
                    <div className="peer-volume-popover">
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                        <span>Громкость:</span>
                        <span style={{ fontWeight: 700 }}>{currentVol}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="200"
                        value={currentVol}
                        onChange={(e) => handleVolumeChange(peer.id, Number(e.target.value))}
                        style={{ width: '100%', accentColor: 'var(--bg-accent)', cursor: 'pointer' }}
                      />
                    </div>
                  )}
                </div>
              );
            })}

            {!connected && (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-muted)', padding: '20px 10px' }}>
                <h3 style={{ color: 'var(--text-header)' }}>Вы не в голосовом канале</h3>
                <p style={{ marginTop: 6, fontSize: 13 }}>Подключайтесь и общайтесь с пацанами без задержек 🎙️</p>
                <button
                  style={{ marginTop: 14, padding: '10px 20px', background: 'var(--bg-accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
                  onClick={() => joinVoiceRoom(currentServer.channels.find(c => c.type === 'voice')?.id || 'general-voice')}
                >
                  ⚡ Подключиться в голосовой канал
                </button>
              </div>
            )}
          </section>

          {/* Right Text / Voice Chat Drawer */}
          {showChat && (
            <aside className="chat-drawer">
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-header)' }}>Чат #{roomId}</span>
                <button
                  className="control-btn"
                  onClick={() => setShowChat(false)}
                  style={{ padding: 2 }}
                >
                  <X size={16} />
                </button>
              </div>

              <div className="chat-messages">
                {messages.length === 0 && (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: 30, fontSize: 13 }}>
                    Пока сообщений нет. Напишите текст или запишите голосовое! 🎙️
                  </div>
                )}
                {messages.map((m) => (
                  <div key={m.id} className="message-item">
                    <img src={m.avatar} alt="Avatar" className="avatar" style={{ width: 34, height: 34 }} />
                    <div className="message-content">
                      <div className="message-meta">
                        <span className="message-user">{m.username}</span>
                        <span className="message-time">{m.timestamp}</span>
                      </div>

                      {m.text && <div className="message-text">{m.text}</div>}

                      {m.audioUrl && (
                        <div className="voice-message-bubble">
                          <button
                            className="voice-play-btn"
                            onClick={() => togglePlayAudio(m.id, m.audioUrl!)}
                            title="Воспроизвести голосовое"
                          >
                            {currentlyPlayingAudio === m.id ? <Square size={14} fill="#fff" /> : <Play size={14} fill="#fff" style={{ marginLeft: 2 }} />}
                          </button>
                          <div className="voice-waveform-visual">
                            {[12, 18, 8, 22, 14, 20, 10, 16, 24, 15, 9, 21].map((h, i) => (
                              <div
                                key={i}
                                className={`voice-bar ${currentlyPlayingAudio === m.id ? 'animating' : ''}`}
                                style={{
                                  height: `${h}px`,
                                  animationDelay: `${i * 0.08}s`
                                }}
                              />
                            ))}
                          </div>
                          <span className="voice-duration">
                            {m.duration ? `${m.duration}s` : '0:05'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Typing notification (Telegram style) */}
              {Object.keys(typingUsers).length > 0 && (
                <div className="typing-indicator">
                  <div className="typing-dots">
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                  </div>
                  <span>
                    {Object.values(typingUsers).join(', ')} {Object.keys(typingUsers).length > 1 ? 'печатают...' : 'печатает...'}
                  </span>
                </div>
              )}

              {/* Chat Input Box with Voice Recording */}
              <form className="chat-input-box" onSubmit={handleSendMessage}>
                {isRecordingVoice ? (
                  <div style={{ display: 'flex', alignItems: 'center', flex: 1, gap: 10, color: 'var(--danger-red)', fontWeight: 600, fontSize: 13 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--danger-red)', animation: 'recordPulse 0.8s infinite alternate' }} />
                    <span>Запись: {recordDuration} сек...</span>
                    <button
                      type="button"
                      style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}
                      onClick={() => stopVoiceRecording(false)}
                    >
                      Отмена
                    </button>
                  </div>
                ) : (
                  <input
                    type="text"
                    className="chat-input"
                    placeholder={`Сообщение в #${roomId}...`}
                    value={inputText}
                    onChange={handleInputChange}
                  />
                )}

                {inputText.trim().length > 0 && (
                  <button type="submit" className="send-btn" title="Отправить сообщение">
                    <Send size={18} color="var(--bg-accent)" />
                  </button>
                )}

                <button
                  type="button"
                  className={`mic-record-btn ${isRecordingVoice ? 'recording' : ''}`}
                  title={isRecordingVoice ? 'Отправить голосовое' : 'Записать голосовое сообщение (как в TG)'}
                  onClick={() => {
                    if (isRecordingVoice) {
                      stopVoiceRecording(true);
                    } else {
                      startVoiceRecording();
                    }
                  }}
                >
                  {isRecordingVoice ? <Square size={16} fill="#fff" /> : <Mic size={18} />}
                </button>
              </form>
            </aside>
          )}
        </div>
      </main>

      {/* Settings Modal (Discord Style) */}
      {showSettingsModal && (
        <div className="modal-backdrop" onClick={() => setShowSettingsModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, color: 'var(--text-header)' }}>⚙️ Настройки пользователя</h2>
              <button className="control-btn" onClick={() => setShowSettingsModal(false)}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
              <img src={myAvatar} alt="My Avatar" style={{ width: 64, height: 64, borderRadius: 32, background: 'var(--bg-secondary)' }} />
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Никнейм
                </label>
                <input
                  type="text"
                  className="chat-input"
                  style={{ marginTop: 6 }}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                style={{ padding: '8px 16px', background: 'var(--bg-accent)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
                onClick={() => setShowSettingsModal(false)}
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Channel Modal */}
      {showCreateRoomModal && (
        <div className="modal-backdrop" onClick={() => setShowCreateRoomModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, color: 'var(--text-header)' }}>Создать канал</h2>
              <button className="control-btn" onClick={() => setShowCreateRoomModal(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateRoom}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Тип канала
                </label>
                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  <button
                    type="button"
                    style={{
                      flex: 1,
                      padding: '10px',
                      borderRadius: 6,
                      border: newRoomType === 'voice' ? '2px solid var(--bg-accent)' : '1px solid var(--border-subtle)',
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-header)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontWeight: 600,
                    }}
                    onClick={() => setNewRoomType('voice')}
                  >
                    <Volume2 size={18} color="var(--online-green)" /> Голосовой
                  </button>
                  <button
                    type="button"
                    style={{
                      flex: 1,
                      padding: '10px',
                      borderRadius: 6,
                      border: newRoomType === 'text' ? '2px solid var(--bg-accent)' : '1px solid var(--border-subtle)',
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-header)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontWeight: 600,
                    }}
                    onClick={() => setNewRoomType('text')}
                  >
                    <Hash size={18} /> Текстовый
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Название канала
                </label>
                <input
                  type="text"
                  className="chat-input"
                  style={{ marginTop: 6 }}
                  placeholder={newRoomType === 'voice' ? 'Новая комната...' : 'новый-чат...'}
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  autoFocus
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  style={{ padding: '8px 16px', background: 'transparent', color: 'var(--text-muted)', border: 'none', cursor: 'pointer' }}
                  onClick={() => setShowCreateRoomModal(false)}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  style={{ padding: '8px 16px', background: 'var(--bg-accent)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
                >
                  Создать
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
