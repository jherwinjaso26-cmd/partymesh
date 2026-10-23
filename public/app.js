const menuScreen = document.getElementById('menu-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');

const bombCanvas = document.getElementById('bomb-canvas');
const ctx = bombCanvas ? bombCanvas.getContext('2d') : null;

const btnHost = document.getElementById('btn-host');
const btnJoin = document.getElementById('btn-join');
const btnStart = document.getElementById('btn-start');

const hostOptionsPanel = document.getElementById('host-options-panel');
const selectTimer = document.getElementById('select-timer');
const selectMaxPlayers = document.getElementById('select-max-players');
const selectDifficulty = document.getElementById('select-difficulty');

const inputUsername = document.getElementById('input-username');
const inputRoom = document.getElementById('input-room');

const displayRoomId = document.getElementById('display-room-id');
const playerList = document.getElementById('player-list');
const waitMessage = document.getElementById('wait-message');
const gameTimer = document.getElementById('game-timer');
const gameTickerMessage = document.getElementById('game-ticker-message');

const joystickZone = document.getElementById('joystick-zone');
const joystickBase = document.getElementById('joystick-base');
const joystickStick = document.getElementById('joystick-stick');

const labelFace = document.getElementById('label-face');
const labelHat = document.getElementById('label-hat');
const labelShirt = document.getElementById('label-shirt');

const faces = ['🙂', '🤪', '😎', '😡', '😭', '🤡'];
const hats = ['', '👑', '🧢', '🤠', '🎩', '🎀'];
const shirts = [
    { name: 'Blue', hex: '#3b82f6' },
    { name: 'Pink', hex: '#ec4899' },
    { name: 'Green', hex: '#10b981' },
    { name: 'Orange', hex: '#f97316' },
    { name: 'Purple', hex: '#8b5cf6' }
];

let currentFaceIdx = 0;
let currentHatIdx = 0;
let currentShirtIdx = 0;

let myUsername = "";
let currentPositions = {};
let gameObstacles = [];
let keysPressed = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };

let joystickActive = false;
let joystickStartPos = { x: 0, y: 0 };
let currentVector = { x: 0, y: 0 };
let pulseTime = 0;

let explosionParticles = [];
let explosionActive = false;
let obstacleMode = "normal";

let audioCtx = null;
let soundInterval = null;
let localIsIt = false;
let isHostUser = false;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

function playPressureTick() {
    if (!audioCtx || !localIsIt || explosionActive) return;
    let osc = audioCtx.createOscillator();
    let gainNode = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(440 + (Math.sin(pulseTime) * 120), audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15);
    gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.18);
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.18);
}

function manageBombSound(isHoldingBomb) {
    if (isHoldingBomb) {
        if (!soundInterval) {
            soundInterval = setInterval(playPressureTick, 250);
        }
    } else {
        if (soundInterval) {
            clearInterval(soundInterval);
            soundInterval = null;
        }
    }
}

function resizeGameView() {
    if (!bombCanvas) return;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    const scale = Math.min(windowWidth / 800, windowHeight / 600, 0.95);
    bombCanvas.style.width = (800 * scale) + "px";
    bombCanvas.style.height = (600 * scale) + "px";
}
window.addEventListener('resize', resizeGameView);

function emitSkinUpdate() {
    const cosmetics = {
        face: faces[currentFaceIdx],
        hat: hats[currentHatIdx],
        shirt: shirts[currentShirtIdx].hex
    };
    labelFace.innerText = faces[currentFaceIdx];
    labelHat.innerText = hats[currentHatIdx] === '' ? '❌' : hats[currentHatIdx];
    labelShirt.innerText = shirts[currentShirtIdx].name;
    Network.updateCosmetics(cosmetics);
}

