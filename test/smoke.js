/* =============================================================
   泡泡勇者 RPG · 核心逻辑冒烟测试（Node，无需浏览器）
   运行：node test/smoke.js
   ============================================================= */
'use strict';
const assert = require('assert');
const C = require('../js/core.js');
const E = require('../js/entities.js');

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log('  \u2713 ' + name);
}
function makeWorld(over) {
  return new E.World(Object.assign({
    charId: 'warrior', level: 1, xp: 0, coins: 0, kills: 0,
    power: {}, equipment: {}, bag: [], floor: 1,
  }, over || {}));
}

console.log('== core.js ==');

ok('genMap：尺寸 / 边界 / 出生点', () => {
  for (let f = 1; f <= 8; f++) {
    const g = C.genMap(f);
    assert.strictEqual(g.length, C.ROWS);
    for (let y = 0; y < C.ROWS; y++) {
      assert.strictEqual(g[y].length, C.COLS);
      assert.strictEqual(g[y][0], C.TILE.WALL);
      assert.strictEqual(g[y][C.COLS - 1], C.TILE.WALL);
    }
    for (let x = 0; x < C.COLS; x++) {
      assert.strictEqual(g[0][x], C.TILE.WALL);
      assert.strictEqual(g[C.ROWS - 1][x], C.TILE.WALL);
    }
    assert.strictEqual(g[1][1], C.TILE.GROUND, '玩家出生点必须为空地');
    assert.strictEqual(g[1][2], C.TILE.GROUND, '出生点旁必须可通行');
    assert.strictEqual(g[2][1], C.TILE.GROUND, '出生点旁必须可通行');
  }
});

ok('genMap：四向对称', () => {
  const g = C.genMap(4);
  for (let y = 0; y < C.ROWS; y++) {
    for (let x = 0; x < C.COLS; x++) {
      assert.strictEqual(g[y][x], g[C.ROWS - 1 - y][C.COLS - 1 - x]);
    }
  }
});

ok('rollEquipment：3000 次全部合法', () => {
  for (let f = 1; f <= 12; f++) {
    for (let i = 0; i < 250; i++) {
      const it = C.rollEquipment(f);
      assert(it.name.length > 0, '装备名不能为空');
      assert(it.rarity >= 0 && it.rarity <= 4);
      assert(it.value >= 1);
      assert(['weapon', 'armor', 'boots', 'trinket'].includes(it.type));
      assert(C.statLabel(it.stat, it.value).length > 0);
      assert(C.itemScore(it) > 0);
      if (it.type !== 'trinket') assert.strictEqual(it.stat, { weapon: 'atk', armor: 'def', boots: 'spd' }[it.type]);
    }
  }
});

ok('computeStats：成长 / 装备加成 / 上限', () => {
  const a = C.computeStats('mage', 1, {}, {});
  const b = C.computeStats('mage', 10, {}, {});
  assert(b.hp > a.hp && b.atk > a.atk && b.def >= a.def);
  const cap = C.computeStats('mage', 30, { bubbles: 99, range: 99, speed: 9999 }, {});
  assert.strictEqual(cap.bubbles, C.CAP.bubbles);
  assert.strictEqual(cap.range, C.CAP.range);
  assert.strictEqual(cap.spd, C.CAP.speed);
  const eq = { weapon: { slot: 'weapon', stat: 'atk', value: 10 } };
  assert.strictEqual(C.computeStats('warrior', 1, {}, eq).atk, C.CLASSES.warrior.base.atk + 10);
});

ok('xpNeed：单调递增', () => {
  for (let l = 1; l < 30; l++) assert(C.xpNeed(l) < C.xpNeed(l + 1));
});

console.log('== entities.js ==');

ok('World：构造 / 敌人数量', () => {
  const w = makeWorld();
  assert.strictEqual(w.enemies.length, 4);
  assert.strictEqual(w.status, 'play');
});

