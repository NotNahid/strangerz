const SERVER_URL = (function() {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host.includes('cloudshell.dev')) {
    return window.location.origin;
  }
  return 'https://strangerz-backend-production.up.railway.app';
})();

let socket = null, isTyping = false, typingTimer = null;
let messagesData = new Map(), selectedMessageId = null, replyingToId = null, editingMessageId = null;
let isRecording = false, mediaRecorder = null, audioChunks = [], longPressTimer = null, recCountdownInterval = null, recTimeLeft = 20;
let audioContext = null, analyser = null, dataArray = null, source = null, animationFrameId = null;
const objectUrls = new Set();

function playSound(id) { const el = document.getElementById(id); if (el) { el.currentTime = 0; el.play().catch(e => {}); } }

let userSettings = { interests: [], maxWait: 30, theme: 'light' };
const saved = localStorage.getItem('strangerz_settings');
if (saved) { try { Object.assign(userSettings, JSON.parse(saved)); } catch(e) {} }

if (userSettings.theme === 'dark') document.body.classList.add('dark-mode');

function toggleTheme() {
  document.body.classList.toggle('dark-mode');
  userSettings.theme = document.body.classList.contains('dark-mode') ? 'dark' : 'light';
  localStorage.setItem('strangerz_settings', JSON.stringify(userSettings));
}
document.getElementById('theme-toggle-landing')?.addEventListener('click', toggleTheme);
document.getElementById('theme-toggle-chat')?.addEventListener('click', toggleTheme);

window.addEventListener('beforeunload', (e) => {
  const chatActive = !document.getElementById('screen-chat').classList.contains('hidden');
  if (chatActive) {
    e.preventDefault();
    e.returnValue = 'If you refresh, your chat will be lost and you will be disconnected.';
    return e.returnValue;
  }
});

function openInterestsModal() { renderTags(); updateWaitUI(); document.getElementById('modal-interests').classList.add('open'); }
function closeInterestsModal(e) { if (e && e.target !== document.getElementById('modal-interests')) return; document.getElementById('modal-interests').classList.remove('open'); localStorage.setItem('strangerz_settings', JSON.stringify(userSettings)); }
function renderTags() { const container = document.getElementById('interests-tags'); container.innerHTML = userSettings.interests.map((tag, i) => `<div class="interest-tag">${escapeHtml(tag)}<div class="remove-tag" onclick="removeTag(${i})">✕</div></div>`).join(''); }
function removeTag(index) { userSettings.interests.splice(index, 1); renderTags(); }
document.getElementById('tag-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') { const val = e.target.value.trim().toLowerCase(); if (val && !userSettings.interests.includes(val)) { userSettings.interests.push(val); e.target.value = ''; renderTags(); } } });
function setWait(sec) { userSettings.maxWait = sec; updateWaitUI(); }
function updateWaitUI() { document.querySelectorAll('.wait-btn').forEach(btn => { btn.classList.toggle('active', parseInt(btn.dataset.wait) === userSettings.maxWait); }); }

function updateLayout() {
  const chatScreen = document.getElementById('screen-chat');
  if (chatScreen.classList.contains('hidden')) return;
  const vv = window.visualViewport;
  const inputArea = document.getElementById('input-area'), messages = document.getElementById('messages'), topbar = document.querySelector('.chat-topbar');
  if (vv) {
    const offsetFromBottom = Math.max(0, window.innerHeight - (vv.offsetTop + vv.height));
    inputArea.style.transform = `translate3d(0, ${-offsetFromBottom}px, 0)`;
    const inputH = inputArea.offsetHeight, topbarH = topbar.offsetHeight;
    messages.style.top = topbarH + 'px';
    messages.style.bottom = (offsetFromBottom + inputH) + 'px';
  }
  scrollToBottom();
}
let layoutRequested = false;
const debouncedUpdateLayout = () => {
  if (layoutRequested) return;
  layoutRequested = true;
  requestAnimationFrame(() => {
    updateLayout();
    layoutRequested = false;
  });
};
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', debouncedUpdateLayout);
  window.visualViewport.addEventListener('scroll', debouncedUpdateLayout);
}
window.addEventListener('resize', debouncedUpdateLayout);

