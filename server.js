const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const activeRooms = new Set();
const roomDetails = {}; 

const MAP_WIDTH = 800;
const MAP_HEIGHT = 600;
const OBSTACLE_SIZE = 40;

function generateRoomId() {
    const chars = '0123456789';
    let result = '';
    for (let i = 0; i < 4; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function generateRandomObstacles() {
    const obstacles = [];
    const count = 14;
    for (let i = 0; i < count; i++) {
        let obsX = Math.floor(Math.random() * ((MAP_WIDTH - 120) / 40)) * 40 + 40;
        let obsY = Math.floor(Math.random() * ((MAP_HEIGHT - 120) / 40)) * 40 + 40;
        
        if (obsX >= 60 && obsX <= 250 && obsY >= 240 && obsY <= 360) continue;
        if (!obstacles.some(o => o.x === obsX && o.y === obsY)) {
            obstacles.push({ x: obsX, y: obsY, w: OBSTACLE_SIZE, h: OBSTACLE_SIZE });
        }
    }
    return obstacles;
}

function checkCollisionWithObstacles(x, y, radius, obstacles) {
    for (let obs of obstacles) {
        let closestX = Math.max(obs.x, Math.min(x, obs.x + obs.w));
        let closestY = Math.max(obs.y, Math.min(y, obs.y + obs.h));
        let dx = x - closestX;
        let dy = y - closestY;
        if ((dx * dx + dy * dy) < (radius * radius)) return { hit: true };
    }
    return { hit: false };
}

function checkProximityToTrap(x, y, obstacles) {
    for (let obs of obstacles) {
        let dx = x - (obs.x + obs.w / 2);
        let dy = y - (obs.y + obs.h / 2);
        if (Math.sqrt(dx * dx + dy * dy) < 45) return true;
    }
    return false;
}

io.on('connection', (socket) => {
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
                    x: 100, y: 300, vx: 0, vy: 0, isIt: true, 
                    face: '🙂', hat: '', shirt: '#3b82f6', 
                    speedBoostExpiry: 0, dashExpiry: 0, isGhost: false,
                    isFakeIt: false, fakeItExpiry: 0, activeEmote: '', emoteExpiry: 0,
                    bombHoldDuration: 0
                } 
            },
            obstacles: [],
            powerups: [],
            decoys: [],
            maxSlots: 6,
            timerDuration: 30,
            hazardMode: 'normal',
            gameStarted: false,
            loopInterval: null,
            itemInterval: null,
            lastTagTime: 0,
            suddenDeathActive: false
        };
        
        socket.join(roomId);
        socket.username = cleanName;
        socket.currentRoom = roomId;
        socket.emit('room_created', { roomId, players: roomDetails[roomId].players });
    });

    socket.on('join_room', ({ roomId, username }) => {
        const uppercaseId = roomId.trim();
        const cleanName = username.trim();

        if (!activeRooms.has(uppercaseId)) return;
        const room = roomDetails[uppercaseId];
        if (room.gameStarted || room.players.length >= room.maxSlots || room.players.some(p => p.toLowerCase() === cleanName.toLowerCase())) return;

        room.players.push(cleanName);
        room.positions[cleanName] = { 
            x: 100, y: 100 + (room.players.length * 80), vx: 0, vy: 0, isIt: false, 
            face: '🙂', hat: '', shirt: '#3b82f6', speedBoostExpiry: 0, dashExpiry: 0, isGhost: false,
            isFakeIt: false, fakeItExpiry: 0, activeEmote: '', emoteExpiry: 0,
            bombHoldDuration: 0
        };
        
        socket.join(uppercaseId);
        socket.username = cleanName;
        socket.currentRoom = uppercaseId;
        io.to(uppercaseId).emit('room_updated', { roomId: uppercaseId, players: room.players });
    });

    socket.on('update_player_cosmetics', (cosmetics) => {
        const roomId = socket.currentRoom;
        if (roomId && roomDetails[roomId]) {
            const playerPos = roomDetails[roomId].positions[socket.username];
            if (playerPos) {
                playerPos.face = cosmetics.face;
                playerPos.hat = cosmetics.hat;
                playerPos.shirt = cosmetics.shirt;
            }
        }
    });

    socket.on('trigger_emote', (emote) => {
        const roomId = socket.currentRoom;
        if (roomId && roomDetails[roomId]) {
            const pos = roomDetails[roomId].positions[socket.username];
            if (pos && !pos.isGhost) {
                pos.activeEmote = emote;
                pos.emoteExpiry = Date.now() + 2000;
            }
        }
    });

    socket.on('trigger_dash', () => {
        const roomId = socket.currentRoom;
        if (roomId && roomDetails[roomId]) {
            const room = roomDetails[roomId];
            const pos = room.positions[socket.username];
            if (room.gameStarted && pos && !pos.isGhost && Date.now() > pos.dashExpiry) {
                pos.speedBoostExpiry = Date.now() + 1000;
                pos.dashExpiry = Date.now() + 4000;
                socket.emit('dash_cooldown_started', 4);
            }
        }
    });

    socket.on('start_game_signal', (config) => {
        const roomId = socket.currentRoom;
        if (roomId && roomDetails[roomId]) {
            const room = roomDetails[roomId];
            room.maxSlots = config.maxPlayers;
            room.timerDuration = config.duration;
            room.hazardMode = config.difficulty;
            room.obstacles = generateRandomObstacles();
            room.powerups = [];
            room.decoys = [];
            room.gameStarted = true;
            room.suddenDeathActive = false;
            
            for (let p in room.positions) {
                room.positions[p].isGhost = false;
                room.positions[p].isFakeIt = false;
                room.positions[p].bombHoldDuration = 0;
            }
            
            io.to(roomId).emit('game_started', { obstacles: room.obstacles, difficulty: room.hazardMode });
            
            let timeLeft = room.timerDuration;
            io.to(roomId).emit('timer_tick', timeLeft);

            room.itemInterval = setInterval(() => {
                if (room.powerups.length < 2) {
                    let px = Math.floor(Math.random() * (MAP_WIDTH - 60)) + 30;
                    let py = Math.floor(Math.random() * (MAP_HEIGHT - 60)) + 30;
                    if (!checkCollisionWithObstacles(px, py, 15, room.obstacles).hit) {
                        room.powerups.push({ x: px, y: py });
                    }
                }
                if (room.decoys.length < 2) {
                    let dx = Math.floor(Math.random() * (MAP_WIDTH - 60)) + 30;
                    let dy = Math.floor(Math.random() * (MAP_HEIGHT - 60)) + 30;
                    if (!checkCollisionWithObstacles(dx, dy, 15, room.obstacles).hit) {
                        room.decoys.push({ x: dx, y: dy });
                    }
                }
                io.to(roomId).emit('items_updated', { powerups: room.powerups, decoys: room.decoys });
            }, 5000);
            
            room.loopInterval = setInterval(() => {
                timeLeft--;
                io.to(roomId).emit('timer_tick', timeLeft);

                if (timeLeft === 10 && !room.suddenDeathActive) {
                    room.suddenDeathActive = true;
                    room.obstacles = [];
                    io.to(roomId).emit('sudden_death_triggered');
                }

                if (timeLeft <= 0) {
                    clearInterval(room.loopInterval);
                    clearInterval(room.itemInterval);
                    let loser = Object.keys(room.positions).find(p => room.positions[p].isIt && !room.positions[p].isGhost) || "";
                    
                    const trackerData = [];
                    for (let p in room.positions) {
                        trackerData.push({ name: p, score: room.positions[p].bombHoldDuration, isLoser: p === loser });
                    }
                    trackerData.sort((a, b) => a.score - b.score);

                    io.to(roomId).emit('game_over', { loser, stats: trackerData });
                    room.gameStarted = false;
                }
            }, 1000);
        }
    });

    socket.on('input_vector', ({ vx, vy }) => {
        const roomId = socket.currentRoom;
        if (roomId && roomDetails[roomId]) {
            const room = roomDetails[roomId];
            const pos = room.positions[socket.username];
            if (room.gameStarted && pos) {
                let currentMaxSpeed = pos.isIt ? 5.5 : 4.5;
                if (pos.isGhost) currentMaxSpeed = 3.0; 
                else {
                    if (Date.now() < pos.speedBoostExpiry) currentMaxSpeed *= 1.6;
                    if (room.hazardMode === 'trap' && checkProximityToTrap(pos.x, pos.y, room.obstacles)) currentMaxSpeed *= 0.45;
                }

                const mag = Math.sqrt(vx * vx + vy * vy);
                if (mag > 0) {
                    pos.vx = (vx / mag) * currentMaxSpeed;
                    pos.vy = (vy / mag) * currentMaxSpeed;
                } else {
                    pos.vx = 0;
                    pos.vy = 0;
                }
            }
        }
    });

    socket.on('disconnect', () => {
        const roomId = socket.currentRoom;
        if (roomId && roomDetails[roomId]) {
            const room = roomDetails[roomId];
            room.players = room.players.filter(p => p !== socket.username);
            delete room.positions[socket.username];
if (room.players.length === 0) {
clearInterval(room.loopInterval);
clearInterval(room.itemInterval);
activeRooms.delete(roomId);
delete roomDetails[roomId];
} else {
if (Object.keys(room.positions).length > 0 && !Object.keys(room.positions).some(p => room.positions[p].isIt)) {
let nextActive = Object.keys(room.positions)[0];
if (room.positions[nextActive]) room.positions[nextActive].isIt = true;
}
io.to(roomId).emit('room_updated', { roomId, players: room.players });
}
}
});
});
setInterval(() => {
for (let roomId in roomDetails) {
const room = roomDetails[roomId];
if (!room.gameStarted) continue;
for (let p in room.positions) {
const pos = room.positions[p];
let oldX = pos.x; pos.x += pos.vx;
if (!pos.isGhost && checkCollisionWithObstacles(pos.x, pos.y, 14, room.obstacles).hit) {
pos.x = oldX; pos.vx = 0;
}
let oldY = pos.y; pos.y += pos.vy;
if (!pos.isGhost && checkCollisionWithObstacles(pos.x, pos.y, 14, room.obstacles).hit) {
pos.y = oldY; pos.vy = 0;
}
for (let otherName in room.positions) {
if (otherName !== p) {
const otherPos = room.positions[otherName];
if (otherPos.isGhost && !pos.isGhost) {
let dx = pos.x - otherPos.x;
let dy = pos.y - otherPos.y;
if (Math.sqrt(dx * dx + dy * dy) < 26) {
pos.x = oldX; pos.y = oldY;
pos.vx *= 0.5; pos.vy *= 0.5;
}
}
}
}
if (pos.x < 15) pos.x = 15; if (pos.x > MAP_WIDTH - 15) pos.x = MAP_WIDTH - 15;
if (pos.y < 15) pos.y = 15; if (pos.y > MAP_HEIGHT - 15) pos.y = MAP_HEIGHT - 15;
if (pos.isIt && !pos.isGhost) {
pos.bombHoldDuration += 1 / 60;
}
if (!pos.isGhost) {
for (let i = room.powerups.length - 1; i >= 0; i--) {
let pu = room.powerups[i];
let dx = pos.x - pu.x; let dy = pos.y - pu.y;
if (Math.sqrt(dx * dx + dy * dy) < 24) {
room.powerups.splice(i, 1);
pos.speedBoostExpiry = Date.now() + 4000;
io.to(roomId).emit('items_updated', { powerups: room.powerups, decoys: room.decoys });
io.to(roomId).emit('powerup_collected', p);
}
}
for (let i = room.decoys.length - 1; i >= 0; i--) {
let dec = room.decoys[i];
let dx = pos.x - dec.x; let dy = pos.y - dec.y;
if (Math.sqrt(dx * dx + dy * dy) < 24) {
room.decoys.splice(i, 1);
pos.isFakeIt = true;
pos.fakeItExpiry = Date.now() + 4000;
io.to(roomId).emit('items_updated', { powerups: room.powerups, decoys: room.decoys });
io.to(roomId).emit('decoy_collected', p);
}
}
}
}
const currentTime = Date.now();
if (currentTime - room.lastTagTime > 1500) {
let itPlayer = Object.keys(room.positions).find(p => room.positions[p].isIt && !room.positions[p].isGhost);
if (itPlayer) {
const itPos = room.positions[itPlayer];
for (let other in room.positions) {
if (other !== itPlayer && !room.positions[other].isGhost) {
const otherPos = room.positions[other];
let dx = otherPos.x - itPos.x; let dy = otherPos.y - itPos.y;
if (Math.sqrt(dx * dx + dy * dy) < 28) {
room.positions[itPlayer].isIt = false;
room.positions[other].isIt = true;
room.positions[itPlayer].vx = 0; room.positions[itPlayer].vy = 0;
room.positions[other].vx = 0; room.positions[other].vy = 0;
room.lastTagTime = currentTime;
io.to(roomId).emit('bomb_passed', { from: itPlayer, to: other });
break;
}
}
}
}
}
io.to(roomId).emit('positions_updated', room.positions);
}
}, 1000 / 60);
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));