ok('World：600 帧空闲运行不崩溃', () => {
  const w = makeWorld({ charId: 'ranger', level: 3, floor: 2 });
  for (let i = 0; i < 600; i++) w.update(1 / 60, { dx: 0, dy: 0 });
  assert.strictEqual(w.status, 'play');
});

ok('爆炸：敌人受伤 + 玩家自伤 + 泡泡消失', () => {
  const w = makeWorld();
  const p = w.player;
  const e = w.enemies[0];
  e.frozen = 99; // 防止跑出爆炸范围
  e.x = 1 * C.T + C.T / 2;
  e.y = 2 * C.T + C.T / 2;
  const before = e.hp;
  w.addBubble(1, 1, 'player');
  p.bubblesActive++;
  for (let i = 0; i < 300; i++) w.update(1 / 60, { dx: 0, dy: 0 });
  assert(e.hp < before, '敌人应被炸伤');
  assert(p.hp < p.maxHp, '玩家应被自己的爆炸波及');
  assert.strictEqual(w.bubbles.length, 0, '爆炸后泡泡应消失');
});

ok('爆炸：墙体阻挡 + 木箱摧毁停止', () => {
  const w = makeWorld();
  // 构造确定性的横向走廊（中心 (7,6) 出发）：
  //   右侧：(8,6) 空地 → (9,6) 石墙
  //   左侧：(6,6) 空地 → (5,6) 木箱 → (4,6) 空地
  w.map[6][8] = C.TILE.GROUND;
  w.map[6][9] = C.TILE.WALL;
  w.map[6][6] = C.TILE.GROUND;
  w.map[6][5] = C.TILE.BOX;
  w.map[6][4] = C.TILE.GROUND;
  const cells = E.computeExplosionCells(w, 7, 6, 8);
  const has = (x, y) => cells.some((c) => c.x === x && c.y === y);
  assert(has(7, 6) && has(8, 6), '中心与相邻格应被覆盖');
  assert(!has(9, 6), '石墙后方不应被覆盖');
  assert(has(5, 6), '木箱所在格应被覆盖');
  assert(!has(4, 6), '木箱后方不应被覆盖');
  assert.strictEqual(w.map[6][5], C.TILE.GROUND, '木箱应被摧毁');
});

ok('连锁爆炸：相邻泡泡先后引爆', () => {
  const w = makeWorld({ charId: 'mage' });
  w.addBubble(1, 1, 'player');
  w.addBubble(1, 2, 'player');
  w.player.bubblesActive += 2;
  for (let i = 0; i < 400; i++) w.update(1 / 60, { dx: 0, dy: 0 });
  assert.strictEqual(w.bubbles.length, 0, '两个泡泡都应爆炸');
});

ok('接触伤害', () => {
  const w = makeWorld();
  const p = w.player;
  const e = w.enemies[0];
  e.x = p.x; e.y = p.y; // 重叠
  const hp0 = p.hp;
  w.update(1 / 60, { dx: 0, dy: 0 });
  assert(p.hp < hp0, '玩家应受到接触伤害');
});

ok('冰冻技能：冻结所有敌人', () => {
  const w = makeWorld({ charId: 'mage' });
  w.freezeEnemies(3.5);
  assert(w.enemies.every((e) => e.frozen > 3));
  for (let i = 0; i < 60; i++) w.update(1 / 60, { dx: 0, dy: 0 });
  assert(w.enemies.every((e) => e.frozen > 2));
});

ok('升级：满级上限 / 升级回满血', () => {
  const w = makeWorld();
  const p = w.player;
  p.hp = 1;
  p.addXp(500, w);
  assert(p.level > 1, '应升级');
  assert.strictEqual(p.hp, p.maxHp, '升级应回满血');
  p.addXp(10 ** 9, w);
  assert.strictEqual(p.level, C.CAP.level, '等级不超过上限');
});