let currentSessionId = null;
function initSocket() {
  if (socket) return;
  socket = io(SERVER_URL, { transports: ['websocket'], reconnectionAttempts: 5, reconnectionDelay: 1000 });
  socket.on('connect_error', () => { socket.io.opts.transports = ['polling', 'websocket']; });
  socket.on('online_count', n => { document.getElementById('online-count').textContent = n; });
  socket.on('queue_position', pos => { document.getElementById('queue-pos').textContent = pos > 1 ? `You're #${pos} in queue` : 'Almost there…'; });
  socket.on('chat_start', ({ sessionId, sharedInterests }) => {
    currentSessionId = sessionId;
    saveToHistory({ id: sessionId, timestamp: Date.now(), messages: [], sharedInterests });
    playSound('snd-match'); showConnectedFlash();
    setTimeout(() => {
      showScreen('chat'); clearMessages(); messagesData.clear();
      objectUrls.forEach(url => URL.revokeObjectURL(url)); objectUrls.clear();
      const handshakeSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block; vertical-align:middle; margin:0 4px"><path opacity="0.5" d="M8.7838 21.9999C7.0986 21.2478 5.70665 20.0758 4.79175 18.5068" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path opacity="0.5" d="M14.8252 2.18595C16.5021 1.70882 18.2333 2.16305 19.4417 3.39724" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M4.0106 8.36655L3.63846 7.71539L4.0106 8.36655ZM6.50218 8.86743L7.15007 8.48962L6.50218 8.86743ZM3.2028 10.7531L2.55491 11.1309H2.55491L3.2028 10.7531ZM7.69685 3.37253L8.34474 2.99472V2.99472L7.69685 3.37253ZM8.53873 4.81624L7.89085 5.19405L8.53873 4.81624ZM10.4165 9.52517C10.6252 9.88299 11.0844 10.0039 11.4422 9.79524C11.8 9.58659 11.9209 9.12736 11.7123 8.76955L10.4165 9.52517ZM7.53806 12.1327C7.74672 12.4905 8.20594 12.6114 8.56376 12.4027C8.92158 12.1941 9.0425 11.7349 8.83384 11.377L7.53806 12.1327ZM4.39747 5.25817L3.74958 5.63598L4.39747 5.25817ZM11.8381 2.9306L12.486 2.55279V2.55279L11.8381 2.9306ZM14.3638 7.26172L15.0117 6.88391L14.3638 7.26172ZM16.0475 10.1491L16.4197 10.8003C16.5934 10.701 16.7202 10.5365 16.772 10.3433C16.8238 10.15 16.7962 9.94413 16.6954 9.77132L16.0475 10.1491ZM17.6632 5.37608L17.0153 5.75389L17.6632 5.37608ZM20.1888 9.7072L20.8367 9.32939V9.32939L20.1888 9.7072ZM6.99128 17.2497L7.63917 16.8719L6.99128 17.2497ZM16.9576 19.2533L16.5854 18.6021L16.9576 19.2533ZM13.784 15.3C13.9927 15.6578 14.4519 15.7787 14.8097 15.5701C15.1676 15.3614 15.2885 14.9022 15.0798 14.5444L13.784 15.3ZM4.38275 9.0177C5.01642 8.65555 5.64023 8.87817 5.85429 9.24524L7.15007 8.48962C6.4342 7.26202 4.82698 7.03613 3.63846 7.71539L4.38275 9.0177ZM3.63846 7.71539C2.44761 8.39597 1.83532 9.8969 2.55491 11.1309L3.85068 10.3753C3.64035 10.0146 3.75139 9.37853 4.38275 9.0177L3.63846 7.71539ZM7.04896 3.75034L7.89085 5.19405L9.18662 4.43843L8.34474 2.99472L7.04896 3.75034ZM7.89085 5.19405L10.4165 9.52517L11.7123 8.76955L9.18662 4.43843L7.89085 5.19405ZM8.83384 11.377L7.15007 8.48962L5.85429 9.24524L7.53806 12.1327L8.83384 11.377ZM7.15007 8.48962L5.04535 4.88036L3.74958 5.63598L5.85429 9.24524L7.15007 8.48962ZM5.57742 3.5228C6.21109 3.16065 6.8349 3.38327 7.04896 3.75034L8.34474 2.99472C7.62887 1.76712 6.02165 1.54123 4.83313 2.22048L5.57742 3.5228ZM4.83313 2.22048C3.64228 2.90107 3.02999 4.40199 3.74958 5.63598L5.04535 4.88036C4.83502 4.51967 4.94606 3.88363 5.57742 3.5228L4.83313 2.22048ZM11.1902 3.30841L13.7159 7.63953L15.0117 6.88391L12.486 2.55279L11.1902 3.30841ZM13.7159 7.63953L15.3997 10.5269L16.6954 9.77132L15.0117 6.88391L13.7159 7.63953ZM9.71869 3.08087C10.3524 2.71872 10.9762 2.94134 11.1902 3.30841L12.486 2.55279C11.7701 1.32519 10.1629 1.0993 8.9744 1.77855L9.71869 3.08087ZM8.9744 1.77855C7.78355 2.45914 7.17126 3.96006 7.89085 5.19405L9.18662 4.43843C8.97629 4.07774 9.08733 3.4417 9.71869 3.08087L8.9744 1.77855ZM17.0153 5.75389L19.5409 10.085L20.8367 9.32939L18.311 4.99827L17.0153 5.75389ZM15.5437 5.52635C16.1774 5.1642 16.8012 5.38682 17.0153 5.75389L18.311 4.99827C17.5952 3.77068 15.988 3.54478 14.7994 4.22404L15.5437 5.52635ZM14.7994 4.22404C13.6086 4.90462 12.9963 6.40555 13.7159 7.63953L15.0117 6.88391C14.8013 6.52322 14.9124 5.88718 15.5437 5.52635L14.7994 4.22404ZM2.55491 11.1309L6.34339 17.6276L7.63917 16.8719L3.85068 10.3753L2.55491 11.1309ZM16.5854 18.6021C13.2185 20.5264 9.24811 19.631 7.63917 16.8719L6.34339 17.6276C8.45414 21.2472 13.4079 22.1458 17.3297 19.9045L16.5854 18.6021ZM19.5409 10.085C21.1461 12.8377 19.9501 16.6792 16.5854 18.6021L17.3297 19.9045C21.2539 17.6618 22.9512 12.9554 20.8367 9.32939L19.5409 10.085ZM15.0798 14.5444C14.4045 13.3863 14.8772 11.6818 16.4197 10.8003L15.6754 9.49797C13.5735 10.6993 12.5995 13.2687 13.784 15.3L15.0798 14.5444Z" fill="currentColor"/></svg>`;
      let welcomeMsg = `You're connected ${handshakeSvg} Say hi!`;
      if (sharedInterests?.length > 0) welcomeMsg = `You both like <b>${sharedInterests.join(', ')}</b>! ${handshakeSvg}`;
      addSystemMsg(welcomeMsg); setStatus('online'); unlockInput();
    }, 400);
  });
  socket.on('message', ({ text, timestamp, id, replyTo }) => { 
    hideTyping(); setStatus('online'); addMsg('stranger', text, timestamp, id, replyTo); 
    updateSessionHistory(currentSessionId, { who: 'stranger', text, timestamp, type: 'text', id, replyTo });
  });
  socket.on('voice_message', ({ audio, id, replyTo }) => { 
    hideTyping(); setStatus('online'); addVoiceMsg('stranger', audio, id, replyTo); 
    updateSessionHistory(currentSessionId, { who: 'stranger', audio, type: 'voice', id, replyTo, timestamp: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) });
  });
  socket.on('message_edit', ({ id, text }) => { 
    const data = messagesData.get(id); if (data) { data.text = text; data.edited = true; const el = document.getElementById(id); if (el) el.querySelector('.msg-text').innerHTML = escapeHtml(text) + ' <span class="msg-edited-tag">(edited)</span>'; updateSessionHistory(currentSessionId, id, { text, edited: true }); } 
  });
  socket.on('message_reaction', ({ msgId, emoji }) => { applyReaction(msgId, emoji, 'stranger'); });
  socket.on('typing_start', () => { showTyping(); setStatus('typing…'); });
  socket.on('typing_stop', () => { hideTyping(); setStatus('online'); });
  socket.on('stranger_disconnected', () => { hideTyping(); addSystemMsg('Stranger left'); setStatus('offline'); lockInput(); showToast('Stranger left'); startAutoReconnect(); });
  socket.on('stranger_skipped', () => { hideTyping(); addSystemMsg('Stranger skipped you'); setStatus('offline'); lockInput(); showToast('You were skipped'); startAutoReconnect(); });
}

