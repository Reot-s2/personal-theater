"use strict";

/* =====================================================================
   TheaterSocket
   - 시그널링 서버(server.js)가 켜져 있으면 실제 WebSocket으로 연결해서
     채팅/리액션/화면공유 신호를 다른 사람과 주고받는다.
   - 서버가 없거나 연결에 실패하면 자동으로 로컬(에코) 모드로 전환해서
     혼자 쓸 때도 그대로 동작한다 (기존 동작과 100% 동일).
   ===================================================================== */
const TheaterSocket = {
  socket: null,
  connected: false,
  listeners: {},

  connect(url) {
    if (!url) {
      console.log("[TheaterSocket] 서버 주소가 없어 로컬 모드로 동작합니다.");
      setTimeout(() => this.emit("open"), 0);
      return;
    }

    try {
      this.socket = new WebSocket(url);
    } catch (err) {
      console.warn("[TheaterSocket] 서버에 연결할 수 없어 로컬 모드로 동작합니다.", err);
      this.socket = null;
      setTimeout(() => this.emit("open"), 0);
      return;
    }

    this.socket.onopen = () => {
      this.connected = true;
      this.emit("open");
    };
    this.socket.onmessage = (event) => {
      const { type, payload } = JSON.parse(event.data);
      this.emit(type, payload);
    };
    this.socket.onclose = () => {
      const wasConnected = this.connected;
      this.connected = false;
      this.socket = null;
      if (wasConnected) {
        this.emit("close");
      } else {
        // 애초에 연결(open)까지 가보지도 못하고 끊긴 경우(서버 미실행 등) - 로컬 모드로 전환.
        console.warn("[TheaterSocket] 서버 연결에 실패해 로컬 모드로 전환합니다.");
        setTimeout(() => this.emit("open"), 0);
      }
    };
    this.socket.onerror = () => {
      // 실제 에러 내용은 onclose에서 이어서 처리하므로 콘솔만 조용히 남긴다.
    };
  },

  send(type, payload) {
    const message = { type, payload, timestamp: Date.now() };

    if (this.socket && this.connected) {
      this.socket.send(JSON.stringify(message));
    } else {
      // 로컬 모드: 서버가 없으니 자기 자신에게 즉시 에코한다.
      this._localEcho(message);
    }
  },

  on(type, callback) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(callback);
  },

  emit(type, payload) {
    (this.listeners[type] || []).forEach((cb) => cb(payload));
  },

  _localEcho(message) {
    setTimeout(() => this.emit(message.type, message.payload), 30);
  },
};

/* =====================================================================
   유틸
   ===================================================================== */
function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

const USER_COLORS = ["#ff4d67", "#5cd6ff", "#7dff8a", "#ffcf5c", "#c58cff", "#ff9a5c"];

function isImageAvatar(avatar) {
  return typeof avatar === "string" && avatar.startsWith("data:image");
}

function getMyUser() {
  let name = localStorage.getItem("theater_username");
  let color = localStorage.getItem("theater_usercolor");
  let avatar = localStorage.getItem("theater_avatar"); // 없으면 null (업로드 전)

  if (!name) {
    name = `게스트${Math.floor(1000 + Math.random() * 9000)}`;
    localStorage.setItem("theater_username", name);
  }
  if (!color) {
    color = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
    localStorage.setItem("theater_usercolor", color);
  }
  if (avatar && !isImageAvatar(avatar)) {
    // 예전 버전(이모지 아바타)의 값이 남아있으면 무시한다.
    avatar = null;
    localStorage.removeItem("theater_avatar");
  }

  return { name, color, avatar };
}

// 업로드한 사진이 있으면 이미지로, 없으면 이름 첫 글자 + 사용자 색상으로 표시한다.
function renderAvatar(el, { avatar, name, color }) {
  if (isImageAvatar(avatar)) {
    el.style.backgroundImage = `url("${avatar}")`;
    el.style.backgroundColor = "";
    el.textContent = "";
  } else {
    el.style.backgroundImage = "";
    el.style.backgroundColor = color;
    el.textContent = (name || "?").trim().charAt(0).toUpperCase();
  }
}

