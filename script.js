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

function appendChatMessage({ author, color, avatar, text, image, system }) {
  const time = Date.now();
  chatLog.push({ author, color, avatar, text, image, system: !!system, time });

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
    bodyEl.innerHTML =
      `<div class="msg-header"><span class="author" style="color:${color}">${escapeHtml(
        author
      )}</span><span class="msg-time">${formatLogTime(time)}</span></div>` +
      (text ? `<span class="text">${escapeHtml(text)}</span>` : "");

    if (image) {
      const imgEl = document.createElement("img");
      imgEl.className = "msg-image";
      imgEl.src = image;
      imgEl.alt = "";
      imgEl.addEventListener("click", () => openImageLightbox(image));
      bodyEl.appendChild(imgEl);
    }

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
  if (!text && !pendingChatImage) return;

  TheaterSocket.send("chat", {
    author: me.name,
    color: me.color,
    avatar: me.avatar,
    text,
    image: pendingChatImage,
  });
  chatInput.value = "";
  clearPendingChatImage();
});

// textarea로 바뀌면서 Enter가 기본적으로 줄바꿈이 되므로, Enter만 누르면 전송하고
// Shift+Enter는 그대로 줄바꿈으로 남겨둔다.
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

/* ---------- 채팅 이미지 첨부 (업로드 / 붙여넣기) ---------- */
const chatAttachBtn = document.getElementById("chatAttachBtn");
const chatImageInput = document.getElementById("chatImageInput");
const chatAttachmentPreview = document.getElementById("chatAttachmentPreview");
const chatAttachmentImg = document.getElementById("chatAttachmentImg");
const chatAttachmentRemoveBtn = document.getElementById("chatAttachmentRemoveBtn");

const CHAT_IMAGE_MAX_DIMENSION = 640;
let pendingChatImage = null; // 전송 대기 중인 이미지(리사이즈된 data URL)

// 알파 채널에 255보다 작은(완전 불투명하지 않은) 픽셀이 하나라도 있으면 투명도가 있는 것으로 본다.
function canvasHasTransparency(ctx, w, h) {
  const { data } = ctx.getImageData(0, 0, w, h);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

// 원본 이미지를 적당한 크기로 줄여서(용량 절약) data URL로 변환한다.
// 투명한 픽셀이 실제로 있는 이미지(티켓, 스티커 등)만 PNG로 저장해 투명도를 지키고,
// 그 외 일반 사진은 용량이 훨씬 작은 JPEG로 저장한다.
function resizeImageFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, CHAT_IMAGE_MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const canvasCtx = canvas.getContext("2d");
        canvasCtx.drawImage(img, 0, 0, w, h);

        const hasTransparency = canvasHasTransparency(canvasCtx, w, h);
        resolve(hasTransparency ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.8));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function setPendingChatImage(dataUrl) {
  pendingChatImage = dataUrl;
  chatAttachmentImg.src = dataUrl;
  chatAttachmentPreview.hidden = false;
}

function clearPendingChatImage() {
  pendingChatImage = null;
  chatAttachmentImg.src = "";
  chatAttachmentPreview.hidden = true;
}

chatAttachBtn.addEventListener("click", () => chatImageInput.click());

chatImageInput.addEventListener("change", async () => {
  const file = chatImageInput.files && chatImageInput.files[0];
  chatImageInput.value = "";
  if (!file) return;
  setPendingChatImage(await resizeImageFile(file));
});

chatAttachmentRemoveBtn.addEventListener("click", clearPendingChatImage);

// 채팅 입력창에 이미지를 붙여넣으면(Ctrl+V) 바로 첨부되게 한다.
chatInput.addEventListener("paste", async (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  const imageItem = [...items].find((item) => item.type.startsWith("image/"));
  if (!imageItem) return;
  e.preventDefault();
  const file = imageItem.getAsFile();
  if (!file) return;
  setPendingChatImage(await resizeImageFile(file));
});

