"use strict";

/**
 * 퍼스널 시어터 시그널링 서버
 * - 채팅 / 리액션 / 입장·퇴장 메시지는 접속한 모든 사람에게 그대로 릴레이(중계)한다.
 * - 화면 공유(WebRTC) 협상 메시지(rtc-offer / rtc-answer / rtc-ice)는 payload.to로
 *   지정된 상대방 한 명에게만 전달한다. 실제 화면 영상 데이터는 이 서버를 거치지
 *   않고 브라우저끼리 직접(P2P) 주고받으며, 이 서버는 "누구랑 연결할지"를
 *   정해주는 중개인 역할만 한다.
 *
 * 실행 방법:
 *   npm install
 *   npm start
 *   (기본 포트 8080. 다른 포트를 쓰려면: PORT=9000 npm start)
 */
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

const clients = new Map(); // peerId -> ws

// 접속자끼리 그대로 릴레이(브로드캐스트)할 메시지 종류.
// 보낸 사람 본인에게도 다시 보내서, 기존 클라이언트 코드(로컬 에코 모드와 동일한 흐름)가
// 서버 유무와 상관없이 그대로 동작하게 한다.
const BROADCAST_TYPES = new Set(["chat", "reaction", "presence", "screenshare"]);

function generatePeerId() {
  return Math.random().toString(36).slice(2, 10);
}

function send(ws, type, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type, payload, timestamp: Date.now() }));
  }
}

function broadcast(type, payload, exceptId) {
  clients.forEach((ws, id) => {
    if (id !== exceptId) send(ws, type, payload);
  });
}

wss.on("connection", (ws) => {
  const id = generatePeerId();
  clients.set(id, ws);

  // 새로 접속한 사람에게 자신의 id와 지금 이미 접속해 있는 사람들의 id 목록을 알려준다.
  send(ws, "welcome", { id, peers: [...clients.keys()].filter((peerId) => peerId !== id) });
  // 기존 접속자들에게는 새 사람이 들어왔다고 알려준다.
  broadcast("peer-joined", { id }, id);

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return; // 형식이 이상한 메시지는 무시
    }

    const { type, payload } = message;
    if (!type) return;

    if (payload && payload.to) {
      // 특정 상대방 한 명에게만 전달하는 WebRTC 시그널링 메시지.
      const targetWs = clients.get(payload.to);
      if (targetWs) send(targetWs, type, { ...payload, from: id });
      return;
    }

    if (BROADCAST_TYPES.has(type)) {
      broadcast(type, payload, null);
    }
  });

  ws.on("close", () => {
    clients.delete(id);
    broadcast("peer-left", { id });
  });
});

console.log(`[시그널링 서버] ws://localhost:${PORT} 에서 대기 중입니다...`);
