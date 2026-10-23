const menuScreen = document.getElementById('menu-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const leaderboardScreen = document.getElementById('leaderboard-screen');
const podiumRowsContainer = document.getElementById('podium-rows-container');
const btnReturnLobby = document.getElementById('btn-return-lobby');

const bombCanvas = document.getElementById('bomb-canvas');
const ctx = bombCanvas ? bombCanvas.getContext('2d') : null;

const btnHost = document.getElementById('btn-host');
const btnJoin = document.getElementById('btn-join');
const btnStart = document.getElementById('btn-start');
const btnDashAbility = document.getElementById('btn-dash-ability');

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
const shirts = [{ name: 'Blue', hex: '#3b82f6' }, { name: 'Pink', hex: '#ec4899' }, { name: 'Green', hex: '#10b981' }, { name: 'Orange', hex: '#f97316' }, { name: 'Purple', hex: '#8b5cf6' }];

let currentFaceIdx = 0, currentHatIdx = 0, currentShirtIdx = 0;
let myUsername = "", currentPositions = {}, gameObstacles = [], currentPowerups = [], currentDecoys = [];
let keysPressed = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };
let joystickActive = false, joystickStartPos = { x: 0, y: 0 }, currentVector = { x: 0, y: 0 };
let pulseTime = 0, explosionParticles = [], playerTrails = {}, explosionActive = false, obstacleMode = "normal";
let audioCtx = null, soundInterval = null, localIsIt = false, isHostUser = false, suddenDeathUIMode = false;

function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playPressureTick() {
    if (!audioCtx || !localIsIt || explosionActive) return;
    let osc = audioCtx.createOscillator(), gainNode = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(440 + (Math.sin(pulseTime) * 120), audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(suddenDeathUIMode ? 1200 : 880, audioCtx.currentTime + 0.15);
    gainNode.gain.setValueAtTime(0.06, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.18);
    osc.connect(gainNode); gainNode.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + 0.18);
}

function manageBombSound(isHoldingBomb) {
    if (isHoldingBomb) {
        if (!soundInterval) soundInterval = setInterval(playPressureTick, suddenDeathUIMode ? 130 : 250);
    } else {
        if (soundInterval) { clearInterval(soundInterval); soundInterval = null; }
    }
}

function resizeGameView() {
    if (!bombCanvas) return;
    const scale = Math.min(window.innerWidth / 800, window.innerHeight / 600, 0.95);
    bombCanvas.style.width = (800 * scale) + "px"; bombCanvas.style.height = (600 * scale) + "px";
}
window.addEventListener('resize', resizeGameView);

function emitSkinUpdate() {
    const cosmetics = { face: faces[currentFaceIdx], hat: hats[currentHatIdx], shirt: shirts[currentShirtIdx].hex };
    labelFace.innerText = faces[currentFaceIdx]; labelHat.innerText = hats[currentHatIdx] === '' ? '❌' : hats[currentHatIdx]; labelShirt.innerText = shirts[currentShirtIdx].name;
    Network.updateCosmetics(cosmetics);
}

document.getElementById('btn-next-face').addEventListener('click', () => { initAudio(); currentFaceIdx = (currentFaceIdx + 1) % faces.length; emitSkinUpdate(); });
document.getElementById('btn-prev-face').addEventListener('click', () => { initAudio(); currentFaceIdx = (currentFaceIdx - 1 + faces.length) % faces.length; emitSkinUpdate(); });
document.getElementById('btn-next-hat').addEventListener('click', () => { initAudio(); currentHatIdx = (currentHatIdx + 1) % hats.length; emitSkinUpdate(); });
document.getElementById('btn-prev-hat').addEventListener('click', () => { initAudio(); currentHatIdx = (currentHatIdx - 1 + hats.length) % hats.length; emitSkinUpdate(); });
document.getElementById('btn-next-shirt').addEventListener('click', () => { initAudio(); currentShirtIdx = (currentShirtIdx + 1) % shirts.length; emitSkinUpdate(); });
document.getElementById('btn-prev-shirt').addEventListener('click', () => { initAudio(); currentShirtIdx = (currentShirtIdx - 1 + shirts.length) % shirts.length; emitSkinUpdate(); });

document.querySelectorAll('.btn-emote-trigger').forEach(btn => {
    btn.addEventListener('click', () => {
        initAudio();
        Network.sendEmote(btn.innerText);
    });
});

btnDashAbility.addEventListener('click', () => {
    initAudio();
    Network.sendDash();
});

btnHost.addEventListener('click', () => { initAudio(); const name = inputUsername.value.trim(); if (name !== '') { myUsername = name; isHostUser = true; Network.hostRoom(name); } });
btnJoin.addEventListener('click', () => { initAudio(); const name = inputUsername.value.trim(), code = inputRoom.value.trim(); if (code.length === 4 && name !== '') { myUsername = name; isHostUser = false; Network.joinRoom(code, name); } });
btnStart.addEventListener('click', () => { initAudio(); const config = { duration: parseInt(selectTimer.value), maxPlayers: parseInt(selectMaxPlayers.value), difficulty: selectDifficulty.value }; Network.startGame(config); });