function getHistory() { try { return JSON.parse(localStorage.getItem('strangerz_history') || '[]'); } catch(e) { return []; } }
function saveHistory(h) { localStorage.setItem('strangerz_history', JSON.stringify(h.slice(0, 50))); }
function saveToHistory(session) { const h = getHistory(); h.unshift(session); saveHistory(h); }
function updateSessionHistory(sessionId, msgOrId, updateData = null) {
  if (!sessionId) return;
  const h = getHistory(); const session = h.find(s => s.id === sessionId); if (!session) return;
  if (updateData) { const msg = session.messages.find(m => m.id === msgOrId); if (msg) { Object.assign(msg, updateData); saveHistory(h); } } else { session.messages.push(msgOrId); saveHistory(h); }
}

function showHistory() {
  showScreen('history');
  const container = document.getElementById('history-list-container');
  const history = getHistory();
  if (history.length === 0) { container.innerHTML = '<div class="empty-history" style="text-align:center; margin-top:40px; color:var(--text-dim)">No past chats yet.</div>'; return; }
  
  const fragment = document.createDocumentFragment();
  history.forEach(s => {
    const date = new Date(s.timestamp).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
    const lastMsg = s.messages.length > 0 ? (s.messages[s.messages.length-1].text || 'Voice Message') : 'No messages';
    const div = document.createElement('div');
    div.className = 'history-item';
    div.onclick = () => viewChatHistory(s.id);
    div.innerHTML = `
      <div class="history-item-info">
        <div class="history-item-title">Chat on ${date}</div>
        <div class="history-item-meta">${s.messages.length} messages • ${lastMsg.slice(0, 30)}${lastMsg.length > 30 ? '...' : ''}</div>
      </div>
      <div class="btn-delete-history" onclick="deleteHistoryItem(event, '${s.id}')">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
      </div>
    `;
    fragment.appendChild(div);
  });
  container.innerHTML = '';
  container.appendChild(fragment);
}