/* ---------- 채팅 이미지 크게 보기 ---------- */
const imageLightbox = document.getElementById("imageLightbox");
const imageLightboxImg = document.getElementById("imageLightboxImg");

function openImageLightbox(src) {
  imageLightboxImg.src = src;
  imageLightbox.hidden = false;
}

imageLightbox.addEventListener("click", () => {
  imageLightbox.hidden = true;
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
  avatarUpload.value = ""; // 같은 파일을 다시 골라도 change가 또 발생하도록 비워둔다.
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => openAvatarCropModal(reader.result);
  reader.readAsDataURL(file);
});

avatarRemoveBtn.addEventListener("click", () => {
  me.avatar = null;
  localStorage.removeItem("theater_avatar");
  avatarUpload.value = "";
  refreshProfilePreview();
});

/* ---------- 프로필 사진 위치 조정(크롭) ----------
   원본 사진을 그대로 원형 아바타에 욱여넣으면 얼굴이 찌그러지거나 엉뚱한 부분이
   잘릴 수 있어서, 업로드 직후 드래그로 위치를 옮기고 슬라이더로 확대해서
   원하는 부분만 골라 저장할 수 있게 한다. */
const avatarCropOverlay = document.getElementById("avatarCropOverlay");
const avatarCropViewport = document.getElementById("avatarCropViewport");
const avatarCropImage = document.getElementById("avatarCropImage");
const avatarCropZoom = document.getElementById("avatarCropZoom");
const avatarCropCancelBtn = document.getElementById("avatarCropCancelBtn");
const avatarCropApplyBtn = document.getElementById("avatarCropApplyBtn");

const AVATAR_CROP_VIEWPORT_SIZE = 220;
const AVATAR_OUTPUT_SIZE = 320;

// { naturalWidth, naturalHeight, baseScale(뷰포트를 꽉 채우는 최소 배율), zoom, offsetX, offsetY }
let avatarCropState = null;

function updateAvatarCropTransform() {
  const { naturalWidth, naturalHeight, baseScale, zoom, offsetX, offsetY } = avatarCropState;
  const scale = baseScale * zoom;
  avatarCropImage.style.width = `${naturalWidth * scale}px`;
  avatarCropImage.style.height = `${naturalHeight * scale}px`;
  avatarCropImage.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
}

// 사진이 원형 뷰포트를 항상 완전히 덮도록(빈 공간이 생기지 않도록) 이동 범위를 제한한다.
function clampAvatarCropOffset() {
  const { naturalWidth, naturalHeight, baseScale, zoom } = avatarCropState;
  const scale = baseScale * zoom;
  const displayedW = naturalWidth * scale;
  const displayedH = naturalHeight * scale;
  const minX = AVATAR_CROP_VIEWPORT_SIZE - displayedW;
  const minY = AVATAR_CROP_VIEWPORT_SIZE - displayedH;
  avatarCropState.offsetX = Math.min(0, Math.max(minX, avatarCropState.offsetX));
  avatarCropState.offsetY = Math.min(0, Math.max(minY, avatarCropState.offsetY));
}

function openAvatarCropModal(dataUrl) {
  const img = new Image();
  img.onload = () => {
    const baseScale = Math.max(
      AVATAR_CROP_VIEWPORT_SIZE / img.naturalWidth,
      AVATAR_CROP_VIEWPORT_SIZE / img.naturalHeight
    );
    avatarCropState = {
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      baseScale,
      zoom: 1,
      offsetX: (AVATAR_CROP_VIEWPORT_SIZE - img.naturalWidth * baseScale) / 2,
      offsetY: (AVATAR_CROP_VIEWPORT_SIZE - img.naturalHeight * baseScale) / 2,
    };
    avatarCropImage.src = dataUrl;
    avatarCropZoom.value = "1";
    updateAvatarCropTransform();
    avatarCropOverlay.hidden = false;
  };
  img.src = dataUrl;
}

