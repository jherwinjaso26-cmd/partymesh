const socket = io();

const Network = {
    hostRoom: (username) => {
        socket.emit('create_room', username);
    },
    joinRoom: (roomId, username) => {
        socket.emit('join_room', { roomId, username });
    },
    updateCosmetics: (cosmetics) => {
        socket.emit('update_player_cosmetics', cosmetics);
    },
    startGame: (config) => {
        socket.emit('start_game_signal', config);
    },
    sendInputVector: (vx, vy) => {
        socket.emit('input_vector', { vx, vy });
    },
    onRoomCreated: (callback) => {
        socket.on('room_created', callback);
    },
    onRoomUpdated: (callback) => {
        socket.on('room_updated', callback);
    },
    onJoinError: (callback) => {
        socket.on('join_error', callback);
    },
    onGameStarted: (callback) => {
        socket.on('game_started', callback);
    },
    onPositionsUpdated: (callback) => {
        socket.on('positions_updated', callback);
    },
    onBombPassed: (callback) => {
        socket.on('bomb_passed', callback);
    },
    onTimerTick: (callback) => {
        socket.on('timer_tick', callback);
    },
    onGameOver: (callback) => {
        socket.on('game_over', callback);
    }
};
