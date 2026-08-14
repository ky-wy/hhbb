const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// ==================== 游戏配置 ====================
const CONFIG = {
  TICK_RATE: 1000 / 20,
  PLAYER_SPEED: 2.5,
  KILL_COOLDOWN: 25,
  KILL_RANGE: 45,
  VENT_RANGE: 35,
  TASK_RANGE: 40,
  MEETING_DURATION: 60,
  TACTICAL_WINDOW: 5,
  VENT_COOLDOWN: 15,
  SABOTAGE_COOLDOWN: 90,
  MAX_VENTS: 8,
  MAP_WIDTH: 2400,
  MAP_HEIGHT: 1800
};

const COMPANIONS = [
  { id: 'nightingale', name: '夜莺', passive: { type: 'curse_counter', probBase: 0.2 }, active: { impostor: { type: 'double_kill', cost: 0 }, crew: { type: 'charge_skill', cost: 2, effect: 'anti_curse' } } },
  { id: 'pugelisi', name: '普格里斯', passive: { type: 'barrier', limit: 1 }, active: { both: { type: 'resurrect', window: 'tactical', limit: 1 } } },
  { id: 'gouwen', name: '钩吻', passive: { type: 'double_hit', weakDuration: 10 }, active: { impostor: { type: 'frenzy', delay: 20, duration: 15 }, crew: { type: 'charge_skill', cost: 1, effect: 'speed_boost', duration: 15 } } },
  { id: 'yuyu', name: '虞瑜', passive: { type: 'curse_immune' }, active: { both: { type: 'summon', limit: 1 }, impostor_extra: { type: 'control_attack', uses: 1 }, crew_extra: { type: 'vision_remote', uses: 2, cost: 2 } } },
  { id: 'hewal', name: '赫瓦尔', passive: { type: 'death_transfer', probKill: 0.3, probVote: 0.1 }, active: { impostor: { type: 'invis', uses: 3, duration: 10, cd: 5 }, crew: { type: 'charge_skill', cost: 3, effect: 'inspect' } } },
  { id: 'xiu', name: '修', passive: { type: 'root', duration: 15 }, active: { impostor: { type: 'curse', window: 'tactical' }, crew: { type: 'fast_task', effect: 'permanent' } } },
  { id: 'luolan', name: '洛兰', passive: { type: 'auto_report' }, active: { both: { type: 'vent_sense' } } },
  { id: 'yuansheng', name: '渊生', active: { impostor: { type: 'trap', window: 'tactical', uses: 1, duration: 10 } } },
  { id: 'fengye', name: '风夜', passive: { type: 'time_aura' }, active: { both: { type: 'time_stop', window: 'tactical', duration: 5, cost: 2 } } },
  { id: 'yezhu', name: '夜主', active: { impostor: { type: 'disguise', window: 'tactical', duration: 15 }, crew: { type: 'disguise_detect', cost: 1 } } }
];

const EMOJIS = ['🤖','👾','🧬','💀','👽','🦾','🦿','🎃','🤠','👻','🧞‍♂️','🧜‍♂️','🧞‍♀️','🧜‍♀️','🧚‍♀️','🧚🏻','🧚‍♂️','🪼','🦋','🪲','🪳','🕷','🪰','🔥','🍔','🍞','🍗'];

// ==================== 房间状态 ====================
const rooms = new Map();

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function createRoom(code) {
  return {
    code, players: new Map(), state: 'lobby',
    tasks: [], vents: [], sabotages: {}, traps: [],
    meetingTimer: null, tacticalTimer: null, gameLoop: null,
    killCooldowns: new Map(), ventCooldowns: new Map(), sabotageCooldown: 0,
    votes: new Map(), chatHistory: { living: [], ghost: [] },
    publicTaskProgress: 0, totalPublicTasks: 0,
    companionSelections: new Map(), selectionTimer: null,
    destroyed: false
  };
}

