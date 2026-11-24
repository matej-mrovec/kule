(() => {
  'use strict';

  const CFG = {
    width: 960, height: 540, ground: 470, gravity: 620,
    playerW: 28, playerH: 56, crouchH: 32, ballR: 8, maxScore: 5
  };

  const $ = (id) => document.getElementById(id);
  const canvas = $('arena');
  const ctx = canvas.getContext('2d');
  const els = {
    conn: $('conn'), room: $('room-code'), waitingCode: $('waiting-code'),
    name0: $('name0'), name1: $('name1'), score0: $('score0'), score1: $('score1'),
    card0: $('card0'), card1: $('card1'), turn: $('turn'), message: $('message'),
    waiting: $('waiting'), result: $('result'), resultTitle: $('result-title'),
    resultText: $('result-text'), aimHint: $('aim-hint'),
    login: $('login'), nick: $('nick'), error: $('error')
  };

  let room = null;
  let pid = null;
  let state = null;
  let lastTurn = null;
  let pollTimer = null;

  const held = { left: false, right: false, crouch: false };
  let jumpPending = false;
  let throwPending = false;
  const aim = { angle: -0.7, power: 0.65, active: false };

  // Hladké vykreslování mezi dvěma síťovými snímky.
  const shown = {
    players: [null, null],
    ball: { x: 0, y: 0, active: false, seen: false, trail: [] }
  };

  async function post(path, data) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Chyba serveru (${res.status})`);
    return json;
  }

  function showError(text) {
    els.error.textContent = text;
    els.error.hidden = !text;
  }

  function myTurn() {
    return !!state && state.you === state.turn &&
           state.phase === 'aim' && state.status === 'playing';
  }

  function handOf(p) {
    return { x: p.x + CFG.playerW / 2, y: p.y + p.h * 0.35 };
  }

  function defaultAngle() {
    if (!state || state.you === null) return -0.7;
    const me = state.players[state.you];
    const foe = state.players[1 - state.you];
    if (!me || !foe) return -0.7;
    const a = handOf(me), b = handOf(foe);
    return Math.atan2(b.y - a.y - 40, b.x - a.x);
  }

  async function join() {
    const name = (els.nick.value || '').trim() || 'Hráč';
    showError('');
    try {
      const requested = new URLSearchParams(location.search).get('room') || '';
      const res = await post('/api/join', { name, room: requested });
      room = res.room;
      pid = res.playerId;
      state = res.state;
      if (res.state.config) Object.assign(CFG, res.state.config);

      els.login.hidden = true;
      els.room.textContent = room;
      els.waitingCode.textContent = room;
      history.replaceState(null, '', `${location.pathname}?room=${room}`);
      refreshUI();
      if (!pollTimer) pollTimer = setInterval(poll, 70);
    } catch (err) {
      showError(err.message);
    }
  }

  async function poll() {
    if (!room) return;
    const data = {
      room, playerId: pid,
      left: held.left, right: held.right, crouch: held.crouch,
      jump: jumpPending
    };
    jumpPending = false;
    if (throwPending) {
      data.throw = true;
      data.angle = aim.angle;
      data.power = aim.power;
      throwPending = false;
    }
    try {
      state = await post('/api/update', data);
      els.conn.textContent = '● připojeno';
      els.conn.className = 'ok';
      refreshUI();
    } catch (err) {
      els.conn.textContent = '● odpojeno';
      els.conn.className = 'bad';
    }
  }

  function refreshUI() {
    if (!state) return;
    els.name0.textContent = state.players[0] ? state.players[0].name : 'Hráč 1';
    els.name1.textContent = state.players[1] ? state.players[1].name : 'Čeká se…';
    els.score0.textContent = state.scores[0];
    els.score1.textContent = state.scores[1];
    els.card0.style.opacity = state.players[0] ? '1' : '.5';
    els.card1.style.opacity = state.players[1] ? '1' : '.5';
    els.message.textContent = state.message || '';

    const active = state.players[state.turn];
    if (state.status === 'finished') {
      const won = state.winner === state.you;
      els.turn.textContent = won ? 'Vyhrál jsi!' : 'Prohrál jsi';
      els.turn.className = 'turn active';
      els.resultTitle.textContent = won ? 'Vítězství! 🏆' : 'Smolně, příště to padne';
      els.resultText.textContent = won
        ? `Skóre ${state.scores[0]} : ${state.scores[1]}. Chceš odvetu?`
        : `Skóre ${state.scores[0]} : ${state.scores[1]}. Zkus to znovu.`;
      els.result.hidden = false;
    } else {
      els.turn.textContent = myTurn() ? 'Na řadě jsi ty!' : `Hraje ${active ? active.name : '…'}`;
      els.turn.className = myTurn() ? 'turn active' : 'turn';
      els.result.hidden = true;
    }

    els.waiting.hidden = !(state.status === 'waiting' || !state.players[1]);
    els.aimHint.hidden = !myTurn();

    if (myTurn() && lastTurn !== state.turn) aim.angle = defaultAngle();
    lastTurn = state.turn;
  }

  function syncShown() {
    if (!state) return;
    for (let i = 0; i < 2; i++) {
      const p = state.players[i];
      if (!p) { shown.players[i] = null; continue; }
      if (!shown.players[i]) shown.players[i] = { x: p.x, y: p.y, h: p.h, crouch: p.crouch };
      const s = shown.players[i];
      s.x += (p.x - s.x) * 0.4;
      s.y += (p.y - s.y) * 0.4;
      s.h += (p.h - s.h) * 0.4;
      s.crouch = p.crouch;
    }
    const b = state.ball;
    if (!shown.ball.seen && b.active) {
      shown.ball.x = b.x; shown.ball.y = b.y; shown.ball.seen = true;
    }
    shown.ball.x += (b.x - shown.ball.x) * 0.55;
    shown.ball.y += (b.y - shown.ball.y) * 0.55;
    shown.ball.active = b.active;
    shown.ball.trail = b.trail || [];
  }

  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, CFG.ground);
    sky.addColorStop(0, '#152547');
    sky.addColorStop(1, '#264066');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CFG.width, CFG.ground);

    ctx.fillStyle = 'rgba(255, 209, 102, .85)';
    ctx.beginPath();
    ctx.arc(815, 90, 34, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,.07)';
    [[140, 95, 1], [520, 60, .75], [690, 130, .6]].forEach(([x, y, s]) => {
      ctx.beginPath();
      ctx.ellipse(x, y, 58 * s, 18 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 38 * s, y - 8 * s, 38 * s, 16 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = '#1b2d2a';
    ctx.fillRect(0, CFG.ground, CFG.width, CFG.height - CFG.ground);
    ctx.fillStyle = '#2f5a46';
    ctx.fillRect(0, CFG.ground, CFG.width, 6);
    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    ctx.lineWidth = 1;
    for (let x = 0; x < CFG.width; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, CFG.ground + 10);
      ctx.lineTo(x + 24, CFG.height);
      ctx.stroke();
    }
  }

  function drawPlayer(p, i) {
    if (!p) return;
    const color = i === 0 ? '#ff6b6b' : '#4dd0e1';
    const dark = i === 0 ? '#b83b45' : '#23899b';
    const x = p.x, y = p.y, w = CFG.playerW, h = p.h;

    if (state && state.turn === i && state.phase === 'aim' && state.status === 'playing') {
      ctx.fillStyle = 'rgba(255, 209, 102, .18)';
      ctx.beginPath();
      ctx.ellipse(x + w / 2, CFG.ground + 2, 26, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // tělo
    ctx.fillStyle = color;
    roundRect(x + 3, y + 10, w - 6, Math.max(10, h - 16), 5);
    ctx.fill();

    // hlava
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + w / 2, y + 8, 9, 0, Math.PI * 2);
    ctx.fill();

    // oči a ruka
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(x + w / 2 + 1, y + 5, 3, 3);
    ctx.fillStyle = dark;
    ctx.fillRect(i === 0 ? x - 2 : x + w - 2, y + 17, 4, 10); // ruka směrem ven

    // nohy
    ctx.fillStyle = dark;
    ctx.fillRect(x + 5, y + h - 6, 7, 6);
    ctx.fillRect(x + w - 12, y + h - 6, 7, 6);

    // jméno
    const name = state && state.players[i] ? state.players[i].name : '';
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(name, x + w / 2, Math.max(14, y - 7));
  }

  function drawBall() {
    const b = shown.ball;
    if (!b.active && !b.trail.length) return;
    if (b.trail.length > 1) {
      ctx.strokeStyle = 'rgba(255,209,102,.25)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(b.trail[0][0], b.trail[0][1]);
      for (const [x, y] of b.trail) ctx.lineTo(x, y);
      ctx.stroke();
    }
    if (b.active) {
      const glow = ctx.createRadialGradient(b.x, b.y, 1, b.x, b.y, 20);
      glow.addColorStop(0, 'rgba(255,209,102,.55)');
      glow.addColorStop(1, 'rgba(255,209,102,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(b.x, b.y, 20, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = '#ffd166';
      ctx.beginPath(); ctx.arc(b.x, b.y, CFG.ballR, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#9a6b16'; ctx.lineWidth = 2; ctx.stroke();
    }
  }

  function drawAim() {
    if (!aim.active || !myTurn() || !state || state.you === null) return;
    const p = shown.players[state.you];
    if (!p) return;
    const h = handOf(p);
    const speed = 170 + aim.power * 560;
    let x = h.x, y = h.y;
    let vx = Math.cos(aim.angle) * speed;
    let vy = Math.sin(aim.angle) * speed;
    const dt = 1 / 60;

    ctx.fillStyle = 'rgba(255,255,255,.7)';
    for (let k = 0; k < 100; k++) {
      vy += CFG.gravity * dt;
      x += vx * dt;
      y += vy * dt;
      if (y >= CFG.ground || x < 0 || x > CFG.width) break;
      if (k % 4 === 0) {
        ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
      }
    }

    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(h.x, h.y);
    ctx.lineTo(h.x + Math.cos(aim.angle) * 45, h.y + Math.sin(aim.angle) * 45);
    ctx.stroke();

    ctx.fillStyle = 'rgba(11,16,32,.75)';
    roundRect(h.x - 24, h.y - 26, 48, 6, 3); ctx.fill();
    ctx.fillStyle = '#ffd166';
    roundRect(h.x - 24, h.y - 26, 48 * aim.power, 6, 3); ctx.fill();
  }

  function draw() {
    syncShown();
    ctx.clearRect(0, 0, CFG.width, CFG.height);
    drawBackground();
    shown.players.forEach(drawPlayer);
    drawAim();
    drawBall();
    requestAnimationFrame(draw);
  }

  function pointerPos(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * CFG.width / r.width,
      y: (e.clientY - r.top) * CFG.height / r.height
    };
  }

  function updateAim(e) {
    if (!state || state.you === null) return;
    const p = state.players[state.you];
    if (!p) return;
    const m = pointerPos(e);
    const h = handOf(p);
    const dx = m.x - h.x, dy = m.y - h.y;
    aim.angle = Math.atan2(dy, dx);
    aim.power = Math.max(0.2, Math.min(1, Math.hypot(dx, dy) / 320));
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!myTurn()) return;
    aim.active = true;
    canvas.setPointerCapture(e.pointerId);
    updateAim(e);
  });
  canvas.addEventListener('pointermove', (e) => { if (aim.active) updateAim(e); });
  canvas.addEventListener('pointerup', (e) => {
    if (!aim.active) return;
    updateAim(e);
    aim.active = false;
    throwPending = true;
  });
  canvas.addEventListener('pointercancel', () => { aim.active = false; });

  const moveKeys = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowDown: 'crouch', KeyS: 'crouch'
  };
  const jumpKeys = ['ArrowUp', 'KeyW', 'Space'];
  const throwKeys = ['KeyF', 'Enter'];

  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (moveKeys[e.code]) { held[moveKeys[e.code]] = true; e.preventDefault(); }
    if (jumpKeys.includes(e.code)) {
      if (!e.repeat) jumpPending = true;
      e.preventDefault();
    }
    if (throwKeys.includes(e.code)) {
      if (!e.repeat && myTurn()) throwPending = true;
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (moveKeys[e.code]) { held[moveKeys[e.code]] = false; e.preventDefault(); }
  });
  window.addEventListener('blur', () => {
    held.left = held.right = held.crouch = false;
    aim.active = false;
  });

  $('join').addEventListener('click', join);
  els.nick.addEventListener('keydown', (e) => { if (e.code === 'Enter') join(); });

  $('again').addEventListener('click', async () => {
    if (!room) return;
    try { state = await post('/api/newgame', { room, playerId: pid }); refreshUI(); }
    catch (err) { console.warn(err); }
  });

  $('leave').addEventListener('click', async () => {
    if (room) {
      try { await post('/api/leave', { room, playerId: pid }); } catch (err) { console.warn(err); }
    }
    room = null; pid = null; state = null; lastTurn = null;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    els.login.hidden = false;
    els.room.textContent = '—';
    els.conn.textContent = '● odpojeno';
    els.conn.className = 'bad';
    history.replaceState(null, '', location.pathname);
  });

  $('share').addEventListener('click', async () => {
    if (!room) return;
    const link = `${location.origin}${location.pathname}?room=${room}`;
    try {
      await navigator.clipboard.writeText(link);
      $('share').textContent = 'Zkopírováno!';
      setTimeout(() => { $('share').textContent = 'Sdílet odkaz'; }, 1600);
    } catch (err) {
      prompt('Pošli soupeři tento odkaz:', link);
    }
  });

  requestAnimationFrame(draw);
})();