function closeAvatarCropModal() {
  avatarCropOverlay.hidden = true;
  avatarCropState = null;
}

let avatarDragStart = null;

avatarCropViewport.addEventListener("pointerdown", (e) => {
  if (!avatarCropState) return;
  avatarDragStart = { x: e.clientX, y: e.clientY, offsetX: avatarCropState.offsetX, offsetY: avatarCropState.offsetY };
  avatarCropViewport.classList.add("dragging");
  avatarCropViewport.setPointerCapture(e.pointerId);
});

avatarCropViewport.addEventListener("pointermove", (e) => {
  if (!avatarDragStart) return;
  avatarCropState.offsetX = avatarDragStart.offsetX + (e.clientX - avatarDragStart.x);
  avatarCropState.offsetY = avatarDragStart.offsetY + (e.clientY - avatarDragStart.y);
  clampAvatarCropOffset();
  updateAvatarCropTransform();
});

function stopAvatarDrag() {
  avatarDragStart = null;
  avatarCropViewport.classList.remove("dragging");
}

avatarCropViewport.addEventListener("pointerup", stopAvatarDrag);
avatarCropViewport.addEventListener("pointercancel", stopAvatarDrag);

avatarCropZoom.addEventListener("input", () => {
  if (!avatarCropState) return;
  avatarCropState.zoom = Number(avatarCropZoom.value);
  clampAvatarCropOffset();
  updateAvatarCropTransform();
});

avatarCropCancelBtn.addEventListener("click", closeAvatarCropModal);

avatarCropOverlay.addEventListener("click", (e) => {
  if (e.target === avatarCropOverlay) closeAvatarCropModal();
});