// ==================== 地图生成 ====================
function generateMap() {
  const rooms = [
    { id: 'cafeteria', name: '餐厅', x: 1000, y: 800, w: 400, h: 300, color: '#00f0ff' },
    { id: 'weapons', name: '武器舱', x: 1600, y: 400, w: 300, h: 250, color: '#ff3131' },
    { id: 'o2', name: '氧气舱', x: 1800, y: 1000, w: 280, h: 280, color: '#00f0ff' },
    { id: 'cockpit', name: '驾驶舱', x: 200, y: 200, w: 350, h: 300, color: '#b300ff' },
    { id: 'mainframe', name: '主控台', x: 600, y: 1200, w: 320, h: 280, color: '#ff00ff' },
    { id: 'storage', name: '仓库', x: 1400, y: 1400, w: 350, h: 250, color: '#ff00ff' },
    { id: 'electrical', name: '电力间', x: 300, y: 900, w: 300, h: 280, color: '#ff3131' },
    { id: 'medbay', name: '医疗间', x: 1100, y: 300, w: 280, h: 250, color: '#00f0ff' }
  ];

  const corridors = [
    { from: 'cafeteria', to: 'medbay' }, { from: 'cafeteria', to: 'weapons' },
    { from: 'cafeteria', to: 'mainframe' }, { from: 'cafeteria', to: 'storage' },
    { from: 'cockpit', to: 'medbay' }, { from: 'cockpit', to: 'electrical' },
    { from: 'electrical', to: 'mainframe' }, { from: 'mainframe', to: 'storage' },
    { from: 'o2', to: 'weapons' }, { from: 'o2', to: 'storage' },
    { from: 'weapons', to: 'medbay' }
  ];

  const tasks = [];
  const taskTypes = ['clean_fan', 'swipe_card', 'wiring', 'password', 'calibrate', 'upload'];
  rooms.forEach(room => {
    const count = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      tasks.push({
        id: `task_${room.id}_${i}`,
        type: taskTypes[Math.floor(Math.random() * taskTypes.length)],
        roomId: room.id,
        x: room.x + 40 + Math.random() * (room.w - 80),
        y: room.y + 40 + Math.random() * (room.h - 80),
        completed: false,
        assignedTo: null
      });
    }
  });

  const vents = [];
  const ventRooms = ['cafeteria', 'weapons', 'o2', 'cockpit', 'mainframe', 'storage', 'electrical', 'medbay'];
  ventRooms.forEach((roomId, i) => {
    const room = rooms.find(r => r.id === roomId);
    vents.push({
      id: `vent_${i}`,
      x: room.x + room.w / 2 + (Math.random() - 0.5) * 100,
      y: room.y + room.h / 2 + (Math.random() - 0.5) * 100,
      roomId
    });
  });

  return { rooms, corridors, tasks, vents };
}

// ==================== 游戏逻辑 ====================
function startCompanionSelection(room) {
  room.state = 'companion';
  room.companionSelections.clear();
  const timer = setTimeout(() => {
    autoAssignCompanions(room);
    startGame(room);
  }, 15000);
  room.selectionTimer = timer;
  io.to(room.code).emit('companion_select', { companions: COMPANIONS, timeLeft: 15 });
}

function autoAssignCompanions(room) {
  const available = [...COMPANIONS];
  for (const [pid, player] of room.players) {
    if (!player.companion) {
      const idx = Math.floor(Math.random() * available.length);
      player.companion = available.splice(idx, 1)[0];
    }
  }
}

function startGame(room) {
  clearTimeout(room.selectionTimer);
  room.state = 'playing';
  const mapData = generateMap();
  room.map = mapData;

  const players = Array.from(room.players.values());
  const impostorCount = players.length <= 6 ? 1 : 2;
  const shuffled = players.sort(() => Math.random() - 0.5);

  shuffled.forEach((p, i) => {
    p.role = i < impostorCount ? 'impostor' : 'crew';
    p.alive = true;
    p.ghost = false;
    p.eliminated = false;
    p.spectating = false;
    p.x = 1200;
    p.y = 950;
    p.vx = 0;
    p.vy = 0;
    p.charge = 0;
    p.maxCharge = 3;
    p.tasks = [];
    p.inVent = false;
    p.disguised = false;
    p.disguiseTarget = null;
    p.barrierActive = false;
    p.weak = false;
    p.cursed = false;
    p.invisible = false;
    p.controlled = false;
    p.speedMultiplier = 1;
    p.deathTransferUsed = false;
    p.resurrectUsed = false;
    p.trapPlaced = false;
    p.summonUsed = false;
    p.antiCurse = false;
    p.visionBonus = p.companion?.id === 'yuyu' && p.role === 'crew' ? 0.3 : 0;
  });

  const crew = players.filter(p => p.role === 'crew');
  room.totalPublicTasks = crew.length * 2;
  room.publicTaskProgress = 0;

  const allTasks = [...mapData.tasks];
  crew.forEach(p => {
    const count = 2 + Math.floor(Math.random() * 2);
    const personal = [];
    for (let i = 0; i < count && allTasks.length > 0; i++) {
      const idx = Math.floor(Math.random() * allTasks.length);
      const t = allTasks.splice(idx, 1)[0];
      t.assignedTo = p.id;
      personal.push(t);
    }
    p.tasks = personal;
  });

  room.sabotageCooldown = 0;
  room.sabotages = {};
  room.traps = [];
  room.votes.clear();
  room.chatHistory = { living: [], ghost: [] };

  io.to(room.code).emit('game_start', {
    map: mapData,
    players: players.map(p => ({
      id: p.id, name: p.name, emoji: p.emoji, x: p.x, y: p.y,
      role: p.role, alive: p.alive, companionId: p.companion?.id
    })),
    yourRole: null
  });

  players.forEach(p => {
    const sock = io.sockets.sockets.get(p.socketId);
    if (sock) {
      sock.emit('personal_data', {
        role: p.role,
        companion: p.companion,
        tasks: p.tasks,
        charge: p.charge
      });
    }
  });

  startGameLoop(room);
}

