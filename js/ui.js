/* =============================================================
   泡泡勇者 RPG · ui.js
   界面层：状态机 / 输入（键盘+触屏）/ HUD / 存档 / 主循环
   （仅浏览器使用）
   ============================================================= */
(function () {
  'use strict';
  const C = window.BubbleCore;
  const E = window.BubbleEntities;
  const R = window.BubbleRender;
  const {
    T, COLS, ROWS, W, H, CAP,
    CLASSES, ENEMIES, FLOORS, RARITIES,
    fmtTime, floorName, statLabel, xpNeed, audio,
  } = C;
  const { World } = E;

  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const stage = $('stage');

  const SAVE_KEY = 'bubbleRpgSave.v1';

  const game = {
    state: 'menu',      // menu | char | intro | play | pause | inv | over | clear | victory
    world: null,
    charId: null,
    totalTime: 0,
    muted: false,
    helpReturn: 'menu',
  };
  const actions = { dx: 0, dy: 0, bubble: false, skill1: false, skill2: false };
  const shopState = { items: [], gachaN: 0, returnTo: 'clear' };

  /* ================= 存档 ================= */
  function saveGame() {
    const w = game.world;
    if (!w) return;
    const p = w.player;
    const data = {
      v: 1,
      charId: p.charId,
      floor: w.floor,
      level: p.level, xp: p.xp, coins: p.coins,
      kills: w.kills,
      power: p.power,
      equipment: p.equipment,
      bag: p.bag,
      bonus: p.bonus,
      revive: p.revive,
      totalTime: game.totalTime,
      ts: Date.now(),
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) { /* 隐私模式等场景忽略 */ }
  }
  function loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d || d.v !== 1 || !CLASSES[d.charId]) return null;
      return d;
    } catch (e) { return null; }
  }
  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  }
  function makeWorld(d) {
    return new World({
      charId: d.charId,
      floor: d.floor,
      level: d.level, xp: d.xp, coins: d.coins, kills: d.kills,
      power: d.power, equipment: d.equipment, bag: d.bag,
      bonus: d.bonus, revive: d.revive,
    });
  }

  /* ================= 界面切换 ================= */
  function show(id) {
    document.querySelectorAll('.overlay').forEach((o) => o.classList.add('hidden'));
    $(id).classList.remove('hidden');
  }
  function hideOverlays() {
    document.querySelectorAll('.overlay').forEach((o) => o.classList.add('hidden'));
  }
  function toast(msg) {
    const box = $('toasts');
    const div = document.createElement('div');
    div.className = 'toast';
    div.textContent = msg;
    box.appendChild(div);
    setTimeout(() => {
      div.classList.add('out');
      setTimeout(() => div.remove(), 400);
    }, 2400);
    while (box.children.length > 4) box.firstChild.remove();
  }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  /* ================= 流程 ================= */
  function toMenu() {
    audio.musicStop();
    game.state = 'menu';
    game.world = null;
    buildMenu();
    show('overlay-menu');
  }
  function toCharSelect() {
    game.state = 'char';
    buildCharSelect();
    show('overlay-char');
  }
  function startRun(charId) {
    game.charId = charId;
    game.totalTime = 0;
    game.world = makeWorld({
      charId, floor: 1, level: 1, xp: 0, coins: 0, kills: 0,
      power: { bubbles: 0, range: 0, speed: 0 }, equipment: {}, bag: [],
    });
    showFloorIntro();
  }
  function continueRun() {
    const d = loadSave();
    if (!d) { toCharSelect(); return; }
    game.charId = d.charId;
    game.totalTime = d.totalTime || 0;
    game.world = makeWorld(d);
    showFloorIntro();
  }
  function showFloorIntro() {
    const w = game.world;
    game.state = 'intro';
    audio.musicStop();
    $('intro-floor').textContent = (w.floor <= FLOORS.length ? '第 ' + w.floor + ' 关 · ' : '') + w.name;
    $('intro-flavor').textContent = w.flavor;
    $('intro-goal').textContent = w.floor === 5
      ? '目标：击败暗影魔王，净化城堡！'
      : '目标：消灭所有怪物，进入传送门！';
    const counts = {};
    for (const e of w.enemies) {
      const nm = ENEMIES[e.typeId].name;
      counts[nm] = (counts[nm] || 0) + 1;
    }
    $('intro-enemies').textContent = '出现的怪物：' +
      Object.keys(counts).map((k) => k + ' ×' + counts[k]).join('　');
    setSkillBtnIcon();
    show('overlay-intro');
  }
  function beginPlay() {
    hideOverlays();
    game.state = 'play';
    game.world.player.healFull();
    playMusic();
    updateHud();
  }
  function playMusic() {
    const w = game.world;
    const bossFloor = w.floor === 5 || (w.floor > 5 && w.floor % 5 === 0);
    audio.musicPlay(bossFloor ? 'boss' : 'normal');
  }
  function nextFloor() {
    const w = game.world;
    if (w.floor === 5) { showVictory(); return; }
    const p = w.player;
    game.world = makeWorld({
      charId: p.charId, floor: w.floor + 1,
      level: p.level, xp: p.xp, coins: p.coins, kills: w.kills,
      power: p.power, equipment: p.equipment, bag: p.bag,
      bonus: p.bonus, revive: p.revive,
    });
    saveGame();
    showFloorIntro();
  }
  function retryFloor() {
    const w = game.world;
    const p = w.player;
    game.world = makeWorld({
      charId: p.charId, floor: w.floor,
      level: p.level, xp: p.xp, coins: p.coins, kills: w.kills,
      power: p.power, equipment: p.equipment, bag: p.bag,
      bonus: p.bonus, revive: p.revive,
    });
    saveGame();
    showFloorIntro();
  }
  function enterEndless() {
    const w = game.world;
    const p = w.player;
    game.world = makeWorld({
      charId: p.charId, floor: 6,
      level: p.level, xp: p.xp, coins: p.coins, kills: w.kills,
      power: p.power, equipment: p.equipment, bag: p.bag,
      bonus: p.bonus, revive: p.revive,
    });
    saveGame();
    showFloorIntro();
  }
  function showVictory() {
    game.state = 'victory';
    audio.musicStop();
    saveGame();
    const w = game.world, p = w.player;
    $('victory-level').textContent = CLASSES[p.charId].name + ' · Lv.' + p.level;
    $('victory-kills').textContent = w.kills;
    $('victory-time').textContent = fmtTime(game.totalTime);
    $('victory-coins').textContent = p.coins;
    show('overlay-victory');
  }
  function showGameOver() {
    game.state = 'over';
    audio.musicStop();
    $('over-kills').textContent = game.world.floorKills;
    show('overlay-over');
  }

  /* ================= 商店 / 神秘商人 / 塔罗牌 ================= */
  const MERCHANT_LINES = [
    '呵呵，又见面了……要看看今天的好货吗？',
    '翻开卡片吧，命运在等待着你。',
    '想试试命运的力量吗？每抽一次，价格翻倍哦……',
    '金币是好东西，但祝福更珍贵，不是吗？',
    '你的手气如何？老夫也很好奇。',
  ];
  function openShop(from, clearData) {
    if (!game.world) return;
    game.state = 'shop';
    audio.musicStop();
    shopState.returnTo = from || 'clear';
    shopState.lastClear = clearData || null;
    shopState.items = C.genShop(game.world.floor, game.world.player);
    shopState.gachaN = 0;
    $('gacha-result').innerHTML = '';
    $('merchant-bubble').textContent = C.pick(MERCHANT_LINES);
    buildShop();
    show('overlay-shop');
  }
  function closeShop() {
    if (game.state !== 'shop' || shopState.returnTo !== 'victory') return;
    game.state = 'victory';
    show('overlay-victory');
  }
  function buildShop() {
    const w = game.world, p = w.player;
    $('shop-floor').textContent = (w.floor <= FLOORS.length ? '第 ' + w.floor + ' 关 · ' : '') + w.name + '（物价随层数上涨）';
    $('shop-coins').textContent = p.coins;
    // 通关统计（通关直开商店时显示）
    const statsEl = $('shop-stats');
    if (shopState.lastClear) {
      statsEl.classList.remove('hidden');
      $('shop-stats-time').textContent = fmtTime(shopState.lastClear.time);
      $('shop-stats-kills').textContent = shopState.lastClear.kills;
      $('shop-stats-coins').textContent = '+' + shopState.lastClear.bonusCoins;
      $('shop-stats-xp').textContent = '+' + shopState.lastClear.bonusXp;
    } else {
      statsEl.classList.add('hidden');
    }
    // 返回按钮仅在胜利后逛商店时显示
    $('btn-shop-back').classList.toggle('hidden', shopState.returnTo !== 'victory');
    // 翻牌商品
    const box = $('shop-items');
    box.innerHTML = '';
    shopState.items.forEach((it, i) => {
      const card = document.createElement('div');
      card.className = 'shop-card' + (it.flipped ? ' flipped' : '') + (it.sold || it.maxed ? ' sold' : '');
      card.innerHTML =
        '<div class="shop-card-inner">' +
          '<div class="shop-card-face shop-card-cover">' +
            '<div class="card-mark">?</div>' +
            '<div class="card-hint">点击翻开</div>' +
          '</div>' +
          '<div class="shop-card-face shop-card-front">' +
            '<div class="shop-item-name" style="color:' + (it.color || '#ffd75e') + '">' + it.name + '</div>' +
            '<div class="shop-item-desc">' + it.desc + '</div>' +
            '<button class="btn shop-buy">🪙 ' + it.price + '</button>' +
          '</div>' +
        '</div>';
      card.onclick = () => {
        if (!it.flipped) { it.flipped = true; card.classList.add('flipped'); audio.sfx('click'); }
      };
      const btn = card.querySelector('.shop-buy');
      if (it.sold) btn.textContent = '✓ 已售出';
      else if (it.maxed) btn.textContent = '已满';
      else btn.onclick = (ev) => { ev.stopPropagation(); audio.sfx('click'); buyItem(i); };
      box.appendChild(card);
    });
    // 神秘商人
    const cost = C.gachaCost(shopState.gachaN);
    $('gacha-cost').textContent = cost;
    $('gacha-times').textContent = '已抽 ' + shopState.gachaN + ' 次';
    const gbtn = $('btn-gacha');
    gbtn.textContent = '🔮 请教神秘商人（🪙 ' + cost + '）';
    gbtn.disabled = p.coins < cost;
    gbtn.onclick = doGacha;
  }
  function buyItem(i) {
    const w = game.world, p = w.player;
    const it = shopState.items[i];
    if (!it || it.sold) return;
    if (p.coins < it.price) { toast('金币不足！'); return; }
    p.coins -= it.price;
    it.sold = true;
    switch (it.kind) {
      case 'equip': w.gainEquipment(it.item, null); break;
      case 'heal': p.hp = p.maxHp; toast('生命已回满！'); audio.sfx('heal'); break;
      case 'mana': p.mp = p.maxMp; toast('魔法已回满！'); audio.sfx('heal'); break;
      case 'bubble': p.power.bubbles++; p.recalc(); toast('泡泡上限 +1（永久）！'); break;
      case 'range': p.power.range++; p.recalc(); toast('爆炸范围 +1（永久）！'); break;
      case 'revive': p.revive = Math.min(1, p.revive + 1); toast('获得复活符 ×1！死亡时将原地复活'); audio.sfx('equip'); break;
    }
    saveGame();
    buildShop();
  }
  function doGacha() {
    const w = game.world, p = w.player;
    const cost = C.gachaCost(shopState.gachaN);
    if (p.coins < cost) { toast('金币不足！'); return; }
    p.coins -= cost;
    const res = C.rollGacha(p);
    if (res.coins) p.coins += res.coins;
    if (res.coinBack) p.coins += Math.ceil(cost / 2);
    p.recalc();
    saveGame();
    shopState.gachaN++;
    $('gacha-result').innerHTML =
      '<span class="gacha-glow">' + res.name + '！</span> ' + res.desc;
    openTarot(res);
  }
  /* ----- 塔罗牌抽卡动画 ----- */
  let tarotTimers = [];
  function openTarot(res) {
    if (game.state !== 'shop') return;
    game.state = 'tarot';
    tarotTimers.forEach(clearTimeout);
    tarotTimers = [];
    const tier = res.tier || 'blue';
    const extra = res.coins ? '（补偿 🪙 ' + res.coins + '）' : (res.coinBack ? '（返还 🪙 ' + Math.ceil(C.gachaCost(shopState.gachaN - 1) / 2) + '）' : '');
    const cardEl = $('tarot-card');
    cardEl.classList.remove('flipped', 'tier-blue', 'tier-purple', 'tier-gold', 'fly-in');
    $('tarot-rays').classList.remove('show');
    $('tarot-legend').classList.remove('show');
    $('btn-tarot-accept').classList.add('hidden');
    $('tarot-particles').innerHTML = '';
    $('tarot-name').textContent = res.name;
    $('tarot-desc').textContent = res.desc + extra;
    show('overlay-tarot');
    void cardEl.offsetWidth; // 强制 reflow 重启动画
    cardEl.classList.add('fly-in');
    tarotTimers.push(setTimeout(() => {
      cardEl.classList.add('flipped', 'tier-' + tier);
      audio.sfx('equip');
      if (tier === 'gold') {
        tarotTimers.push(setTimeout(() => {
          $('tarot-rays').classList.add('show');
          $('tarot-legend').classList.add('show');
          spawnGoldParticles();
          audio.sfx('levelup');
        }, 550));
        tarotTimers.push(setTimeout(() => {
          $('btn-tarot-accept').classList.remove('hidden');
        }, 1800));
      } else {
        tarotTimers.push(setTimeout(() => {
          $('btn-tarot-accept').classList.remove('hidden');
        }, 1200));
      }
    }, 650));
  }
  function spawnGoldParticles() {
    const box = $('tarot-particles');
    box.innerHTML = '';
    for (let i = 0; i < 26; i++) {
      const s = document.createElement('i');
      s.style.left = (Math.random() * 100) + '%';
      s.style.top = (Math.random() * 100) + '%';
      s.style.setProperty('--gx', (Math.random() * 480 - 240) + 'px');
      s.style.setProperty('--gy', (-60 - Math.random() * 260) + 'px');
      s.style.animationDelay = (Math.random() * 1.2) + 's';
      s.style.animationDuration = (1.4 + Math.random() * 1.4) + 's';
      box.appendChild(s);
    }
  }
  function closeTarot() {
    if (game.state !== 'tarot') return;
    tarotTimers.forEach(clearTimeout);
    tarotTimers = [];
    game.state = 'shop';
    buildShop();
    show('overlay-shop');
  }
  function shopNext() {
    if (game.state !== 'shop') return;
    audio.sfx('click');
    const w = game.world;
    if (w.floor === 5) enterEndless();
    else nextFloor();
  }
  function openPause() {
    if (game.state !== 'play') return;
    game.state = 'pause';
    audio.musicStop();
    $('pause-floor').textContent = game.world.name;
    show('overlay-pause');
  }
  function resumeGame() {
    hideOverlays();
    game.state = 'play';
    playMusic();
  }
  function toggleMute() {
    game.muted = !game.muted;
    audio.setMuted(game.muted);
    document.querySelectorAll('.sound-label').forEach((el) => {
      el.textContent = game.muted ? '音效：关' : '音效：开';
    });
    document.querySelectorAll('.sound-icon').forEach((el) => {
      el.textContent = game.muted ? '🔇' : '🔊';
    });
    audio.sfx('click');
  }
  function showHelp(from) {
    game.helpReturn = from;
    show('overlay-help');
  }
  function closeHelp() {
    show(game.helpReturn === 'pause' ? 'overlay-pause' : 'overlay-menu');
  }
  function setSkillBtnIcon() {
    const icons = { warrior: '🛡️', mage: '❄️', ranger: '💨' };
    $('btn-touch-skill2').textContent = icons[game.charId] || '✨';
  }

  /* ================= 事件处理 ================= */
  function handleEvents() {
    const w = game.world;
    if (!w) return;
    const evs = w.drainEvents();
    for (const ev of evs) {
      if (ev.type === 'toast') toast(ev.data);
      else if (ev.type === 'clear') { saveGame(); openShop('clear', ev.data); }
      else if (ev.type === 'dead') { saveGame(); showGameOver(); }
    }
  }

  /* ================= HUD ================= */
  function updateHud() {
    const w = game.world;
    if (!w) return;
    const p = w.player;
    const c = CLASSES[p.charId];
    $('hud-level').textContent = 'Lv.' + p.level;
    $('hud-class').textContent = c.name;
    $('hud-hp-bar').style.width = (p.hp / p.maxHp * 100).toFixed(1) + '%';
    $('hud-hp-text').textContent = Math.ceil(p.hp) + ' / ' + p.maxHp;
    $('hud-mp-bar').style.width = (p.mp / p.maxMp * 100).toFixed(1) + '%';
    $('hud-mp-text').textContent = Math.floor(p.mp) + ' / ' + p.maxMp;
    const need = xpNeed(p.level);
    $('hud-xp-bar').style.width = (p.xp / need * 100).toFixed(1) + '%';
    $('hud-xp-text').textContent = p.xp + ' / ' + need;
    $('hud-floor').textContent = (w.floor <= FLOORS.length ? '第 ' + w.floor + ' 关 · ' : '') + w.name;
    $('hud-coins').textContent = '🪙 ' + p.coins;
    $('hud-kills').textContent = '⚔ ' + w.kills;
    const bb = $('hud-bubbles');
    bb.innerHTML = '';
    for (let i = 0; i < p.maxBubbles; i++) {
      const d = document.createElement('span');
      d.className = 'bub-dot' + (i < p.bubblesActive ? ' on' : '');
      bb.appendChild(d);
    }
    const sk1 = p.skill1();
    const sk2 = p.skill;
    $('skill1-cd').style.height = (clamp01(p.skill1Cd / sk1.cd) * 100) + '%';
    $('skill2-cd').style.height = (clamp01(p.skill2Cd / sk2.cd) * 100) + '%';
    $('skill1-name').textContent = sk1.name + '（' + sk1.mp + ' 魔法）';
    $('skill2-name').textContent = sk2.name + '（' + sk2.mp + ' 魔法）';
  }

  /* ================= 背包 ================= */
  function openInventory() {
    if (game.state !== 'play') return;
    game.state = 'inv';
    buildInventory();
    show('overlay-inventory');
  }
  function closeInventory() {
    if (game.state === 'inv') {
      game.state = 'play';
      hideOverlays();
      updateHud();
    }
  }
  function buildInventory() {
    const p = game.world.player;
    $('inv-title').textContent = CLASSES[p.charId].name + ' · Lv.' + p.level;
    $('inv-hp').textContent = Math.ceil(p.hp) + ' / ' + p.maxHp;
    $('inv-mp').textContent = Math.floor(p.mp) + ' / ' + p.maxMp;
    $('inv-atk').textContent = p.atk;
    $('inv-def').textContent = p.def;
    $('inv-spd').textContent = p.spd;
    $('inv-bubbles').textContent = p.maxBubbles;
    $('inv-range').textContent = p.range;
    $('inv-coins').textContent = p.coins;
    $('inv-revive').textContent = p.revive > 0 ? '×' + p.revive : '无';
    $('inv-bonus').textContent = (p.bonus && Object.keys(p.bonus).length)
      ? Object.keys(p.bonus).map((k) => ({ atk: '攻击', def: '防御', hp: '生命', mp: '魔法', spd: '速度', bubbles: '泡泡', range: '范围' }[k] || k) + '+' + p.bonus[k]).join('　')
      : '无（商店扭蛋机可获得）';
    const slotNames = { weapon: '武器', armor: '护甲', boots: '靴子', trinket: '饰品' };
    const eqBox = $('inv-equipped');
    eqBox.innerHTML = '';
    for (const s of ['weapon', 'armor', 'boots', 'trinket']) {
      const it = p.equipment[s];
      const div = document.createElement('div');
      div.className = 'inv-slot' + (it ? ' clickable' : '');
      if (it) {
        div.innerHTML =
          '<span class="slot-name">' + slotNames[s] + '</span>' +
          '<span class="item-name" style="color:' + it.rarityColor + '">' + it.name + '</span>' +
          '<span class="item-stat">' + statLabel(it.stat, it.value) + '</span>';
        div.title = '点击卸下';
        div.onclick = () => unequipItem(s);
      } else {
        div.innerHTML =
          '<span class="slot-name">' + slotNames[s] + '</span>' +
          '<span class="item-name dim">（空）</span>';
      }
      eqBox.appendChild(div);
    }
    const bagBox = $('inv-bag');
    bagBox.innerHTML = '';
    if (!p.bag.length) {
      bagBox.innerHTML = '<div class="bag-empty">背包空空如也～<br>打碎木箱、击败怪物可获得装备！</div>';
    } else {
      p.bag.forEach((it, i) => {
        const div = document.createElement('div');
        div.className = 'inv-slot';
        div.innerHTML =
          '<span class="item-name" style="color:' + it.rarityColor + '">' + it.name + '</span>' +
          '<span class="item-stat">' + statLabel(it.stat, it.value) + '</span>' +
          '<button class="mini-btn">装备</button>' +
          '<button class="mini-btn danger">丢弃</button>';
        div.querySelectorAll('button')[0].onclick = (ev) => { ev.stopPropagation(); equipFromBag(i); };
        div.querySelectorAll('button')[1].onclick = (ev) => { ev.stopPropagation(); discardFromBag(i); };
        bagBox.appendChild(div);
      });
    }
  }
  function equipFromBag(i) {
    const p = game.world.player;
    const it = p.bag[i];
    if (!it) return;
    p.bag.splice(i, 1);
    const old = p.equipment[it.slot];
    p.equipment[it.slot] = it;
    if (old) p.bag.push(old);
    p.recalc();
    audio.sfx('equip');
    toast('已装备 ' + it.name);
    buildInventory();
    updateHud();
  }
  function unequipItem(slot) {
    const p = game.world.player;
    const it = p.equipment[slot];
    if (!it) return;
    if (p.bag.length >= CAP.bag) { toast('背包已满，无法卸下！'); return; }
    delete p.equipment[slot];
    p.bag.push(it);
    p.recalc();
    audio.sfx('click');
    buildInventory();
    updateHud();
  }
  function discardFromBag(i) {
    const p = game.world.player;
    const it = p.bag.splice(i, 1)[0];
    toast('丢弃了 ' + it.name);
    audio.sfx('click');
    buildInventory();
    updateHud();
  }

  /* ================= 菜单 / 选人 ================= */
  function buildMenu() {
    const d = loadSave();
    const btnC = $('menu-continue');
    const info = $('menu-continue-info');
    if (d) {
      btnC.classList.remove('hidden');
      info.classList.remove('hidden');
      info.textContent = '进度：' + CLASSES[d.charId].name + ' · Lv.' + d.level + ' · ' + floorName(d.floor);
    } else {
      btnC.classList.add('hidden');
      info.classList.add('hidden');
    }
  }
  let selIdx = 0;
  let previews = [];
  function buildCharSelect() {
    const box = $('char-cards');
    box.innerHTML = '';
    previews = [];
    const ids = Object.keys(CLASSES);
    ids.forEach((id, i) => {
      const c = CLASSES[id];
      const card = document.createElement('div');
      card.className = 'char-card' + (i === selIdx ? ' selected' : '');
      card.innerHTML =
        '<canvas class="char-art" width="96" height="96"></canvas>' +
        '<div class="char-name">' + c.icon + ' ' + c.name + '</div>' +
        '<div class="char-title">' + c.title + '</div>' +
        '<div class="char-desc">' + c.desc + '</div>' +
        '<div class="char-stats">生命 ' + c.base.hp + ' · 攻击 ' + c.base.atk +
        ' · 防御 ' + c.base.def + ' · 速度 ' + c.base.spd + '</div>' +
        '<div class="char-skill">技能「' + c.skill.name + '」：' + c.skill.desc + '</div>';
      card.onclick = () => { selIdx = i; selectChar(i); };
      box.appendChild(card);
      previews.push({ canvas: card.querySelector('canvas'), charId: id });
    });
  }
  function selectChar(i) {
    selIdx = i;
    document.querySelectorAll('.char-card').forEach((el, j) => el.classList.toggle('selected', j === i));
    audio.sfx('click');
  }
  function confirmChar() {
    audio.sfx('click');
    startRun(Object.keys(CLASSES)[selIdx]);
  }
  function drawPreviews(t) {
    for (const pv of previews) {
      const c = pv.canvas;
      const g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      g.save();
      g.translate(c.width / 2, c.height / 2);
      g.scale(2, 2);
      g.translate(-c.width / 2, -c.height / 2);
      R.drawCharPreview(g, pv.charId, c.width, c.height, t);
      g.restore();
    }
  }

  /* ================= 输入 ================= */
  const keys = new Set();
  const joy = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
  function collectInput() {
    actions.dx = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) -
                 (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0);
    actions.dy = (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0) -
                 (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0);
    if (joy.active) {
      const l = Math.hypot(joy.dx, joy.dy);
      if (l < 6) {
        actions.dx = 0; actions.dy = 0;
      } else {
        actions.dx = joy.dx / 16;
        actions.dy = joy.dy / 16;
        const m = Math.hypot(actions.dx, actions.dy);
        if (m > 1) { actions.dx /= m; actions.dy /= m; }
      }
    }
  }
  function pressAction(name) {
    if (game.state === 'play' && game.world) {
      if (name === 'bubble') actions.bubble = true;
      else if (name === 'skill1') actions.skill1 = true;
      else if (name === 'skill2') actions.skill2 = true;
    }
  }

  document.addEventListener('keydown', (e) => {
    audio.ensure();
    if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    const st = game.state;
    if (st === 'play') {
      if (e.code === 'Space') pressAction('bubble');
      else if (e.code === 'Digit1') pressAction('skill1');
      else if (e.code === 'Digit2') pressAction('skill2');
      else if (e.code === 'KeyI') openInventory();
      else if (e.code === 'Escape' || e.code === 'KeyP') openPause();
      else if (e.code === 'KeyM') toggleMute();
    } else if (st === 'intro') {
      if (e.code === 'Space' || e.code === 'Enter') beginPlay();
      else if (e.code === 'Escape') toMenu();
    } else if (st === 'pause') {
      if (e.code === 'Escape' || e.code === 'KeyP') resumeGame();
    } else if (st === 'inv') {
      if (e.code === 'Escape' || e.code === 'KeyI') closeInventory();
    } else if (st === 'shop') {
      if (e.code === 'Enter') shopNext();
      else if (e.code === 'Escape') closeShop();
    } else if (st === 'tarot') {
      if (e.code === 'Enter' || e.code === 'Escape' || e.code === 'Space') closeTarot();
    } else if (st === 'over') {
      if (e.code === 'Enter') retryFloor();
      else if (e.code === 'Escape') toMenu();
    } else if (st === 'victory') {
      if (e.code === 'Enter') enterEndless();
      else if (e.code === 'Escape') toMenu();
      else if (e.code === 'KeyB') openShop('victory');
    } else if (st === 'char') {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { selIdx = (selIdx + 2) % 3; selectChar(selIdx); }
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') { selIdx = (selIdx + 1) % 3; selectChar(selIdx); }
      else if (e.code === 'Enter' || e.code === 'Space') confirmChar();
      else if (e.code === 'Escape') toMenu();
    } else if (st === 'menu') {
      if (e.code === 'Enter') {
        if (loadSave()) continueRun();
        else toCharSelect();
      }
    }
  });
  document.addEventListener('keyup', (e) => { keys.delete(e.code); });
  document.addEventListener('pointerdown', () => audio.ensure(), { once: true });

  /* ================= 触屏 ================= */
  function setupTouch() {
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!isTouch) return;
    document.body.classList.add('touch-device');
    const base = $('joy-base'), knob = $('joy-knob');
    base.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const tch = e.changedTouches[0];
      joy.active = true;
      joy.id = tch.identifier;
      joy.ox = tch.clientX;
      joy.oy = tch.clientY;
      joy.dx = 0; joy.dy = 0;
      knob.style.transform = 'translate(-50%, -50%)';
      base.classList.add('active');
    }, { passive: false });
    window.addEventListener('touchmove', (e) => {
      if (!joy.active) return;
      for (const tch of e.changedTouches) {
        if (tch.identifier !== joy.id) continue;
        e.preventDefault();
        let dx = tch.clientX - joy.ox, dy = tch.clientY - joy.oy;
        const l = Math.hypot(dx, dy);
        const max = 44;
        if (l > max) { dx = dx / l * max; dy = dy / l * max; }
        joy.dx = dx; joy.dy = dy;
        knob.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))';
      }
    }, { passive: false });
    const endJoy = (e) => {
      for (const tch of e.changedTouches) {
        if (tch.identifier === joy.id) {
          joy.active = false;
          joy.id = null;
          joy.dx = 0; joy.dy = 0;
          knob.style.transform = 'translate(-50%, -50%)';
          base.classList.remove('active');
        }
      }
    };
    window.addEventListener('touchend', endJoy);
    window.addEventListener('touchcancel', endJoy);
    const bindBtn = (id, name) => {
      const el = $(id);
      el.addEventListener('touchstart', (e) => {
        e.preventDefault();
        audio.ensure();
        pressAction(name);
        el.classList.add('active');
      }, { passive: false });
      const up = () => el.classList.remove('active');
      el.addEventListener('touchend', up);
      el.addEventListener('touchcancel', up);
    };
    bindBtn('btn-touch-bubble', 'bubble');
    bindBtn('btn-touch-skill1', 'skill1');
    bindBtn('btn-touch-skill2', 'skill2');
  }

  /* ================= 适配缩放 ================= */
  function fitStage() {
    const s = Math.min(
      (window.innerWidth - 12) / (W + 16),
      (window.innerHeight - 12) / stage.offsetHeight
    );
    stage.style.transform = 'translate(-50%, -50%) scale(' + Math.min(1, s) + ')';
  }
  window.addEventListener('resize', fitStage);

  /* ================= 主循环 ================= */
  let lastT = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - lastT) / 1000 || 0);
    lastT = now;
    const t = now / 1000;
    if (game.state === 'play' && game.world) {
      game.totalTime += dt;
      collectInput();
      game.world.update(dt, actions);
      actions.bubble = actions.skill1 = actions.skill2 = false;
      handleEvents();
      updateHud();
    }
    if (game.world) {
      ctx.clearRect(0, 0, W, H);
      R.drawWorld(ctx, game.world, t);
    }
    if (game.state === 'char') drawPreviews(t);
  }

  /* ================= 按钮绑定 ================= */
  function bindButtons() {
    $('menu-new').onclick = () => { audio.sfx('click'); toCharSelect(); };
    $('menu-continue').onclick = () => { audio.sfx('click'); continueRun(); };
    $('menu-help').onclick = () => { audio.sfx('click'); showHelp('menu'); };
    $('btn-char-back').onclick = () => { audio.sfx('click'); toMenu(); };
    $('btn-char-confirm').onclick = confirmChar;
    $('btn-intro-start').onclick = beginPlay;
    $('btn-pause-resume').onclick = resumeGame;
    $('btn-pause-restart').onclick = () => { audio.sfx('click'); retryFloor(); };
    $('btn-pause-save').onclick = () => { audio.sfx('click'); saveGame(); toMenu(); };
    $('btn-pause-help').onclick = () => { audio.sfx('click'); showHelp('pause'); };
    $('btn-over-retry').onclick = () => { audio.sfx('click'); retryFloor(); };
    $('btn-over-menu').onclick = () => { audio.sfx('click'); toMenu(); };
    $('btn-victory-endless').onclick = () => { audio.sfx('click'); enterEndless(); };
    $('btn-victory-menu').onclick = () => { audio.sfx('click'); saveGame(); toMenu(); };
    $('btn-victory-shop').onclick = () => { audio.sfx('click'); openShop('victory'); };
    $('btn-shop-next').onclick = shopNext;
    $('btn-shop-back').onclick = closeShop;
    $('btn-tarot-accept').onclick = closeTarot;
    $('btn-inv-close').onclick = closeInventory;
    $('btn-help-back').onclick = () => { audio.sfx('click'); closeHelp(); };
    $('btn-hud-inv').onclick = () => { audio.sfx('click'); openInventory(); };
    $('btn-hud-pause').onclick = () => { audio.sfx('click'); openPause(); };
    document.querySelectorAll('.sound-btn, #btn-hud-sound').forEach((el) => {
      el.onclick = () => toggleMute();
    });
  }

  /* ================= 启动 ================= */
  function boot() {
    setupTouch();
    bindButtons();
    buildMenu();
    show('overlay-menu');
    fitStage();
    requestAnimationFrame(loop);
  }
  document.addEventListener('DOMContentLoaded', boot);

  // 调试钩子（浏览器控制台可用，方便测试与排查）
  window.__bubbleDebug = {
    get game() { return game; },
    get shopState() { return shopState; },
    openShop, closeShop, buyItem, doGacha, buildShop,
    openTarot, closeTarot,
  };
})();
