const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const rooms = new Map();

function makeCode() {
  let code;
  do code = Math.random().toString(36).slice(2, 6).toUpperCase(); while (rooms.has(code));
  return code;
}

function state(room) {
  return {
    code: room.code,
    host: room.host,
    phase: room.phase,
    endsAt: room.endsAt,
    spark: room.spark,
    players: [...room.players.values()].map(({ id, name, score, color }) => ({ id, name, score, color }))
  };
}

function send(socket, type, data) {
  const payload = Buffer.from(JSON.stringify({ type, data }));
  const len = payload.length;
  const header = len < 126 ? Buffer.from([0x81, len]) : Buffer.from([0x81, 126, len >> 8, len & 255]);
  if (!socket.destroyed) socket.write(Buffer.concat([header, payload]));
}
function broadcast(room) { for (const socket of room.sockets.values()) send(socket, 'state', state(room)); }

function finishRound(room) {
  if (room.phase !== 'playing') return;
  room.phase = 'finished';
  room.spark = null;
  broadcast(room);
}

function handle(socket, message) {
  const { type, data = {}, requestId } = message;
  const reply = data => send(socket, 'reply', { requestId, ...data });
  if (type === 'create') {
    const { name } = data;
    const code = makeCode();
    const room = { code, host: socket.id, phase: 'lobby', endsAt: null, spark: null, players: new Map(), sockets: new Map(), timer: null };
    rooms.set(code, room);
    join(room, name, socket);
    reply({ ok: true, code, playerId: socket.id, state: state(room) });
  }

  if (type === 'join') {
    const { code, name } = data;
    const room = rooms.get(String(code).toUpperCase());
    if (!room) return reply({ ok: false, error: 'That room code does not exist.' });
    if (room.phase === 'playing') return reply({ ok: false, error: 'A round is already happening—try again next round.' });
    join(room, name, socket);
    reply({ ok: true, code: room.code, playerId: socket.id, state: state(room) });
  }

  if (type === 'start') {
    const room = roomFor(socket);
    if (!room || room.host !== socket.id || room.players.size < 2) return;
    room.phase = 'playing';
    room.endsAt = Date.now() + 60000;
    room.spark = nextSpark();
    clearTimeout(room.timer);
    room.timer = setTimeout(() => finishRound(room), 60500);
    broadcast(room);
  }

  if (type === 'claim') {
    const { id } = data;
    const room = roomFor(socket);
    if (!room || room.phase !== 'playing' || !room.spark || room.spark.id !== id) return;
    const player = room.players.get(socket.id);
    if (!player) return;
    player.score += 1;
    room.spark = nextSpark();
    broadcast(room);
  }

  if (type === 'play-again') {
    const room = roomFor(socket);
    if (!room || room.host !== socket.id) return;
    for (const player of room.players.values()) player.score = 0;
    room.phase = 'lobby'; room.spark = null; room.endsAt = null;
    broadcast(room);
  }
}
function leave(socket) {
    const room = roomFor(socket);
    if (!room) return;
    room.players.delete(socket.id); room.sockets.delete(socket.id);
    if (!room.players.size) { clearTimeout(room.timer); rooms.delete(room.code); return; }
    if (room.host === socket.id) room.host = room.players.keys().next().value;
    broadcast(room);
}

function join(room, rawName, socket) {
  const name = String(rawName || 'Player').trim().slice(0, 16) || 'Player';
  const colors = ['#ff8b5e', '#8be4dc', '#f7cd6b', '#b5a4ff', '#ff9fc4', '#8de788'];
  room.players.set(socket.id, { id: socket.id, name, score: 0, color: colors[room.players.size % colors.length] });
  room.sockets.set(socket.id, socket); socket.data = { room: room.code }; broadcast(room);
}
function roomFor(socket) { return rooms.get(socket.data && socket.data.room); }
function nextSpark() { return { id: Math.random().toString(36).slice(2), x: 8 + Math.random() * 84, y: 9 + Math.random() * 78, kind: ['✦', '✹', '✷'][Math.floor(Math.random() * 3)] }; }

const server = http.createServer((req, res) => {
  const requested = req.url === '/' ? 'index.html' : req.url.replace(/^\//, '');
  const safe = path.normalize(requested).replace(/^\.\.\/?/, '');
  const file = path.join(__dirname, 'public', safe);
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
  fs.readFile(file, (err, content) => { if (err) { res.writeHead(404); return res.end('Not found'); } res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); res.end(content); });
});
server.on('upgrade', (req, socket) => {
  if (req.headers.upgrade !== 'websocket') return socket.destroy();
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.id = crypto.randomUUID(); let buffer = Buffer.alloc(0);
  socket.on('data', chunk => { buffer = Buffer.concat([buffer, chunk]); while (buffer.length >= 2) { const length = buffer[1] & 127, offset = length === 126 ? 4 : 2; if (length > 125 || buffer.length < offset + length + 4) return; const mask = buffer.subarray(offset, offset + 4), data = buffer.subarray(offset + 4, offset + 4 + length); for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4]; buffer = buffer.subarray(offset + 4 + length); try { handle(socket, JSON.parse(data)); } catch {} } });
  socket.on('close', () => leave(socket)); socket.on('error', () => leave(socket));
});
server.listen(process.env.PORT || 3000, () => console.log('Spark Snatch is live on port ' + (process.env.PORT || 3000)));