function startGameLoop(room) {
  if (room.gameLoop) clearInterval(room.gameLoop);
  room.gameLoop = setInterval(() => {
    if (room.destroyed) return;
    updateGame(room);
  }, CONFIG.TICK_RATE);
}

function updateGame(room) {
  if (room.state !== 'playing' && room.state !== 'tactical') return;

  const players = Array.from(room.players.values());

  players.forEach(p => {
    if (!p.alive || p.inVent || p.controlled || p.frozen) return;
    const speed = CONFIG.PLAYER_SPEED * p.speedMultiplier * (p.weak ? 0.8 : 1);
    p.x += p.vx * speed;
    p.y += p.vy * speed;
    p.x = Math.max(20, Math.min(CONFIG.MAP_WIDTH - 20, p.x));
    p.y = Math.max(20, Math.min(CONFIG.MAP_HEIGHT - 20, p.y));
  });

  room.traps.forEach(trap => {
    if (trap.triggered) return;
    players.forEach(p => {
      if (p.alive && !p.ghost && p.role === 'crew') {
        const dist = Math.hypot(p.x - trap.x, p.y - trap.y);
        if (dist < 30) {
          trap.triggered = true;
          trap.triggerTime = Date.now();
          killPlayer(room, p, 'trap');
          io.to(room.code).emit('trap_triggered', { x: trap.x, y: trap.y });
          setTimeout(() => {
            room.traps = room.traps.filter(t => t !== trap);
          }, 3000);
        }
      }
    });
  });

  players.forEach(p => {
    if (p.cursed && p.curseEndTime && Date.now() > p.curseEndTime) {
      if (p.alive && !p.ghost) {
        killPlayer(room, p, 'curse');
      }
      p.cursed = false;
    }
  });

  checkWinCondition(room);

  const snapshot = players.map(p => ({
    id: p.id, x: p.x, y: p.y, vx: p.vx, vy: p.vy,
    alive: p.alive, ghost: p.ghost, invisible: p.invisible,
    disguised: p.disguised, barrierActive: p.barrierActive,
    inVent: p.inVent, controlled: p.controlled
  }));
  io.to(room.code).emit('game_tick', { players: snapshot, sabotages: room.sabotages });
}

function killPlayer(room, victim, cause, killer = null) {
  if (!victim.alive || victim.ghost) return;

  if (victim.companion?.id === 'pugelisi' && cause !== 'curse' && cause !== 'vote' && !victim.barrierUsed) {
    victim.barrierUsed = true;
    victim.barrierActive = true;
    io.to(room.code).emit('barrier_activated', { playerId: victim.id });
    setTimeout(() => { victim.barrierActive = false; }, 3000);
    return;
  }

  if (cause === 'curse' && victim.antiCurse) {
    victim.antiCurse = false;
    io.to(victim.socketId).emit('curse_blocked');
    return;
  }

  if (cause === 'curse' && victim.companion?.id === 'yuyu') {
    io.to(victim.socketId).emit('curse_immune');
    return;
  }

  if (victim.companion?.id === 'gouwen' && cause !== 'curse' && cause !== 'vote' && !victim.injured) {
    victim.injured = true;
    victim.weak = true;
    victim.injuredTime = Date.now();
    io.to(room.code).emit('player_injured', { playerId: victim.id });
    setTimeout(() => {
      if (victim.alive && victim.injured) {
        victim.injured = false;
        victim.weak = false;
      }
    }, 10000);
    return;
  }

  if (victim.companion?.id === 'hewal' && !victim.deathTransferUsed) {
    const prob = cause === 'vote' ? 0.1 : 0.3;
    if (Math.random() < prob) {
      victim.deathTransferUsed = true;
      const targets = Array.from(room.players.values()).filter(p => p.alive && !p.ghost && p.id !== victim.id);
      if (targets.length > 0) {
        const transfer = targets[Math.floor(Math.random() * targets.length)];
        io.to(room.code).emit('death_transferred', { from: victim.id, to: transfer.id });
        killPlayer(room, transfer, cause, killer);
        return;
      }
    }
  }

  if (killer && victim.companion?.id === 'xiu' && cause !== 'curse' && cause !== 'vote') {
    killer.rooted = true;
    killer.rootEndTime = Date.now() + 15000;
    io.to(room.code).emit('killer_rooted', { killerId: killer.id, duration: 15 });
    setTimeout(() => { if (killer) killer.rooted = false; }, 15000);
  }

  if (victim.companion?.id === 'luolan' && killer) {
    setTimeout(() => {
      if (room.state === 'playing') {
        startMeeting(room, victim.id, killer.id, 'auto_report');
      }
    }, 1000);
  }

  victim.alive = false;
  victim.ghost = true;
  victim.deathTime = Date.now();

  io.to(room.code).emit('player_killed', { 
    victimId: victim.id, cause, killerId: killer?.id || null 
  });
  io.to(victim.socketId).emit('you_died', { cause, canGhost: true });

  checkWinCondition(room);
}