function viewChatHistory(id) {
  const session = getHistory().find(s => s.id === id); if (!session) return;
  showScreen('view-history'); document.getElementById('history-date').textContent = new Date(session.timestamp).toLocaleString();
  const container = document.getElementById('history-messages'); container.innerHTML = '';
  const fragment = document.createDocumentFragment();
  session.messages.forEach(m => {
    const div = document.createElement('div'); div.className = 'msg ' + m.who;
    let reactionsHtml = '';
    if (m.reactions?.length > 0) reactionsHtml = `<div class="reaction-container" style="display:flex; gap:4px; margin-top:-8px; margin-left:10px">${m.reactions.map(([e, u]) => `<div class="reaction-pill">${e}${u.length > 1 ? ' <span>' + u.length + '</span>' : ''}</div>`).join('')}</div>`;
    if (m.type === 'voice') div.innerHTML = `<div class="bubble voice-bubble"><button class="play-btn" onclick="playVoice('${m.audio}', this)"><svg viewBox="0 0 24 24" width="14" fill="white"><path d="M8 5v14l11-7z"/></svg></button><div class="waveform-visual">${Array(12).fill('<div class="wave-bar" style="height:10px"></div>').join('')}</div><div class="msg-time">${m.timestamp}</div></div>${reactionsHtml}`;
    else div.innerHTML = `<div class="bubble"><div class="msg-text">${escapeHtml(m.text)}${m.edited ? ' <span class="msg-edited-tag">(edited)</span>' : ''}</div><div class="msg-time">${m.timestamp}</div></div>${reactionsHtml}`;
    fragment.appendChild(div);
  });
  container.appendChild(fragment);
  document.getElementById('btn-delete-current').onclick = () => { if(confirm('Delete this chat?')) { deleteHistoryItem(null, id); showHistory(); } };
}

function deleteHistoryItem(e, id) { if (e) e.stopPropagation(); const h = getHistory().filter(s => s.id !== id); saveHistory(h); if (!e) return; showHistory(); }
function clearAllHistory() { if (confirm('Are you sure you want to clear all chat history?')) { saveHistory([]); showHistory(); } }