/* =====================================================================
   채팅
   ===================================================================== */
const chatMessages = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const me = getMyUser();

// 백업 기능에서 사용하는, 지금까지 나눈 채팅 로그 전체 기록
const chatLog = [];

function appendChatMessage({ author, color, avatar, text, system }) {
  const time = Date.now();
  chatLog.push({ author, color, avatar, text, system: !!system, time });

  const row = document.createElement("div");
  row.className = system ? "chat-message system" : "chat-message";

  if (system) {
    row.textContent = text;
  } else {
    const avatarEl = document.createElement("span");
    avatarEl.className = "msg-avatar";
    renderAvatar(avatarEl, { avatar, name: author, color });

    const bodyEl = document.createElement("div");
    bodyEl.className = "msg-body";
    bodyEl.innerHTML = `<div class="msg-header"><span class="author" style="color:${color}">${escapeHtml(
      author
    )}</span><span class="msg-time">${formatLogTime(time)}</span></div><span class="text">${escapeHtml(
      text
    )}</span>`;

    row.appendChild(avatarEl);
    row.appendChild(bodyEl);
  }

  chatMessages.appendChild(row);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 서버(혹은 로컬 에코)로부터 채팅 메시지를 받으면 화면에 그린다.
TheaterSocket.on("chat", (payload) => {
  appendChatMessage(payload);
});

// 입장/퇴장 알림: 채팅 로그(백업 저장 대상)에는 남기지 않고, 화면에만 가운데 정렬로 보여준다.
function appendPresenceMessage(text) {
  const row = document.createElement("div");
  row.className = "chat-message system presence";
  row.textContent = text;
  chatMessages.appendChild(row);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 실제 서버가 연결되면 다른 사용자의 입장/퇴장도 이 이벤트로 전달받으면 된다.
TheaterSocket.on("presence", (payload) => {
  const verb = payload.type === "leave" ? "퇴장했습니다" : "입장했습니다";
  appendPresenceMessage(`${payload.name}님이 ${verb}`);
});

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  TheaterSocket.send("chat", {
    author: me.name,
    color: me.color,
    avatar: me.avatar,
    text,
  });
  chatInput.value = "";
});

// 연결이 실제로 준비된 뒤(로컬 모드에서도 open은 항상 한 번 발생한다) 입장을 알린다.
TheaterSocket.on("open", () => {
  TheaterSocket.send("presence", { type: "join", name: me.name });
});

/* =====================================================================
   프로필 설정 (닉네임 / 프로필 사진)
   ===================================================================== */
const profileTrigger = document.getElementById("profileTrigger");
const profileMenu = document.getElementById("profileMenu");
const profileCloseBtn = document.getElementById("profileCloseBtn");
const myAvatarPreview = document.getElementById("myAvatarPreview");
const myNamePreview = document.getElementById("myNamePreview");
const nameInput = document.getElementById("nameInput");
const colorInput = document.getElementById("colorInput");
const avatarPreviewLg = document.getElementById("avatarPreviewLg");
const avatarUpload = document.getElementById("avatarUpload");
const avatarRemoveBtn = document.getElementById("avatarRemoveBtn");

function refreshProfilePreview() {
  renderAvatar(myAvatarPreview, me);
  renderAvatar(avatarPreviewLg, me);
  myNamePreview.textContent = me.name;
}

nameInput.addEventListener("input", () => {
  const trimmed = nameInput.value.trim();
  me.name = trimmed || me.name;
  if (trimmed) localStorage.setItem("theater_username", trimmed);
  refreshProfilePreview();
});

colorInput.addEventListener("input", () => {
  me.color = colorInput.value;
  localStorage.setItem("theater_usercolor", me.color);
  refreshProfilePreview();
});