function checkWinCondition(room) {
  const players = Array.from(room.players.values());
  const aliveCrew = players.filter(p => p.role === 'crew' && p.alive && !p.ghost && !p.eliminated && !p.spectating).length;
  const aliveImpostors = players.filter(p => p.role === 'impostor' && p.alive && !p.ghost && !p.eliminated && !p.spectating).length;

  if (room.sabotages.o2 && room.sabotages.o2.endTime < Date.now()) {
    endGame(room, 'impostor', 'oxygen_depleted');
    return;
  }

  if (aliveImpostors >= aliveCrew && aliveCrew > 0) {
    endGame(room, 'impostor', 'numbers');
    return;
  }

  if (aliveImpostors === 0) {
    endGame(room, 'crew', 'impostors_eliminated');
    return;
  }

  if (room.publicTaskProgress >= room.totalPublicTasks) {
    endGame(room, 'crew', 'tasks_completed');
    return;
  }
}

function startMeeting(room, bodyId, reporterId, reason) {
  if (room.state === 'meeting') return;
  room.state = 'meeting';
  room.votes.clear();
  room.meetingTimer = CONFIG.MEETING_DURATION;
  room.killCooldowns.clear();

  io.to(room.code).emit('meeting_called', {
    bodyId, reporterId, reason,
    duration: CONFIG.MEETING_DURATION,
    players: Array.from(room.players.values()).map(p => ({
      id: p.id, name: p.name, emoji: p.emoji,
      alive: p.alive, ghost: p.ghost, eliminated: p.eliminated
    }))
  });

  let timeLeft = CONFIG.MEETING_DURATION;
  const timer = setInterval(() => {
    timeLeft--;
    io.to(room.code).emit('meeting_tick', { timeLeft });
    if (timeLeft <= 0) {
      clearInterval(timer);
      endMeeting(room);
    }
  }, 1000);
  room.meetingTimer = timer;
}

function endMeeting(room) {
  clearInterval(room.meetingTimer);

  const votes = {};
  room.votes.forEach((target, voter) => {
    votes[target] = (votes[target] || 0) + 1;
  });

  let maxVotes = 0;
  let targets = [];
  for (const [target, count] of Object.entries(votes)) {
    if (count > maxVotes) {
      maxVotes = count;
      targets = [target];
    } else if (count === maxVotes) {
      targets.push(target);
    }
  }

  let ejected = null;
  if (targets.length === 1 && maxVotes > 0) {
    ejected = targets[0];
    const player = room.players.get(ejected);
    if (player) {
      player.alive = false;
      player.ghost = false;
      player.eliminated = true;
      io.to(room.code).emit('player_ejected', { playerId: ejected });
      io.to(player.socketId).emit('you_ejected');
    }
  }

  io.to(room.code).emit('meeting_ended', { ejected, votes: Object.fromEntries(room.votes) });

  const players = Array.from(room.players.values());
  const aliveCrew = players.filter(p => p.role === 'crew' && p.alive && !p.ghost && !p.eliminated).length;
  const aliveImpostors = players.filter(p => p.role === 'impostor' && p.alive && !p.ghost && !p.eliminated).length;

  if (aliveImpostors >= aliveCrew || aliveImpostors === 0) {
    setTimeout(() => checkWinCondition(room), 100);
    return;
  }

  setTimeout(() => {
    room.state = 'tactical';
    io.to(room.code).emit('tactical_window', { duration: CONFIG.TACTICAL_WINDOW });
    setTimeout(() => {
      room.state = 'playing';
      io.to(room.code).emit('tactical_ended');
    }, CONFIG.TACTICAL_WINDOW * 1000);
  }, 3000);
}