btnReturnLobby.addEventListener('click', () => {
    leaderboardScreen.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');
    document.body.style.overflow = 'auto';
});

window.addEventListener('keydown', (e) => {
    if (e.key in keysPressed) { keysPressed[e.key] = true; updateKeyboardInput(); }
    if (e.key === ' ' || e.key === 'f') { Network.sendDash(); }
});
window.addEventListener('keyup', (e) => { if (e.key in keysPressed) { keysPressed[e.key] = false; updateKeyboardInput(); } });

function updateKeyboardInput() {
    if (joystickActive) return;
    let vx = 0, vy = 0;
    if (keysPressed.ArrowUp) vy -= 1; if (keysPressed.ArrowDown) vy += 1; if (keysPressed.ArrowLeft) vx -= 1; if (keysPressed.ArrowRight) vx += 1;
    Network.sendInputVector(vx, vy);
}

joystickZone?.addEventListener('touchstart', (e) => {
    initAudio(); joystickActive = true;
    const rect = joystickBase.getBoundingClientRect();
    joystickStartPos = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    handleJoystickMove(e.touches[0]);
});
joystickZone?.addEventListener('touchmove', (e) => { if (joystickActive) handleJoystickMove(e.touches[0]); });
window.addEventListener('touchend', () => { if (joystickActive) { joystickActive = false; if (joystickStick) { joystickStick.style.left = '50%'; joystickStick.style.top = '50%'; } Network.sendInputVector(0, 0); } });

function handleJoystickMove(touch) {
    if (!touch) return;
    let dx = touch.clientX - joystickStartPos.x, dy = touch.clientY - joystickStartPos.y;
    const maxRadius = 45, distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > maxRadius) { dx = (dx / distance) * maxRadius; dy = (dy / distance) * maxRadius; }
    if (joystickStick) { joystickStick.style.left = `calc(50% + ${dx}px)`; joystickStick.style.top = `calc(50% + ${dy}px)`; }
    Network.sendInputVector(dx / maxRadius, dy / maxRadius);
}

Network.onRoomCreated(({ roomId, players }) => { menuScreen.classList.add('hidden'); lobbyScreen.classList.remove('hidden'); displayRoomId.innerText = `Room ID: ${roomId}`; btnStart.classList.remove('hidden'); hostOptionsPanel.classList.remove('hidden'); waitMessage.classList.add('hidden'); updatePlayerLobbyUI(players); emitSkinUpdate(); });
Network.onRoomUpdated(({ roomId, players }) => { menuScreen.classList.add('hidden'); lobbyScreen.classList.remove('hidden'); displayRoomId.innerText = `Room ID: ${roomId}`; if (isHostUser) { btnStart.classList.remove('hidden'); hostOptionsPanel.classList.remove('hidden'); waitMessage.classList.add('hidden'); } else { btnStart.classList.add('hidden'); hostOptionsPanel.classList.add('hidden'); waitMessage.classList.remove('hidden'); } updatePlayerLobbyUI(players); emitSkinUpdate(); });
Network.onJoinError((message) => alert(message));

Network.onGameStarted(({ obstacles, difficulty }) => {
    gameObstacles = obstacles; obstacleMode = difficulty; currentPowerups = []; currentDecoys = []; explosionActive = false; explosionParticles = []; playerTrails = {}; suddenDeathUIMode = false;
    gameScreen.classList.remove('sudden-death'); btnDashAbility.disabled = false;
    document.body.style.overflow = 'hidden'; lobbyScreen.classList.add('hidden'); gameScreen.classList.remove('hidden');
    resizeGameView(); setTimeout(resizeGameView, 100); requestAnimationFrame(renderLoop);
});