avatarUpload.addEventListener("change", () => {
  const file = avatarUpload.files && avatarUpload.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    me.avatar = reader.result;
    localStorage.setItem("theater_avatar", reader.result);
    refreshProfilePreview();
  };
  reader.readAsDataURL(file);
});

avatarRemoveBtn.addEventListener("click", () => {
  me.avatar = null;
  localStorage.removeItem("theater_avatar");
  avatarUpload.value = "";
  refreshProfilePreview();
});

function openProfileMenu() {
  nameInput.value = me.name;
  colorInput.value = me.color;
  closeBackupMenu();
  profileMenu.hidden = false;
}

function closeProfileMenu() {
  profileMenu.hidden = true;
}

profileTrigger.addEventListener("click", () => {
  if (profileMenu.hidden) openProfileMenu();
  else closeProfileMenu();
});

profileCloseBtn.addEventListener("click", closeProfileMenu);

document.addEventListener("click", (e) => {
  if (profileMenu.hidden) return;
  const clickedInsideMenu = profileMenu.contains(e.target);
  const clickedTrigger = profileTrigger.contains(e.target);
  if (!clickedInsideMenu && !clickedTrigger) closeProfileMenu();
});

refreshProfilePreview();

/* =====================================================================
   채팅 로그 백업 (텍스트 / HTML)
   ===================================================================== */
const backupTrigger = document.getElementById("backupTrigger");
const backupMenu = document.getElementById("backupMenu");
const backupTxtBtn = document.getElementById("backupTxtBtn");
const backupHtmlBtn = document.getElementById("backupHtmlBtn");

function openBackupMenu() {
  closeProfileMenu();
  backupMenu.hidden = false;
}

function closeBackupMenu() {
  backupMenu.hidden = true;
}

backupTrigger.addEventListener("click", () => {
  if (backupMenu.hidden) openBackupMenu();
  else closeBackupMenu();
});

document.addEventListener("click", (e) => {
  if (backupMenu.hidden) return;
  const clickedInsideMenu = backupMenu.contains(e.target);
  const clickedTrigger = backupTrigger.contains(e.target);
  if (!clickedInsideMenu && !clickedTrigger) closeBackupMenu();
});

function formatDateForFilename(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function formatLogTime(ms) {
  const d = new Date(ms);
  const hours24 = d.getHours();
  const period = hours24 < 12 ? "AM" : "PM";
  let hours12 = hours24 % 12;
  if (hours12 === 0) hours12 = 12;
  const pad = (n) => String(n).padStart(2, "0");
  return `${period} ${pad(hours12)}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildTextLog() {
  // 제목 아래 구분선 + 한 줄 여백을 두고 실제 채팅 로그가 이어지게 한다.
  const lines = [
    `퍼스널 시어터 채팅 로그 - ${new Date().toLocaleString("ko-KR")}`,
    "",
    "----------------------------------------",
    "",
  ];

  chatLog.forEach((m) => {
    const time = formatLogTime(m.time);
    lines.push(m.system ? `[${time}] * ${m.text}` : `[${time}] ${m.author}: ${m.text}`);
  });

  return lines.join("\n");
}

function buildHtmlLog() {
  const rows = chatLog
    .map((m) => {
      if (m.system) {
        return `  <div class="log-system">* ${escapeHtml(m.text)}</div>`;
      }

      const avatarHtml = isImageAvatar(m.avatar)
        ? `<span class="log-avatar" style="background-image:url('${m.avatar}')"></span>`
        : `<span class="log-avatar" style="background-color:${escapeHtml(
            m.color
          )}">${escapeHtml((m.author || "?").trim().charAt(0).toUpperCase())}</span>`;

      return `  <div class="log-message">
    ${avatarHtml}
    <div class="log-body">
      <div class="log-meta"><span class="log-author" style="color:${escapeHtml(
        m.color
      )}">${escapeHtml(m.author)}</span><span class="log-time">${formatLogTime(
        m.time
      )}</span></div>
      <div class="log-text">${escapeHtml(m.text)}</div>
    </div>
  </div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<title>퍼스널 시어터 채팅 로그</title>
<style>
  body { background:#0b0b0f; color:#f5f5f7; font-family:"Apple SD Gothic Neo","Malgun Gothic",sans-serif; padding:24px; }
  h1 { font-size:15px; font-weight:700; color:#9a9aa5; margin:0 0 18px; }
  .log-message { display:flex; align-items:flex-start; gap:10px; margin-bottom:16px; }
  .log-avatar { flex-shrink:0; width:40px; height:40px; border-radius:50%; background-color:#1e1e26; background-size:cover; background-position:center; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:16px; color:#fff; }
  .log-body { min-width:0; }
  .log-meta { display:flex; align-items:baseline; gap:8px; margin-bottom:2px; }
  .log-author { font-weight:700; font-size:13px; }
  .log-time { font-size:11px; color:#6d6d78; }
  .log-text { font-size:13px; line-height:1.5; word-break:break-word; }
  .log-system { color:#9a9aa5; font-style:italic; font-size:12px; margin:10px 0; }
  .log-divider { border-top:1px solid #2a2a33; margin:8px 0 24px; }
</style>
</head>
<body>
<h1>퍼스널 시어터 채팅 로그 - ${escapeHtml(new Date().toLocaleString("ko-KR"))}</h1>
<div class="log-divider"></div>
${rows}
</body>
</html>
`;
}