ok('装备：自动穿戴 / 换装入包 / 更差入包', () => {
  const w = makeWorld();
  const p = w.player;
  const mk = (id, value, rarity, name) => ({
    id, type: 'weapon', slot: 'weapon', stat: 'atk', value,
    rarity, rarityName: 'X', rarityColor: '#fff', name,
  });
  const it1 = mk('a', 8, 1, '精良·铁剑');
  const it2 = mk('b', 12, 2, '稀有·精钢剑');
  const it3 = mk('c', 5, 0, '普通·木剑');
  w.gainEquipment(it1, null);
  assert.strictEqual(p.equipment.weapon, it1, '第一件应直接装备');
  w.gainEquipment(it2, null);
  assert.strictEqual(p.equipment.weapon, it2, '更好的应替换');
  assert.strictEqual(p.bag.length, 1, '旧装备入包');
  w.gainEquipment(it3, null);
  assert.strictEqual(p.equipment.weapon, it2, '更差的应进包');
  assert.strictEqual(p.bag.length, 2);
});

ok('击杀全部敌人：开启传送门 / 进入后通关', () => {
  const w = makeWorld({ level: 20 });
  assert.strictEqual(w.portal, null);
  for (const e of w.enemies.slice()) w.damageEnemy(e, 99999);
  assert(w.portal, '应生成传送门');
  assert.strictEqual(w.enemies.length, 0);
  w.player.x = w.portal.x;
  w.player.y = w.portal.y;
  w.update(1 / 60, { dx: 0, dy: 0 });
  assert.strictEqual(w.status, 'clear');
  assert(w.drainEvents().some((ev) => ev.type === 'clear'));
});

ok('死亡：金币惩罚 + dead 事件', () => {
  const w = makeWorld({ coins: 100 });
  const p = w.player;
  p.coins = 100;
  p.takeHit(9999, w);
  assert.strictEqual(w.status, 'dead');
  assert.strictEqual(p.coins, 85, '应损失 15% 金币');
  assert(w.drainEvents().some((ev) => ev.type === 'dead'));
});

ok('Boss 关卡：生成魔王 + 10 秒战斗不崩溃', () => {
  const w = makeWorld({ level: 10, floor: 5 });
  assert(w.enemies.some((e) => e.boss), '应有魔王');
  for (let i = 0; i < 600; i++) w.update(1 / 60, { dx: 0, dy: 0 });
  assert(w.status === 'play' || w.status === 'dead', '状态合法');
});

ok('无尽模式：敌人生成与命名', () => {
  assert(C.enemiesForFloor(7).length >= 6);
  assert(C.enemiesForFloor(10).includes('boss'));
  assert(C.floorName(7).indexOf('无尽') >= 0);
  const w = makeWorld({ level: 5, floor: 8 });
  for (let i = 0; i < 300; i++) w.update(1 / 60, { dx: 0, dy: 0 });
  assert(w.status === 'play' || w.status === 'dead' || w.status === 'clear', '状态合法');
});

console.log('== 回归：放泡泡坐标瞬移 bug ==');

ok('放泡泡站定 0.5s 后向各方向移动：无瞬移、永不出界', () => {
  const w = makeWorld();
  const p = w.player;
  w.addBubble(1, 1, 'player');
  p.bubblesActive++;
  for (let i = 0; i < 30; i++) w.update(1 / 60, { dx: 0, dy: 0 }); // 站在自己的泡泡上不动
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
  let maxJump = 0;
  for (const d of dirs) {
    for (let i = 0; i < 120; i++) {
      const px = p.x, py = p.y;
      w.update(1 / 60, { dx: d[0], dy: d[1] });
      maxJump = Math.max(maxJump, Math.hypot(p.x - px, p.y - py));
      assert(p.x >= p.radius - 0.5 && p.x <= C.W - p.radius + 0.5, '玩家 x 出界: ' + p.x);
      assert(p.y >= p.radius - 0.5 && p.y <= C.H - p.radius + 0.5, '玩家 y 出界: ' + p.y);
      assert(w.map[C.tileY(p.y)][C.tileX(p.x)] !== C.TILE.WALL, '卡进墙里了: (' + C.tileX(p.x) + ',' + C.tileY(p.y) + ')');
    }
  }
  assert(maxJump <= 25, '出现坐标瞬移：单帧位移 ' + maxJump.toFixed(1) + 'px');
});