document.getElementById('btn-next-face').addEventListener('click', () => { initAudio(); currentFaceIdx = (currentFaceIdx + 1) % faces.length; emitSkinUpdate(); });
document.getElementById('btn-prev-face').addEventListener('click', () => { initAudio(); currentFaceIdx = (currentFaceIdx - 1 + faces.length) % faces.length; emitSkinUpdate(); });
document.getElementById('btn-next-hat').addEventListener('click', () => { initAudio(); currentHatIdx = (currentHatIdx + 1) % hats.length; emitSkinUpdate(); });
document.getElementById('btn-prev-hat').addEventListener('click', () => { initAudio(); currentHatIdx = (currentHatIdx - 1 + hats.length) % hats.length; emitSkinUpdate(); });
document.getElementById('btn-next-shirt').addEventListener('click', () => { initAudio(); currentShirtIdx = (currentShirtIdx + 1) % shirts.length; emitSkinUpdate(); });
document.getElementById('btn-prev-shirt').addEventListener('click', () => { initAudio(); currentShirtIdx = (currentShirtIdx - 1 + shirts.length) % shirts.length; emitSkinUpdate(); });

btnHost.addEventListener('click', () => {
    initAudio();
    const name = inputUsername.value.trim();
    if (name !== '') {
        myUsername = name;
        isHostUser = true;
        Network.hostRoom(name);
    } else {
        alert('Please enter a username first.');
    }
});

btnJoin.addEventListener('click', () => {
    initAudio();
    const name = inputUsername.value.trim();
    const code = inputRoom.value.trim();
    if (name === '') {
        alert('Please enter a username first.');
        return;
    }
    if (code.length === 4) {
        myUsername = name;
        isHostUser = false;
        Network.joinRoom(code, name);
    } else {
        alert('Please enter a valid 4-digit room code.');
    }
});

btnStart.addEventListener('click', () => {
    initAudio();
    const config = {
        duration: parseInt(selectTimer.value),
        maxPlayers: parseInt(selectMaxPlayers.value),
        difficulty: selectDifficulty.value
    };
    Network.startGame(config);
});

window.addEventListener('keydown', (e) => {
    if (e.key in keysPressed) {
        keysPressed[e.key] = true;
        updateKeyboardInput();
    }
});

window.addEventListener('keyup', (e) => {
    if (e.key in keysPressed) {
        keysPressed[e.key] = false;
        updateKeyboardInput();
    }
});

function updateKeyboardInput() {
    if (joystickActive) return;
    let vx = 0;
    let vy = 0;
    if (keysPressed.ArrowUp) vy -= 1;
    if (keysPressed.ArrowDown) vy += 1;
    if (keysPressed.ArrowLeft) vx -= 1;
    if (keysPressed.ArrowRight) vx += 1;
    Network.sendInputVector(vx, vy);
}

joystickZone?.addEventListener('touchstart', (e) => {
    initAudio();
    joystickActive = true;
    const rect = joystickBase.getBoundingClientRect();
    joystickStartPos = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
    };
    handleJoystickMove(e.touches[0]);
});

joystickZone?.addEventListener('touchmove', (e) => {
    if (!joystickActive) return;
    handleJoystickMove(e.touches[0]);
});

window.addEventListener('touchend', () => {
    if (!joystickActive) return;
    joystickActive = false;
    if (joystickStick) {
        joystickStick.style.left = '50%';
        joystickStick.style.top = '50%';
    }
    Network.sendInputVector(0, 0);
});

function handleJoystickMove(touch) {
    if (!touch) return;
    let dx = touch.clientX - joystickStartPos.x;
    let dy = touch.clientY - joystickStartPos.y;
    const maxRadius = 45;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > maxRadius) {
        dx = (dx / distance) * maxRadius;
        dy = (dy / distance) * maxRadius;
    }

    if (joystickStick) {
        joystickStick.style.left = `calc(50% + ${dx}px)`;
        joystickStick.style.top = `calc(50% + ${dy}px)`;
    }

    currentVector.x = dx / maxRadius;
    currentVector.y = dy / maxRadius;
    Network.sendInputVector(currentVector.x, currentVector.y);
}