backupTxtBtn.addEventListener("click", () => {
  downloadFile(
    `theater-chat-log-${formatDateForFilename(new Date())}.txt`,
    buildTextLog(),
    "text/plain;charset=utf-8"
  );
  closeBackupMenu();
});

backupHtmlBtn.addEventListener("click", () => {
  downloadFile(
    `theater-chat-log-${formatDateForFilename(new Date())}.html`,
    buildHtmlLog(),
    "text/html;charset=utf-8"
  );
  closeBackupMenu();
});

/* =====================================================================
   리액션 (야유 / 박수 / 하트)
   ===================================================================== */
const reactionStage = document.getElementById("reactionStage");

const reactionButtons = {
  boo: document.getElementById("btnBoo"),
  clap: document.getElementById("btnClap"),
  heart: document.getElementById("btnHeart"),
};

const reactionCounts = {
  boo: document.getElementById("countBoo"),
  clap: document.getElementById("countClap"),
  heart: document.getElementById("countHeart"),
};

const counts = { boo: 0, clap: 0, heart: 0 };

function spawnSplat(x, y) {
  const mark = document.createElement("span");
  mark.className = "fx-splat-mark";
  mark.style.left = `${x}px`;
  mark.style.top = `${y}px`;
  reactionStage.appendChild(mark);
  mark.addEventListener("animationend", () => mark.remove());

  const dropCount = 8;
  for (let i = 0; i < dropCount; i++) {
    const angle = ((Math.PI * 2) / dropCount) * i + randomBetween(-0.3, 0.3);
    const dist = randomBetween(18, 46);
    const drop = document.createElement("span");
    drop.className = "fx-splat-drop";
    drop.style.left = `${x}px`;
    drop.style.top = `${y}px`;
    drop.style.setProperty("--sx", `${Math.cos(angle) * dist}px`);
    drop.style.setProperty("--sy", `${Math.sin(angle) * dist}px`);
    reactionStage.appendChild(drop);
    drop.addEventListener("animationend", () => drop.remove());
  }
}