let autoReconnectTimer = null, autoReconnectTimeLeft = 10;
function startAutoReconnect() {
  stopAutoReconnect(); autoReconnectTimeLeft = 10;
  const msgs = document.getElementById('messages'), typing = document.getElementById('typing-bubble'), div = document.createElement('div');
  div.className = 'msg system'; div.id = 'auto-reconnect-msg';
  div.innerHTML = `<div class="bubble reconnect-banner"><span>Next stranger in <b id="reconnect-timer">${autoReconnectTimeLeft}</b>s</span><a href="#" class="btn-cancel-reconnect" onclick="cancelReconnectAction(event)">Cancel</a></div>`;
  msgs.insertBefore(div, typing); scrollToBottom();
  autoReconnectTimer = setInterval(() => { autoReconnectTimeLeft--; const el = document.getElementById('reconnect-timer'); if (el) el.textContent = autoReconnectTimeLeft; if (autoReconnectTimeLeft <= 0) { stopAutoReconnect(); startChat(); } }, 1000);
}
function cancelReconnectAction(e) { if (e) e.preventDefault(); stopAutoReconnect(); const el = document.getElementById('auto-reconnect-msg'); if (el) { el.querySelector('.bubble').innerHTML = 'Auto-reconnect cancelled'; el.querySelector('.bubble').classList.remove('reconnect-banner'); } }
function stopAutoReconnect() { clearInterval(autoReconnectTimer); autoReconnectTimer = null; }

async function toggleVoiceRecord() {
  if (isRecording) return; cleanupMedia();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    document.getElementById('recording-ui').classList.add('visible'); document.getElementById('rec-timer').textContent = '0:20'; initRecWaves();
    audioContext = new (window.AudioContext || window.webkitAudioContext)(); analyser = audioContext.createAnalyser(); source = audioContext.createMediaStreamSource(stream); source.connect(analyser); analyser.fftSize = 64; dataArray = new Uint8Array(analyser.frequencyBinCount);
    mediaRecorder = new MediaRecorder(stream); audioChunks = []; recTimeLeft = 20; mediaRecorder.ondataavailable = e => audioChunks.push(e.data); mediaRecorder.start(); isRecording = true;
    recCountdownInterval = setInterval(() => { recTimeLeft--; document.getElementById('rec-timer').textContent = `0:${recTimeLeft < 10 ? '0' : ''}${recTimeLeft}`; if (recTimeLeft <= 0) sendVoiceRecord(); }, 1000); visualize();
  } catch (err) { console.error(err); showToast('Mic access denied'); cleanupMedia(); }
}
function initRecWaves() { const container = document.getElementById('rec-waves'); container.innerHTML = Array(20).fill('<div class="rec-wave-bar"></div>').join(''); }
function visualize() { if (!isRecording) return; analyser.getByteFrequencyData(dataArray); const bars = document.querySelectorAll('.rec-wave-bar'); for (let i = 0; i < bars.length; i++) { const val = dataArray[i % dataArray.length]; bars[i].style.height = Math.max(4, (val/255)*28) + 'px'; } animationFrameId = requestAnimationFrame(visualize); }
function cleanupMedia() { if (mediaRecorder?.state !== 'inactive') try { mediaRecorder.stop(); } catch(e){} if (mediaRecorder?.stream) mediaRecorder.stream.getTracks().forEach(t => t.stop()); if (audioContext) try { audioContext.close(); } catch(e){} clearInterval(recCountdownInterval); cancelAnimationFrame(animationFrameId); isRecording = false; document.getElementById('recording-ui').classList.remove('visible'); audioContext = null; mediaRecorder = null; source = null; }
function cancelVoiceRecord() { cleanupMedia(); showToast('Cancelled'); }
function sendVoiceRecord() {
  if (!isRecording || !mediaRecorder) return;
  mediaRecorder.onstop = () => {
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' }); const reader = new FileReader(); reader.readAsArrayBuffer(audioBlob);
    reader.onloadend = () => { const buffer = reader.result, msgId = 'msg-' + Math.random().toString(36).substr(2, 9); const ts = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); addVoiceMsg('you', buffer, msgId, replyingToId); socket.emit('voice_message', { audio: buffer, id: msgId, replyTo: replyingToId }); updateSessionHistory(currentSessionId, { who: 'you', audio: buffer, type: 'voice', id: msgId, replyTo: replyingToId, timestamp: ts }); cancelReply(); };
  }; cleanupMedia();
}