function endGame(room, winner, reason) {
  room.state = 'ended';
  clearInterval(room.gameLoop);
  room.gameLoop = null;

  io.to(room.code).emit('game_ended', { winner, reason });

  setTimeout(() => {
    room.state = 'lobby';
    room.players.forEach(p => {
      p.role = null;
      p.alive = true;
      p.ghost = false;
      p.eliminated = false;
      p.spectating = false;
      p.companion = null;
      p.x = 1200; p.y = 950;
      p.charge = 0;
    });
    room.map = null;
    room.tasks = [];
    room.votes.clear();
    room.chatHistory = { living: [], ghost: [] };
    io.to(room.code).emit('return_lobby');
  }, 10000);
}

// ==================== Socket 处理 ====================
io.on('connection', (socket) => {
  let currentRoom = null;
  let playerId = null;

  socket.on('create_room', (data, cb) => {
    const code = generateRoomCode();
    const room = createRoom(code);
    rooms.set(code, room);
    cb({ success: true, code });
  });

  socket.on('join_room', (data, cb) => {
    const { code, name } = data;
    const room = rooms.get(code);
    if (!room) return cb({ success: false, error: '房间不存在' });
    if (room.state !== 'lobby') return cb({ success: false, error: '游戏进行中' });
    if (room.players.size >= 10) return cb({ success: false, error: '房间已满' });

    playerId = socket.id;
    const player = {
      id: playerId, socketId: socket.id, name,
      emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
      roomCode: code, ready: false,
      x: 1200, y: 950, vx: 0, vy: 0,
      role: null, alive: true, ghost: false,
      eliminated: false, spectating: false,
      companion: null, charge: 0, maxCharge: 3,
      tasks: [], inVent: false
    };

    room.players.set(playerId, player);
    currentRoom = room;
    socket.join(code);

    cb({ success: true, playerId, players: Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name, emoji: p.emoji, ready: p.ready })) });
    socket.to(code).emit('player_joined', { id: playerId, name, emoji: player.emoji });
  });

  socket.on('ready', () => {
    if (!currentRoom) return;
    const player = currentRoom.players.get(playerId);
    if (!player) return;
    player.ready = !player.ready;
    io.to(currentRoom.code).emit('player_ready', { playerId, ready: player.ready });

    const allReady = Array.from(currentRoom.players.values()).every(p => p.ready);
    const count = currentRoom.players.size;
    if (allReady && count >= 4) {
      setTimeout(() => startCompanionSelection(currentRoom), 2000);
    }
  });

  socket.on('select_companion', (data) => {
    if (!currentRoom || currentRoom.state !== 'companion') return;
    const { companionId } = data;
    const companion = COMPANIONS.find(c => c.id === companionId);
    if (!companion) return;

    for (const p of currentRoom.players.values()) {
      if (p.companion?.id === companionId && p.id !== playerId) return;
    }

    const player = currentRoom.players.get(playerId);
    player.companion = companion;
    currentRoom.companionSelections.set(playerId, companionId);
    socket.emit('companion_selected', { companion });

    if (currentRoom.companionSelections.size === currentRoom.players.size) {
      clearTimeout(currentRoom.selectionTimer);
      startGame(currentRoom);
    }
  });

  socket.on('move', (data) => {
    if (!currentRoom) return;
    const player = currentRoom.players.get(playerId);
    if (!player || !player.alive || player.inVent || player.controlled || player.rooted || player.frozen) return;
    const { vx, vy } = data;
    player.vx = vx;
    player.vy = vy;
  });

  socket.on('kill', () => {
    if (!currentRoom || currentRoom.state !== 'playing') return;
    const killer = currentRoom.players.get(playerId);
    if (!killer || killer.role !== 'impostor' || !killer.alive || killer.ghost) return;

    const lastKill = currentRoom.killCooldowns.get(playerId) || 0;
    if (Date.now() - lastKill < CONFIG.KILL_COOLDOWN * 1000) return;

    const targets = Array.from(currentRoom.players.values()).filter(p => {
      if (p.id === playerId || p.role === 'impostor' || !p.alive || p.ghost || p.inVent) return false;
      const dist = Math.hypot(p.x - killer.x, p.y - killer.y);
      return dist < CONFIG.KILL_RANGE;
    });

    if (targets.length > 0) {
      const victim = targets[0];
      currentRoom.killCooldowns.set(playerId, Date.now());
      killPlayer(currentRoom, victim, 'kill', killer);

      if (killer.companion?.id === 'nightingale') {
        const second = targets.find(t => t.id !== victim.id && Math.hypot(t.x - killer.x, t.y - killer.y) < CONFIG.KILL_RANGE);
        if (second) {
          setTimeout(() => killPlayer(currentRoom, second, 'kill', killer), 100);
        }
      }
    }
  });

  socket.on('use_vent', (data) => {
    if (!currentRoom || currentRoom.state !== 'playing') return;
    const player = currentRoom.players.get(playerId);
    if (!player || player.role !== 'impostor' || !player.alive || player.ghost) return;

    const lastVent = currentRoom.ventCooldowns.get(playerId) || 0;
    if (Date.now() - lastVent < CONFIG.VENT_COOLDOWN * 1000) return;

    if (!player.inVent) {
      const nearVent = currentRoom.map.vents.find(v => Math.hypot(v.x - player.x, v.y - player.y) < CONFIG.VENT_RANGE);
      if (nearVent) {
        player.inVent = true;
        player.ventId = nearVent.id;
        player.x = nearVent.x;
        player.y = nearVent.y;
        io.to(currentRoom.code).emit('vent_entered', { playerId, ventId: nearVent.id });
      }
    } else {
      const { targetVentId } = data;
      const target = currentRoom.map.vents.find(v => v.id === targetVentId);
      if (target) {
        player.x = target.x;
        player.y = target.y;
        player.inVent = false;
        player.ventId = null;
        currentRoom.ventCooldowns.set(playerId, Date.now());
        io.to(currentRoom.code).emit('vent_exited', { playerId, x: target.x, y: target.y });
      }
    }
  });

  socket.on('sabotage', (data) => {
    if (!currentRoom || currentRoom.state !== 'playing') return;
    const player = currentRoom.players.get(playerId);
    if (!player || player.role !== 'impostor' || !player.alive) return;
    if (currentRoom.sabotageCooldown > Date.now()) return;

    const { type } = data;
    const room = currentRoom.map.rooms.find(r => r.id === type);
    if (!room) return;
    const dist = Math.hypot(player.x - (room.x + room.w/2), player.y - (room.y + room.h/2));
    if (dist > 100) return;

    currentRoom.sabotageCooldown = Date.now() + CONFIG.SABOTAGE_COOLDOWN * 1000;

    if (type === 'electrical') {
      currentRoom.sabotages.electrical = { startTime: Date.now() };
      io.to(currentRoom.code).emit('sabotage_started', { type: 'electrical' });
    } else if (type === 'o2') {
      currentRoom.sabotages.o2 = { startTime: Date.now(), endTime: Date.now() + 60000 };
      io.to(currentRoom.code).emit('sabotage_started', { type: 'o2', duration: 60 });
    }
  });

  socket.on('fix_sabotage', (data) => {
    if (!currentRoom) return;
    const player = currentRoom.players.get(playerId);
    if (!player || !player.alive || player.ghost) return;

    const { type } = data;
    const room = currentRoom.map.rooms.find(r => r.id === type);
    if (!room) return;
    const dist = Math.hypot(player.x - (room.x + room.w/2), player.y - (room.y + room.h/2));
    if (dist > 80) return;

    if (currentRoom.sabotages[type]) {
      delete currentRoom.sabotages[type];
      io.to(currentRoom.code).emit('sabotage_fixed', { type, fixer: playerId });
    }
  });

  socket.on('report_body', () => {
    if (!currentRoom || currentRoom.state !== 'playing') return;
    const player = currentRoom.players.get(playerId);
    if (!player || !player.alive || player.ghost) return;

    const bodies = Array.from(currentRoom.players.values()).filter(p => !p.alive && p.ghost && !p.eliminated);
    const nearBody = bodies.find(b => Math.hypot(b.x - player.x, b.y - player.y) < 60);
    if (nearBody) {
      startMeeting(currentRoom, nearBody.id, playerId, 'body_report');
    }
  });

  socket.on('emergency_meeting', () => {
    if (!currentRoom || currentRoom.state !== 'playing') return;
    const player = currentRoom.players.get(playerId);
    if (!player || !player.alive || player.ghost) return;

    const cafe = currentRoom.map.rooms.find(r => r.id === 'cafeteria');
    const dist = Math.hypot(player.x - (cafe.x + cafe.w/2), player.y - (cafe.y + cafe.h/2));
    if (dist < 100) {
      startMeeting(currentRoom, null, playerId, 'emergency');
    }
  });

  socket.on('task_interact', () => {
    if (!currentRoom || currentRoom.state !== 'playing') return;
    const player = currentRoom.players.get(playerId);
    if (!player || player.role !== 'crew' || !player.alive || player.ghost) return;

    const task = player.tasks.find(t => {
      const dist = Math.hypot(t.x - player.x, t.y - player.y);
      return dist < CONFIG.TASK_RANGE && !t.completed;
    });

    if (task) {
      socket.emit('task_start', { task });
    }
  });

  socket.on('task_complete', (data) => {
    if (!currentRoom || currentRoom.state !== 'playing') return;
    const player = currentRoom.players.get(playerId);
    if (!player || player.role !== 'crew' || !player.alive || player.ghost) return;

    const { taskId } = data;
    const task = player.tasks.find(t => t.id === taskId);
    if (task && !task.completed) {
      task.completed = true;
      currentRoom.publicTaskProgress++;
      player.charge = Math.min(player.maxCharge, player.charge + 1);

      socket.emit('task_done', { taskId, charge: player.charge });
      io.to(currentRoom.code).emit('task_progress', { 
        completed: currentRoom.publicTaskProgress, 
        total: currentRoom.totalPublicTasks 
      });

      if (player.companion?.id === 'yuyu') {
        player.remoteTaskUses = (player.remoteTaskUses || 0) + 1;
      }

      checkWinCondition(currentRoom);
    }
  });

  socket.on('vote', (data) => {
    if (!currentRoom || currentRoom.state !== 'meeting') return;
    const player = currentRoom.players.get(playerId);
    if (!player || !player.alive || player.ghost || player.eliminated || player.spectating) return;

    const { targetId } = data;
    currentRoom.votes.set(playerId, targetId || 'skip');
    io.to(currentRoom.code).emit('player_voted', { playerId });
  });

  socket.on('chat_message', (data) => {
    if (!currentRoom) return;
    const player = currentRoom.players.get(playerId);
    if (!player) return;

    const { message } = data;
    const isGhost = player.ghost || player.eliminated || player.spectating;
    const channel = isGhost ? 'ghost' : 'living';

    const msg = {
      id: Date.now() + Math.random(),
      playerId: player.id,
      playerName: player.name,
      message,
      channel,
      timestamp: Date.now()
    };

    currentRoom.chatHistory[channel].push(msg);

    currentRoom.players.forEach(p => {
      const pIsGhost = p.ghost || p.eliminated || p.spectating;
      const canSee = (channel === 'living' && !pIsGhost) || (channel === 'ghost' && pIsGhost);
      if (canSee) {
        io.to(p.socketId).emit('chat_message', msg);
      }
    });
  });

  socket.on('use_ability', (data) => {
    if (!currentRoom) return;
    const player = currentRoom.players.get(playerId);
    if (!player || !player.alive || player.ghost) return;

    const { type, targetId } = data;
    handleAbility(currentRoom, player, type, targetId);
  });

  socket.on('spectate_choice', (data) => {
    if (!currentRoom) return;
    const player = currentRoom.players.get(playerId);
    if (!player || !player.eliminated) return;

    if (data.choice === 'spectate') {
      player.spectating = true;
      socket.emit('enter_spectate');
    } else {
      socket.leave(currentRoom.code);
      currentRoom.players.delete(playerId);
      socket.emit('kicked');
    }
  });

  socket.on('disconnect', () => {
    if (currentRoom) {
      currentRoom.players.delete(playerId);
      io.to(currentRoom.code).emit('player_left', { playerId });
      if (currentRoom.players.size === 0) {
        currentRoom.destroyed = true;
        clearInterval(currentRoom.gameLoop);
        rooms.delete(currentRoom.code);
      }
    }
  });
});