function spawnTomato() {
  const rect = reactionStage.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  // 화면 밖(아래쪽)에서 시작해 화면 중앙 쪽 랜덤한 지점으로 날아가 부딪힌다.
  const startX = randomBetween(width * 0.1, width * 0.9);
  const startY = height + 70;
  const targetX = randomBetween(width * 0.25, width * 0.75);
  const targetY = randomBetween(height * 0.25, height * 0.65);

  const dx = targetX - startX;
  const dy = targetY - startY;
  const rot = randomBetween(-220, 220);
  const duration = randomBetween(0.5, 0.7);

  const el = document.createElement("span");
  el.className = "fx-tomato";
  el.textContent = "🍅";
  el.style.left = `${startX}px`;
  el.style.top = `${startY}px`;
  el.style.setProperty("--dx", `${dx}px`);
  el.style.setProperty("--dy", `${dy}px`);
  el.style.setProperty("--rot", `${rot}deg`);
  el.style.animationDuration = `${duration}s`;
  reactionStage.appendChild(el);

  // 날아가는 도중(약 75% 지점)에 화면에 부딪혀 터지는 것처럼 스플래시를 띄운다.
  setTimeout(() => spawnSplat(targetX, targetY), duration * 750);

  el.addEventListener("animationend", () => el.remove());
}

function spawnConfettiBurst() {
  const colors = ["#ff4d67", "#ffcf5c", "#5cd6ff", "#7dff8a", "#c58cff"];
  const pieceCount = 26;

  for (let i = 0; i < pieceCount; i++) {
    const el = document.createElement("span");
    el.className = "fx-confetti";
    el.style.left = `${randomBetween(0, 100)}%`;
    el.style.background = colors[Math.floor(Math.random() * colors.length)];
    el.style.animationDuration = `${randomBetween(0.9, 1.6)}s`;
    el.style.animationDelay = `${randomBetween(0, 0.25)}s`;
    reactionStage.appendChild(el);
    el.addEventListener("animationend", () => el.remove());
  }
}

function spawnHearts() {
  const heartCount = 4;

  for (let i = 0; i < heartCount; i++) {
    const el = document.createElement("span");
    el.className = "fx-heart";
    el.textContent = "❤️";
    el.style.left = `${randomBetween(35, 60)}%`;
    el.style.setProperty("--drift", `${randomBetween(-40, 40)}px`);
    el.style.animationDuration = `${randomBetween(1.4, 2)}s`;
    el.style.animationDelay = `${randomBetween(0, 0.3)}s`;
    reactionStage.appendChild(el);
    el.addEventListener("animationend", () => el.remove());
  }
}

const REACTION_EFFECTS = {
  boo: spawnTomato,
  clap: spawnConfettiBurst,
  heart: spawnHearts,
};

function playReactionEffect(type) {
  const effect = REACTION_EFFECTS[type];
  if (effect) effect();

  const btn = reactionButtons[type];
  btn.classList.remove("pulse");
  void btn.offsetWidth; // 리플로우를 강제해 애니메이션 재시작
  btn.classList.add("pulse");
}

function bumpReactionCount(type) {
  counts[type] += 1;
  reactionCounts[type].textContent = counts[type];
}

// 서버(혹은 로컬 에코)로부터 리액션 이벤트를 받으면 애니메이션 + 카운트를 갱신한다.
TheaterSocket.on("reaction", ({ type }) => {
  playReactionEffect(type);
  bumpReactionCount(type);
});

Object.entries(reactionButtons).forEach(([type, btn]) => {
  btn.addEventListener("click", () => {
    TheaterSocket.send("reaction", { type });
  });
});

/* =====================================================================
   화면 공유 (getDisplayMedia + WebRTC 1:N 메시)
   - 화면 스트림 자체는 서버를 거치지 않고 브라우저끼리(P2P) 직접 주고받는다.
   - TheaterSocket(WebSocket)은 "누구랑 연결할지"를 정하는 신호(offer/answer/
     ICE candidate)만 중개한다 - 실제 영상 데이터는 안 지나간다.
   - 최대 5인 정도의 소규모 모임을 기준으로 한 "메시(mesh)" 구조라, 화면을 공유하는
     사람이 시청자 수만큼 업로드를 나눠 보낸다. 인원이 훨씬 많아지면 중계 서버(SFU)가
     필요하지만 지금 규모에서는 이 구조로 충분하다.
   ===================================================================== */