ok('离开泡泡格后：泡泡实心挡住自己且贴边不抖动', () => {
  const w = makeWorld({ charId: 'mage' });
  const p = w.player;
  w.addBubble(1, 1, 'player');
  p.bubblesActive++;
  for (let i = 0; i < 36; i++) w.update(1 / 60, { dx: 1, dy: 0 }); // 向右离开泡泡格
  for (let i = 0; i < 48; i++) w.update(1 / 60, { dx: -1, dy: 0 }); // 向左往回撞自己的泡泡
  const edge = 1 * C.T + C.T + (p.radius - 1); // 泡泡格 (1,1) 右边缘 + 玩家半径
  assert.strictEqual(C.tileX(p.x), 2, '应被挡在泡泡右侧，实际 x=' + p.x);
  assert(Math.abs(p.x - edge) <= 2, '应贴住泡泡边缘，实际 x=' + p.x + ' 期望 ' + edge);
});

ok('随机乱走 60 秒（含放泡泡）：坐标永不出界', () => {
  const w = makeWorld({ level: 15 });
  const p = w.player;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [0, 0]];
  for (let i = 0; i < 3600; i++) {
    const d = dirs[Math.floor(Math.random() * dirs.length)];
    w.update(1 / 60, Math.random() < 0.1 ? { dx: d[0], dy: d[1], bubble: true } : { dx: d[0], dy: d[1] });
    assert(p.x >= p.radius - 0.5 && p.x <= C.W - p.radius + 0.5, '玩家 x 出界: ' + p.x);
    assert(p.y >= p.radius - 0.5 && p.y <= C.H - p.radius + 0.5, '玩家 y 出界: ' + p.y);
    assert(w.map[C.tileY(p.y)][C.tileX(p.x)] !== C.TILE.WALL, '卡进墙里了: (' + C.tileX(p.x) + ',' + C.tileY(p.y) + ')');
    if (w.status !== 'play') break;
  }
});

console.log('== 商店 / 扭蛋机 / 复活符 ==');

ok('商店：每层随机 4 件商品，价格随层数上涨', () => {
  const w = makeWorld({ floor: 1, coins: 1000 });
  const s1 = C.genShop(1, w.player);
  const s5 = C.genShop(5, w.player);
  assert.strictEqual(s1.length, 4);
  assert.strictEqual(s5.length, 4);
  const avg = (s) => s.reduce((a, b) => a + b.price, 0) / s.length;
  assert(avg(s5) > avg(s1), '高层商店应更贵');
  for (const it of s1.concat(s5)) {
    assert(it.price >= 10 && it.name.length > 0);
    if (it.kind === 'equip') assert(it.item && it.item.name === it.name);
  }
  // 多轮生成不崩溃且种类合法
  const kinds = new Set(['equip', 'heal', 'mana', 'bubble', 'range', 'revive']);
  for (let i = 0; i < 50; i++) {
    for (const it of C.genShop(3, w.player)) assert(kinds.has(it.kind), '未知商品 ' + it.kind);
  }
});

ok('扭蛋机：费用翻倍，祝福永久生效', () => {
  const w = makeWorld();
  const p = w.player;
  assert.strictEqual(C.gachaCost(0), 30);
  assert.strictEqual(C.gachaCost(1), 60);
  assert.strictEqual(C.gachaCost(2), 120);
  assert.strictEqual(C.gachaCost(4), 480);
  const atk0 = p.atk;
  // 大量抽取必然出现属性祝福（并验证统计叠加到属性上）
  let attrHits = 0, coinBackHits = 0;
  for (let i = 0; i < 60; i++) {
    const r = C.rollGacha(p);
    assert(r.name && r.desc);
    assert(['blue', 'purple', 'gold'].includes(r.tier), '品质非法: ' + r.tier);
    if (r.coinBack) coinBackHits++;
    if (!r.coins && !r.coinBack) attrHits++;
  }
  p.recalc();
  assert(attrHits > 0, '应能抽到属性祝福');
  assert(p.atk > atk0 || p.def > C.CLASSES.warrior.base.def || p.maxHp > C.CLASSES.warrior.base.hp, '祝福应提升属性');
  assert(coinBackHits >= 0);
});

