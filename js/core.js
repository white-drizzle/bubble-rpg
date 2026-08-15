/* =============================================================
   泡泡勇者 RPG · core.js
   工具函数 / 游戏数据 / 地图与掉落生成 / 音频合成
   （浏览器与 Node 冒烟测试共用，本文件不依赖 DOM）
   ============================================================= */
(function (global) {
  'use strict';

  /* ---------------- 常量 ---------------- */
  const T = 48;                    // 格子尺寸（px）
  const COLS = 15, ROWS = 13;      // 地图格数
  const W = COLS * T;              // 画布宽 720
  const H = ROWS * T;              // 画布高 624
  const TILE = { GROUND: 0, WALL: 1, BOX: 2 };
  const CAP = { bubbles: 6, range: 8, speed: 260, level: 30, bag: 40, hp: 9999, mp: 9999 };

  /* ---------------- 小工具 ---------------- */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const dist2 = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
  const tileX = (px) => Math.floor(px / T);
  const tileY = (py) => Math.floor(py / T);
  let uid = 1;
  const nextId = () => uid++;
  const fmtTime = (s) => {
    s = Math.max(0, Math.floor(s));
    const m = Math.floor(s / 60), ss = s % 60;
    return m + ':' + String(ss).padStart(2, '0');
  };

  /* ---------------- 角色 ---------------- */
  const CLASSES = {
    warrior: {
      id: 'warrior', name: '泡泡战士', title: '坚盾与利刃', color: '#e05a4a', dark: '#9c3428', icon: '🛡️',
      desc: '身经百战的近战勇士，血厚防高，容错率极高，适合新手冒险家。',
      base: { hp: 130, mp: 60, atk: 14, def: 9, spd: 150, bubbles: 1, range: 2 },
      skill: { name: '战吼护盾', desc: '5 秒内受到的伤害降低 60%', mp: 25, cd: 15 },
    },
    mage: {
      id: 'mage', name: '泡泡法师', title: '冰霜与烈焰', color: '#4a7de0', dark: '#2c4e9c', icon: '🧙',
      desc: '天赋异禀的法师，攻击高、泡泡多、范围大，还能冰冻全场敌人。',
      base: { hp: 90, mp: 110, atk: 18, def: 5, spd: 162, bubbles: 2, range: 3 },
      skill: { name: '冰霜新星', desc: '冰冻全场敌人 3.5 秒（魔王 1.5 秒）', mp: 40, cd: 18 },
    },
    ranger: {
      id: 'ranger', name: '泡泡游侠', title: '疾风与迅影', color: '#4ac06a', dark: '#2c7a42', icon: '🏹',
      desc: '身手敏捷的游侠，速度飞快，冲刺时短暂无敌，操作上限最高。',
      base: { hp: 105, mp: 80, atk: 12, def: 6, spd: 180, bubbles: 1, range: 2 },
      skill: { name: '疾风冲刺', desc: '1.2 秒内移动速度大幅提升且无敌', mp: 20, cd: 10 },
    },
  };
  const HEAL_SKILL = { name: '治疗术', desc: '立即恢复 35% 最大生命值', mp: 30, cd: 12 };

  /* ---------------- 敌人 ---------------- */
  const ENEMIES = {
    slime:    { name: '史莱姆',   hp: 30,  atk: 8,  spd: 60,  xp: 12, coin: [4, 10],   color: '#6fd06f', radius: 16, fly: false, chase: 0.15, aggro: 3, boss: false },
    goblin:   { name: '哥布林',   hp: 55,  atk: 12, spd: 75,  xp: 22, coin: [8, 16],   color: '#58a858', radius: 16, fly: false, chase: 0.7,  aggro: 6, boss: false },
    skeleton: { name: '骷髅兵',   hp: 80,  atk: 15, spd: 70,  xp: 35, coin: [12, 20], color: '#e2e2e2', radius: 16, fly: false, chase: 0.9,  aggro: 7, boss: false },
    bat:      { name: '暗影蝠',   hp: 40,  atk: 10, spd: 110, xp: 28, coin: [8, 14],  color: '#8a5fd0', radius: 15, fly: true,  chase: 0.5,  aggro: 5, boss: false },
    boss:     { name: '暗影魔王', hp: 320, atk: 22, spd: 80,  xp: 400, coin: [300, 500], color: '#46306e', radius: 24, fly: false, chase: 0.85, aggro: 9, boss: true },
  };

  /* ---------------- 关卡 ---------------- */
  const FLOORS = [
    { name: '青草平原', theme: 'grass',  flavor: '微风拂过草原，史莱姆们在草丛间蹦蹦跳跳……', enemies: [['slime', 4]] },
    { name: '迷雾森林', theme: 'forest', flavor: '浓雾笼罩森林，哥布林的绿眼睛在暗处闪烁。',       enemies: [['slime', 2], ['goblin', 4]] },
    { name: '幽暗洞窟', theme: 'cave',   flavor: '洞穴深处传来骨头碰撞的咔嗒声，小心头顶！',       enemies: [['skeleton', 4], ['bat', 3]] },
    { name: '熔岩地牢', theme: 'lava',   flavor: '灼热的地牢中，魔物倾巢而出！',                    enemies: [['goblin', 3], ['skeleton', 3], ['bat', 3]] },
    { name: '魔王城堡', theme: 'castle', flavor: '暗影魔王在王座上等待着你，决战的时刻到了！',      enemies: [['boss', 1], ['slime', 2]] },
  ];

  const THEMES = {
    grass:  { g1: '#86cf5e', g2: '#7cc455', tuft: '#5fae3f', wall: '#8d95a3', wallHi: '#b3bac7', wallLo: '#636a78', box: '#b07f42', boxDark: '#7c5527', boxLight: '#cf9e58' },
    forest: { g1: '#4c9a53', g2: '#438c4a', tuft: '#2f6b36', wall: '#708067', wallHi: '#93a489', wallLo: '#4c5847', box: '#8a6a3c', boxDark: '#5d4524', boxLight: '#a8874f' },
    cave:   { g1: '#5c5c6a', g2: '#545462', tuft: '#43434f', wall: '#7a7a8c', wallHi: '#a0a0b4', wallLo: '#4e4e5c', box: '#7a5c3e', boxDark: '#4f3a24', boxLight: '#97764f' },
    lava:   { g1: '#7c4a3c', g2: '#71402f', tuft: '#5a3326', wall: '#4c4a55', wallHi: '#6e6c7a', wallLo: '#33323b', box: '#6f5532', boxDark: '#4a3820', boxLight: '#8d6f43' },
    castle: { g1: '#6a5c80', g2: '#5f5275', tuft: '#4d4260', wall: '#8476a8', wallHi: '#a89ac8', wallLo: '#554a72', box: '#8a6844', boxDark: '#5d4528', boxLight: '#a88754' },
  };

  function floorName(floor) {
    if (floor <= FLOORS.length) return FLOORS[floor - 1].name;
    return '无尽深渊 · 第' + (floor - FLOORS.length) + '层';
  }
  function floorTheme(floor) {
    if (floor <= FLOORS.length) return FLOORS[floor - 1].theme;
    const order = ['grass', 'forest', 'cave', 'lava', 'castle'];
    return order[(floor - 1) % order.length];
  }
  function floorFlavor(floor) {
    if (floor <= FLOORS.length) return FLOORS[floor - 1].flavor;
    return '无尽深渊中，怪物如潮水般涌来，你能坚持到第几层？';
  }
  function enemiesForFloor(floor) {
    if (floor <= FLOORS.length) {
      const list = [];
      for (const [type, n] of FLOORS[floor - 1].enemies) for (let i = 0; i < n; i++) list.push(type);
      return list;
    }
    const list = [];
    const n = Math.min(10, 3 + Math.floor(floor / 2));
    const pool = ['slime', 'goblin', 'skeleton', 'bat'];
    for (let i = 0; i < n; i++) list.push(pick(pool));
    if (floor % 5 === 0) list.unshift('boss');
    return list;
  }

  /* ---------------- 装备 ---------------- */
  const RARITIES = [
    { name: '普通', color: '#e8e8e8', mult: 1.0 },
    { name: '精良', color: '#6fe06f', mult: 1.6 },
    { name: '稀有', color: '#5fb8ff', mult: 2.4 },
    { name: '史诗', color: '#c47af0', mult: 3.5 },
    { name: '传说', color: '#ffb84a', mult: 5.0 },
  ];
  const EQ_POOL = {
    weapon:  { slot: 'weapon',  stat: 'atk',     base: 5, names: ['木剑', '铁剑', '精钢剑', '寒霜之刃', '烈焰圣剑'], specials: null },
    armor:   { slot: 'armor',   stat: 'def',     base: 3, names: ['布甲', '皮甲', '锁子甲', '骑士铠甲', '龙鳞神铠'], specials: null },
    boots:   { slot: 'boots',   stat: 'spd',     base: 6, names: ['草鞋', '皮靴', '轻便靴', '疾风之靴', '疾电神靴'], specials: null },
    trinket: { slot: 'trinket', stat: 'special', base: 1, names: null, specials: ['atk', 'def', 'hp', 'mp', 'bubbles', 'range'] },
  };
  const TRINKET_NAMES = { atk: '力量戒指', def: '守护戒指', hp: '生命护符', mp: '魔法吊坠', bubbles: '泡泡指环', range: '爆裂项链' };
  const TRINKET_BASE = { atk: 5, def: 4, hp: 20, mp: 16, bubbles: 1, range: 1 };

  function rarityWeights(floor) {
    const f = Math.max(1, floor);
    return [
      Math.max(16, 50 - f * 5),
      28,
      14 + f * 1.5,
      6.5 + f * 1.5,
      1.5 + f * 0.9,
    ];
  }
  function rollRarityIdx(floor) {
    const ws = rarityWeights(floor);
    let s = 0;
    for (const w of ws) s += w;
    let r = Math.random() * s;
    for (let i = 0; i < ws.length; i++) {
      r -= ws[i];
      if (r <= 0) return i;
    }
    return ws.length - 1;
  }
  function rollEquipment(floor) {
    const f = Math.max(1, floor);
    const type = pick(['weapon', 'armor', 'boots', 'trinket']);
    const pool = EQ_POOL[type];
    const ridx = rollRarityIdx(f);
    const rarity = RARITIES[ridx];
    let stat = pool.stat, value;
    if (type === 'trinket') {
      stat = pick(pool.specials);
      if (stat === 'bubbles' || stat === 'range') {
        value = ridx >= 3 ? 2 : 1;
      } else {
        value = Math.round(TRINKET_BASE[stat] * rarity.mult * (1 + (f - 1) * 0.10) * rand(0.85, 1.15));
      }
    } else {
      value = Math.round(pool.base * rarity.mult * (1 + (f - 1) * 0.08) * rand(0.85, 1.15));
    }
    const nameBase = type === 'trinket' ? TRINKET_NAMES[stat] : pool.names[ridx];
    return {
      id: 'eq' + nextId(),
      type, slot: pool.slot, stat, value,
      rarity: ridx, rarityName: rarity.name, rarityColor: rarity.color,
      name: rarity.name + '·' + nameBase,
    };
  }

  function statLabel(stat, value) {
    const map = {
      atk: '攻击 +' + value,
      def: '防御 +' + value,
      spd: '速度 +' + value,
      hp: '生命 +' + value,
      mp: '魔法 +' + value,
      bubbles: '泡泡上限 +' + value,
      range: '爆炸范围 +' + value,
    };
    return map[stat] || '';
  }
  function itemScore(it) {
    const w = { atk: 2, def: 2, spd: 0.5, hp: 0.6, mp: 0.5, bubbles: 60, range: 40 };
    return it.value * (w[it.stat] || 1);
  }

  function rollBoxDrop(floor) {
    const r = Math.random();
    if (r < 0.45) return null;
    if (r < 0.60) return { type: 'coin', value: randi(8, 16) + floor * 3 };
    if (r < 0.72) return { type: 'potion' };
    if (r < 0.80) return { type: 'mana' };
    if (r < 0.90) return { type: pick(['bubble', 'range', 'speed', 'shield']) };
    return { type: 'equip', item: rollEquipment(floor) };
  }
  function rollEnemyDrop(floor) {
    const r = Math.random();
    if (r < 0.55) return { type: 'coin', value: randi(6, 14) + floor * 2 };
    if (r < 0.75) return { type: 'potion' };
    if (r < 0.85) return { type: 'mana' };
    return { type: 'equip', item: rollEquipment(floor) };
  }

  /* ---------------- 地图生成（四向对称） ---------------- */
  function genMap(floor) {
    const f = Math.max(1, floor);
    const g = [];
    for (let y = 0; y < ROWS; y++) g.push(new Array(COLS).fill(TILE.GROUND));
    for (let x = 0; x < COLS; x++) { g[0][x] = TILE.WALL; g[ROWS - 1][x] = TILE.WALL; }
    for (let y = 0; y < ROWS; y++) { g[y][0] = TILE.WALL; g[y][COLS - 1] = TILE.WALL; }
    // 柱子网格（偶数坐标交叉点）：石墙或木箱
    const pillarWall = 0.60 + Math.min(0.15, f * 0.015);
    for (let y = 2; y <= ROWS - 3; y += 2) {
      for (let x = 2; x <= COLS - 3; x += 2) {
        const t = Math.random() < pillarWall ? TILE.WALL : TILE.BOX;
        g[y][x] = t;
        g[y][COLS - 1 - x] = t;
        g[ROWS - 1 - y][x] = t;
        g[ROWS - 1 - y][COLS - 1 - x] = t;
      }
    }
    // 随机木箱（保护出生点与中心）
    const safe = new Set([
      '1,1', '2,1', '1,2', '3,1', '1,3',
      '13,1', '12,1', '13,2', '11,1', '13,3',
      '1,11', '2,11', '1,10', '3,11', '1,9',
      '13,11', '12,11', '13,10', '11,11', '13,9',
      '7,6', '6,6', '8,6', '7,5', '7,7',
    ]);
    const dens = 0.14 + Math.min(0.10, f * 0.012);
    const extra = Math.floor(COLS * ROWS * dens / 4) + 4;
    for (let i = 0; i < extra; i++) {
      const x = randi(1, 7), y = randi(1, 6);
      const pts = [[x, y], [COLS - 1 - x, y], [x, ROWS - 1 - y], [COLS - 1 - x, ROWS - 1 - y]];
      let ok = true;
      for (const p of pts) {
        if (g[p[1]][p[0]] !== TILE.GROUND || safe.has(p[0] + ',' + p[1])) { ok = false; break; }
      }
      if (!ok) continue;
      for (const p of pts) g[p[1]][p[0]] = TILE.BOX;
    }
    return g;
  }

  /* ---------------- 属性 / 经验 ---------------- */
  function computeStats(charId, level, power, equipment) {
    const c = CLASSES[charId];
    const b = c.base;
    const s = {
      hp: b.hp + (level - 1) * 9,
      mp: b.mp + (level - 1) * 6,
      atk: b.atk + (level - 1) * 2,
      def: b.def + (level - 1) * 1,
      spd: b.spd + (level - 1) * 1.2 + ((power && power.speed) || 0),
      bubbles: b.bubbles + ((power && power.bubbles) || 0),
      range: b.range + ((power && power.range) || 0),
    };
    if (equipment) {
      for (const slot of ['weapon', 'armor', 'boots', 'trinket']) {
        const it = equipment[slot];
        if (!it) continue;
        if (it.stat === 'spd') s.spd += it.value;
        else if (it.stat === 'bubbles') s.bubbles += it.value;
        else if (it.stat === 'range') s.range += it.value;
        else s[it.stat] += it.value;
      }
    }
    s.bubbles = Math.min(CAP.bubbles, s.bubbles);
    s.range = Math.min(CAP.range, s.range);
    s.spd = Math.min(CAP.speed, s.spd);
    s.hp = Math.min(CAP.hp, Math.round(s.hp));
    s.mp = Math.min(CAP.mp, Math.round(s.mp));
    s.atk = Math.round(s.atk);
    s.def = Math.round(s.def);
    s.spd = Math.round(s.spd);
    return s;
  }
  function xpNeed(level) {
    return 40 + (level - 1) * 35;
  }

  /* ---------------- 音频（Web Audio 合成，无需外部文件） ---------------- */
  const NOTE = {};
  (function () {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    for (let oct = 2; oct <= 6; oct++) {
      for (let i = 0; i < names.length; i++) {
        const midi = (oct + 1) * 12 + i;
        NOTE[names[i] + oct] = 440 * Math.pow(2, (midi - 69) / 12);
      }
    }
  })();

  const TRACKS = {
    normal: {
      bpm: 138,
      lead: ['E4', 'E4', 'G4', 'G4', 'A4', 'A4', 'G4', null, 'F4', 'F4', 'E4', 'E4', 'D4', 'D4', 'E4', null, 'C4', 'C4', 'E4', 'E4', 'G4', 'G4', 'A4', null, 'G4', 'F4', 'E4', 'D4', 'C4', 'D4', 'E4', null],
      bass: ['C3', null, 'G2', null, 'A2', null, 'E3', null, 'F2', null, 'C3', null, 'G2', null, 'C3', null],
    },
    boss: {
      bpm: 156,
      lead: ['A3', 'C4', 'E4', 'E4', 'D4', 'C4', 'D4', null, 'A3', 'C4', 'E4', 'E4', 'F4', 'E4', 'D4', null, 'A3', 'B3', 'C4', 'D4', 'E4', 'D4', 'C4', null, 'B3', 'C4', 'D4', 'B3', 'G#3', 'B3', 'A3', null],
      bass: ['A2', null, 'A2', null, 'F2', null, 'F2', null, 'G2', null, 'G2', null, 'E2', null, 'E2', null],
    },
  };

  class MusicPlayer {
    constructor(ctx, dest) {
      this.ctx = ctx;
      this.dest = dest;
      this.timer = null;
      this.nextT = 0;
      this.step = 0;
      this.track = null;
    }
    play(name) {
      const t = TRACKS[name];
      if (!t) { this.stop(); return; }
      this.track = t;
      this.step = 0;
      this.nextT = this.ctx.currentTime + 0.06;
      if (!this.timer) this.timer = setInterval(() => this.schedule(), 90);
    }
    stop() {
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      this.track = null;
    }
    schedule() {
      if (!this.track || !this.ctx) return;
      const spb = 60 / this.track.bpm / 2;
      while (this.nextT < this.ctx.currentTime + 0.3) {
        const i = this.step % this.track.lead.length;
        const l = this.track.lead[i];
        if (l) this.note(NOTE[l], this.nextT, spb * 0.9, 'square', 0.045);
        const bass = this.track.bass[i % this.track.bass.length];
        if (bass) this.note(NOTE[bass], this.nextT, spb * 0.9, 'triangle', 0.075);
        this.nextT += spb;
        this.step++;
      }
    }
    note(freq, t, dur, type, vol) {
      if (!freq) return;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(this.dest);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  function playSfx(ctx, master, noiseBuf, name) {
    const t0 = ctx.currentTime;
    const beep = (freq, dur, type, vol, at, slideTo) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, t0 + (at || 0));
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + (at || 0) + dur);
      g.gain.setValueAtTime(0.0001, t0 + (at || 0));
      g.gain.linearRampToValueAtTime(vol, t0 + (at || 0) + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + (at || 0) + dur);
      o.connect(g);
      g.connect(master);
      o.start(t0 + (at || 0));
      o.stop(t0 + (at || 0) + dur + 0.05);
    };
    const noise = (dur, vol, freq, at) => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.value = freq;
      const g = ctx.createGain();
      const tt = t0 + (at || 0);
      g.gain.setValueAtTime(vol, tt);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + dur);
      src.connect(flt);
      flt.connect(g);
      g.connect(master);
      src.start(tt);
      src.stop(tt + dur + 0.05);
    };
    switch (name) {
      case 'click': beep(880, 0.05, 'square', 0.10); break;
      case 'place': beep(560, 0.12, 'sine', 0.25, 0, 240); break;
      case 'explode': noise(0.4, 0.5, 1000); beep(100, 0.3, 'sine', 0.4, 0, 40); break;
      case 'box': noise(0.18, 0.3, 700); break;
      case 'pickup': beep(660, 0.07, 'square', 0.16); beep(990, 0.11, 'square', 0.16, 0.07); break;
      case 'coin': beep(1046, 0.05, 'square', 0.14); beep(1318, 0.09, 'square', 0.14, 0.05); break;
      case 'equip': beep(523, 0.07, 'square', 0.16); beep(659, 0.07, 'square', 0.16, 0.07); beep(784, 0.07, 'square', 0.16, 0.14); beep(1046, 0.14, 'square', 0.16, 0.21); break;
      case 'hurt': beep(200, 0.18, 'sawtooth', 0.20, 0, 110); break;
      case 'die': beep(320, 0.2, 'sawtooth', 0.22); beep(220, 0.22, 'sawtooth', 0.22, 0.18); beep(140, 0.35, 'sawtooth', 0.22, 0.36, 60); break;
      case 'enemyDie': noise(0.22, 0.25, 600); beep(300, 0.22, 'square', 0.18, 0, 60); break;
      case 'levelup': [523, 659, 784, 1046, 1318].forEach((f, i) => beep(f, 0.1, 'square', 0.16, i * 0.08)); break;
      case 'portal': noise(0.55, 0.18, 2600); beep(700, 0.42, 'sine', 0.14, 0, 1400); break;
      case 'freeze': beep(1400, 0.28, 'sine', 0.18, 0, 320); break;
      case 'dash': noise(0.22, 0.18, 3200); break;
      case 'heal': beep(392, 0.13, 'sine', 0.22); beep(784, 0.18, 'sine', 0.18, 0.12); break;
      case 'shield': beep(220, 0.25, 'triangle', 0.25, 0, 440); break;
      case 'boss': beep(110, 0.5, 'sawtooth', 0.3, 0, 55); break;
      case 'victory': [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => beep(f, 0.16, 'square', 0.18, i * 0.14)); break;
    }
  }

  const audio = {
    ctx: null, master: null, muted: false, noiseBuf: null, music: null,
    ensure() {
      if (typeof window === 'undefined') return null;
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 1;
        this.master.connect(this.ctx.destination);
        const len = Math.floor(this.ctx.sampleRate * 0.8);
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.music = new MusicPlayer(this.ctx, this.master);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    setMuted(m) {
      this.muted = m;
      if (this.master) this.master.gain.value = m ? 0 : 1;
    },
    sfx(name) {
      if (this.ctx && !this.muted) playSfx(this.ctx, this.master, this.noiseBuf, name);
    },
    musicPlay(name) {
      this.ensure();
      if (this.music) this.music.play(name);
    },
    musicStop() {
      if (this.music) this.music.stop();
    },
  };

  /* ---------------- 导出 ---------------- */
  const api = {
    T, COLS, ROWS, W, H, TILE, CAP,
    clamp, rand, randi, pick, dist2, tileX, tileY, nextId, fmtTime,
    CLASSES, HEAL_SKILL, ENEMIES, FLOORS, THEMES, RARITIES, EQ_POOL, TRINKET_NAMES,
    floorName, floorTheme, floorFlavor, enemiesForFloor,
    rarityWeights, rollRarityIdx, rollEquipment, statLabel, itemScore,
    rollBoxDrop, rollEnemyDrop, genMap, computeStats, xpNeed,
    NOTE, TRACKS, audio,
  };
  global.BubbleCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