const screenWrapper = document.getElementById("screenWrapper");
const shareStartBtn = document.getElementById("shareStartBtn");
const shareStopBtn = document.getElementById("shareStopBtn");
const screenVideo = document.getElementById("screenVideo");
const unmuteBtn = document.getElementById("unmuteBtn");
const viewerCountEl = document.getElementById("viewerCount");

let screenStream = null;
let myPeerId = null;
const knownPeerIds = new Set();
const peerConnections = new Map(); // peerId -> RTCPeerConnection

// 공개 STUN 서버로 대부분의 가정용 네트워크 환경(NAT 뒤)에서 P2P 연결을 뚫는다.
// (아주 제한적인 네트워크의 경우 TURN 중계 서버가 추가로 필요할 수 있는데,
// 지인들끼리 쓰는 지금 규모에서는 STUN만으로 충분한 경우가 대부분이다.)
const RTC_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

function updateViewerCount() {
  viewerCountEl.textContent = `${knownPeerIds.size + 1}명 시청 중`;
}

// 화면 <video>에 스트림을 붙인다. 내가 공유 중인 내 화면(local)은 소리가 겹치지
// 않도록 항상 음소거하고, 남이 공유한 화면(remote)은 소리를 켜서 재생을 시도한다.
function attachScreenStream(stream, { local }) {
  unmuteBtn.hidden = true;
  screenVideo.srcObject = stream;
  screenVideo.muted = local;
  screenWrapper.classList.add("sharing");

  const playPromise = screenVideo.play();
  if (playPromise && playPromise.catch) {
    playPromise.catch(() => {
      if (local) return;
      // 브라우저 자동재생 정책 때문에 소리가 있는 영상이 자동재생 안 될 수 있다.
      // 일단 음소거로 재생하고, 시청자가 직접 눌러서 소리를 켤 수 있게 안내한다.
      screenVideo.muted = true;
      unmuteBtn.hidden = false;
      screenVideo.play().catch(() => {});
    });
  }
}

function clearScreenStream() {
  screenVideo.srcObject = null;
  screenWrapper.classList.remove("sharing");
  unmuteBtn.hidden = true;
}

function createPeerConnection(peerId) {
  const pc = new RTCPeerConnection(RTC_CONFIG);

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      TheaterSocket.send("rtc-ice", { to: peerId, candidate: e.candidate });
    }
  };

  // 상대방이 화면을 공유 중이면(=내가 시청자일 때) 여기로 스트림이 들어온다.
  pc.ontrack = (e) => {
    attachScreenStream(e.streams[0], { local: false });
  };

  peerConnections.set(peerId, pc);
  return pc;
}

function getOrCreatePeerConnection(peerId) {
  return peerConnections.get(peerId) || createPeerConnection(peerId);
}

function closePeerConnection(peerId) {
  const pc = peerConnections.get(peerId);
  if (pc) {
    pc.close();
    peerConnections.delete(peerId);
  }
}

// 지금 내가 공유 중인 화면을 특정 상대방에게 새로 연결해서 보내준다.
// (공유를 막 시작했을 때 이미 있던 사람들에게, 또는 공유 도중 새로 들어온 사람에게 쓴다.)
async function offerScreenShareTo(peerId) {
  if (!screenStream) return;
  const pc = getOrCreatePeerConnection(peerId);
  screenStream.getTracks().forEach((track) => pc.addTrack(track, screenStream));
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  TheaterSocket.send("rtc-offer", { to: peerId, sdp: offer });
}

TheaterSocket.on("welcome", ({ id, peers }) => {
  myPeerId = id;
  peers.forEach((peerId) => knownPeerIds.add(peerId));
  updateViewerCount();
});

TheaterSocket.on("peer-joined", ({ id }) => {
  knownPeerIds.add(id);
  updateViewerCount();
  // 내가 이미 화면을 공유하고 있었다면, 새로 들어온 사람에게도 바로 이어서 보내준다.
  offerScreenShareTo(id);
});