// ==================== 能力处理 ====================
function handleAbility(room, player, type, targetId) {
  const companion = player.companion;
  if (!companion) return;

  if (type === 'trap' && companion.id === 'yuansheng' && player.role === 'impostor' && room.state === 'tactical') {
    if (player.trapPlaced) return;
    player.trapPlaced = true;
    room.traps.push({
      x: player.x, y: player.y,
      placedBy: player.id, duration: 10000,
      triggered: false
    });
    io.to(room.code).emit('trap_placed', { x: player.x, y: player.y, playerId: player.id });
  }

  if (type === 'invis' && companion.id === 'hewal' && player.role === 'impostor' && room.state === 'tactical') {
    if (player.invisUses >= 3) return;
    player.invisible = true;
    player.invisUses = (player.invisUses || 0) + 1;
    io.to(room.code).emit('player_invis', { playerId: player.id, duration: 10 });
    setTimeout(() => {
      player.invisible = false;
      io.to(room.code).emit('player_vis', { playerId: player.id });
    }, 10000);
  }

  if (type === 'time_stop' && companion.id === 'fengye' && room.state === 'tactical') {
    if (player.charge < 2) return;
    player.charge -= 2;
    io.to(room.code).emit('time_stopped', { playerId: player.id, duration: 5 });
    room.players.forEach(p => {
      if (p.id !== player.id && p.alive && !p.ghost) {
        p.frozen = true;
        setTimeout(() => { p.frozen = false; }, 5000);
      }
    });
  }

  if (type === 'disguise' && companion.id === 'yezhu' && player.role === 'impostor' && room.state === 'tactical') {
    const target = room.players.get(targetId);
    if (!target) return;
    player.disguised = true;
    player.disguiseTarget = targetId;
    io.to(room.code).emit('player_disguised', { playerId: player.id, targetId });
    setTimeout(() => {
      player.disguised = false;
      player.disguiseTarget = null;
      io.to(room.code).emit('player_undisguised', { playerId: player.id });
    }, 15000);
  }

  if (type === 'curse' && companion.id === 'xiu' && player.role === 'impostor' && room.state === 'tactical') {
    const target = room.players.get(targetId);
    if (!target || target.role === 'impostor' || !target.alive || target.ghost) return;
    target.cursed = true;
    target.curseEndTime = Date.now() + 10000;
    io.to(room.code).emit('player_cursed', { playerId: target.id, duration: 10 });
  }

  if (type === 'control_attack' && companion.id === 'yuyu' && player.role === 'impostor' && room.state === 'tactical') {
    if (player.controlAttackUsed) return;
    const target = room.players.get(targetId);
    const victim = Array.from(room.players.values()).find(p => p.alive && !p.ghost && p.id !== targetId && p.role === 'crew');
    if (target && victim && target.alive && !target.ghost) {
      player.controlAttackUsed = true;
      target.controlled = true;
      io.to(target.socketId).emit('mind_controlled', { victimId: victim.id });
      setTimeout(() => {
        killPlayer(room, victim, 'control', target);
        target.controlled = false;
        io.to(target.socketId).emit('control_released');
      }, 2000);
    }
  }

  if (type === 'resurrect' && companion.id === 'pugelisi' && room.state === 'tactical') {
    if (player.resurrectUsed) return;
    const target = Array.from(room.players.values()).find(p => p.ghost && !p.eliminated && p.deathCause !== 'curse');
    if (target) {
      player.resurrectUsed = true;
      target.alive = true;
      target.ghost = false;
      target.resurrected = true;
      target.silenced = true;
      io.to(room.code).emit('player_resurrected', { playerId: target.id });
    }
  }

  if (type === 'speed_boost' && companion.id === 'gouwen' && player.role === 'crew' && room.state === 'tactical') {
    if (player.charge < 1) return;
    player.charge -= 1;
    player.speedMultiplier = 1.5;
    setTimeout(() => { player.speedMultiplier = 1; }, 15000);
    io.to(player.socketId).emit('speed_boosted', { duration: 15 });
  }

  if (type === 'anti_curse' && companion.id === 'nightingale' && player.role === 'crew' && room.state === 'tactical') {
    if (player.charge < 2) return;
    player.charge -= 2;
    player.antiCurse = true;
    io.to(player.socketId).emit('anti_curse_activated');
  }

  if (type === 'inspect' && companion.id === 'hewal' && player.role === 'crew' && room.state === 'tactical') {
    if (player.charge < 3) return;
    player.charge -= 3;
    const target = room.players.get(targetId);
    if (target) {
      io.to(player.socketId).emit('inspect_result', { 
        playerId: target.id, 
        isImpostor: target.role === 'impostor' 
      });
    }
  }

  if (type === 'remote_task' && companion.id === 'yuyu' && player.role === 'crew') {
    if (player.charge < 2 || (player.remoteTaskUses || 0) >= 2) return;
    player.charge -= 2;
    player.remoteTaskUses = (player.remoteTaskUses || 0) + 1;
    const task = player.tasks.find(t => !t.completed);
    if (task) {
      task.completed = true;
      room.publicTaskProgress++;
      io.to(player.socketId).emit('task_done', { taskId: task.id, charge: player.charge });
      io.to(room.code).emit('task_progress', { 
        completed: room.publicTaskProgress, 
        total: room.totalPublicTasks 
      });
    }
  }

  if (type === 'vent_sense' && companion.id === 'luolan') {
    const nearVent = room.map.vents.find(v => Math.hypot(v.x - player.x, v.y - player.y) < 20);
    if (nearVent) {
      const occupied = Array.from(room.players.values()).some(p => p.inVent);
      io.to(player.socketId).emit('vent_sense_result', { occupied });
    }
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Cyberpunk Among Us server running on port ${PORT}`);
});