ok('扭蛋池：品质分级与传说概率', () => {
  for (const g of C.GACHA_POOL) {
    assert(['blue', 'purple', 'gold'].includes(g.tier), '扭蛋项缺品质: ' + g.name);
  }
  const gold = C.GACHA_POOL.find((g) => g.tier === 'gold');
  assert(gold && gold.name === '传说祝福', '金色应为传说祝福');
  const totalW = C.GACHA_POOL.reduce((a, b) => a + b.w, 0);
  assert(Math.abs(gold.w / totalW - 0.02) < 0.002, '金色概率应约 2%');
  // 抽到传说时返回 tier gold
  for (let i = 0; i < 4000; i++) {
    const r = C.rollGacha(makeWorld().player);
    if (r.tier === 'gold') return;
  }
  assert(false, '4000 次未抽到金色（概率异常）');
});

ok('物价：调低后符合玩家收入水平', () => {
  assert.strictEqual(C.shopPrice(15, 1), 15);
  assert.strictEqual(C.shopPrice(15, 2), 20);
  assert.strictEqual(C.shopPrice(15, 5), 25);
  assert.strictEqual(C.shopPrice(40, 1), 40);
  assert.strictEqual(C.shopPrice(80, 1), 80);
  assert.strictEqual(C.equipPrice({ rarity: 0 }, 1), 25);
  assert.strictEqual(C.equipPrice({ rarity: 4 }, 1), 350);
  assert.strictEqual(C.gachaCost(0), 30);
  // 第 1 关结算约 40 金币（已上调掉落）应能买 1 件便宜货 + 1 次扭蛋
  assert(C.shopPrice(15, 1) + C.gachaCost(0) <= 45);
});

ok('扭蛋机：满级泡泡/范围祝福转为金币补偿', () => {
  const w = makeWorld();
  const p = w.player;
  p.bonus = { bubbles: 99, range: 99 }; // 拉满触发补偿分支
  let sawComp = false;
  for (let i = 0; i < 200; i++) {
    const r = C.rollGacha(p);
    if (r.name === '补偿金币') { sawComp = true; assert.strictEqual(r.coins, 60); break; }
  }
  assert(sawComp, '满级时应出现金币补偿');
});

ok('computeStats：永久祝福叠加', () => {
  const base = C.computeStats('warrior', 1, {}, {}, {});
  const boosted = C.computeStats('warrior', 1, {}, {}, { atk: 5, def: 3, hp: 20, bubbles: 1 });
  assert.strictEqual(boosted.atk, base.atk + 5);
  assert.strictEqual(boosted.def, base.def + 3);
  assert.strictEqual(boosted.hp, base.hp + 20);
  assert.strictEqual(boosted.bubbles, Math.min(C.CAP.bubbles, base.bubbles + 1));
});

ok('复活符：死亡时原地复活且状态保持', () => {
  const w = makeWorld();
  const p = w.player;
  p.revive = 1;
  p.hp = p.maxHp;
  p.takeHit(9999, w);
  assert.strictEqual(w.status, 'play', '应复活而不是死亡');
  assert.strictEqual(p.revive, 0, '复活符应被消耗');
  assert(!p.dead);
  assert(p.hp > 0 && p.hp <= p.maxHp);
  assert(p.hp <= Math.round(p.maxHp * 0.5), '复活后应为 50% 生命');
  assert(p.invuln > 2.5, '复活后应有 3 秒无敌');
  assert(w.drainEvents().some((ev) => ev.type === 'toast'), '应有复活提示');
  // 没有复活符时正常死亡
  p.invuln = 0;
  p.takeHit(9999, w);
  assert.strictEqual(w.status, 'dead');
});

console.log('\n全部通过：' + passed + ' 项冒烟测试 \u2713');
