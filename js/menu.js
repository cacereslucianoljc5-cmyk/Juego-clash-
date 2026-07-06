// ===========================================================================
// Menú principal: gatea el arranque del juego, conecta la wallet de Solana,
// abre el chat global y el panel de Batalla 1v1.
//
// El backend (usuarios + chat + emparejamiento 1v1) es enchufable: si existe
// `window.CLASH_API` (URL base de funciones serverless respaldadas por Neon),
// se usa la red; si no, se cae a una demo local con localStorage para que el
// menú funcione sin backend. Así, conectar Neon después es un simple cambio.
// ===========================================================================

import { createNetMatch } from './netmatch.js?v=1';

const API = window.CLASH_API || null; // p.ej. 'https://tu-app.vercel.app/api'

const $ = (id) => document.getElementById(id);
const menu = $('menu');

// --------------------------------------------------- identidad de usuario
function guestName() {
  let n = localStorage.getItem('clashName');
  if (!n) {
    n = 'Invitado' + Math.floor(1000 + Math.random() * 9000);
    localStorage.setItem('clashName', n);
  }
  return n;
}
const state = {
  wallet: null,
  name: guestName(),
};

// --------------------------------------------------- wallet (Solana)
function shorten(addr) {
  return addr.slice(0, 4) + '…' + addr.slice(-4);
}
function getSolanaProvider() {
  if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
  if (window.solana?.isPhantom) return window.solana;
  if (window.solflare?.isSolflare) return window.solflare;
  if (window.solana) return window.solana;
  return null;
}
async function connectWallet() {
  const provider = getSolanaProvider();
  if (!provider) {
    alert('No se detectó ninguna wallet de Solana.\nInstala Phantom o Solflare para conectarte.');
    window.open('https://phantom.app/', '_blank');
    return;
  }
  try {
    const resp = await provider.connect();
    const pk = (resp?.publicKey || provider.publicKey);
    state.wallet = pk.toString();
    state.name = shorten(state.wallet);
    localStorage.setItem('clashWallet', state.wallet);
    renderWallet();
    // Crea/actualiza el usuario en el backend cuando exista Neon.
    if (API) {
      fetch(`${API}/user`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: state.wallet, name: state.name }),
      }).catch(() => {});
    }
    updateOnline();
  } catch (e) {
    console.warn('conexión de wallet cancelada', e);
  }
}
function renderWallet() {
  const chip = $('walletChip');
  if (state.wallet) {
    chip.textContent = shorten(state.wallet);
    chip.classList.add('on');
  } else {
    chip.classList.remove('on');
  }
}
// reconecta en silencio si ya se autorizó antes
(async function tryEagerConnect() {
  const provider = getSolanaProvider();
  if (!provider) return;
  try {
    const resp = await provider.connect({ onlyIfTrusted: true });
    const pk = resp?.publicKey || provider.publicKey;
    if (pk) {
      state.wallet = pk.toString();
      state.name = shorten(state.wallet);
      renderWallet();
      updateOnline();
    }
  } catch { /* no estaba autorizada: nada que hacer */ }
})();

// --------------------------------------------------- navegación del menú
function startOffline() {
  menu.classList.add('hide');
  // El juego ya está renderizando de fondo; esto lanza la carga y la partida vs IA.
  if (window.startOfflineGame) window.startOfflineGame();
}
$('btnOffline').addEventListener('click', startOffline);
$('walletBtn').addEventListener('click', connectWallet);

// --------------------------------------------------- CHAT global
const chatPanel = $('chatPanel');
const chatMsgs = $('chatMessages');
let chatTimer = null;

function openChat() {
  chatPanel.classList.remove('hide');
  loadChat();
  // sondea mensajes nuevos mientras está abierto (cuando hay backend)
  if (API) chatTimer = setInterval(loadChat, 4000);
}
function closeChat() {
  chatPanel.classList.add('hide');
  if (chatTimer) { clearInterval(chatTimer); chatTimer = null; }
}
$('chatBtn').addEventListener('click', openChat);
$('chatClose').addEventListener('click', closeChat);

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function renderMessages(list) {
  chatMsgs.innerHTML = '';
  for (const m of list) {
    const el = document.createElement('div');
    el.className = 'chat-msg' + (m.name === state.name ? ' me' : '');
    el.innerHTML = `<span class="who"></span><span class="time"></span><div class="body"></div>`;
    el.querySelector('.who').textContent = m.name;
    el.querySelector('.time').textContent = fmtTime(m.ts);
    el.querySelector('.body').textContent = m.text;
    chatMsgs.appendChild(el);
  }
  chatMsgs.scrollTop = chatMsgs.scrollHeight;
}

async function loadChat() {
  if (API) {
    try {
      const res = await fetch(`${API}/chat`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) { renderMessages(data); $('chatNote').textContent = ''; return; }
      }
    } catch { /* cae a demo local */ }
  }
  renderMessages(localMessages());
  $('chatNote').textContent = 'Chat en modo demo local — se hará global al conectar Neon.';
}

