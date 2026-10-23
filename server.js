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
        
        if (obsX >= 60 && obsX <= 250 && obsY >= 240 && obsY <= 360) {
            continue;
        }
        
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
        
        let distanceX = x - closestX;
        let distanceY = y - closestY;
        let distanceSquared = (distanceX * distanceX) + (distanceY * distanceY);
        
        if (distanceSquared < (radius * radius)) {
            return { hit: true };
        }
    }
    return { hit: false };
}

function checkProximityToTrap(x, y, obstacles) {
    for (let obs of obstacles) {
        let centerX = obs.x + obs.w / 2;
        let centerY = obs.y + obs.h / 2;
        let dx = x - centerX;
        let dy = y - centerY;
        let dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < 45) {
            return true;
        }
    }
    return false;
}

io.on('connection', (socket) => {
    socket.on('create_room', (username) => {
        const cleanName = username.trim();
        if (!cleanName) {
            socket.emit('join_error', 'Username cannot be empty');
            return;
        }

        let roomId = generateRoomId();
        while (activeRooms.has(roomId)) {
            roomId = generateRoomId();
        }
        
        activeRooms.add(roomId);
        roomDetails[roomId] = {
            players: [cleanName],
            positions: { 
                [cleanName]: { 
                    x: 100, y: 300, vx: 0, vy: 0, isIt: true,
                    face: '🙂', hat: '', shirt: '#3b82f6' 
                } 
            },
            obstacles: [],
            maxSlots: 6,
            timerDuration: 30,
            hazardMode: 'normal',
            gameStarted: false,
            loopInterval: null,
            lastTagTime: 0
        };
        
        socket.join(roomId);
        socket.username = cleanName;
        socket.currentRoom = roomId;
        
        socket.emit('room_created', { roomId, players: roomDetails[roomId].players });
    });

    socket.on('join_room', ({ roomId, username }) => {
        const uppercaseId = roomId.trim();
        const cleanName = username.trim();

        if (!cleanName) {
            socket.emit('join_error', 'Username cannot be empty');
            return;
        }

        if (!activeRooms.has(uppercaseId)) {
            socket.emit('join_error', 'Invalid Room ID');
            return;
        }

        const room = roomDetails[uppercaseId];
        
        if (room.gameStarted) {
            socket.emit('join_error', 'Game has already started in this room');
            return;
        }

        if (room.players.length >= room.maxSlots) {
            socket.emit('join_error', 'Lobby room is completely full!');
            return;
        }

        const isDuplicate = room.players.some(p => p.toLowerCase() === cleanName.toLowerCase());
        if (isDuplicate) {
            socket.emit('join_error', 'Name already taken in this room');
            return;
        }

        room.players.push(cleanName);
        room.positions[cleanName] = { 
            x: 100, 
            y: 100 + (room.players.length * 80), 
            vx: 0, 
            vy: 0, 
            isIt: false,
            face: '🙂', hat: '', shirt: '#3b82f6'
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

    socket.on('start_game_signal', (config) => {
        const roomId = socket.currentRoom;
        if (roomId && roomDetails[roomId]) {
            const room = roomDetails[roomId];
            
            if (room.players.length > config.maxPlayers) {
                socket.emit('join_error', 'Cannot set player cap lower than current lobby count!');
                return;
            }

            room.maxSlots = config.maxPlayers;
            room.timerDuration = config.duration;
            room.hazardMode = config.difficulty;
            
            room.obstacles = generateRandomObstacles();
            room.gameStarted = true;
            
            io.to(roomId).emit('game_started', { 
                obstacles: room.obstacles, 
                difficulty: room.hazardMode 
            });
            
            let timeLeft = room.timerDuration;
            io.to(roomId).emit('timer_tick', timeLeft);
            
            room.loopInterval = setInterval(() => {
                timeLeft--;
                io.to(roomId).emit('timer_tick', timeLeft);
                if (timeLeft <= 0) {
                    clearInterval(room.loopInterval);
                    let loser = "";
                    for (let p in room.positions) {
                        if (room.positions[p].isIt) loser = p;
                    }
                    io.to(roomId).emit('game_over', loser);
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
                
                if (room.hazardMode === 'trap' && checkProximityToTrap(pos.x, pos.y, room.obstacles)) {
                    currentMaxSpeed *= 0.45; 
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
                if (room.loopInterval) clearInterval(room.loopInterval);
                activeRooms.delete(roomId);
                delete roomDetails[roomId];
            } else {
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
            
            let oldX = pos.x;
            pos.x += pos.vx;
            let collideX = checkCollisionWithObstacles(pos.x, pos.y, 14, room.obstacles);
            if (collideX.hit) {
                pos.x = oldX;
                pos.vx = 0;
            }

            let oldY = pos.y;
            pos.y += pos.vy;
            let collideY = checkCollisionWithObstacles(pos.x, pos.y, 14, room.obstacles);
            if (collideY.hit) {
                pos.y = oldY;
                pos.vy = 0;
            }

            if (pos.x < 15) pos.x = 15;
            if (pos.x > MAP_WIDTH - 15) pos.x = MAP_WIDTH - 15;
            if (pos.y < 15) pos.y = 15;
            if (pos.y > MAP_HEIGHT - 15) pos.y = MAP_HEIGHT - 15;
        }

        const currentTime = Date.now();
        if (currentTime - room.lastTagTime > 1500) {
            let itPlayer = null;
            for (let p in room.positions) {
                if (room.positions[p].isIt) {
                    itPlayer = p;
                    break;
                }
            }

            if (itPlayer) {
                const itPos = room.positions[itPlayer];
                for (let other in room.positions) {
                    if (other !== itPlayer) {
                        const otherPos = room.positions[other];
                        let dx = otherPos.x - itPos.x;
                        let dy = otherPos.y - itPos.y;
                        let distance = Math.sqrt(dx * dx + dy * dy);
                        if (distance < 28) {
room.positions[itPlayer].isIt = false;
room.positions[other].isIt = true;
room.positions[itPlayer].vx = 0;
room.positions[itPlayer].vy = 0;
room.positions[other].vx = 0;
room.positions[other].vy = 0;
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
