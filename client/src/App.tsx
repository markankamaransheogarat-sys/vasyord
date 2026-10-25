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
  Share2,
  Menu,
  X,
  Play,
  Square,
  Send
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

export function App() {
  const [username, setUsername] = useState(() => localStorage.getItem('vasyord_user') || `Patsan_${Math.floor(Math.random() * 899 + 100)}`);
  const [roomId, setRoomId] = useState('general-voice');
  const [connected, setConnected] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  
  // UI & Mobile state
  const [showChat, setShowChat] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  
  // Audio Controls
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);

  // Voice message recording (Telegram style)
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [currentlyPlayingAudio, setCurrentlyPlayingAudio] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<{ [peerId: string]: RTCPeerConnection }>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // MediaRecorder refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<any>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  const myAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`;

  useEffect(() => {
    localStorage.setItem('vasyord_user', username);
  }, [username]);

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
      console.warn("No microphone available or permission denied, joining in listen-only mode:", err);
      setIsMuted(true);
      localStreamRef.current = null;
    }

    // Connect Socket.io signaling (works even without microphone!)
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

  function setupSocketEvents(socket: Socket, currentRoom: string, initialMuted: boolean = false) {
    socket.on('connect', () => {
      socket.emit('join-room', {
        roomId: currentRoom,
        username,
        avatar: myAvatar,
        isMuted: initialMuted,
      });
    });

    // Handle existing peers
    socket.on('room-peers', ({ peers: initialPeers, messages: initialMessages }: { peers: Peer[]; messages: Message[] }) => {
      setPeers(initialPeers);
      setMessages(initialMessages);

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

    // Chat Message (Text or Voice)
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
      audioEl.play().catch(console.warn);
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

  // Send Text Message
  function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!inputText.trim() || !socketRef.current) return;
    socketRef.current.emit('send-message', { text: inputText });
    setInputText('');
  }

  // Telegram-style Voice Message Recorder
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

  // Play audio message
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

  return (
    <div className="vasyord-app">
      {/* 1. Server Icons Sidebar */}
      <nav className="servers-sidebar">
        <div className="server-icon active" title="Vasyord Home">
          <Compass size={22} />
        </div>
        <div style={{ width: 28, height: 2, background: 'var(--border-subtle)', borderRadius: 1 }} />
        <div className="server-icon" title="Пацанский сервер">
          VY
        </div>
        <div className="server-icon" title="Dota 2 / CS2 Party">
          🎮
        </div>
        <div className="server-icon" title="Create Room">
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
          <span>⚡ Vasyord Web</span>
          <span style={{ fontSize: 10, background: 'var(--online-green)', color: '#fff', padding: '2px 6px', borderRadius: 10, fontWeight: 700 }}>
            P2P
          </span>
        </div>

        <div className="channels-list">
          <div className="channel-category">Голосовые комнаты</div>

          <div
            className={`channel-item ${connected && roomId === 'general-voice' ? 'active' : ''}`}
            onClick={() => joinVoiceRoom('general-voice')}
          >
            <Volume2 size={18} color="var(--online-green)" />
            <span>🎙️ Общий войс</span>
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

          <div className="channel-category" style={{ marginTop: 12 }}>Текстовые темы</div>

          <div className="channel-item active">
            <Hash size={18} />
            <span>флудилка</span>
          </div>
          <div className="channel-item">
            <Hash size={18} />
            <span>мемы-и-скрины</span>
          </div>
        </div>

        {/* User Footer Controls (Discord style) */}
        <div className="user-footer">
          <div className="user-profile">
            <img src={myAvatar} alt="Avatar" className="avatar" />
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span
                style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-header)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }}
                onClick={() => {
                  const newName = prompt("Введите ваш никнейм:", username);
                  if (newName && newName.trim()) setUsername(newName.trim());
                }}
                title="Нажмите, чтобы сменить ник"
              >
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
          <button
            className="control-btn"
            onClick={() => {
              const newName = prompt("Сменить никнейм:", username);
              if (newName && newName.trim()) setUsername(newName.trim());
            }}
            title="Сменить ник"
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

            {/* Remote Peers */}
            {peers.map((peer) => (
              <div key={peer.id} className={`peer-card ${peer.isSpeaking ? 'speaking' : ''}`}>
                <div className="peer-status-icons">
                  {peer.isMuted && <MicOff size={15} color="var(--danger-red)" />}
                  {peer.isDeafened && <VolumeX size={15} color="var(--danger-red)" />}
                </div>
                <img src={peer.avatar} alt={peer.username} className="peer-avatar" />
                <div className="peer-name">{peer.username}</div>
              </div>
            ))}

            {!connected && (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-muted)', padding: '20px 10px' }}>
                <h3 style={{ color: 'var(--text-header)' }}>Вы не в голосовом канале</h3>
                <p style={{ marginTop: 6, fontSize: 13 }}>Подключайтесь и общайтесь с пацанами без задержек 🎙️</p>
                <button
                  style={{ marginTop: 14, padding: '10px 20px', background: 'var(--bg-accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
                  onClick={() => joinVoiceRoom('general-voice')}
                >
                  ⚡ Подключиться в «Общий войс»
                </button>
              </div>
            )}
          </section>

          {/* Right Text / Voice Chat Drawer */}
          {showChat && (
            <aside className="chat-drawer">
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-header)' }}>Чат комнаты</span>
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

                      {/* Regular text */}
                      {m.text && <div className="message-text">{m.text}</div>}

                      {/* Telegram-style voice message bubble */}
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
                    onChange={(e) => setInputText(e.target.value)}
                  />
                )}

                {/* Send text button if typing */}
                {inputText.trim().length > 0 && (
                  <button type="submit" className="send-btn" title="Отправить сообщение">
                    <Send size={18} color="var(--bg-accent)" />
                  </button>
                )}

                {/* Telegram-style Voice Message Button */}
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
    </div>
  );
}

export default App;
