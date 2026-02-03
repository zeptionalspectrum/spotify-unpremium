const socket = io();
let player;
let currentParty = null;
let isHost = false;

socket.emit("getParties");

function showCreate() {
  createModal.style.display = "flex";
}

function showJoin() {
  joinModal.style.display = "flex";
}

function closeModals() {
  createModal.style.display = "none";
  joinModal.style.display = "none";
}

function createParty() {
  socket.emit("createParty", {
    name: partyName.value,
    icon: partyIcon.value,
    private: false
  });
}

function joinByCode() {
  socket.emit("joinParty", joinCode.value);
  closeModals();
}

socket.on("partyCreated", party => {
  closeModals();
  openParty(party);
});

socket.on("partyList", list => {
  partyGrid.innerHTML = list.map(p => `
    <div class="party-card">
      <h3>${p.name}</h3>
      <div class="party-meta">👥 ${Object.keys(p.users || {}).length} players</div>
      <button class="primary" onclick="joinParty('${p.id}')">Join</button>
    </div>
  `).join("");
});

function joinParty(id) {
  socket.emit("joinParty", id);
}

socket.on("partyState", party => {
  openParty(party);
});

function openParty(party) {
  currentParty = party;
  isHost = party.host === socket.id;
  partyTitle.textContent = party.name;
  partyView.classList.remove("hidden");
  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
}

function extractId(url) {
  const m = url.match(/v=([^&]+)/);
  return m ? m[1] : url;
}

function addToQueue() {
  const id = extractId(ytInput.value);
  socket.emit("addToQueue", { videoId: id });
  ytInput.value = "";
}

socket.on("queueUpdate", q => {
  queue.innerHTML = q.map(v => `<div>${v.videoId}</div>`).join("");
});

function play() {
  if (!isHost) return;
  const first = queue.firstChild?.textContent;
  if (!first) return;
  player.loadVideoById(first);
  socket.emit("hostPlay", { videoId: first, time: 0 });
}

function pause() {
  if (!isHost) return;
  const t = player.getCurrentTime();
  player.pauseVideo();
  socket.emit("hostPause", t);
}

socket.on("syncPlay", data => {
  player.loadVideoById(data.videoId, data.time);
});

socket.on("syncPause", time => {
  player.seekTo(time, true);
  player.pauseVideo();
});

function onYouTubeIframeAPIReady() {
  player = new YT.Player("player", {
    height: "360",
    width: "640"
  });
}