function localMessages() {
  try { return JSON.parse(localStorage.getItem('clashChat') || '[]'); }
  catch { return []; }
}
async function sendMessage(text) {
  const msg = { name: state.name, text, ts: Date.now(), wallet: state.wallet };
  if (API) {
    try {
      const res = await fetch(`${API}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg),
      });
      if (res.ok) { await loadChat(); return; }
    } catch { /* cae a demo local */ }
  }
  const all = localMessages();
  all.push(msg);
  localStorage.setItem('clashChat', JSON.stringify(all.slice(-200)));
  renderMessages(all);
}
$('chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('chatInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  sendMessage(text);
});

// --------------------------------------------------- BATALLA 1v1 (lobby)
const onlinePanel = $('onlinePanel');
let stake = '0';
let searching = false;
let matchTimer = null;

// selector de apuesta
$('olStakes').addEventListener('click', (e) => {
  const btn = e.target.closest('.ol-stake-btn');
  if (!btn || searching) return;
  document.querySelectorAll('.ol-stake-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  stake = btn.dataset.stake;
});

function openOnline() { onlinePanel.classList.remove('hide'); updateOnline(); }
function closeOnline() { cancelSearch(); onlinePanel.classList.add('hide'); }

function updateOnline() {
  const status = $('onlineStatus');
  const find = $('onlineFind');
  $('olYou').textContent = state.wallet ? shorten(state.wallet) : 'Tú (invitado)';
  if (searching) return;
  if (!state.wallet) {
    status.textContent = 'Conecta tu wallet de Solana para jugar online.';
    find.disabled = true; find.textContent = 'Conecta la wallet primero';
  } else if (!API) {
    status.textContent = 'El online se activa al conectar el backend (Neon) en Vercel.';
    find.disabled = true; find.textContent = 'Online próximamente';
  } else {
    status.textContent = 'Elige tu apuesta y busca rival.';
    find.disabled = false; find.textContent = 'Buscar rival';
  }
}

function setFoe(name, found) {
  $('olFoe').textContent = name || 'Rival';
  const av = $('olFoeAv');
  av.textContent = found ? '🙂' : '❔';
  av.classList.toggle('found', !!found);
}

async function findMatch() {
  if (!API || !state.wallet || searching) return;
  searching = true;
  const find = $('onlineFind');
  find.classList.add('searching');
  find.textContent = 'Buscando rival…';
  $('onlineStatus').textContent = 'Emparejando por apuesta ' + (stake === '0' ? 'amistosa' : stake + ' ◎') + '…';
  try {
    const res = await fetch(`${API}/match`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'join', wallet: state.wallet, name: state.name, stake }),
    });
    if (!res.ok) throw new Error('backend no disponible');
    const r = await res.json();
    if (r.status === 'matched') return onMatched(r.matchId, r.opponent);
    // esperando: sondeamos hasta que otro jugador entre
    matchTimer = setInterval(pollMatch, 2500);
  } catch (e) {
    $('onlineStatus').textContent = 'El servidor de emparejamiento aún no está disponible.';
    resetSearch();
  }
}
async function pollMatch() {
  try {
    const res = await fetch(`${API}/match?wallet=${encodeURIComponent(state.wallet)}`);
    if (!res.ok) return;
    const r = await res.json();
    if (r.status === 'matched') { clearInterval(matchTimer); matchTimer = null; onMatched(r.matchId, r.opponent); }
  } catch { /* reintenta en el siguiente tick */ }
}
async function onMatched(matchId, opponent) {
  searching = false;
  setFoe(opponent, true);
  const find = $('onlineFind');
  find.classList.remove('searching');
  find.textContent = '¡Emparejado!';
  $('onlineStatus').textContent = '¡Rival encontrado! Sincronizando partida…';
  try {
    // Prepara el netcode (roles, semilla y reloj compartido) y lanza el 1v1.
    const net = await createNetMatch({ api: API, matchId, wallet: state.wallet });
    onlinePanel.classList.add('hide');
    menu.classList.add('hide');
    if (window.startNetMatch) window.startNetMatch(net);
  } catch (e) {
    $('onlineStatus').textContent = 'No se pudo iniciar la partida: ' + (e.message || e);
    resetSearch();
  }
}
function cancelSearch() {
  if (matchTimer) { clearInterval(matchTimer); matchTimer = null; }
  if (searching && API && state.wallet) {
    fetch(`${API}/match`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'leave', wallet: state.wallet }),
    }).catch(() => {});
  }
  resetSearch();
}
function resetSearch() {
  searching = false;
  setFoe('Rival', false);
  $('onlineFind').classList.remove('searching');
  updateOnline();
}

$('btn1v1').addEventListener('click', openOnline);
$('onlineClose').addEventListener('click', closeOnline);
$('onlineBack').addEventListener('click', closeOnline);
$('onlineFind').addEventListener('click', () => { searching ? cancelSearch() : findMatch(); });

// arranque
renderWallet();