avatarCropApplyBtn.addEventListener("click", () => {
  if (!avatarCropState) return;
  const { baseScale, zoom, offsetX, offsetY } = avatarCropState;
  const scale = baseScale * zoom;

  // 원형 뷰포트가 원본 사진 좌표계에서 어디에 해당하는지 역산해서 그 영역만 잘라낸다.
  const sx = -offsetX / scale;
  const sy = -offsetY / scale;
  const sSize = AVATAR_CROP_VIEWPORT_SIZE / scale;

  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_OUTPUT_SIZE;
  canvas.height = AVATAR_OUTPUT_SIZE;
  canvas.getContext("2d").drawImage(avatarCropImage, sx, sy, sSize, sSize, 0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);

  const croppedDataUrl = canvas.toDataURL("image/png");
  me.avatar = croppedDataUrl;
  localStorage.setItem("theater_avatar", croppedDataUrl);
  refreshProfilePreview();

  closeAvatarCropModal();
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
    if (m.system) {
      lines.push(`[${time}] * ${m.text}`);
      return;
    }
    const text = m.text || (m.image ? "[이미지]" : "");
    lines.push(`[${time}] ${m.author}: ${text}`);
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

      const textHtml = m.text ? `<div class="log-text">${escapeHtml(m.text)}</div>` : "";
      const imageHtml = m.image ? `<img class="log-image" src="${m.image}" alt="" />` : "";

      return `  <div class="log-message">
    ${avatarHtml}
    <div class="log-body">
      <div class="log-meta"><span class="log-author" style="color:${escapeHtml(
        m.color
      )}">${escapeHtml(m.author)}</span><span class="log-time">${formatLogTime(
        m.time
      )}</span></div>
      ${textHtml}
      ${imageHtml}
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
  .log-image { max-width:220px; max-height:220px; margin-top:6px; border-radius:10px; display:block; }
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

// 이모지(🍅)는 보는 사람 기기의 이모지 폰트에 따라 모양이 제각각이라, 누가 봐도
// 똑같이 보이도록 직접 그린 SVG를 쓴다.
const TOMATO_SVG = `<svg viewBox="0 0 24 24" style="width:100%;height:100%;display:block;" aria-hidden="true">
  <ellipse cx="12" cy="13.5" rx="9.5" ry="8" fill="#e6432f"></ellipse>
  <ellipse cx="8.3" cy="9.8" rx="2.6" ry="1.6" fill="#ff8a72" opacity="0.65"></ellipse>
  <polygon points="12,3 13.8,7.2 18.3,7.2 14.7,9.8 16,14 12,11.3 8,14 9.3,9.8 5.7,7.2 10.2,7.2" fill="#3fa34d"></polygon>
</svg>`;

function spawnSplat(x, y) {
  const mark = document.createElement("span");
  mark.className = "fx-splat-mark";
  mark.style.left = `${x}px`;
  mark.style.top = `${y}px`;
  mark.style.setProperty("--rot", `${randomBetween(0, 360)}deg`);
  reactionStage.appendChild(mark);
  mark.addEventListener("animationend", () => mark.remove());

  // 메인 자국 주위에 작게 튄 자국을 몇 개 더 흩뿌려서 좀 더 "터진" 느낌을 준다.
  const spatterCount = Math.round(randomBetween(4, 7));
  for (let i = 0; i < spatterCount; i++) {
    const angle = randomBetween(0, Math.PI * 2);
    const dist = randomBetween(22, 52);
    const size = randomBetween(10, 22);
    const spatter = document.createElement("span");
    spatter.className = "fx-splat-spatter";
    spatter.style.left = `${x + Math.cos(angle) * dist}px`;
    spatter.style.top = `${y + Math.sin(angle) * dist}px`;
    spatter.style.width = `${size}px`;
    spatter.style.height = `${size}px`;
    spatter.style.marginLeft = `${-size / 2}px`;
    spatter.style.marginTop = `${-size / 2}px`;
    spatter.style.setProperty("--rot", `${randomBetween(0, 360)}deg`);
    reactionStage.appendChild(spatter);
    spatter.addEventListener("animationend", () => spatter.remove());
  }

  const dropCount = 10;
  for (let i = 0; i < dropCount; i++) {
    const angle = ((Math.PI * 2) / dropCount) * i + randomBetween(-0.3, 0.3);
    const dist = randomBetween(20, 56);
    const size = randomBetween(4, 9);
    const drop = document.createElement("span");
    drop.className = "fx-splat-drop";
    drop.style.left = `${x}px`;
    drop.style.top = `${y}px`;
    drop.style.width = `${size}px`;
    drop.style.height = `${size}px`;
    drop.style.marginLeft = `${-size / 2}px`;
    drop.style.marginTop = `${-size / 2}px`;
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
  el.innerHTML = TOMATO_SVG;
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

// 서버(혹은 로컬 에코)로부터 리액션 이벤트를 받으면 애니메이션을 재생한다.
TheaterSocket.on("reaction", ({ type }) => {
  playReactionEffect(type);
});

Object.entries(reactionButtons).forEach(([type, btn]) => {
  btn.addEventListener("click", () => {
    TheaterSocket.send("reaction", { type });
  });
});

/* ---------- 이모티콘 패널 트리거 ----------
   실제 이모티콘 목록/버튼은 따로 채워 넣을 예정이라 여기서는 열고 닫는 동작만
   준비해 둔다. 프로필/백업 메뉴와 똑같은 "토글 + 바깥 클릭하면 닫기" 패턴이라
   그대로 재사용했다. */
const emojiPanelBtn = document.getElementById("emojiPanelBtn");
const emojiPanel = document.getElementById("emojiPanel");

function openEmojiPanel() {
  closeProfileMenu();
  closeBackupMenu();
  emojiPanel.hidden = false;
}

function closeEmojiPanel() {
  emojiPanel.hidden = true;
}

emojiPanelBtn.addEventListener("click", () => {
  if (emojiPanel.hidden) openEmojiPanel();
  else closeEmojiPanel();
});

document.addEventListener("click", (e) => {
  if (emojiPanel.hidden) return;
  const clickedInsidePanel = emojiPanel.contains(e.target);
  const clickedTrigger = emojiPanelBtn.contains(e.target);
  if (!clickedInsidePanel && !clickedTrigger) closeEmojiPanel();
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
const screenVolumeControl = document.getElementById("screenVolumeControl");
const screenVolumeSlider = document.getElementById("screenVolumeSlider");
const viewerCountEl = document.getElementById("viewerCount");
const shareQualitySelect = document.getElementById("shareQualitySelect");

// 브라우저의 기본 자동 대역폭 추정치는 꽤 보수적이어서(특히 P2P 환경에서), 움직임이
// 많은 화면(직캠, 게임 등)에서 화질이 뭉개지거나 프레임이 밀리는 원인이 된다.
// - 표준: 일반적인 가정용 업로드 속도로도 무난한 값.
// - 고화질: 프레임/비트레이트를 크게 올리므로, 업로드 속도가 넉넉한 사람(기가 인터넷 등)에게 추천.
//   (시청자 수만큼 업로드가 곱해지는 구조라, 시청자가 많을수록 부담이 커진다.)
const SCREEN_SHARE_QUALITY_PRESETS = {
  standard: {
    video: { frameRate: { ideal: 24, max: 30 }, width: { max: 1920 }, height: { max: 1080 } },
    maxBitrate: 4_000_000,
  },
  high: {
    video: { frameRate: { ideal: 30, max: 60 }, width: { max: 1920 }, height: { max: 1080 } },
    maxBitrate: 8_000_000,
  },
};

shareQualitySelect.value = localStorage.getItem("theater_share_quality") || "standard";
shareQualitySelect.addEventListener("change", () => {
  localStorage.setItem("theater_share_quality", shareQualitySelect.value);
});

function getSelectedQualityPreset() {
  return SCREEN_SHARE_QUALITY_PRESETS[shareQualitySelect.value] || SCREEN_SHARE_QUALITY_PRESETS.standard;
}

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
  screenVideo.volume = Number(screenVolumeSlider.value);
  // 소리 크기 조절은 "남이 공유한 화면을 보는" 시청자한테만 의미가 있다
  // (내가 공유 중인 내 화면은 항상 음소거라서 볼륨을 조절해도 들리지 않는다).
  screenVolumeControl.hidden = local;
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

screenVolumeSlider.addEventListener("input", () => {
  screenVideo.volume = Number(screenVolumeSlider.value);
});

function clearScreenStream() {
  screenVideo.srcObject = null;
  screenWrapper.classList.remove("sharing");
  unmuteBtn.hidden = true;
  screenVolumeControl.hidden = true;
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

function boostVideoBitrate(pc) {
  const preset = getSelectedQualityPreset();
  pc.getSenders().forEach((sender) => {
    if (!sender.track || sender.track.kind !== "video") return;
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
    params.encodings[0].maxBitrate = preset.maxBitrate;
    // 실패해도 화면 공유 자체는 계속 진행하되, 콘솔에는 남겨서 화질이 이상할 때 원인을
    // 추적할 수 있게 한다 (전에는 조용히 무시해서 실패해도 알 방법이 없었다).
    sender.setParameters(params).catch((err) => console.warn("[화면공유] 비트레이트 설정 실패", err));
  });
}

// 지금 내가 공유 중인 화면을 특정 상대방에게 새로 연결해서 보내준다.
// (공유를 막 시작했을 때 이미 있던 사람들에게, 또는 공유 도중 새로 들어온 사람에게 쓴다.)
async function offerScreenShareTo(peerId) {
  if (!screenStream) return;
  const pc = getOrCreatePeerConnection(peerId);
  screenStream.getTracks().forEach((track) => pc.addTrack(track, screenStream));
  boostVideoBitrate(pc);
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
// 이때 그 상대방과 맺어뒀던 RTCPeerConnection도 같이 닫아야 한다 - 안 그러면 다음에
// 그 사람이 다시 공유를 시작했을 때, 이미 닫혀버린(stale) 연결을 재사용하려다 실패해서
// 화면이 아예 안 보이는 문제가 생긴다.
TheaterSocket.on("screenshare", ({ active, from }) => {
  if (!active) {
    clearScreenStream();
    if (from) closePeerConnection(from);
  }
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
    // 선택한 화질 프리셋(표준/고화질)에 따라 캡처 해상도·프레임 상한이 정해진다.
    const preset = getSelectedQualityPreset();
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: preset.video,
      audio: true,
    });
    screenStream = stream;
    attachScreenStream(stream, { local: true });

    // 인코더에게 "화질보다 움직임(프레임)이 중요한 영상"이라는 힌트를 줘서,
    // 직캠·게임처럼 움직임이 많은 화면에서 프레임이 밀리지 않게 한다.
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) videoTrack.contentHint = "motion";

    // 브라우저가 기본 제공하는 "공유 중지" 버튼(주소창 옆 등)을 눌러도
    // 감지할 수 있도록 트랙 종료 이벤트를 듣는다.
    stream.getVideoTracks()[0].addEventListener("ended", stopScreenShare);

    TheaterSocket.send("screenshare", { active: true, name: me.name, from: myPeerId });

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
  TheaterSocket.send("screenshare", { active: false, name: me.name, from: myPeerId });
}

shareStartBtn.addEventListener("click", startScreenShare);
shareStopBtn.addEventListener("click", stopScreenShare);
unmuteBtn.addEventListener("click", () => {
  screenVideo.muted = false;
  unmuteBtn.hidden = true;
});

/* =====================================================================
   채팅창 너비 조절 (드래그)
   ===================================================================== */
const theaterLayout = document.querySelector(".theater-layout");
const chatResizeHandle = document.getElementById("chatResizeHandle");
const chatPanelEl = document.querySelector(".chat-panel");

const CHAT_WIDTH_MIN = 260; // 채팅이 안 보일 정도로 쭈그러들지 않게 하는 최소 너비
const CHAT_WIDTH_MAX = 640;

// 반응형(좁은 화면) 구간에서는 세로 스택 레이아웃을 그대로 써야 하므로 너비를 강제하지 않는다.
function isDesktopLayout() {
  return window.matchMedia("(min-width: 901px)").matches;
}

function applyChatWidth(px) {
  theaterLayout.style.gridTemplateColumns = `1fr 6px ${px}px`;
}

function syncChatWidthForViewport() {
  if (!isDesktopLayout()) {
    theaterLayout.style.gridTemplateColumns = "";
    return;
  }
  const saved = parseInt(localStorage.getItem("theater_chat_width"), 10);
  if (!Number.isNaN(saved)) applyChatWidth(saved);
}

syncChatWidthForViewport();
window.addEventListener("resize", syncChatWidthForViewport);

let resizingChat = false;

chatResizeHandle.addEventListener("mousedown", (e) => {
  if (!isDesktopLayout()) return;
  resizingChat = true;
  chatResizeHandle.classList.add("dragging");
  document.body.style.userSelect = "none";
  e.preventDefault();
});

window.addEventListener("mousemove", (e) => {
  if (!resizingChat) return;
  const containerRect = theaterLayout.getBoundingClientRect();
  const maxAllowed = Math.min(CHAT_WIDTH_MAX, containerRect.width * 0.6);
  let newWidth = containerRect.right - e.clientX;
  newWidth = Math.min(maxAllowed, Math.max(CHAT_WIDTH_MIN, newWidth));
  applyChatWidth(newWidth);
});

window.addEventListener("mouseup", () => {
  if (!resizingChat) return;
  resizingChat = false;
  chatResizeHandle.classList.remove("dragging");
  document.body.style.userSelect = "";
  const chatWidthPx = Math.round(chatPanelEl.getBoundingClientRect().width);
  localStorage.setItem("theater_chat_width", chatWidthPx);
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
