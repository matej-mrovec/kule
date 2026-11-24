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

  // Šílené animované pozadí: hvězdy, kuličky a jiskry jsou předpočítané,
  // aby se za běhu netvořily objekty a animace zůstala plynulá.
  let fxOn = true;
  const TAU = Math.PI * 2;
  const stars = Array.from({ length: 96 }, () => ({
    x: Math.random() * CFG.width,
    y: Math.random() * (CFG.ground - 30),
    r: 0.6 + Math.random() * 1.7,
    phase: Math.random() * TAU,
    speed: 0.8 + Math.random() * 3.4,
    hue: 170 + Math.random() * 170,
    sparkle: Math.random() < 0.16
  }));
  const orbs = Array.from({ length: 7 }, (_, i) => ({
    x: 90 + Math.random() * (CFG.width - 180),
    y: 60 + Math.random() * 300,
    r: 3 + Math.random() * 6,
    hue: (i * 51 + 20) % 360,
    speed: 0.25 + Math.random() * 0.5,
    phase: Math.random() * TAU
  }));
  const sparks = Array.from({ length: 40 }, () => ({
    x: Math.random() * CFG.width,
    speed: 18 + Math.random() * 55,
    phase: Math.random(),
    size: 1 + Math.random() * 2,
    hue: 35 + Math.random() * 60
  }));

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

  function drawBackground(time) {
    const t = fxOn ? time : 0;
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, CFG.width, CFG.ground);
    ctx.clip();

    // Obloha, která pomalu mění odstín i jas.
    const sky = ctx.createLinearGradient(0, 0, 0, CFG.ground);
    sky.addColorStop(0, `hsl(${(268 + Math.sin(t * 0.17) * 42 + 360) % 360}, 68%, ${9 + pulse * 4}%)`);
    sky.addColorStop(0.55, `hsl(${(212 + Math.sin(t * 0.29) * 48 + 360) % 360}, 78%, ${15 + pulse * 5}%)`);
    sky.addColorStop(1, '#101d31');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CFG.width, CFG.ground);

    // Rotující majákové paprsky.
    ctx.save();
    ctx.translate(CFG.width * 0.5, CFG.ground * 0.44);
    ctx.rotate(t * 0.24);
    const rayHues = [188, 4, 45];
    for (let i = 0; i < 24; i++) {
      ctx.rotate(TAU / 24);
      const a = 0.02 + 0.045 * (0.5 + 0.5 * Math.sin(t * 3 + i * 0.8));
      ctx.fillStyle = `hsla(${rayHues[i % 3]}, 100%, 65%, ${a})`;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(CFG.width, -30);
      ctx.lineTo(CFG.width, 30);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Neonové prsteny otáčející se proti sobě.
    ctx.save();
    ctx.translate(CFG.width * 0.5, CFG.ground * 0.44);
    [125, 215, 325].forEach((r, i) => {
      ctx.save();
      ctx.rotate((i % 2 ? -1 : 1) * t * (0.3 + i * 0.16));
      ctx.setLineDash([12 + i * 9, 20 + i * 7]);
      ctx.lineDashOffset = -t * (45 + i * 30);
      ctx.strokeStyle = `hsla(${(i * 115 + t * 45) % 360}, 100%, 72%, ${0.13 + pulse * 0.12})`;
      ctx.lineWidth = 2 + i;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.stroke();
      ctx.restore();
    });
    ctx.restore();

    // Blikající hvězdy, z nichž některé rotují jako čtyřcípé jiskřičky.
    for (const s of stars) {
      const a = 0.18 + 0.82 * Math.abs(Math.sin(t * s.speed + s.phase));
      const y = s.y + Math.sin(t * 0.8 + s.phase) * 4;
      ctx.fillStyle = `hsla(${s.hue}, 100%, 82%, ${a})`;
      ctx.shadowBlur = s.sparkle ? 14 : 0;
      ctx.shadowColor = `hsl(${s.hue}, 100%, 70%)`;
      ctx.beginPath(); ctx.arc(s.x, y, s.r, 0, TAU); ctx.fill();
      if (s.sparkle && a > 0.7) {
        ctx.save();
        ctx.translate(s.x, y);
        ctx.rotate(t * 1.6 + s.phase);
        ctx.strokeStyle = `hsla(${s.hue}, 100%, 88%, ${a})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-s.r * 5, 0); ctx.lineTo(s.r * 5, 0);
        ctx.moveTo(0, -s.r * 5); ctx.lineTo(0, s.r * 5);
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.shadowBlur = 0;

    // Pulzující neonové slunce vlevo.
    ctx.save();
    ctx.translate(108, 94);
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = `hsla(${(42 + i * 26 + t * 35) % 360}, 100%, 72%, ${0.28 + 0.22 * Math.sin(t * 2 + i)})`;
      ctx.lineWidth = 3 + i;
      ctx.beginPath();
      ctx.arc(0, 0, 22 + i * 10 + Math.sin(t * 2 + i) * 3, 0, TAU);
      ctx.stroke();
    }
    ctx.fillStyle = `hsla(48, 100%, 78%, ${0.7 + 0.25 * pulse})`;
    ctx.shadowBlur = 26; ctx.shadowColor = '#ffd166';
    ctx.beginPath(); ctx.arc(0, 0, 15, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.shadowBlur = 0;

    // Rotující disko-šestihrán s hvězdou uvnitř.
    ctx.save();
    ctx.translate(CFG.width - 120, 108);
    ctx.rotate(t * 0.85);
    ctx.strokeStyle = `hsla(${(t * 95) % 360}, 100%, 78%, 0.7)`;
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 20; ctx.shadowColor = '#4dd0e1';
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * TAU;
      const x = Math.cos(a) * 32, y = Math.sin(a) * 32;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.rotate(-t * 2.1);
    ctx.strokeStyle = 'rgba(255,255,255,.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * TAU;
      const r = i % 2 ? 8 : 22;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
    ctx.shadowBlur = 0;

    // Zářící létající kuličky.
    for (let i = 0; i < orbs.length; i++) {
      const o = orbs[i];
      const x = o.x + Math.sin(t * o.speed + o.phase) * 44;
      const y = o.y + Math.cos(t * o.speed * 0.77 + o.phase) * 20;
      const g = ctx.createRadialGradient(x, y, 0, x, y, o.r * 4);
      g.addColorStop(0, `hsla(${o.hue}, 100%, 78%, 0.32)`);
      g.addColorStop(1, `hsla(${o.hue}, 100%, 60%, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, o.r * 4, 0, TAU); ctx.fill();
      ctx.fillStyle = `hsla(${o.hue}, 100%, 86%, ${0.45 + 0.4 * Math.sin(t * 3 + i) ** 2})`;
      ctx.beginPath(); ctx.arc(x, y, o.r, 0, TAU); ctx.fill();
    }

    // Jiskry stoupající ze země.
    for (const s of sparks) {
      const y = CFG.ground - ((t * s.speed + s.phase * CFG.ground) % (CFG.ground + 30));
      const x = s.x + Math.sin(t * 1.3 + s.phase * 9) * 16;
      ctx.fillStyle = `hsla(${s.hue}, 100%, 76%, ${0.2 + 0.55 * Math.sin(t * 4 + s.phase * 12) ** 2})`;
      ctx.fillRect(x, y, s.size, s.size * 2);
    }

    // Horský horizont s neónovou linií.
    ctx.beginPath();
    ctx.moveTo(0, CFG.ground);
    for (let x = 0; x <= CFG.width; x += 20) {
      const y = CFG.ground - 34 - Math.abs(Math.sin(x * 0.011 + t * 0.12)) * 34
                            - Math.abs(Math.sin(x * 0.033)) * 16;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(CFG.width, CFG.ground);
    ctx.closePath();
    ctx.fillStyle = 'rgba(8, 16, 32, 0.82)';
    ctx.fill();
    ctx.strokeStyle = `hsla(${(t * 55) % 360}, 100%, 72%, 0.5)`;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Občasný blesk (jednou za 9 sekund).
    const cycle = t % 9;
    if (cycle > 8.8 && cycle < 8.96) {
      ctx.fillStyle = `rgba(210, 235, 255, ${0.1 + 0.16 * Math.sin((cycle - 8.8) * 90) ** 2})`;
      ctx.fillRect(0, 0, CFG.width, CFG.ground);
      ctx.strokeStyle = 'rgba(220,245,255,.85)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(660, 0);
      for (let i = 1; i <= 6; i++) {
        ctx.lineTo(660 + Math.sin(i * 4.7 + Math.floor(t / 9)) * 26, (CFG.ground * i) / 6);
      }
      ctx.stroke();
    }

    ctx.restore(); // konec ořezu oblohy

    drawGround(t, pulse);
    drawScreenFx(t);
  }

  function drawGround(t, pulse) {
    ctx.fillStyle = '#0b1418';
    ctx.fillRect(0, CFG.ground, CFG.width, CFG.height - CFG.ground);

    ctx.fillStyle = `hsla(${(160 + t * 40) % 360}, 90%, 55%, ${0.5 + 0.25 * pulse})`;
    ctx.shadowBlur = 16; ctx.shadowColor = '#4dd0e1';
    ctx.fillRect(0, CFG.ground, CFG.width, 4);
    ctx.shadowBlur = 0;

    ctx.strokeStyle = 'rgba(77, 208, 225, .16)';
    ctx.lineWidth = 1;
    const scroll = (t * 34) % 24;
    for (let y = CFG.ground + 10 + scroll; y < CFG.height; y += 24) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CFG.width, y); ctx.stroke();
    }
    const shift = (t * 26) % 60;
    for (let x = -CFG.width; x < CFG.width * 2; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x + shift, CFG.ground);
      ctx.lineTo((x + shift - CFG.width / 2) * 2.2 + CFG.width / 2, CFG.height);
      ctx.stroke();
    }
  }

  function drawScreenFx(t) {
    ctx.fillStyle = 'rgba(0,0,0,.07)';
    for (let y = 0; y < CFG.height; y += 4) ctx.fillRect(0, y, CFG.width, 1);

    const vg = ctx.createRadialGradient(
      CFG.width / 2, CFG.height / 2, CFG.height * 0.28,
      CFG.width / 2, CFG.height / 2, CFG.height * 0.82
    );
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.38)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, CFG.width, CFG.height);

    ctx.strokeStyle = `hsla(${(t * 70) % 360}, 100%, 70%, ${0.25 + 0.2 * Math.sin(t * 1.7)})`;
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, CFG.width - 3, CFG.height - 3);
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

  function draw(timestamp) {
    syncShown();
    ctx.clearRect(0, 0, CFG.width, CFG.height);
    drawBackground((timestamp || 0) / 1000);
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

  $('fx').addEventListener('click', () => {
    fxOn = !fxOn;
    $('fx').textContent = fxOn ? '✨ Efekty: ON' : 'Efekty: OFF';
    $('fx').classList.toggle('active', fxOn);
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
