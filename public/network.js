const socket = io();

const Network = {
    hostRoom: (username) => socket.emit('create_room', username),
    joinRoom: (roomId, username) => socket.emit('join_room', { roomId, username }),
    updateCosmetics: (cosmetics) => socket.emit('update_player_cosmetics', cosmetics),
    sendEmote: (emote) => socket.emit('trigger_emote', emote),
    sendDash: () => socket.emit('trigger_dash'),
    startGame: (config) => socket.emit('start_game_signal', config),
    sendInputVector: (vx, vy) => socket.emit('input_vector', { vx, vy }),
    onRoomCreated: (callback) => socket.on('room_created', callback),
    onRoomUpdated: (callback) => socket.on('room_updated', callback),
    onJoinError: (callback) => socket.on('join_error', callback),
    onGameStarted: (callback) => socket.on('game_started', callback),
    onPositionsUpdated: (callback) => socket.on('positions_updated', callback),
    onItemsUpdated: (callback) => socket.on('items_updated', callback),
    onPowerupCollected: (callback) => socket.on('powerup_collected', callback),
    onDecoyCollected: (callback) => socket.on('decoy_collected', callback),
    onSuddenDeath: (callback) => socket.on('sudden_death_triggered', callback),
    onBombPassed: (callback) => socket.on('bomb_passed', callback),
    onTimerTick: (callback) => socket.on('timer_tick', callback),
    onGameOver: (callback) => socket.on('game_over', callback)
};