function addVoiceMsg(who, audioData, id, replyToId = null) {
  const msgId = id || 'msg-' + Math.random().toString(36).substr(2, 9);
  const blob = new Blob([audioData], { type: 'audio/webm' }), url = URL.createObjectURL(blob); objectUrls.add(url);
  const timestamp = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  messagesData.set(msgId, { who, type: 'voice', url, timestamp, reactions: new Map() });
  const msgs = document.getElementById('messages'), typing = document.getElementById('typing-bubble'), div = document.createElement('div');
  div.className = 'msg ' + who; div.id = msgId;
  let replyHtml = '';
  if (replyToId) { const p = messagesData.get(replyToId); if (p) replyHtml = `<div class="bubble-reply-context" onclick="scrollToMsg('${replyToId}')"><div style="font-size:10px; font-weight:700; opacity:0.6">${p.who === 'you' ? 'You' : 'Stranger'}</div><div style="font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${escapeHtml(p.type === 'voice' ? 'Voice Message' : p.text)}</div></div>`; }
  div.innerHTML = `${replyHtml}<div class="msg-content-wrapper"><div class="bubble voice-bubble" onmousedown="handleMsgTouchStart('${msgId}', this)" onmouseup="handleMsgTouchEnd()" ontouchstart="handleMsgTouchStart('${msgId}', this)" ontouchend="handleMsgTouchEnd()"><div style="display:flex; align-items:center; gap:10px"><button class="play-btn" onclick="playVoice('${url}', this)"><svg viewBox="0 0 24 24" width="14" fill="white"><path d="M8 5v14l11-7z"/></svg></button><div class="waveform-visual">${Array(12).fill('<div class="wave-bar" style="height:10px"></div>').join('')}</div></div><div class="msg-time">${timestamp}</div></div><button class="msg-dots-btn" onclick="openActionMenuViaBtn('${msgId}', this)"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="12" cy="5" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="12" cy="19" r="2"></circle></svg></button></div><div class="reaction-container"></div>`;
  msgs.insertBefore(div, typing); scrollToBottom(); if (who === 'stranger') playSound('snd-msg-in');
}
function playVoice(url, btn) {
  const audio = new Audio(url), bars = btn.parentElement.querySelectorAll('.wave-bar'); audio.play();
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" fill="white"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
  const interval = setInterval(() => { bars.forEach(b => b.style.height = (Math.random() * 15 + 5) + 'px'); }, 100);
  audio.onended = () => { clearInterval(interval); bars.forEach(b => b.style.height = '10px'); btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" fill="white"><path d="M8 5v14l11-7z"/></svg>'; };
}

function showScreen(name) { 
  ['landing','finding','chat','history','view-history'].forEach(s => { const el = document.getElementById('screen-' + s); if (el) el.classList.toggle('hidden', s !== name); });
  document.getElementById('btn-skip')?.classList.remove('confirming'); document.getElementById('btn-end')?.classList.remove('confirming'); 
  if (name === 'chat') setTimeout(() => { updateLayout(); scrollToBottom(); }, 100); 
}
function startChat() { stopAutoReconnect(); initSocket(); socket.emit('find_stranger', userSettings); showScreen('finding'); }
function cancelSearch() { socket.emit('cancel_search'); showScreen('landing'); }
let skipTimer = null, endTimer = null;
function skipStranger() { const btn = document.getElementById('btn-skip'); if (!btn.classList.contains('confirming')) { btn.classList.add('confirming'); clearTimeout(skipTimer); skipTimer = setTimeout(() => btn.classList.remove('confirming'), 3000); return; } btn.classList.remove('confirming'); stopAutoReconnect(); clearMessages(); socket.emit('skip_stranger'); showScreen('finding'); unlockInput(); }
function endChat() { const btn = document.getElementById('btn-end'); if (!btn.classList.contains('confirming')) { btn.classList.add('confirming'); clearTimeout(endTimer); endTimer = setTimeout(() => btn.classList.remove('confirming'), 3000); return; } btn.classList.remove('confirming'); stopAutoReconnect(); socket.emit('end_chat'); showScreen('landing'); }
function scrollToBottom() { const msgs = document.getElementById('messages'); msgs.scrollTop = msgs.scrollHeight; }

function addMsg(who, text, timestamp, id = null, replyToId = null) {
  const msgId = id || 'msg-' + Math.random().toString(36).substr(2, 9); const ts = timestamp || new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  messagesData.set(msgId, { who, text, timestamp: ts, type: 'text', reactions: new Map(), edited: false });
  const msgs = document.getElementById('messages'), typing = document.getElementById('typing-bubble'), div = document.createElement('div');
  div.className = 'msg ' + who; div.id = msgId;
  let replyHtml = '';
  if (replyToId) { const p = messagesData.get(replyToId); if (p) replyHtml = `<div class="bubble-reply-context" onclick="scrollToMsg('${replyToId}')"><div style="font-size:10px; font-weight:700; opacity:0.6">${p.who === 'you' ? 'You' : 'Stranger'}</div><div style="font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${escapeHtml(p.type === 'voice' ? 'Voice Message' : p.text)}</div></div>`; }
  div.innerHTML = `${replyHtml}<div class="msg-content-wrapper"><div class="bubble" onmousedown="handleMsgTouchStart('${msgId}', this)" onmouseup="handleMsgTouchEnd()" onmouseleave="handleMsgTouchEnd()" ontouchstart="handleMsgTouchStart('${msgId}', this)" ontouchend="handleMsgTouchStart('${msgId}', this)"><div class="msg-text">${escapeHtml(text)}</div><div class="msg-time">${ts}</div></div><button class="msg-dots-btn" onclick="openActionMenuViaBtn('${msgId}', this)"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="12" cy="5" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="12" cy="19" r="2"></circle></svg></button></div><div class="reaction-container"></div>`;
  msgs.insertBefore(div, typing); scrollToBottom(); if (who === 'stranger') playSound('snd-msg-in');
}

function handleMsgTouchStart(id, el) { selectedMessageId = id; longPressTimer = setTimeout(() => { openActionMenu(el); }, 600); }
function handleMsgTouchEnd() { clearTimeout(longPressTimer); }
function openActionMenuViaBtn(id, el) { selectedMessageId = id; openActionMenu(el); }
function openActionMenu(triggerEl = null) {
  const data = messagesData.get(selectedMessageId); const menu = document.querySelector('.action-menu'), overlay = document.getElementById('action-menu-overlay');
  document.getElementById('edit-action-btn').style.display = (data.who === 'you' && data.type !== 'voice') ? 'flex' : 'none';
  if (triggerEl) {
    const rect = triggerEl.getBoundingClientRect(); const menuWidth = 180, menuHeight = 220;
    let top = rect.top + window.scrollY, left = data.who === 'you' ? rect.left - menuWidth + 20 : rect.right - 20;
    if (left < 10) left = 10; if (left + menuWidth > window.innerWidth - 10) left = window.innerWidth - menuWidth - 10;
    if (top + menuHeight > window.innerHeight - 20) top = window.innerHeight - menuHeight - 20; if (top < 70) top = 70;
    menu.style.top = top + 'px'; menu.style.left = left + 'px'; menu.style.transform = 'scale(1)';
  } else { menu.style.top = '50%'; menu.style.left = '50%'; menu.style.transform = 'translate(-50%, -50%) scale(1)'; }
  overlay.classList.add('open');
}
function closeActionMenu() { document.getElementById('action-menu-overlay').classList.remove('open'); }
function copyMessage() { const data = messagesData.get(selectedMessageId); if (data.type === 'voice') showToast('Cannot copy audio'); else { navigator.clipboard.writeText(data.text); showToast('Copied'); } closeActionMenu(); }
function replyToMessage() { const data = messagesData.get(selectedMessageId); replyingToId = selectedMessageId; editingMessageId = null; const content = data.type === 'voice' ? 'Voice Message' : data.text; document.getElementById('reply-content').innerHTML = `Replying to: <b>${escapeHtml(content.slice(0, 40))}...</b>`; document.getElementById('reply-preview').classList.add('visible'); document.getElementById('msg-input').focus(); closeActionMenu(); }
function cancelReply() { replyingToId = null; editingMessageId = null; document.getElementById('reply-preview').classList.remove('visible'); document.getElementById('msg-input').value = ''; autoResize(document.getElementById('msg-input')); }
function editMessage() { const data = messagesData.get(selectedMessageId); if (data.who !== 'you' || data.type === 'voice') return; editingMessageId = selectedMessageId; replyingToId = null; document.getElementById('reply-content').innerHTML = `Editing: <b>${escapeHtml(data.text.slice(0, 40))}...</b>`; document.getElementById('reply-preview').classList.add('visible'); document.getElementById('msg-input').value = data.text; autoResize(document.getElementById('msg-input')); document.getElementById('msg-input').focus(); closeActionMenu(); }
function reactToMessage(emoji) { if (!selectedMessageId || !socket) return; applyReaction(selectedMessageId, emoji, 'you'); socket.emit('message_reaction', { msgId: selectedMessageId, emoji }); closeActionMenu(); }
function applyReaction(msgId, emoji, who) { const data = messagesData.get(msgId); if (!data) return; if (!data.reactions) data.reactions = new Map(); if (!data.reactions.has(emoji)) data.reactions.set(emoji, new Set()); const set = data.reactions.get(emoji); if (set.has(who)) { set.delete(who); if (set.size === 0) data.reactions.delete(emoji); } else { set.add(who); } renderReactions(msgId); }
function renderReactions(msgId) { const data = messagesData.get(msgId), msgEl = document.getElementById(msgId); if (!msgEl) return; let container = msgEl.querySelector('.reaction-container'); if (!container) return; if (!data.reactions || data.reactions.size === 0) { container.innerHTML = ''; return; } container.innerHTML = Array.from(data.reactions.entries()).map(([emoji, users]) => `<div class="reaction-pill ${users.has('you') ? 'own' : ''}">${emoji}${users.size > 1 ? ' <span>' + users.size + '</span>' : ''}</div>`).join(''); }
function scrollToMsg(id) { const el = document.getElementById(id); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); const bubble = el.querySelector('.bubble'); bubble.style.animation = 'highlight 1s ease'; setTimeout(() => bubble.style.animation = '', 1000); } }
function addSystemMsg(text) { const msgs = document.getElementById('messages'), typing = document.getElementById('typing-bubble'), div = document.createElement('div'); div.className = 'msg system'; div.innerHTML = `<div class="bubble">${text}</div>`; msgs.insertBefore(div, typing); scrollToBottom(); }
function clearMessages() { const msgs = document.getElementById('messages'), typing = document.getElementById('typing-bubble'); msgs.innerHTML = ''; msgs.appendChild(typing); }

