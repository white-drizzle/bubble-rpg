/* =============================================================
   泡泡勇者 RPG · render.js
   Canvas 渲染：瓦片纹理预渲染 + 角色/怪物/泡泡/爆炸/道具绘制
   （仅浏览器使用，依赖 BubbleCore）
   ============================================================= */
(function (global) {
  'use strict';
  const C = global.BubbleCore;
  const { T, COLS, ROWS, TILE, THEMES, CLASSES, ENEMIES, clamp, rand } = C;

  /* ---------- 瓦片纹理预渲染（按主题缓存） ---------- */
  const tileCache = {};
  function makeTiles(themeName) {
    if (tileCache[themeName]) return tileCache[themeName];
    const th = THEMES[themeName];
    const mk = (w, h) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      return c;
    };
    const grounds = [];
    for (let i = 0; i < 3; i++) {
      const c = mk(T, T), x = c.getContext('2d');
      x.fillStyle = i === 0 ? th.g1 : th.g2;
      x.fillRect(0, 0, T, T);
      x.fillStyle = i === 0 ? th.g2 : th.g1;
      x.fillRect(0, 0, T, 2);
      x.fillRect(0, 0, 2, T);
      x.fillStyle = th.tuft;
      for (let k = 0; k < 4; k++) {
        const gx = ((k * 13 + i * 7) % (T - 8)) + 4;
        const gy = ((k * 29 + i * 5) % (T - 8)) + 4;
        x.fillRect(gx, gy, 3, 3);
      }
      grounds.push(c);
    }
    // 石墙
    const wc = mk(T, T), wx = wc.getContext('2d');
    wx.fillStyle = th.wall;
    wx.fillRect(0, 0, T, T);
    wx.fillStyle = th.wallHi;
    wx.fillRect(0, 0, T, 6);
    wx.fillRect(0, 0, 6, T);
    wx.fillStyle = th.wallLo;
    wx.fillRect(0, T - 6, T, 6);
    wx.fillRect(T - 6, 0, 6, T);
    wx.strokeStyle = 'rgba(0,0,0,0.25)';
    wx.lineWidth = 2;
    wx.strokeRect(4, 4, T - 8, T - 8);
    wx.beginPath();
    wx.moveTo(0, T / 2);
    wx.lineTo(T, T / 2);
    wx.stroke();
    // 木箱
    const bc = mk(T, T), bx = bc.getContext('2d');
    bx.fillStyle = th.box;
    bx.fillRect(2, 2, T - 4, T - 4);
    bx.fillStyle = th.boxLight;
    bx.fillRect(2, 2, T - 4, 5);
    bx.fillRect(2, 2, 5, T - 4);
    bx.fillStyle = th.boxDark;
    bx.fillRect(2, T - 7, T - 4, 5);
    bx.fillRect(T - 7, 2, 5, T - 4);
    bx.strokeStyle = th.boxDark;
    bx.lineWidth = 3;
    bx.strokeRect(9, 9, T - 18, T - 18);
    bx.beginPath();
    bx.moveTo(9, 9); bx.lineTo(T - 9, T - 9);
    bx.moveTo(T - 9, 9); bx.lineTo(9, T - 9);
    bx.stroke();
    tileCache[themeName] = { grounds, wall: wc, box: bc };
    return tileCache[themeName];
  }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------- 世界渲染 ---------- */
  function drawWorld(ctx, world, t) {
    const tiles = makeTiles(world.theme);
    const g = world.map;
    ctx.save();
    if (world.shake > 0) {
      ctx.translate(rand(-world.shake, world.shake) * 0.6, rand(-world.shake, world.shake) * 0.6);
    }
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const tt = g[y][x];
        if (tt === TILE.GROUND) ctx.drawImage(tiles.grounds[(x * 13 + y * 7) % 3], x * T, y * T);
        else if (tt === TILE.WALL) ctx.drawImage(tiles.wall, x * T, y * T);
        else ctx.drawImage(tiles.box, x * T, y * T);
      }
    }
    if (world.portal) drawPortal(ctx, world.portal);
    for (const pk of world.pickups) drawPickup(ctx, pk);
    for (const b of world.bubbles) drawBubble(ctx, b, t);
    for (const e of world.enemies) drawEnemy(ctx, e, t);
    drawPlayer(ctx, world.player, t);
    for (const ex of world.explosions) drawExplosion(ctx, ex);
    for (const pa of world.particles) drawParticle(ctx, pa);
    for (const ft of world.floats) drawFloatText(ctx, ft);
    ctx.restore();
  }

  /* ---------- 玩家 ---------- */
  function drawCharPreview(ctx, charId, w, h, t) {
    const p = {
      charId, x: w / 2, y: h / 2 - 4,
      facing: { x: 0.25, y: 0.9 }, moving: false, invuln: 0, shieldT: 0,
      dead: false, walkT: 0,
    };
    drawPlayer(ctx, p, t);
  }

  function drawPlayer(ctx, p, t) {
    if (p.dead) return;
    const c = CLASSES[p.charId];
    const bob = p.moving ? Math.sin(p.walkT * 14) * 1.8 : Math.sin(t * 2.4) * 0.9;
    const x = p.x, y = p.y + bob;
    ctx.save();
    // 影子
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(x, p.y + 17, 12, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // 无敌闪烁
    if (p.invuln > 0 && p.shieldT <= 0 && Math.floor(t * 14) % 2 === 0) ctx.globalAlpha = 0.55;
    // 身体
    ctx.fillStyle = c.color;
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 脚
    const fw = p.moving ? Math.sin(p.walkT * 14) * 4 : 0;
    ctx.fillStyle = c.dark;
    ctx.beginPath();
    ctx.ellipse(x - 6 + fw, y + 13, 4.5, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + 6 - fw, y + 13, 4.5, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // 脸
    const fx = p.facing.x * 3.2, fy = p.facing.y * 3.2;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x - 5 + fx, y - 2 + fy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 5 + fx, y - 2 + fy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(x - 5 + fx * 1.6, y - 2 + fy * 1.6, 1.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 5 + fx * 1.6, y - 2 + fy * 1.6, 1.9, 0, Math.PI * 2);
    ctx.fill();
    // 嘴
    ctx.strokeStyle = '#3a2416';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(x, y + 4, 4, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    // 职业装扮
    if (p.charId === 'warrior') {
      ctx.fillStyle = '#9aa2ad';
      ctx.strokeStyle = '#5c626c';
      ctx.beginPath();
      ctx.arc(x, y - 9, 11, Math.PI, 0);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#c4cad2';
      ctx.fillRect(x - 11, y - 12, 22, 4);
    } else if (p.charId === 'mage') {
      ctx.fillStyle = '#3a4e9c';
      ctx.strokeStyle = '#232f63';
      ctx.beginPath();
      ctx.moveTo(x - 9, y - 7);
      ctx.lineTo(x, y - 26);
      ctx.lineTo(x + 9, y - 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffd75e';
      ctx.beginPath();
      ctx.arc(x, y - 26, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4a5fb0';
      ctx.beginPath();
      ctx.ellipse(x, y - 6, 12, 3.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillStyle = '#2f7a46';
      ctx.strokeStyle = '#1d4f2c';
      ctx.beginPath();
      ctx.arc(x, y - 7, 11.5, Math.PI, 0);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + 2, y - 19);
      ctx.lineTo(x + 12, y - 27);
      ctx.lineTo(x + 8, y - 18);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ff6a5e';
      ctx.fillRect(x + 8, y - 25, 3, 7);
    }
    ctx.globalAlpha = 1;
    // 护盾 / 无敌光环
    if (p.shieldT > 0) {
      ctx.strokeStyle = 'rgba(255,215,94,' + (0.5 + 0.3 * Math.sin(t * 10)) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 20, 0, Math.PI * 2);
      ctx.stroke();
    } else if (p.invuln > 0) {
      ctx.strokeStyle = 'rgba(126,240,255,' + (0.5 + 0.3 * Math.sin(t * 16)) + ')';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, 19, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------- 敌人 ---------- */
  function drawEnemy(ctx, e, t) {
    const def = ENEMIES[e.typeId];
    const squash = 1 + Math.sin(e.walkT * 8) * 0.08;
    const x = e.x, y = e.y;
    ctx.save();
    if (e.frozen > 0) ctx.globalAlpha = 0.8;
    // 影子
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x, y + e.radius, e.radius - 3, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    const body = e.flash > 0 ? '#ffffff' : def.color;
    ctx.fillStyle = body;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2.5;

    if (e.typeId === 'slime') {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, squash);
      ctx.beginPath();
      ctx.arc(0, 4, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(-5, 2, 3.6, 0, Math.PI * 2);
      ctx.arc(5, 2, 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(-5, 3, 1.8, 0, Math.PI * 2);
      ctx.arc(5, 3, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#2c5c2c';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 9, 3.4, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.stroke();
      ctx.restore();
    } else if (e.typeId === 'goblin') {
      ctx.beginPath();
      ctx.moveTo(x - 12, y - 4); ctx.lineTo(x - 19, y - 14); ctx.lineTo(x - 6, y - 10);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + 12, y - 4); ctx.lineTo(x + 19, y - 14); ctx.lineTo(x + 6, y - 10);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x - 5, y - 3, 4, 0, Math.PI * 2);
      ctx.arc(x + 5, y - 3, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c22';
      ctx.beginPath();
      ctx.arc(x - 5, y - 2, 2, 0, Math.PI * 2);
      ctx.arc(x + 5, y - 2, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1c3a1c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 9, y - 9); ctx.lineTo(x - 2, y - 7);
      ctx.moveTo(x + 9, y - 9); ctx.lineTo(x + 2, y - 7);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y + 7, 4.5, 0.2 * Math.PI, 0.8 * Math.PI);
      ctx.stroke();
      ctx.fillStyle = '#7a5230';
      ctx.fillRect(x + 12, y - 16, 4, 12);
      ctx.fillStyle = '#8a6238';
      ctx.fillRect(x + 10, y - 18, 8, 5);
    } else if (e.typeId === 'skeleton') {
      ctx.beginPath();
      ctx.arc(x, y, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = def.color;
      ctx.fillRect(x - 6, y + 6, 12, 7);
      ctx.strokeRect(x - 6, y + 6, 12, 7);
      ctx.fillStyle = '#1c1c24';
      ctx.beginPath();
      ctx.arc(x - 5, y - 4, 4, 0, Math.PI * 2);
      ctx.arc(x + 5, y - 4, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e04a5a';
      ctx.beginPath();
      ctx.arc(x - 5, y - 4, 1.8, 0, Math.PI * 2);
      ctx.arc(x + 5, y - 4, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 2, y + 2); ctx.lineTo(x - 2, y + 5);
      ctx.moveTo(x + 2, y + 2); ctx.lineTo(x + 2, y + 5);
      ctx.stroke();
    } else if (e.typeId === 'bat') {
      const flap = Math.sin(e.walkT * 18) * 0.8;
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(x - 8, y - 4);
      ctx.quadraticCurveTo(x - 22, y - 14 - flap * 8, x - 18, y + 4);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + 8, y - 4);
      ctx.quadraticCurveTo(x + 22, y - 14 - flap * 8, x + 18, y + 4);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 6, y - 8); ctx.lineTo(x - 8, y - 16); ctx.lineTo(x - 2, y - 10);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + 6, y - 8); ctx.lineTo(x + 8, y - 16); ctx.lineTo(x + 2, y - 10);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ff5e6a';
      ctx.beginPath();
      ctx.arc(x - 4, y - 2, 2.4, 0, Math.PI * 2);
      ctx.arc(x + 4, y - 2, 2.4, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.typeId === 'boss') {
      const pulse = 1 + Math.sin(t * 6) * 0.05;
      const grd = ctx.createRadialGradient(x, y, 4, x, y, 44 * pulse);
      grd.addColorStop(0, e.enraged ? 'rgba(255,80,60,0.35)' : 'rgba(140,90,220,0.32)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(x, y, 44 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = body;
      ctx.strokeStyle = '#1c1030';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(x, y, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // 王冠
      ctx.fillStyle = e.enraged ? '#ff5e4a' : '#8a6ac8';
      ctx.beginPath();
      ctx.moveTo(x - 12, y - 12); ctx.lineTo(x - 12, y - 24); ctx.lineTo(x - 5, y - 15);
      ctx.lineTo(x, y - 26); ctx.lineTo(x + 5, y - 15); ctx.lineTo(x + 12, y - 24); ctx.lineTo(x + 12, y - 12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // 眼睛
      ctx.fillStyle = '#ff3a3a';
      ctx.beginPath();
      ctx.arc(x - 7, y - 2, 4.5, 0, Math.PI * 2);
      ctx.arc(x + 7, y - 2, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd75e';
      ctx.beginPath();
      ctx.arc(x - 7, y - 2, 1.8, 0, Math.PI * 2);
      ctx.arc(x + 7, y - 2, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1c1030';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y + 10, 6, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      if (e.telegraph > 0) {
        ctx.fillStyle = 'rgba(255,90,60,' + (0.35 + 0.35 * Math.sin(t * 40)) + ')';
        ctx.beginPath();
        ctx.arc(x, y, 25, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    // 血条
    if (e.hp < e.maxHp) {
      const w = e.radius * 2;
      const hx = x - w / 2, hy = y - e.radius - 9;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(hx - 1, hy - 1, w + 2, 5);
      ctx.fillStyle = e.boss ? '#ff5e4a' : '#6fe06f';
      ctx.fillRect(hx, hy, w * clamp(e.hp / e.maxHp, 0, 1), 3);
    }
    // 冰冻
    if (e.frozen > 0) {
      ctx.fillStyle = 'rgba(150,220,255,0.35)';
      ctx.beginPath();
      ctx.arc(x, y, e.radius + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(220,245,255,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, e.radius + 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------- 泡泡 / 爆炸 ---------- */
  function drawBubble(ctx, b, t) {
    const near = b.fuse < 0.6;
    const wob = 1 + Math.sin(t * 10) * 0.05 + (near ? Math.sin(t * 36) * 0.12 : 0);
    const r = 15 * wob;
    const boss = b.owner === 'boss';
    const x = b.cx, y = b.cy;
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    if (boss) {
      g.addColorStop(0, near ? '#ff9ac0' : '#c8a8f0');
      g.addColorStop(0.7, 'rgba(90,50,150,0.75)');
      g.addColorStop(1, 'rgba(60,30,110,0.55)');
    } else {
      g.addColorStop(0, near ? '#ffd0d8' : '#cfeaff');
      g.addColorStop(0.7, 'rgba(110,180,255,0.55)');
      g.addColorStop(1, 'rgba(70,130,220,0.45)');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = near ? 'rgba(255,120,130,0.9)' : 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.66, -2.4, -1.1);
    ctx.stroke();
    if (boss) {
      ctx.fillStyle = 'rgba(30,10,50,0.85)';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('💀', x, y + 1);
    }
  }

  function drawExplosion(ctx, ex) {
    const p = ex.age / ex.dur;
    const a = 1 - p;
    const cells = ex.cells;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const cx = c.x * T + T / 2, cy = c.y * T + T / 2;
      const center = i === 0;
      const h = ((c.x * 7 + c.y * 13) % 10) / 10;
      const rad = (T / 2) * (0.62 + 0.34 * p) * (1 + h * 0.25) * (center ? 1.18 : 1);
      ctx.fillStyle = 'rgba(255,110,40,' + a + ')';
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,205,70,' + a + ')';
      ctx.beginPath();
      ctx.arc(cx, cy, rad * 0.72, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,235,' + a + ')';
      ctx.beginPath();
      ctx.arc(cx, cy, rad * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ---------- 道具 / 传送门 / 特效 ---------- */
  function drawPickup(ctx, pk) {
    const bob = Math.sin(pk.t * 3.4) * 3;
    const x = pk.x, y = pk.y + bob;
    ctx.save();
    if (pk.type === 'equip') {
      ctx.fillStyle = pk.item.rarityColor;
      ctx.globalAlpha = 0.35 + 0.2 * Math.sin(pk.t * 5);
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.strokeStyle = 'rgba(40,40,60,0.8)';
    ctx.lineWidth = 2;
    rr(ctx, x - 13, y - 13, 26, 26, 7);
    ctx.fill();
    ctx.stroke();
    const cx = x, cy = y;
    if (pk.type === 'coin') {
      ctx.fillStyle = '#f5b93e';
      ctx.strokeStyle = '#a8761c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffe08a';
      ctx.beginPath();
      ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (pk.type === 'potion' || pk.type === 'mana') {
      const col = pk.type === 'potion' ? '#ff5e5e' : '#5e8aff';
      ctx.fillStyle = col;
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      rr(ctx, cx - 5, cy - 2, 10, 10, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.fillRect(cx - 2.5, cy - 8, 5, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(cx - 3, cy + 1, 2.5, 5);
    } else if (pk.type === 'bubble') {
      ctx.fillStyle = '#6fc4ff';
      ctx.strokeStyle = '#3a7ab8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 5, -2.2, -1);
      ctx.stroke();
    } else if (pk.type === 'range') {
      ctx.fillStyle = '#ff8a3e';
      ctx.strokeStyle = '#a84e14';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 8);
      ctx.quadraticCurveTo(cx + 9, cy - 6, cx + 2, cy + 2);
      ctx.quadraticCurveTo(cx + 9, cy + 6, cx, cy + 8);
      ctx.quadraticCurveTo(cx - 5, cy + 4, cx - 4, cy);
      ctx.quadraticCurveTo(cx - 9, cy, cx, cy - 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffd75e';
      ctx.beginPath();
      ctx.arc(cx - 1, cy + 1, 2.6, 0, Math.PI * 2);
      ctx.fill();
    } else if (pk.type === 'speed') {
      ctx.fillStyle = '#6fe06f';
      ctx.strokeStyle = '#2f7a36';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + 2, cy - 8);
      ctx.lineTo(cx - 6, cy + 1);
      ctx.lineTo(cx - 1, cy + 1);
      ctx.lineTo(cx - 3, cy + 8);
      ctx.lineTo(cx + 6, cy - 1);
      ctx.lineTo(cx + 1, cy - 1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (pk.type === 'shield') {
      ctx.fillStyle = '#7ee8ff';
      ctx.strokeStyle = '#2f7fa8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 9);
      ctx.quadraticCurveTo(cx + 8, cy - 5, cx + 8, cy + 1);
      ctx.quadraticCurveTo(cx + 8, cy + 7, cx, cy + 9);
      ctx.quadraticCurveTo(cx - 8, cy + 7, cx - 8, cy + 1);
      ctx.quadraticCurveTo(cx - 8, cy - 5, cx, cy - 9);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (pk.type === 'equip') {
      const col = pk.item.rarityColor;
      ctx.fillStyle = '#8a6a44';
      ctx.strokeStyle = '#5a4028';
      ctx.lineWidth = 2;
      rr(ctx, cx - 7, cy - 5, 14, 11, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.fillRect(cx - 7, cy - 2, 14, 3);
      ctx.fillStyle = '#ffd75e';
      ctx.fillRect(cx - 2, cy - 5, 4, 4);
    }
    ctx.restore();
  }

  function drawPortal(ctx, pt) {
    const x = pt.x, y = pt.y, t = pt.t;
    const g = ctx.createRadialGradient(x, y, 2, x, y, 30);
    g.addColorStop(0, 'rgba(200,150,255,0.9)');
    g.addColorStop(0.6, 'rgba(120,70,200,0.5)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#241538';
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#c896ff';
    for (let i = 0; i < 3; i++) {
      const a = t * (1.4 + i * 0.5) + i * 2.1;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(x, y, 11, a, a + 1.8);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(220,180,255,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 18 + Math.sin(t * 4) * 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawParticle(ctx, pa) {
    ctx.globalAlpha = clamp(pa.life / pa.maxLife, 0, 1);
    ctx.fillStyle = pa.color;
    ctx.beginPath();
    ctx.arc(pa.x, pa.y, pa.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawFloatText(ctx, ft) {
    ctx.globalAlpha = clamp((ft.life / ft.maxLife) * 1.6, 0, 1);
    ctx.font = 'bold ' + ft.size + 'px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(20,16,32,0.85)';
    ctx.strokeText(ft.text, ft.x, ft.y);
    ctx.fillStyle = ft.color;
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.globalAlpha = 1;
  }

  /* ---------------- 导出 ---------------- */
  global.BubbleRender = { drawWorld, drawPlayer, drawCharPreview, makeTiles };
})(typeof window !== 'undefined' ? window : globalThis);
