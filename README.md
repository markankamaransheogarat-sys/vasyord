# 🎙️ Vasyord (Васёрд) — Open-Source Discord Alternative

> **Легковесная, отказоустойчивая замена Discord для голосового общения и чата с пацанами без блокировок, лагов и цензуры.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](docker-compose.yml)
[![WebRTC](https://img.shields.io/badge/WebRTC-P2P%20Voice-333333?logo=webrtc)](https://webrtc.org/)
[![React](https://img.shields.io/badge/React-18%20%2B%20TypeScript-61DAFB?logo=react&logoColor=black)](https://reactjs.org/)

---

## ⚡ Особенности

- 🔒 **Полная приватность и Self-Hosted**: Разворачивается на личном VPS за 1 минуту через Docker. Никаких внешних серверов, прослушки или блокировок РКН.
- 🎙️ **Peer-to-Peer Voice (WebRTC)**: Ультра-низкая задержка (<30ms), аудио кодек Opus 48kHz Stereo, автоматическое шумоподавление (noise suppression) и эхоподавление (echo cancellation).
- 🟢 **Voice Activity Detection**: Подсветка говорящего зеленым ободком в реальном времени.
- 💬 **Комнатный чат и обмен ссылками**: Встроенный чат для каждого голосового канала.
- 🎨 **Discord Dark Theme**: Привычный и продуманный интерфейс Discord (левый сайдбар серверов, список каналов, плашка профиля с Mute/Deafen).
- 🔗 **Мгновенный инвайт**: Скопировал ссылку на комнату одной кнопкой — отправил друзьям — все в войсе. Не требует обязательной регистрации и паролей.
- 🛡️ **Обход блокировок**: Трафик между браузерами идет напрямую через WebRTC либо через ваш собственный зашифрованный туннель Cloudflare/HTTPS.

---

## 🚀 Быстрый старт (Docker)

```bash
# Клонируйте репозиторий
git clone https://github.com/markankamaransheogarat-sys/vasyord.git
cd vasyord

# Запустите через Docker Compose
docker compose up -d --build
```

Приложение будет доступно по адресу `http://localhost:3001` (или на вашем публичном домене/IP).

---

## 🛠️ Разработка локально

```bash
# 1. Установите зависимости
npm install
cd client && npm install && cd ..

# 2. Запустите клиент и сервер
npm run dev:server   # Сигнальный сервер на порту 3001
npm run dev:client   # Vite dev-сервер на порту 5173
```

---

## 🏗️ Архитектура

```
[ Browser A (Client) ] <====== WebRTC Media Stream (Opus Audio) ======> [ Browser B (Client) ]
         \                                                                   /
          \--- Socket.io (ICE / SDP Signaling, Room State, Chat Messages) --/
                                      |
                           [ Vasyord Signaling Server ]
                               (Node.js / Express)
```

- **Frontend**: React 18, TypeScript, Vite, Lucide Icons.
- **Backend / Signaling**: Node.js, Express, Socket.io.
- **P2P Engine**: Native WebRTC `RTCPeerConnection` with STUN fallbacks (`stun:stun.l.google.com:19302`, `stun:stun1.l.google.com:19302`).

---

## 📄 Лицензия

MIT License © 2026 [markankamaran](https://github.com/markankamaransheogarat-sys)