function sendMessage() {
  const inp = document.getElementById('msg-input'), text = inp.value.trim(); if (!text || !socket) return;
  if (editingMessageId) {
    socket.emit('message_edit', { id: editingMessageId, text }); const data = messagesData.get(editingMessageId);
    if (data) { data.text = text; data.edited = true; const el = document.getElementById(editingMessageId); if (el) el.querySelector('.msg-text').innerHTML = escapeHtml(text) + ' <span class="msg-edited-tag">(edited)</span>'; updateSessionHistory(currentSessionId, editingMessageId, { text, edited: true }); }
    cancelReply(); return;
  }
  const ts = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}), msgId = 'msg-' + Math.random().toString(36).substr(2, 9);
  const payload = { text, id: msgId }; if (replyingToId) payload.replyTo = replyingToId;
  addMsg('you', text, ts, msgId, replyingToId); socket.emit('message', payload);
  updateSessionHistory(currentSessionId, { who: 'you', text, timestamp: ts, type: 'text', id: msgId, replyTo: replyingToId });
  inp.value = ''; autoResize(inp); stopTypingEmit(); cancelReply(); inp.focus();
}

function showTyping() { document.getElementById('typing-bubble').classList.add('visible'); scrollToBottom(); }
function hideTyping() { document.getElementById('typing-bubble').classList.remove('visible'); }
function stopTypingEmit() { if (isTyping) { socket?.emit('typing_stop'); isTyping = false; } clearTimeout(typingTimer); }
const msgInput = document.getElementById('msg-input');
msgInput?.addEventListener('input', () => { autoResize(msgInput); if (!isTyping) { isTyping = true; socket?.emit('typing_start'); } clearTimeout(typingTimer); typingTimer = setTimeout(() => { isTyping = false; socket?.emit('typing_stop'); }, 1500); });
msgInput?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
msgInput?.addEventListener('focus', () => setTimeout(updateLayout, 300));
function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 110) + 'px'; }
function lockInput() { msgInput.disabled = true; document.getElementById('send-btn').disabled = true; }
function unlockInput() { msgInput.disabled = false; document.getElementById('send-btn').disabled = false; setTimeout(() => msgInput.focus(), 100); }
function setStatus(text) { document.getElementById('stranger-status').textContent = text; }
function showConnectedFlash() { const el = document.createElement('div'); el.className = 'conn-flash'; el.innerHTML = `<div class="conn-flash-inner"><div style="font-size:36px">👋</div><div style="font-size:17px;font-weight:700;margin-top:6px">Stranger found!</div><p>Say something nice</p></div>`; document.body.appendChild(el); setTimeout(() => el.remove(), 900); }
function showToast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000); }
function escapeHtml(str) { return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }

initSocket();