Network.onRoomCreated(({ roomId, players }) => {
    menuScreen.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');
    displayRoomId.innerText = `Room ID: ${roomId}`;
    btnStart.classList.remove('hidden');
    hostOptionsPanel.classList.remove('hidden');
    waitMessage.classList.add('hidden');
    updatePlayerLobbyUI(players);
    emitSkinUpdate();
});

Network.onRoomUpdated(({ roomId, players }) => {
    menuScreen.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');
    displayRoomId.innerText = `Room ID: ${roomId}`;
    if (isHostUser) {
        btnStart.classList.remove('hidden');
        hostOptionsPanel.classList.remove('hidden');
        waitMessage.classList.add('hidden');
    } else {
        btnStart.classList.add('hidden');
        hostOptionsPanel.classList.add('hidden');
        waitMessage.classList.remove('hidden');
    }
    updatePlayerLobbyUI(players);
    emitSkinUpdate();
});

Network.onJoinError((message) => {
    alert(message);
});

Network.onGameStarted(({ obstacles, difficulty }) => {
    gameObstacles = obstacles;
    obstacleMode = difficulty;
    explosionActive = false;
    explosionParticles = [];
    
    document.body.style.overflow = 'hidden'; 
    
    lobbyScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    resizeGameView();
    setTimeout(resizeGameView, 100);
    requestAnimationFrame(renderLoop);
});

