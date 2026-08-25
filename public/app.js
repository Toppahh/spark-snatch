const socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
socket.id = null; let request = 0; const callbacks = new Map();
socket.onmessage = ({ data }) => { const message = JSON.parse(data); if (message.type === 'state') { room = message.data; render(); } if (message.type === 'reply') { const cb = callbacks.get(message.data.requestId); if (cb) { callbacks.delete(message.data.requestId); cb(message.data); } } };
function setConnection(ready) { $('#create').disabled = !ready; $('#join').disabled = !ready; if (!ready) error.textContent = 'Connecting to game…'; else if (error.textContent === 'Connecting to game…') error.textContent = ''; }
socket.onopen = () => setConnection(true);
socket.onclose = () => { setConnection(false); error.textContent = 'Connection lost. Refresh to try again.'; };
function emit(type, data, callback) { if (socket.readyState !== WebSocket.OPEN) return setConnection(false); const requestId = ++request; if (callback) callbacks.set(requestId, callback); socket.send(JSON.stringify({ type, data, requestId })); }
let myId, room, clock;
const $ = s => document.querySelector(s);
const nameInput = $('#name'), codeInput = $('#code'), error = $('#error');
setConnection(socket.readyState === WebSocket.OPEN);

function name() { return nameInput.value.trim() || 'Player'; }
function enter(data) { myId = data.playerId; room = data.state; $('#landing').hidden = true; $('#game').hidden = false; $('#room-code').textContent = data.code; render(); }
$('#create').onclick = () => emit('create', { name: name() }, res => res.ok ? enter(res) : showError(res.error));
$('#join').onclick = () => emit('join', { name: name(), code: codeInput.value }, res => res.ok ? enter(res) : showError(res.error));
codeInput.addEventListener('input', () => codeInput.value = codeInput.value.toUpperCase());
function showError(message) { error.textContent = message; }

$('#start').onclick = () => emit('start');
$('#again').onclick = () => emit('play-again');
$('#spark').onclick = () => room.spark && emit('claim', { id: room.spark.id });
$('#copy').onclick = async () => { await navigator.clipboard.writeText(location.origin + '/?room=' + room.code); $('#copy').textContent = 'Invite link copied!'; setTimeout(() => $('#copy').textContent = 'Copy invite link', 1600); };

function render() {
  if (!room) return;
  const isHost = room.host === myId, count = room.players.length;
  $('#players').replaceChildren(...room.players.sort((a,b) => b.score-a.score).map(p => { const item = $('#player-template').content.firstElementChild.cloneNode(true); item.querySelector('.dot').style.background = p.color; item.querySelector('.player-name').textContent = p.name + (p.id === socket.id ? ' (you)' : ''); item.querySelector('.score').textContent = p.score; return item; }));
  $('#start').hidden = room.phase !== 'lobby' || !isHost; $('#again').hidden = room.phase !== 'finished' || !isHost;
  $('#host-note').textContent = room.phase === 'lobby' ? (isHost ? (count < 2 ? 'Need one more player to begin.' : 'Everyone ready? Start when you are.') : 'Waiting for the host to start.') : '';
  const spark = $('#spark'), msg = $('#arena-message'); spark.hidden = room.phase !== 'playing' || !room.spark;
  if (room.spark) { spark.style.left = room.spark.x + '%'; spark.style.top = room.spark.y + '%'; spark.textContent = room.spark.kind; }
  if (room.phase === 'lobby') msg.innerHTML = 'Invite a friend to your room<small>Room code: ' + room.code + '</small>';
  if (room.phase === 'playing') msg.textContent = '';
  if (room.phase === 'finished') { const best = Math.max(...room.players.map(p => p.score)); const winners = room.players.filter(p => p.score === best).map(p => p.name).join(' & '); msg.innerHTML = (winners + (winners.includes('&') ? ' tie!' : ' wins!')) + '<small>' + best + ' sparks claimed</small>'; }
  clearInterval(clock); if (room.phase === 'playing') { tick(); clock = setInterval(tick, 250); } else $('#timer').textContent = room.phase === 'finished' ? 'DONE' : '1:00';
}
function tick() { const seconds = Math.max(0, Math.ceil((room.endsAt - Date.now()) / 1000)); $('#timer').textContent = '0:' + String(seconds).padStart(2,'0'); }
const queryRoom = new URLSearchParams(location.search).get('room'); if (queryRoom) { codeInput.value = queryRoom.toUpperCase(); }