TheaterSocket.on("peer-left", ({ id }) => {
  knownPeerIds.delete(id);
  closePeerConnection(id);
  updateViewerCount();
});

// 화면 공유 시작/종료 알림 - 공유가 끝났다는 신호를 받으면(내 것 포함) 시청 화면을 정리한다.
TheaterSocket.on("screenshare", ({ active }) => {
  if (!active) clearScreenStream();
});

// 누군가 나에게 화면을 보내겠다는 offer를 보내오면(=상대가 방금 공유를 시작함) 응답한다.
TheaterSocket.on("rtc-offer", async ({ from, sdp }) => {
  const pc = getOrCreatePeerConnection(from);
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  TheaterSocket.send("rtc-answer", { to: from, sdp: answer });
});

TheaterSocket.on("rtc-answer", async ({ from, sdp }) => {
  const pc = peerConnections.get(from);
  if (pc) await pc.setRemoteDescription(new RTCSessionDescription(sdp));
});

TheaterSocket.on("rtc-ice", async ({ from, candidate }) => {
  const pc = peerConnections.get(from);
  if (pc && candidate) {
    try {
      await pc.addIceCandidate(candidate);
    } catch (err) {
      console.warn("[화면공유] ICE candidate 추가 실패", err);
    }
  }
});

async function startScreenShare() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    alert("이 브라우저는 화면 공유 기능을 지원하지 않습니다.");
    return;
  }

  try {
    // 시청자 수만큼 업로드 대역폭이 곱절로 나가는 P2P 구조라, 화질/프레임에 상한을 걸어둔다.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 24, max: 30 }, width: { max: 1920 }, height: { max: 1080 } },
      audio: true,
    });
    screenStream = stream;
    attachScreenStream(stream, { local: true });

    // 브라우저가 기본 제공하는 "공유 중지" 버튼(주소창 옆 등)을 눌러도
    // 감지할 수 있도록 트랙 종료 이벤트를 듣는다.
    stream.getVideoTracks()[0].addEventListener("ended", stopScreenShare);

    TheaterSocket.send("screenshare", { active: true, name: me.name });

    // 지금 접속해 있는 모든 사람에게 화면을 이어서 보내준다.
    knownPeerIds.forEach((peerId) => offerScreenShareTo(peerId));
  } catch (err) {
    // 사용자가 공유 선택 창에서 취소한 경우(NotAllowedError)는 에러가 아니다.
    if (err.name !== "NotAllowedError") console.error(err);
  }
}

function stopScreenShare() {
  if (screenStream) {
    screenStream.getTracks().forEach((track) => track.stop());
    screenStream = null;
  }
  // 시청자들에게 만들어줬던 연결도 모두 정리한다.
  peerConnections.forEach((pc) => pc.close());
  peerConnections.clear();

  clearScreenStream();
  TheaterSocket.send("screenshare", { active: false, name: me.name });
}

shareStartBtn.addEventListener("click", startScreenShare);
shareStopBtn.addEventListener("click", stopScreenShare);
unmuteBtn.addEventListener("click", () => {
  screenVideo.muted = false;
  unmuteBtn.hidden = true;
});

/* =====================================================================
   초기화
   ===================================================================== */
// 시그널링 서버 주소. Render 무료 플랜에 배포해 둔 서버를 기본으로 쓰고,
// localhost에서 개발/테스트할 때만 로컬의 server.js(포트 8080)로 붙는다.
// 서버가 꺼져 있거나 연결에 실패해도 자동으로 로컬 모드로 전환되니, 배포 서버가
// 잠들어 있거나(무료 플랜 슬립) 아직 안 켜져 있어도 혼자 쓰는 건 지장 없다.
const DEPLOYED_SIGNALING_URL = "wss://personal-theater-signaling.onrender.com";
const isLocalDev = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const SIGNALING_SERVER_URL = isLocalDev ? `ws://${location.hostname}:8080` : DEPLOYED_SIGNALING_URL;
TheaterSocket.connect(SIGNALING_SERVER_URL);