Network.onPositionsUpdated((positions) => {
    if (explosionActive) return;
    currentPositions = positions;
    
    const holdingBomb = !!currentPositions[myUsername]?.isIt;
    localIsIt = holdingBomb;
manageBombSound(holdingBomb);
if (holdingBomb) {
gameScreen.classList.add('bomb-danger');
} else {
gameScreen.classList.remove('bomb-danger');
}
});
Network.onBombPassed(({ from, to }) => {
if (gameTickerMessage) {
gameTickerMessage.innerText = `💥 ${from} passed the bomb to ${to}!`;
gameTickerMessage.style.color = '#ef4444';
setTimeout(() => {
if (!gameScreen.classList.contains('hidden')) {
gameTickerMessage.innerText = "Evade the bomb holder!";
gameTickerMessage.style.color = '#94a3b8';
}
}, 1500);
}
});
Network.onTimerTick((seconds) => {
if (gameTimer) gameTimer.innerText = `Time Left: ${seconds}s`;
});
Network.onGameOver((loserName) => {
explosionActive = true;
manageBombSound(false);
gameScreen.classList.remove('bomb-danger');
let targetX = 400;
let targetY = 300;
if (currentPositions[loserName]) {
targetX = currentPositions[loserName].x;
targetY = currentPositions[loserName].y;
}
if (audioCtx) {
let boomOsc = audioCtx.createOscillator();
let boomGain = audioCtx.createGain();
boomOsc.type = 'sawtooth';
boomOsc.frequency.setValueAtTime(120, audioCtx.currentTime);
boomOsc.frequency.linearRampToValueAtTime(40, audioCtx.currentTime + 0.5);
boomGain.gain.setValueAtTime(0.3, audioCtx.currentTime);
boomGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
boomOsc.connect(boomGain);
boomGain.connect(audioCtx.destination);
boomOsc.start();
boomOsc.stop(audioCtx.currentTime + 0.6);
}
for (let i = 0; i < 60; i++) {
let angle = Math.random() * Math.PI * 2;
let speed = 2 + Math.random() * 6;
explosionParticles.push({
x: targetX,
y: targetY,
vx: Math.cos(angle) * speed,
vy: Math.sin(angle) * speed,
radius: 3 + Math.random() * 5,
color: Math.random() > 0.4 ? '#ef4444' : '#f97316',
alpha: 1
});
}
setTimeout(() => {
alert(`💥 BOOM! Game Over!\n${loserName} exploded!`);
gameScreen.classList.add('hidden');
document.body.style.overflow = 'auto';
lobbyScreen.classList.remove('hidden');
explosionActive = false;
explosionParticles = [];
emitSkinUpdate();
}, 1500);
});
function renderLoop() {
if (gameScreen.classList.contains('hidden')) return;
pulseTime += 0.1;
if (ctx) {
ctx.clearRect(0, 0, 800, 600);
ctx.strokeStyle = 'rgba(79, 70, 229, 0.08)';
ctx.lineWidth = 1;
for (let x = 0; x < 800; x += 40) {
ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 600); ctx.stroke();
}
for (let y = 0; y < 600; y += 40) {
ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(800, y); ctx.stroke();
}
let myCamX = 400;
let myCamY = 300;
let internalIsIt = false;
if (currentPositions[myUsername]) {
myCamX = currentPositions[myUsername].x;
myCamY = currentPositions[myUsername].y;
internalIsIt = currentPositions[myUsername].isIt;
}
ctx.save();
ctx.translate(400 - myCamX, 300 - myCamY);
for (let obs of gameObstacles) {
ctx.fillStyle = obstacleMode === 'trap' ? '#374151' : '#1f2937';
ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
ctx.strokeStyle = obstacleMode === 'trap' ? '#b91c1c' : '#4f46e5';
ctx.lineWidth = 2;
ctx.strokeRect(obs.x, obs.y, obs.w, obs.h);
if (obstacleMode === 'trap') {
ctx.fillStyle = 'rgba(185, 28, 28, 0.05)';
ctx.beginPath();
ctx.arc(obs.x + obs.w/2, obs.y + obs.h/2, 45, 0, Math.PI * 2);
ctx.fill();
}
}
ctx.strokeStyle = '#ef4444';
ctx.lineWidth = 8;
ctx.strokeRect(0, 0, 800, 600);
for (let name in currentPositions) {
let player = currentPositions[name];
if (player.isIt && !explosionActive) {
let waveRadius = 14 + Math.abs(Math.sin(pulseTime)) * 14;
ctx.beginPath();
ctx.arc(player.x, player.y, waveRadius, 0, Math.PI * 2);
ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
ctx.fill();
}
ctx.beginPath();
ctx.arc(player.x, player.y, 14, 0, Math.PI * 2);
ctx.fillStyle = player.isIt ? '#ef4444' : (player.shirt || '#3b82f6');
ctx.fill();
ctx.strokeStyle = '#ffffff';
ctx.lineWidth = 2;
ctx.stroke();
ctx.fillStyle = '#ffffff';
ctx.font = '14px Arial';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText(player.face || '🙂', player.x, player.y);
if (player.hat) {
ctx.font = '16px Arial';
ctx.fillText(player.hat, player.x, player.y - 18);
}
ctx.fillStyle = '#ffffff';
ctx.font = 'bold 11px Arial';
ctx.textBaseline = 'alphabetic';
ctx.fillText(player.isIt ? `💣 ${name}` : name, player.x, player.y - 28);
}
if (explosionActive) {
for (let p of explosionParticles) {
p.x += p.vx;
p.y += p.vy;
p.alpha -= 0.015;
if (p.alpha < 0) p.alpha = 0;
ctx.save();
ctx.globalAlpha = p.alpha;
ctx.beginPath();
ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
ctx.fillStyle = p.color;
ctx.fill();
ctx.restore();
}
}
ctx.restore();
if (internalIsIt && !explosionActive) {
let pulseAlpha = 0.15 + Math.sin(pulseTime * 2) * 0.1;
ctx.fillStyle = `rgba(239, 68, 68, ${pulseAlpha})`;
ctx.fillRect(0, 0, 800, 600);
}
}
requestAnimationFrame(renderLoop);
}
function updatePlayerLobbyUI(players) {
playerList.innerHTML = '';
players.forEach((player, index) => {
const item = document.createElement('p');
item.innerText = index === 0 ? `👑 ${player} (Host)` : `🎮 ${player}`;
playerList.appendChild(item);
});
}