Network.onPositionsUpdated((positions) => {
    if (explosionActive) return;
    currentPositions = positions;
const holdingBomb = !!currentPositions[myUsername]?.isIt && !currentPositions[myUsername]?.isGhost;
localIsIt = holdingBomb;
manageBombSound(holdingBomb);
if (holdingBomb) gameScreen.classList.add('bomb-danger'); else gameScreen.classList.remove('bomb-danger');
for (let name in currentPositions) {
let p = currentPositions[name];
if (!playerTrails[name]) playerTrails[name] = [];
playerTrails[name].push({ x: p.x, y: p.y, color: p.isIt ? '#ef4444' : (p.isGhost ? 'rgba(255,255,255,0.2)' : p.shirt), alpha: 1.0 });
if (playerTrails[name].length > 12) playerTrails[name].shift();
}
});
Network.onItemsUpdated((items) => { currentPowerups = items.powerups; currentDecoys = items.decoys; });
Network.onPowerupCollected((name) => {
    if (gameTickerMessage) { gameTickerMessage.innerText = `⚡ ${name} grabbed Speed Boost!`; }
});
Network.onDecoyCollected((name) => {
    if (gameTickerMessage) { gameTickerMessage.innerText = `📦 ${name} opened a Trick Box!`; }
});
Network.onSuddenDeath(() => {
    suddenDeathUIMode = true;
    gameObstacles = [];
    gameScreen.classList.add('sudden-death');
    if (gameTickerMessage) gameTickerMessage.innerText = '⚠️ SUDDEN DEATH! NO WALLS!';
    const wasIt = localIsIt; manageBombSound(false); manageBombSound(wasIt);
});
Network.onBombPassed(({ from, to }) => { if (gameTickerMessage) { gameTickerMessage.innerText = `💥 ${from} tagged ${to}!`; } });
Network.onTimerTick((seconds) => { if (gameTimer) gameTimer.innerText = `Time Left: ${seconds}s`; });
Network.onGameOver(({ loser, stats }) => {
    explosionActive = true; manageBombSound(false); gameScreen.classList.remove('bomb-danger');
    let targetX = currentPositions[loser] ? currentPositions[loser].x : 400, targetY = currentPositions[loser] ? currentPositions[loser].y : 300;
    if (audioCtx) {
        let bOsc = audioCtx.createOscillator(), bGain = audioCtx.createGain();
        bOsc.type = 'sawtooth'; bOsc.frequency.setValueAtTime(120, audioCtx.currentTime); bOsc.frequency.linearRampToValueAtTime(40, audioCtx.currentTime + 0.5);
        bGain.gain.setValueAtTime(0.3, audioCtx.currentTime); bGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
        bOsc.connect(bGain); bGain.connect(audioCtx.destination); bOsc.start(); bOsc.stop(audioCtx.currentTime + 0.6);
    }
    for (let i = 0; i < 60; i++) {
        let angle = Math.random() * Math.PI * 2, speed = 2 + Math.random() * 6;
        explosionParticles.push({ x: targetX, y: targetY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, radius: 3 + Math.random() * 5, color: Math.random() > 0.4 ? '#ef4444' : '#f97316', alpha: 1 });
    }
    setTimeout(() => {
        gameScreen.classList.add('hidden');
        leaderboardScreen.classList.remove('hidden');
        podiumRowsContainer.innerHTML = '';
        stats.forEach((row, idx) => {
            const item = document.createElement('div');
            item.className = 'podium-row';
            item.style.display = 'flex';
            item.style.justifyContent = 'space-between';
            let rankSymbol = idx === 0 ? '👑' : (row.isLoser ? '💥' : '🎮');
            item.innerHTML = `<span>${rankSymbol} ${row.name}</span> <small>Held bomb: ${Math.floor(row.score)}s</small>`;
            podiumRowsContainer.appendChild(item);
        });
    }, 1800);
});
socket.on('dash_cooldown_started', (cooldown) => {
    btnDashAbility.disabled = true;
    let currentCooldown = cooldown;
    btnDashAbility.innerText = currentCooldown + "s";
    let interval = setInterval(() => {
        currentCooldown--;
        if (currentCooldown <= 0) {
            clearInterval(interval);
            btnDashAbility.disabled = false;
            btnDashAbility.innerText = "DASH";
        } else {
            btnDashAbility.innerText = currentCooldown + "s";
        }
    }, 1000);
});
function renderLoop() {
    if (gameScreen.classList.contains('hidden')) return;
    pulseTime += 0.1;
    if (ctx) {
        ctx.clearRect(0, 0, 800, 600);
        ctx.strokeStyle = suddenDeathUIMode ? 'rgba(239, 68, 68, 0.15)' : 'rgba(79, 70, 229, 0.08)'; ctx.lineWidth = 1;
        for (let x = 0; x < 800; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 600); ctx.stroke(); }
        for (let y = 0; y < 600; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(800, y); ctx.stroke(); }
        let myCamX = currentPositions[myUsername] ? currentPositions[myUsername].x : 400, myCamY = currentPositions[myUsername] ? currentPositions[myUsername].y : 300, internalIsIt = currentPositions[myUsername] ? currentPositions[myUsername].isIt : false;
        ctx.save(); ctx.translate(400 - myCamX, 300 - myCamY);
        for (let name in playerTrails) {
            for (let t of playerTrails[name]) {
                t.alpha -= 0.04;
                if (t.alpha > 0) {
                    ctx.save(); ctx.globalAlpha = t.alpha; ctx.beginPath(); ctx.arc(t.x, t.y, 8, 0, Math.PI * 2); ctx.fillStyle = t.color; ctx.fill(); ctx.restore();
                }
            }
            playerTrails[name] = playerTrails[name].filter(t => t.alpha > 0);
        }
        for (let obs of gameObstacles) {
            ctx.fillStyle = obstacleMode === 'trap' ? '#374151' : '#1f2937'; ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
            ctx.strokeStyle = obstacleMode === 'trap' ? '#b91c1c' : '#4f46e5'; ctx.lineWidth = 2; ctx.strokeRect(obs.x, obs.y, obs.w, obs.h);
            if (obstacleMode === 'trap') { ctx.fillStyle = 'rgba(185, 28, 28, 0.05)'; ctx.beginPath(); ctx.arc(obs.x + obs.w/2, obs.y + obs.h/2, 45, 0, Math.PI * 2); ctx.fill(); }
        }
        for (let pu of currentPowerups) {
            ctx.beginPath(); ctx.arc(pu.x, pu.y, 10 + Math.sin(pulseTime * 2) * 2, 0, Math.PI * 2); ctx.fillStyle = 'rgba(234, 179, 8, 0.3)'; ctx.fill();
            ctx.beginPath(); ctx.arc(pu.x, pu.y, 5, 0, Math.PI * 2); ctx.fillStyle = '#eab308'; ctx.fill();
            ctx.fillStyle = '#ffffff'; ctx.font = '10px Arial'; ctx.fillText("⚡", pu.x - 4, pu.y + 4);
        }
        for (let dec of currentDecoys) {
            ctx.beginPath(); ctx.arc(dec.x, dec.y, 10 + Math.cos(pulseTime * 2) * 2, 0, Math.PI * 2); ctx.fillStyle = 'rgba(168, 85, 247, 0.3)'; ctx.fill();
            ctx.beginPath(); ctx.arc(dec.x, dec.y, 5, 0, Math.PI * 2); ctx.fillStyle = '#a855f7'; ctx.fill();
            ctx.fillStyle = '#ffffff'; ctx.font = '10px Arial'; ctx.fillText("📦", dec.x - 4, dec.y + 4);
        }
        ctx.strokeStyle = suddenDeathUIMode ? '#b91c1c' : '#ef4444'; ctx.lineWidth = 8; ctx.strokeRect(0, 0, 800, 600);
        for (let name in currentPositions) {
            let player = currentPositions[name];
            let drawItState = player.isIt || (player.isFakeIt && Date.now() < player.fakeItExpiry);
            if (player.isGhost) {
                ctx.save(); ctx.globalAlpha = 0.45;
            }
            if (drawItState && !player.isGhost && !explosionActive) {
                ctx.beginPath(); ctx.arc(player.x, player.y, 14 + Math.abs(Math.sin(pulseTime)) * 14, 0, Math.PI * 2); ctx.fillStyle = player.isFakeIt ? 'rgba(168, 85, 247, 0.2)' : 'rgba(239, 68, 68, 0.25)'; ctx.fill();
            }
            ctx.beginPath(); ctx.arc(player.x, player.y, 14, 0, Math.PI * 2);
            ctx.fillStyle = player.isGhost ? '#6b7280' : (drawItState ? (player.isFakeIt ? '#a855f7' : '#ef4444') : (player.shirt || '#3b82f6'));
            ctx.fill();
            ctx.strokeStyle = player.isGhost ? 'rgba(255,255,255,0.4)' : '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
            ctx.fillStyle = '#ffffff'; ctx.font = '14px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(player.isGhost ? '👻' : (player.face || '🙂'), player.x, player.y);
            if (player.hat && !player.isGhost) { ctx.font = '16px Arial'; ctx.fillText(player.hat, player.x, player.y - 18); }
            if (player.activeEmote && Date.now() < player.emoteExpiry) {
                ctx.font = '18px Arial'; ctx.fillText(player.activeEmote, player.x, player.y - 38);
            }
            ctx.fillStyle = '#ffffff'; ctx.font = 'bold 11px Arial'; ctx.textBaseline = 'alphabetic';
            ctx.fillText(player.isGhost ? `[GHOST] ${name}` : (player.isIt ? `💣 ${name}` : name), player.x, player.y - 26);
            if (player.isGhost) ctx.restore();
        }
        if (explosionActive) {
            for (let p of explosionParticles) {
                p.x += p.vx; p.y += p.vy; p.alpha -= 0.015; if (p.alpha < 0) p.alpha = 0;
                ctx.save(); ctx.globalAlpha = p.alpha; ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fillStyle = p.color; ctx.fill(); ctx.restore();
            }
        }
        ctx.restore();
        if (internalIsIt && !explosionActive && !currentPositions[myUsername]?.isGhost) { ctx.fillStyle = `rgba(239, 68, 68, ${0.15 + Math.sin(pulseTime * 2) * 0.1})`; ctx.fillRect(0, 0, 800, 600); }
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