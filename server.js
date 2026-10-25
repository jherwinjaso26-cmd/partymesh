const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: [
            "http://localhost:3000",
            "http://127.0.0.1:3000"
        ],
        methods: ["GET", "POST"],
        credentials: true
    }
});

app.use(express.static('public'));

const activeRooms = new Set();
const roomDetails = {}; 

const OBSTACLE_SIZE = 60;
const PLAYER_BASE_SPEED = 5.6; 
const MAP_TICK_RATE = 1000 / 60; 

function generateRoomId() {
    const chars = '0123456789';
    let result = '';
    for (let i = 0; i < 4; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function calculateDynamicMapDimensions(playerCount) {
    let width = 1400;
    let height = 1000;
    if (playerCount > 8) {
        width = 2200;
        height = 1600;
    } else if (playerCount > 4) {
        width = 1800;
        height = 1300;
    }
    return { width, height };
}

function generateTerrainObstacles(terrainType, playersPositions, mapW, mapH, difficulty) {
    if (difficulty === 'none') return [];
    
    let count = 25;
    if (difficulty === 'hard') count = 45;
    if (mapW > 1800) count = Math.floor(count * 1.8);
    else if (mapW > 1400) count = Math.floor(count * 1.4);

    const obstacles = [];
    for (let i = 0; i < count; i++) {
        let obsX = Math.floor(Math.random() * ((mapW - 240) / 60)) * 60 + 120;
        let obsY = Math.floor(Math.random() * ((mapH - 240) / 60)) * 60 + 120;
        
        let nearPlayer = false;
        for (let p in playersPositions) {
            if (Math.sqrt((obsX + 30 - playersPositions[p].x)**2 + (obsY + 30 - playersPositions[p].y)**2) < 150) { 
                nearPlayer = true;
                break;
            }
        }
        
        if (!nearPlayer && !obstacles.some(o => o.x === obsX && o.y === obsY)) {
            let obsType = 'standard';
            if (difficulty === 'hard') {
                let rand = Math.random();
                if (terrainType === 'volcano' && rand < 0.35) obsType = 'magma_vent';
                else if (terrainType === 'jungle' && rand < 0.35) obsType = 'ancient_tree';
                else if (rand < 0.2) obsType = 'spike_trap';
            }
            let moveAngle = Math.random() * Math.PI * 2;
            obstacles.push({ 
                id: 'obs_' + i + '_' + Math.floor(Math.random() * 10000),
                x: obsX, y: obsY, w: OBSTACLE_SIZE, h: OBSTACLE_SIZE, type: obsType,
                vx: Math.cos(moveAngle) * 1.5, vy: Math.sin(moveAngle) * 1.5,
                phaseState: 'visible', phaseTimer: Date.now() + Math.random() * 5000 + 3000
            });
        }
    }
    return obstacles;
}

function checkCollisionWithObstacles(x, y, radius, obstacles) {
    for (let obs of obstacles) {
        if (obs.phaseState === 'hidden') continue;
        let closestX = Math.max(obs.x, Math.min(x, obs.x + obs.w));
        let closestY = Math.max(obs.y, Math.min(y, obs.y + obs.h));
        let dx = x - closestX;
        let dy = y - closestY;
        let distSq = dx * dx + dy * dy;
        if (distSq < (radius * radius)) {
            return { collided: true, obs: obs, closestX: closestX, closestY: closestY };
        }
    }
    return { collided: false };
}

function processPhysicsFrame(roomId, room) {
    if (!room.gameStarted || room.countdownActive) return;

    const playerNames = Object.keys(room.positions);
    const alivePlayers = playerNames.filter(p => !room.positions[p].isDead);

    alivePlayers.forEach(name => {
        const p = room.positions[name];
        
        let currentSpeed = PLAYER_BASE_SPEED;
        if (p.isIt) currentSpeed *= 1.15; 
        if (Date.now() < p.speedBoostExpiry) currentSpeed *= 1.5;
        if (Date.now() < p.frozenExpiry) currentSpeed *= 0.2;

        let targetX = p.x + p.vx * currentSpeed;
        if (targetX - 20 >= 0 && targetX + 20 <= room.mapWidth) {
            let col = checkCollisionWithObstacles(targetX, p.y, 20, room.obstacles);
            if (!col.collided) {
                p.x = targetX;
            } else {
                if (p.x < col.obs.x) p.x = col.closestX - 20.05;
                else p.x = col.closestX + 20.05;
            }
        }

        let targetY = p.y + p.vy * currentSpeed;
        if (targetY - 20 >= 0 && targetY + 20 <= room.mapHeight) {
            let col = checkCollisionWithObstacles(p.x, targetY, 20, room.obstacles);
            if (!col.collided) {
                p.y = targetY;
            } else {
                if (p.y < col.obs.y) p.y = col.closestY - 20.05;
                else p.y = col.closestY + 20.05;
            }
        }

        if (p.isIt) {
            p.bombHoldDuration += (MAP_TICK_RATE / 1000);
        }
    });

    if (room.difficulty === 'hard') {
        let obstaclesChanged = false;
        room.obstacles.forEach(obs => {
            if (obs.type === 'magma_vent' || obs.type === 'standard') {
                obs.x += obs.vx;
                obs.y += obs.vy;
                
                if (obs.x <= 100 || obs.x + obs.w >= room.mapWidth - 100) { obs.vx *= -1; obs.x += obs.vx; }
                if (obs.y <= 100 || obs.y + obs.h >= room.mapHeight - 100) { obs.vy *= -1; obs.y += obs.vy; }
            }
            
            if (Date.now() > obs.phaseTimer) {
                obs.phaseState = obs.phaseState === 'visible' ? 'hidden' : 'visible';
                obs.phaseTimer = Date.now() + (obs.phaseState === 'visible' ? (Math.random() * 5000 + 4000) : (Math.random() * 3000 + 2000));
                obstaclesChanged = true;
            }
        });

        if (obstaclesChanged) {
            io.to(roomId).emit('obstacles_phased_sync', { obstacles: room.obstacles });
        }
    }

    for (let i = room.powerups.length - 1; i >= 0; i--) {
        const pu = room.powerups[i];
        for (let name of alivePlayers) {
            const p = room.positions[name];
            const dist = Math.sqrt((p.x - pu.x)**2 + (p.y - pu.y)**2);
            if (dist < 32) { 
                if (pu.type === 'speed') {
                    p.speedBoostExpiry = Date.now() + 4500;
                } else if (pu.type === 'freeze_trap') {
                    alivePlayers.forEach(other => {
                        if (other !== name && !room.positions[other].isIt) {
                            room.positions[other].frozenExpiry = Date.now() + 3000;
                        }
                    });
                } else if (pu.type === 'shield') {
                    p.hasShield = true;
                }
                
                io.to(roomId).emit('powerup_collected_global', { username: name, type: pu.type });
                room.powerups.splice(i, 1);
                io.to(roomId).emit('items_updated', { powerups: room.powerups });
                break;
            }
        }
    }

    const now = Date.now();
    for (let i = 0; i < alivePlayers.length; i++) {
        const nameA = alivePlayers[i];
        const pA = room.positions[nameA];
        if (!pA.isIt) continue;

        for (let j = 0; j < alivePlayers.length; j++) {
            const nameB = alivePlayers[j];
            if (nameA === nameB) continue;
            const pB = room.positions[nameB];

            const dist = Math.sqrt((pA.x - pB.x)**2 + (pA.y - pB.y)**2);
            if (dist < 40) { 
                const lastTagA = room.lastTagTimes[nameA] || 0;
                const lastTagB = room.lastTagTimes[nameB] || 0;

                if (now - lastTagA > 1500 && now - lastTagB > 1500) {
                    if (pB.hasShield) {
                        pB.hasShield = false;
                        pA.speedBoostExpiry = 0;
                        pA.frozenExpiry = Date.now() + 1200; 
                        room.lastTagTimes[nameA] = now;
                        room.lastTagTimes[nameB] = now;
                        io.to(roomId).emit('bomb_passed', { from: `🛡️ ${nameB}'s Shield`, to: `${nameA} (BLOCKED)` });
                    } else {
                        pA.isIt = false;
                        pB.isIt = true;
                        room.lastTagTimes[nameA] = now;
                        room.lastTagTimes[nameB] = now;
                        io.to(roomId).emit('bomb_passed', { from: nameA, to: nameB });
                    }
                    io.to(roomId).emit('positions_updated', { positions: room.positions });
                }
            }
        }
    }

    io.to(roomId).emit('positions_updated', { positions: room.positions });
}

function startMatchTimers(roomId, room) {
    room.itemInterval = setInterval(() => {
        if (!room.gameStarted || room.countdownActive) return;

        if (room.powerups.length < room.maxItemsCount) {
            let px = Math.floor(Math.random() * (room.mapWidth - 240)) + 120;
            let py = Math.floor(Math.random() * (room.mapHeight - 240)) + 120;
            if (!checkCollisionWithObstacles(px, py, 20, room.obstacles).collided) {
                let rand = Math.random();
                let itemType = rand < 0.4 ? 'speed' : (rand < 0.75 ? 'freeze_trap' : 'shield');
                room.powerups.push({ x: px, y: py, type: itemType });
            }
        }
        io.to(roomId).emit('items_updated', { powerups: room.powerups });
    }, room.spawnRateTime);

    room.loopInterval = setInterval(() => {
        if (!room.gameStarted || room.countdownActive) return;

        room.bombFuseLeft--;
        io.to(roomId).emit('timer_tick', { seconds: room.bombFuseLeft });

        if (room.bombFuseLeft <= 0) {
            let currentCarriers = Object.keys(room.positions).filter(p => room.positions[p].isIt && !room.positions[p].isDead);
            
            currentCarriers.forEach(carrier => {
                room.positions[carrier].isDead = true;
room.positions[carrier].isIt = false;
room.positions[carrier].vx = 0;
room.positions[carrier].vy = 0;
});
let blastSources = currentCarriers.map(c => ({ x: room.positions[c].x, y: room.positions[c].y }));
io.to(roomId).emit('bomb_detonated_pulse', { origins: blastSources });
let survivors = Object.keys(room.positions).filter(p => !room.positions[p].isDead);
if (survivors.length <= 1) {
endMatchSession(roomId, room);
return;
} else {
let bombCount = 1;
if (survivors.length >= 10) bombCount = 3;
else if (survivors.length >= 6) bombCount = 2;
let shuffledSurvivors = [...survivors].sort(() => 0.5 - Math.random());
let now = Date.now();
for (let i = 0; i < Math.min(bombCount, shuffledSurvivors.length); i++) {
let nextTarget = shuffledSurvivors[i];
room.positions[nextTarget].isIt = true;
room.lastTagTimes[nextTarget] = now;
io.to(roomId).emit('bomb_passed', { from: "ARENA SYSTEM", to: nextTarget });
}
room.bombFuseLeft = 10;
io.to(roomId).emit('timer_tick', { seconds: room.bombFuseLeft });
io.to(roomId).emit('positions_updated', { positions: room.positions });
}
}
}, 1000);
room.physicsInterval = setInterval(() => {
processPhysicsFrame(roomId, room);
}, MAP_TICK_RATE);
}
function runPreMatchSequence(roomId, room) {
let countdownVal = 3;
room.countdownActive = true;
let survivors = Object.keys(room.positions).filter(p => !room.positions[p].isDead);
let bombCount = 1;
if (survivors.length >= 10) bombCount = 3;
else if (survivors.length >= 6) bombCount = 2;
let shuffled = [...survivors].sort(() => 0.5 - Math.random());
let selectedHolders = [];
for (let i = 0; i < Math.min(bombCount, shuffled.length); i++) {
room.positions[shuffled[i]].isIt = true;
selectedHolders.push(shuffled[i]);
room.lastTagTimes[shuffled[i]] = Date.now();
}
io.to(roomId).emit('positions_updated', { positions: room.positions });
let countInterval = setInterval(() => {
io.to(roomId).emit('pre_match_countdown', { count: countdownVal, holders: selectedHolders });
countdownVal--;
if (countdownVal < 0) {
clearInterval(countInterval);
room.countdownActive = false;
io.to(roomId).emit('match_begin_pulse');
startMatchTimers(roomId, room);
}
}, 1000);
}
// Fixed room ID feature to follow user request constraints (numbers only summary)
function endMatchSession(roomId, room) {
if (room.loopInterval) clearInterval(room.loopInterval);
if (room.itemInterval) clearInterval(room.itemInterval);
if (room.physicsInterval) clearInterval(room.physicsInterval);
room.gameStarted = false;
const trackerData = [];
for (let p in room.positions) {
trackerData.push({ name: p, score: room.positions[p].bombHoldDuration, isLoser: room.positions[p].isDead });
}
trackerData.sort((a, b) => a.score - b.score);
io.to(roomId).emit('game_over', { stats: trackerData, losers: Object.keys(room.positions).filter(p => room.positions[p].isDead) });
}
io.on('connection', (socket) => {
socket.on('lobby_heartbeat', () => {
if (socket.currentRoom && roomDetails[socket.currentRoom]) {
const p = roomDetails[socket.currentRoom].positions[socket.username];
if (p) p.lastActivePing = Date.now();
}
});
socket.on('create_room', (username) => {
const cleanName = username.trim();
if (!cleanName) return;
let roomId = generateRoomId();
while (activeRooms.has(roomId)) roomId = generateRoomId();
activeRooms.add(roomId);
roomDetails[roomId] = {
players: [cleanName],
positions: {
[cleanName]: {
x: 200, y: 200, vx: 0, vy: 0, isIt: false,
face: '🙂', hat: 'none', shirt: '#e0a96d',
speedBoostExpiry: 0, frozenExpiry: 0, hasShield: false,
activeEmote: '', emoteExpiry: 0,
bombHoldDuration: 0, isDead: false, lastActivePing: Date.now()
}
},
obstacles: [],
powerups: [],
maxSlots: 15,
bombFuseLeft: 10,
terrain: 'cyber',
difficulty: 'medium',
gameStarted: false,
countdownActive: true,
loopInterval: null,
itemInterval: null,
physicsInterval: null,
lastTagTimes: {},
spawnRateTime: 3500,
maxItemsCount: 6,
mapWidth: 1400,
mapHeight: 1000
};
roomDetails[roomId].afkCheckInterval = setInterval(() => {
const currentRoom = roomDetails[roomId];
if (!currentRoom || currentRoom.gameStarted) return;
const now = Date.now();
currentRoom.players.forEach(playerName => {
const pos = currentRoom.positions[playerName];
if (pos && now - pos.lastActivePing > 10000) {
currentRoom.players = currentRoom.players.filter(name => name !== playerName);
delete currentRoom.positions[playerName];
io.to(roomId).emit('room_updated', { roomId, players: currentRoom.players });
io.to(roomId).emit('positions_updated', { positions: currentRoom.positions });
}
});
}, 4000);
socket.join(roomId);
socket.username = cleanName;
socket.currentRoom = roomId;
socket.emit('room_created', { roomId, players: roomDetails[roomId].players });
io.to(roomId).emit('positions_updated', { positions: roomDetails[roomId].positions });
});
socket.on('join_room', ({ roomId, username }) => {
const uppercaseId = roomId.trim();
const cleanName = username.trim();
if (!activeRooms.has(uppercaseId)) return;
const room = roomDetails[uppercaseId];
if (room.players.some(p => p.toLowerCase() === cleanName.toLowerCase())) {
socket.emit('join_denied', { message: "Username already taken in this room!" });
return;
}
if (room.gameStarted || room.players.length >= room.maxSlots) return;
room.players.push(cleanName);
let spawnOffset = room.players.length * 45;
room.positions[cleanName] = {
x: 200 + (spawnOffset % 300), y: 200 + (Math.floor(spawnOffset / 300) * 50),
vx: 0, vy: 0, isIt: false,
face: '🙂', hat: 'none', shirt: '#e0a96d', speedBoostExpiry: 0, frozenExpiry: 0, hasShield: false,
activeEmote: '', emoteExpiry: 0, bombHoldDuration: 0, isDead: false, lastActivePing: Date.now()
};
socket.join(uppercaseId);
socket.username = cleanName;
socket.currentRoom = uppercaseId;
io.to(uppercaseId).emit('room_updated', { roomId: uppercaseId, players: room.players });
io.to(uppercaseId).emit('positions_updated', { positions: room.positions });
});
socket.on('update_player_cosmetics', (cosmetics) => {
const roomId = socket.currentRoom;
if (roomId && roomDetails[roomId]) {
const playerPos = roomDetails[roomId].positions[socket.username];
if (playerPos) {
playerPos.face = cosmetics.face;
playerPos.hat = cosmetics.hat;
playerPos.shirt = cosmetics.shirt;
io.to(roomId).emit('positions_updated', { positions: roomDetails[roomId].positions });
}
}
});
socket.on('trigger_emote', (emote) => {
const roomId = socket.currentRoom;
if (roomId && roomDetails[roomId]) {
const pos = roomDetails[roomId].positions[socket.username];
if (pos && !pos.isDead) {
pos.activeEmote = emote;
pos.emoteExpiry = Date.now() + 2000;
io.to(roomId).emit('emote_triggered_global', { username: socket.username, emote: emote });
}
}
});
socket.on('input_vector', ({ vx, vy }) => {
const roomId = socket.currentRoom;
if (roomId && roomDetails[roomId]) {
const pos = roomDetails[roomId].positions[socket.username];
if (pos && !pos.isDead) {
pos.vx = vx;
pos.vy = vy;
}
}
});
socket.on('start_game_signal', (config) => {
const roomId = socket.currentRoom;
if (roomId && roomDetails[roomId]) {
const room = roomDetails[roomId];
if (room.afkCheckInterval) clearInterval(room.afkCheckInterval);
const playerNames = Object.keys(room.positions);
const dimensions = calculateDynamicMapDimensions(playerNames.length);
room.mapWidth = dimensions.width;
room.mapHeight = dimensions.height;
room.terrain = config.terrain || 'cyber';
room.difficulty = config.difficulty || 'medium';
room.bombFuseLeft = 10;
room.gameStarted = true;
room.powerups = [];
playerNames.forEach((p, idx) => {
let validSpawnFound = false;
let finalSpawnX = 150;
let finalSpawnY = 150;
let generationRetries = 0;
while (!validSpawnFound && generationRetries < 100) {
generationRetries++;
let potentialX = Math.floor(Math.random() * (room.mapWidth - 300)) + 150;
let potentialY = Math.floor(Math.random() * (room.mapHeight - 300)) + 150;
let clusterFault = false;
for (let otherPlayer of playerNames) {
if (otherPlayer === p) continue;
let otherPos = room.positions[otherPlayer];
if (otherPos && otherPos.x !== 200 && Math.sqrt((potentialX - otherPos.x)**2 + (potentialY - otherPos.y)**2) < 220) {
clusterFault = true;
break;
}
}
if (!clusterFault) {
finalSpawnX = potentialX;
finalSpawnY = potentialY;
validSpawnFound = true;
}
}
room.positions[p].x = finalSpawnX;
room.positions[p].y = finalSpawnY;
room.positions[p].vx = 0;
room.positions[p].vy = 0;
room.positions[p].isIt = false;
room.positions[p].isDead = false;
room.positions[p].bombHoldDuration = 0;
room.positions[p].hasShield = false;
room.positions[p].speedBoostExpiry = 0;
room.positions[p].frozenExpiry = 0;
});
room.obstacles = generateTerrainObstacles(room.terrain, room.positions, room.mapWidth, room.mapHeight, room.difficulty);
io.to(roomId).emit('game_started', {
obstacles: room.obstacles,
terrain: room.terrain,
mapWidth: room.mapWidth,
mapHeight: room.mapHeight
});
runPreMatchSequence(roomId, room);
}
});
socket.on('disconnect', () => {
const roomId = socket.currentRoom;
if (roomId && roomDetails[roomId]) {
const room = roomDetails[roomId];
room.players = room.players.filter(p => p !== socket.username);
delete room.positions[socket.username];
if (room.players.length === 0) {
if (room.afkCheckInterval) clearInterval(room.afkCheckInterval);
clearInterval(room.loopInterval);
clearInterval(room.itemInterval);
clearInterval(room.physicsInterval);
activeRooms.delete(roomId);
delete roomDetails[roomId];
} else {
io.to(roomId).emit('room_updated', { roomId, players: room.players });
io.to(roomId).emit('positions_updated', { positions: room.positions });
let carriers = Object.keys(room.positions).filter(p => room.positions[p].isIt && !room.positions[p].isDead);
if (carriers.length === 0 && room.gameStarted && !room.countdownActive) {
let survivors = Object.keys(room.positions).filter(p => !room.positions[p].isDead);
if (survivors.length > 0) {
let nextTarget = survivors[Math.floor(Math.random() * survivors.length)];
room.positions[nextTarget].isIt = true;
room.lastTagTimes[nextTarget] = Date.now();
io.to(roomId).emit('bomb_passed', { from: "ARENA SYSTEM", to: nextTarget });
}
}
}
}
});
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Arena engine listening on port ${PORT}`);
});