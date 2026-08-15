/* =============================================================
   泡泡勇者 RPG · entities.js
   实体系统：玩家 / 敌人 AI / 泡泡 / 爆炸 / 道具 / 传送门 / 世界
   （同样不依赖 DOM，可被 Node 冒烟测试直接调用）
   ============================================================= */
(function (global) {
  'use strict';
  const C = (typeof window !== 'undefined' && window.BubbleCore) ? window.BubbleCore : require('./core.js');
  const {
    T, COLS, ROWS, W, H, TILE, CAP,
    clamp, rand, randi, pick, dist2, tileX, tileY, nextId,
    CLASSES, HEAL_SKILL, ENEMIES,
    genMap, enemiesForFloor, floorName, floorTheme, floorFlavor,
    rollBoxDrop, rollEnemyDrop, rollEquipment, computeStats, xpNeed, itemScore,
    audio,
  } = C;

  /* ================= 玩家 ================= */
  class Player {
    constructor(opts) {
      this.charId = opts.charId;
      this.level = opts.level || 1;
      this.xp = opts.xp || 0;
      this.coins = opts.coins || 0;
      this.power = Object.assign({ bubbles: 0, range: 0, speed: 0 }, opts.power);
      this.equipment = opts.equipment || {};
      this.bag = opts.bag || [];
      this.radius = 15;
      this.x = 0; this.y = 0;
      this.facing = { x: 0, y: 1 };
      this.hp = 1; this.mp = 1;
      this.bubblesActive = 0;
      this.invuln = 0; this.shieldT = 0; this.dashT = 0;
      this.skill1Cd = 0; this.skill2Cd = 0;
      this.dead = false; this.moving = false;
      this.walkT = 0;
      this.recalc();
      this.hp = this.maxHp;
      this.mp = this.maxMp;
    }
    recalc() {
      const s = computeStats(this.charId, this.level, this.power, this.equipment);
      this.maxHp = s.hp; this.maxMp = s.mp;
      this.atk = s.atk; this.def = s.def;
      this.spd = s.spd; this.maxBubbles = s.bubbles; this.range = s.range;
      this.hp = Math.min(this.hp, this.maxHp);
      this.mp = Math.min(this.mp, this.maxMp);
    }
    get skill() { return CLASSES[this.charId].skill; }
    skill1() { return HEAL_SKILL; }
    healFull() { this.hp = this.maxHp; this.mp = this.maxMp; }

    update(dt, world, actions) {
      if (this.dead) return;
      actions = actions || {};
      // 兜底：任何情况下都不允许被推出地图
      this.x = clamp(this.x, this.radius, W - this.radius);
      this.y = clamp(this.y, this.radius, H - this.radius);
      this.invuln -= dt; this.shieldT -= dt; this.dashT -= dt;
      this.skill1Cd -= dt; this.skill2Cd -= dt;
      this.mp = Math.min(this.maxMp, this.mp + 2.5 * dt);

      let dx = actions.dx || 0, dy = actions.dy || 0;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      this.moving = len > 0.01;
      if (this.moving) { this.facing = { x: dx, y: dy }; this.walkT += dt; }
      let spd = this.spd;
      if (this.dashT > 0) spd *= 2.2;
      if (this.moving) world.moveEntity(this, dx * spd * dt, dy * spd * dt);

      if (actions.bubble) this.tryPlaceBubble(world);
      if (actions.skill1) this.useSkill1(world);
      if (actions.skill2) this.useSkill2(world);

      // 传送门
      if (world.portal && dist2(this.x, this.y, world.portal.x, world.portal.y) < 22) world.levelClear();
      // 拾取
      for (const pk of world.pickups) {
        if (pk.dead) continue;
        if (dist2(this.x, this.y, pk.x, pk.y) < this.radius + pk.radius - 2) world.collectPickup(pk);
      }
    }

    tryPlaceBubble(world) {
      if (this.bubblesActive >= this.maxBubbles) return;
      const tx = tileX(this.x), ty = tileY(this.y);
      if (world.map[ty][tx] !== TILE.GROUND) return;
      if (world.bubbleAt(tx, ty)) return;
      world.addBubble(tx, ty, 'player');
      this.bubblesActive++;
      audio.sfx('place');
    }

    useSkill1(world) {
      const sk = HEAL_SKILL;
      if (this.skill1Cd > 0) return;
      if (this.mp < sk.mp) { world.event('toast', '魔法值不足！'); return; }
      this.mp -= sk.mp;
      this.skill1Cd = sk.cd;
      const heal = Math.round(this.maxHp * 0.35);
      this.hp = Math.min(this.maxHp, this.hp + heal);
      world.floatText(this.x, this.y - 24, '+' + heal, '#5fff8a');
      world.spawnRing(this.x, this.y, '#5fff8a');
      audio.sfx('heal');
    }

    useSkill2(world) {
      const sk = this.skill;
      if (this.skill2Cd > 0) return;
      if (this.mp < sk.mp) { world.event('toast', '魔法值不足！'); return; }
      this.mp -= sk.mp;
      this.skill2Cd = sk.cd;
      if (this.charId === 'warrior') {
        this.shieldT = 5;
        world.floatText(this.x, this.y - 24, '战吼护盾！', '#ffd75e');
        audio.sfx('shield');
      } else if (this.charId === 'mage') {
        world.freezeEnemies(3.5);
        world.floatText(this.x, this.y - 24, '冰霜新星！', '#7ed0ff');
        audio.sfx('freeze');
      } else {
        this.dashT = 1.2;
        this.invuln = Math.max(this.invuln, 1.2);
        world.floatText(this.x, this.y - 24, '疾风冲刺！', '#8affa0');
        audio.sfx('dash');
      }
    }

    takeHit(raw, world) {
      if (this.dead || this.invuln > 0) return;
      let dmg = Math.max(1, raw - this.def);
      if (this.shieldT > 0) dmg = Math.max(1, Math.round(dmg * 0.4));
      this.hp -= dmg;
      this.invuln = 0.5;
      world.floatText(this.x, this.y - 26, '-' + dmg, '#ff6a5e');
      world.spawnHurtParticles(this.x, this.y);
      audio.sfx('hurt');
      world.shake = Math.min(8, world.shake + 3);
      if (this.hp <= 0) {
        this.hp = 0;
        world.onPlayerDeath();
      }
    }

    addXp(n, world) {
      this.xp += n;
      while (this.level < CAP.level && this.xp >= xpNeed(this.level)) {
        this.xp -= xpNeed(this.level);
        this.level++;
        this.recalc();
        this.hp = this.maxHp;
        this.mp = this.maxMp;
        world.event('toast', '升级！达到 Lv.' + this.level + '，全状态恢复！');
        world.floatText(this.x, this.y - 34, 'LEVEL UP!', '#ffd75e', 17);
        world.spawnRing(this.x, this.y, '#ffd75e');
        audio.sfx('levelup');
      }
    }
  }

  /* ================= 敌人 ================= */
  class Enemy {
    constructor(typeId, tx, ty, floor) {
      const def = ENEMIES[typeId];
      this.id = nextId();
      this.typeId = typeId;
      this.def = def;
      const f = Math.max(1, floor);
      const mul = def.boss ? 1 + (f - 5) * 0.5 : Math.min(6, 1 + (f - 1) * 0.35);
      this.maxHp = Math.round(def.hp * mul);
      this.hp = this.maxHp;
      this.atk = Math.round(def.atk * (def.boss ? 1 + Math.max(0, f - 5) * 0.2 : mul));
      this.spd = def.spd * (1 + Math.min(0.45, (f - 1) * 0.05));
      this.xp = Math.round(def.xp * Math.min(4, Math.pow(1.2, f - 1)));
      this.x = tx * T + T / 2;
      this.y = ty * T + T / 2;
      this.radius = def.radius;
      this.fly = !!def.fly;
      this.boss = !!def.boss;
      this.dir = { x: 0, y: 0 };
      this.decideT = 0;
      this.blocked = false;
      this.hitCd = 0;
      this.walkT = rand(0, 6);
      this.frozen = 0;
      this.dead = false;
      this.flash = 0;
      if (this.boss) {
        this.dashCd = 3.0;
        this.bubbleCd = 3.8;
        this.summoned = false;
        this.dashT = 0;
        this.telegraph = 0;
        this.dashDir = { x: 0, y: 0 };
        this.enraged = false;
      }
    }

    update(dt, world) {
      if (this.dead) return;
      this.hitCd -= dt;
      this.frozen -= dt;
      this.walkT += dt;
      this.flash -= dt;
      if (this.frozen > 0) return;
      if (this.boss) this.bossUpdate(dt, world);
      else this.normalUpdate(dt, world);
      // 接触伤害（移动之后判定）
      const p = world.player;
      if (!p.dead && this.hitCd <= 0 && dist2(this.x, this.y, p.x, p.y) < this.radius + p.radius - 3) {
        this.hitCd = 0.8;
        world.damagePlayer(p, this.atk);
      }
    }

    normalUpdate(dt, world) {
      const p = world.player;
      const d = dist2(this.x, this.y, p.x, p.y);
      this.decideT -= dt;
      if (this.decideT <= 0 || this.blocked) {
        this.decideT = rand(0.5, 1.3);
        if (!p.dead && d < this.def.aggro * T && Math.random() < this.def.chase) {
          const a = Math.atan2(p.y - this.y, p.x - this.x);
          this.dir = { x: Math.cos(a), y: Math.sin(a) };
        } else {
          const a = pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]);
          this.dir = { x: Math.cos(a), y: Math.sin(a) };
          if (Math.random() < 0.25) this.dir = { x: 0, y: 0 };
        }
      }
      this.blocked = world.moveEntity(this, this.dir.x * this.spd * dt, this.dir.y * this.spd * dt);
    }

    bossUpdate(dt, world) {
      const p = world.player;
      this.enraged = this.hp < this.maxHp * 0.5;
      if (this.dashT > 0) {
        this.dashT -= dt;
        world.moveEntity(this, this.dashDir.x * this.spd * 3.2 * dt, this.dashDir.y * this.spd * 3.2 * dt);
        if (Math.random() < 0.5) world.spawnParticle(this.x + rand(-8, 8), this.y + rand(-8, 8), 0, 0, 0.3, '#a06ae8', rand(2, 4));
        if (this.dashT <= 0) {
          this.dashDir = { x: 0, y: 0 };
          this.dashCd = this.enraged ? 2.2 : 3.2;
        }
        return;
      }
      if (this.telegraph > 0) {
        this.telegraph -= dt;
        if (this.telegraph <= 0) {
          this.dashT = 0.5;
          this.dashDir = { x: Math.sign(p.x - this.x) || 1, y: Math.sign(p.y - this.y) };
          audio.sfx('boss');
        }
        return;
      }
      this.dashCd -= dt;
      this.bubbleCd -= dt;
      if (this.dashCd <= 0 && !p.dead && dist2(this.x, this.y, p.x, p.y) < 12 * T) {
        this.telegraph = 0.45;
        this.dashCd = 999;
      }
      if (this.bubbleCd <= 0) {
        this.bubbleCd = this.enraged ? 3.2 : 4.5;
        const n = this.enraged ? 3 : 2;
        let placed = 0, tries = 0;
        while (placed < n && tries < 24) {
          tries++;
          const tx = clamp(tileX(p.x) + randi(-2, 2), 1, COLS - 2);
          const ty = clamp(tileY(p.y) + randi(-2, 2), 1, ROWS - 2);
          const onPlayer = tx === tileX(p.x) && ty === tileY(p.y);
          const onBoss = tx === tileX(this.x) && ty === tileY(this.y);
          if (world.map[ty][tx] === TILE.GROUND && !world.bubbleAt(tx, ty) && !onPlayer && !onBoss) {
            world.addBubble(tx, ty, 'boss');
            placed++;
          }
        }
      }
      if (this.enraged && !this.summoned) {
        this.summoned = true;
        world.spawnEnemies(['slime', 'slime']);
        world.event('toast', '魔王狂怒了！召唤出两只史莱姆！');
        audio.sfx('boss');
      }
      // 平时也向玩家靠近
      const a = Math.atan2(p.y - this.y, p.x - this.x);
      this.blocked = world.moveEntity(this, Math.cos(a) * this.spd * dt, Math.sin(a) * this.spd * dt);
    }
  }

  /* ================= 泡泡 / 爆炸 ================= */
  class Bubble {
    constructor(tx, ty, owner, world) {
      this.tx = tx; this.ty = ty;
      this.cx = tx * T + T / 2;
      this.cy = ty * T + T / 2;
      this.owner = owner;
      this.fuse = owner === 'boss' ? rand(1.7, 2.3) : 2.2;
      this.maxFuse = this.fuse;
      this.range = owner === 'boss' ? 3 : world.player.range;
      this.age = 0;
      this.dead = false;
      this.ownerLeft = false; // 放置者是否已完全离开本格（离开后泡泡对其永久实心）
    }
    update(dt, world) {
      this.age += dt;
      this.fuse -= dt;
      if (this.fuse <= 0) world.explode(this);
    }
  }

  function circleHitsCell(e, cell) {
    const rx = cell.x * T, ry = cell.y * T;
    const nx = clamp(e.x, rx, rx + T), ny = clamp(e.y, ry, ry + T);
    return dist2(e.x, e.y, nx, ny) < e.radius;
  }

  function computeExplosionCells(world, tx, ty, range) {
    const cells = [{ x: tx, y: ty }];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const d of dirs) {
      for (let i = 1; i <= range; i++) {
        const nx = tx + d[0] * i, ny = ty + d[1] * i;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) break;
        const t = world.map[ny][nx];
        if (t === TILE.WALL) break;
        cells.push({ x: nx, y: ny });
        if (t === TILE.BOX) { world.destroyBox(nx, ny); break; }
      }
    }
    return cells;
  }

  class Explosion {
    constructor(world, b) {
      this.tx = b.tx; this.ty = b.ty;
      this.age = 0;
      this.dur = 0.5;
      this.owner = b.owner;
      this.cells = computeExplosionCells(world, this.tx, this.ty, b.range);
      const hit = new Set();
      const playerDmg = b.owner === 'player' ? 16 : 24;
      const enemyDmg = b.owner === 'player' ? world.player.atk : 0;
      for (const cell of this.cells) {
        // 连锁引爆其它泡泡
        const ob = world.bubbleAt(cell.x, cell.y);
        if (ob && !ob.dead && !(ob.tx === b.tx && ob.ty === b.ty)) ob.fuse = Math.min(ob.fuse, 0.04);
        if (enemyDmg > 0) {
          for (const e of world.enemies) {
            if (e.dead || hit.has(e.id)) continue;
            if (circleHitsCell(e, cell)) {
              hit.add(e.id);
              world.damageEnemy(e, enemyDmg);
            }
          }
        }
        const p = world.player;
        if (!p.dead && !hit.has('p') && circleHitsCell(p, cell)) {
          hit.add('p');
          world.damagePlayer(p, playerDmg);
        }
      }
      audio.sfx('explode');
      world.shake = Math.min(7, world.shake + 2 + b.range * 0.5);
      world.spawnExplosionSparks(this.cells);
    }
    update(dt) {
      this.age += dt;
    }
  }

  /* ================= 掉落 / 传送门 / 特效 ================= */
  class Pickup {
    constructor(tx, ty, drop) {
      this.tx = tx; this.ty = ty;
      this.x = tx * T + T / 2;
      this.y = ty * T + T / 2;
      this.type = drop.type;
      this.value = drop.value;
      this.item = drop.item || null;
      this.t = rand(0, 6.28);
      this.radius = 13;
      this.dead = false;
    }
    update(dt) { this.t += dt; }
  }

  class Portal {
    constructor(tx, ty) {
      this.tx = tx; this.ty = ty;
      this.x = tx * T + T / 2;
      this.y = ty * T + T / 2;
      this.t = 0;
    }
    update(dt, world) {
      this.t += dt;
      if (Math.random() < 0.3) {
        world.spawnParticle(
          this.x + rand(-16, 16), this.y + rand(-16, 16),
          rand(-10, 10), rand(-30, -10), rand(0.5, 0.9),
          Math.random() < 0.5 ? '#b07af0' : '#7ae0ff', rand(2, 4)
        );
      }
    }
  }

  class Particle {
    constructor(x, y, vx, vy, life, color, size, grav) {
      this.x = x; this.y = y;
      this.vx = vx; this.vy = vy;
      this.life = life; this.maxLife = life;
      this.color = color; this.size = size;
      this.grav = grav || 0;
    }
    update(dt) {
      this.life -= dt;
      this.vy += this.grav * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
    }
  }

  class FloatText {
    constructor(x, y, text, color, size) {
      this.x = x; this.y = y;
      this.text = text; this.color = color;
      this.life = 1.1; this.maxLife = 1.1;
      this.size = size || 15;
    }
    update(dt) {
      this.life -= dt;
      this.y -= 34 * dt;
    }
  }

  /* ================= 世界 ================= */
  class World {
    constructor(opts) {
      this.floor = opts.floor || 1;
      this.charId = opts.charId;
      this.player = new Player(opts);
      this.kills = opts.kills || 0;
      this.floorKills = 0;
      this.floorTime = 0;
      this.status = 'play';   // play | dead | clear
      this.events = [];
      this.map = genMap(this.floor);
      this.bubbles = [];
      this.explosions = [];
      this.pickups = [];
      this.particles = [];
      this.floats = [];
      this.enemies = [];
      this.portal = null;
      this.shake = 0;
      this.theme = floorTheme(this.floor);
      this.name = floorName(this.floor);
      this.flavor = floorFlavor(this.floor);
      this.setupSpawns();
    }

    setupSpawns() {
      const p = this.player;
      p.x = 1 * T + T / 2;
      p.y = 1 * T + T / 2;
      const list = enemiesForFloor(this.floor);
      const corners = [[COLS - 2, 1], [1, ROWS - 2], [COLS - 2, ROWS - 2]];
      let ci = 0;
      for (const type of list) {
        let tx = -1, ty = -1;
        if (ci < corners.length) {
          tx = corners[ci][0];
          ty = corners[ci][1];
          ci++;
        } else {
          const open = this.openTiles();
          const cand = open.filter((c) => Math.abs(c[0] - 1) + Math.abs(c[1] - 1) >= 6);
          const c = cand.length ? pick(cand) : pick(open);
          tx = c[0]; ty = c[1];
        }
        this.enemies.push(new Enemy(type, tx, ty, this.floor));
      }
    }

    openTiles() {
      const out = [];
      for (let y = 1; y < ROWS - 1; y++) {
        for (let x = 1; x < COLS - 1; x++) {
          if (this.map[y][x] === TILE.GROUND) out.push([x, y]);
        }
      }
      return out;
    }

    event(type, data) { this.events.push({ type, data }); }
    drainEvents() { const e = this.events; this.events = []; return e; }

    bubbleAt(tx, ty) {
      for (const b of this.bubbles) {
        if (!b.dead && b.tx === tx && b.ty === ty) return b;
      }
      return null;
    }

    /* ----- 碰撞 ----- */
    blocks(e, tx, ty) {
      if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return true;
      const t = this.map[ty][tx];
      if (t === TILE.WALL) return true;
      if (t === TILE.BOX) return !e.fly;
      const b = this.bubbleAt(tx, ty);
      if (b) {
        if (e.fly) return false;
        if (b.owner === 'player' && e === this.player) {
          // 自己的泡泡：放置后只要圆心还在该格矩形内就不阻挡；
          // 一旦完全离开，泡泡对放置者永久实心（经典泡泡堂手感）
          const overlap = e.x >= b.tx * T && e.x <= (b.tx + 1) * T &&
                          e.y >= b.ty * T && e.y <= (b.ty + 1) * T;
          if (overlap && !b.ownerLeft) return false;
          if (!overlap) b.ownerLeft = true;
          return true;
        }
        return true;
      }
      return false;
    }

    moveEntity(e, dx, dy) {
      const bx = e.x, by = e.y;
      e.x += dx;
      this.resolveAxis(e, true, Math.sign(dx));
      e.y += dy;
      this.resolveAxis(e, false, Math.sign(dy));
      const moved = Math.hypot(e.x - bx, e.y - by);
      const want = Math.hypot(dx, dy);
      return want > 0.01 && moved < want * 0.3;
    }

    resolveAxis(e, horiz, sign) {
      const r = Math.max(1, e.radius - 1);
      const x0 = Math.floor((e.x - r) / T), x1 = Math.floor((e.x + r) / T);
      const y0 = Math.floor((e.y - r) / T), y1 = Math.floor((e.y + r) / T);
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          if (!this.blocks(e, tx, ty)) continue;
          const rx = tx * T, ry = ty * T;
          const nx = clamp(e.x, rx, rx + T), ny = clamp(e.y, ry, ry + T);
          const ddx = e.x - nx, ddy = e.y - ny;
          if (ddx * ddx + ddy * ddy >= r * r) continue;
          if (horiz) {
            // 沿本帧移动方向的反向推出；圆心已越过格子中线说明正在穿出，跳过（防止相邻格互相推挤抖动）
            if (sign > 0) {
              if (e.x > rx + T / 2) continue;
              e.x = rx - r;
            } else if (sign < 0) {
              if (e.x < rx + T / 2) continue;
              e.x = rx + T + r;
            } else {
              // 该轴本帧无位移：仅修正 ≤2px 的轻微擦碰，避免把正在从另一轴穿出的玩家弹飞
              const dMin = Math.min(e.x - rx, rx + T - e.x);
              const depth = r - dMin;
              if (depth <= 0 || depth > 2) continue;
              e.x = e.x < rx + T / 2 ? rx - r : rx + T + r;
            }
          } else {
            if (sign > 0) {
              if (e.y > ry + T / 2) continue;
              e.y = ry - r;
            } else if (sign < 0) {
              if (e.y < ry + T / 2) continue;
              e.y = ry + T + r;
            } else {
              const dMin = Math.min(e.y - ry, ry + T - e.y);
              const depth = r - dMin;
              if (depth <= 0 || depth > 2) continue;
              e.y = e.y < ry + T / 2 ? ry - r : ry + T + r;
            }
          }
        }
      }
    }

    /* ----- 泡泡 / 爆炸 ----- */
    addBubble(tx, ty, owner) {
      const b = new Bubble(tx, ty, owner, this);
      this.bubbles.push(b);
      return b;
    }

    explode(b) {
      if (b.dead) return;
      b.dead = true;
      const i = this.bubbles.indexOf(b);
      if (i >= 0) this.bubbles.splice(i, 1);
      if (b.owner === 'player') this.player.bubblesActive = Math.max(0, this.player.bubblesActive - 1);
      this.explosions.push(new Explosion(this, b));
    }

    destroyBox(tx, ty) {
      if (this.map[ty][tx] !== TILE.BOX) return;
      this.map[ty][tx] = TILE.GROUND;
      const drop = rollBoxDrop(this.floor);
      if (drop) this.pickups.push(new Pickup(tx, ty, drop));
      audio.sfx('box');
      for (let i = 0; i < 6; i++) {
        this.spawnParticle(tx * T + T / 2, ty * T + T / 2, rand(-60, 60), rand(-90, -20), rand(0.3, 0.6),
          pick(['#c8934e', '#8a6536', '#e8b96a']), rand(2, 4));
      }
    }

    /* ----- 战斗 ----- */
    damageEnemy(e, dmg) {
      if (e.dead) return;
      e.hp -= dmg;
      e.flash = 0.15;
      this.floatText(e.x, e.y - e.radius - 6, '-' + dmg, '#ffffff');
      if (e.hp <= 0) this.killEnemy(e);
    }

    killEnemy(e) {
      e.dead = true;
      this.kills++;
      this.floorKills++;
      const drop = rollEnemyDrop(this.floor);
      if (drop) this.pickups.push(new Pickup(tileX(e.x), tileY(e.y), drop));
      this.player.addXp(e.xp, this);
      this.floatText(e.x, e.y - e.radius - 20, '+' + e.xp + ' EXP', '#c9a6ff', 13);
      audio.sfx('enemyDie');
      for (let i = 0; i < 10; i++) {
        this.spawnParticle(e.x, e.y, rand(-70, 70), rand(-70, 70), rand(0.3, 0.7), e.def.color, rand(2, 5));
      }
      if (e.boss) {
        this.pickups.push(new Pickup(tileX(e.x), tileY(e.y), { type: 'equip', item: rollEquipment(this.floor + 2) }));
        this.event('toast', '魔王被击败！传说装备掉落了！');
        audio.sfx('victory');
      }
      this.enemies = this.enemies.filter((x) => x !== e);
      if (!this.enemies.length) this.openPortal();
    }

    damagePlayer(p, raw) {
      p.takeHit(raw, this);
    }

    onPlayerDeath() {
      this.player.dead = true;
      this.status = 'dead';
      this.player.coins = Math.floor(this.player.coins * 0.85);
      this.event('dead', { floorKills: this.floorKills, coins: this.player.coins });
      audio.sfx('die');
    }

    freezeEnemies(dur) {
      for (const e of this.enemies) {
        e.frozen = Math.max(e.frozen, e.boss ? Math.min(dur, 1.5) : dur);
        for (let i = 0; i < 4; i++) {
          this.spawnParticle(e.x + rand(-14, 14), e.y + rand(-14, 14), rand(-20, 20), rand(-40, -10), 0.4, '#9fe8ff', 3);
        }
      }
    }

    /* ----- 关卡流程 ----- */
    openPortal() {
      const p = this.player;
      const cand = this.openTiles().filter((c) => {
        const md = Math.abs(c[0] - tileX(p.x)) + Math.abs(c[1] - tileY(p.y));
        return md >= 5;
      });
      const c = cand.length ? pick(cand) : pick(this.openTiles());
      this.portal = new Portal(c[0], c[1]);
      this.event('toast', '所有怪物已消灭！传送门开启，快进入下一层！');
      audio.sfx('portal');
    }

    levelClear() {
      if (this.status !== 'play') return;
      this.status = 'clear';
      const bonusXp = 30 + this.floor * 10;
      const bonusCoins = 20 + this.floor * 8;
      this.player.addXp(bonusXp, this);
      this.player.coins += bonusCoins;
      this.event('clear', {
        floor: this.floor,
        kills: this.floorKills,
        time: this.floorTime,
        bonusXp, bonusCoins,
        coins: this.player.coins,
      });
      audio.sfx('victory');
    }

    /* ----- 道具 ----- */
    collectPickup(pk) {
      if (pk.dead) return;
      pk.dead = true;
      const p = this.player;
      switch (pk.type) {
        case 'coin':
          p.coins += pk.value;
          this.floatText(pk.x, pk.y - 10, '+' + pk.value + ' 金币', '#ffd75e', 13);
          audio.sfx('coin');
          break;
        case 'potion':
          p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.3));
          this.floatText(pk.x, pk.y - 10, '生命 +30%', '#ff8a7a', 13);
          audio.sfx('pickup');
          break;
        case 'mana':
          p.mp = Math.min(p.maxMp, p.mp + Math.round(p.maxMp * 0.35));
          this.floatText(pk.x, pk.y - 10, '魔法 +35%', '#7ab8ff', 13);
          audio.sfx('pickup');
          break;
        case 'bubble': {
          const cur = computeStats(p.charId, p.level, p.power, p.equipment).bubbles;
          if (cur < CAP.bubbles) {
            p.power.bubbles++;
            this.floatText(pk.x, pk.y - 10, '泡泡上限 +1', '#6fc8ff', 13);
          } else {
            p.coins += 40;
            this.floatText(pk.x, pk.y - 10, '已满！金币 +40', '#ffd75e', 13);
          }
          audio.sfx('pickup');
          break;
        }
        case 'range': {
          const cur = computeStats(p.charId, p.level, p.power, p.equipment).range;
          if (cur < CAP.range) {
            p.power.range++;
            this.floatText(pk.x, pk.y - 10, '爆炸范围 +1', '#ff9a3e', 13);
          } else {
            p.coins += 40;
            this.floatText(pk.x, pk.y - 10, '已满！金币 +40', '#ffd75e', 13);
          }
          audio.sfx('pickup');
          break;
        }
        case 'speed': {
          const cur = computeStats(p.charId, p.level, p.power, p.equipment).spd;
          if (cur < CAP.speed) {
            p.power.speed += 6;
            this.floatText(pk.x, pk.y - 10, '速度 +', '#8affa0', 13);
          } else {
            p.coins += 40;
            this.floatText(pk.x, pk.y - 10, '已满！金币 +40', '#ffd75e', 13);
          }
          audio.sfx('pickup');
          break;
        }
        case 'shield':
          p.invuln = Math.max(p.invuln, 5);
          this.floatText(pk.x, pk.y - 10, '无敌护盾 5 秒', '#7ef0ff', 13);
          audio.sfx('shield');
          break;
        case 'equip':
          this.gainEquipment(pk.item, pk);
          break;
      }
    }

    gainEquipment(item, pk) {
      const p = this.player;
      const slot = item.slot;
      const cur = p.equipment[slot];
      const score = itemScore(item);
      if (!cur) {
        p.equipment[slot] = item;
        this.event('toast', '已装备 ' + item.name);
      } else if (score > itemScore(cur)) {
        p.equipment[slot] = item;
        this.addToBag(cur);
        this.event('toast', '已装备 ' + item.name);
      } else {
        this.addToBag(item);
        this.event('toast', '获得 ' + item.name + '（已放入背包）');
      }
      p.recalc();
      audio.sfx('equip');
      this.floatText(pk ? pk.x : p.x, (pk ? pk.y : p.y) - 18, item.name, item.rarityColor, 13);
    }

    addToBag(item) {
      const p = this.player;
      if (p.bag.length >= CAP.bag) {
        this.event('toast', '背包已满，' + item.name + ' 被丢弃了……');
        return;
      }
      p.bag.push(item);
    }

    spawnEnemies(types) {
      for (const type of types) {
        const open = this.openTiles().filter((c) =>
          Math.abs(c[0] - tileX(this.player.x)) + Math.abs(c[1] - tileY(this.player.y)) >= 4
        );
        const c = open.length ? pick(open) : pick(this.openTiles());
        this.enemies.push(new Enemy(type, c[0], c[1], this.floor));
      }
    }

    /* ----- 特效 ----- */
    floatText(x, y, text, color, size) {
      this.floats.push(new FloatText(x, y, text, color, size));
    }
    spawnParticle(x, y, vx, vy, life, color, size) {
      if (this.particles.length < 400) this.particles.push(new Particle(x, y, vx, vy, life, color, size, 60));
    }
    spawnRing(x, y, color) {
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        this.spawnParticle(x, y, Math.cos(a) * 60, Math.sin(a) * 60, 0.5, color, 3);
      }
    }
    spawnHurtParticles(x, y) {
      for (let i = 0; i < 8; i++) {
        this.spawnParticle(x, y, rand(-90, 90), rand(-90, 90), 0.4, '#ff6a5e', rand(2, 4));
      }
    }
    spawnExplosionSparks(cells) {
      for (const c of cells) {
        const cx = c.x * T + T / 2, cy = c.y * T + T / 2;
        for (let i = 0; i < 3; i++) {
          this.spawnParticle(cx, cy, rand(-80, 80), rand(-80, 80), rand(0.2, 0.45),
            pick(['#ffd75e', '#ff9a3e', '#ff5e3e', '#ffffff']), rand(2, 4));
        }
      }
    }

    /* ----- 主更新 ----- */
    update(dt, actions) {
      actions = actions || {};
      this.floorTime += dt;
      this.shake = Math.max(0, this.shake - dt * 14);
      if (this.status === 'play') {
        this.player.update(dt, this, actions);
        for (const e of this.enemies) {
          e.update(dt, this);
          e.x = clamp(e.x, e.radius, W - e.radius);
          e.y = clamp(e.y, e.radius, H - e.radius);
        }
        for (const b of this.bubbles.slice()) b.update(dt, this);
        this.bubbles = this.bubbles.filter((b) => !b.dead);
        for (const pk of this.pickups) pk.update(dt);
        this.pickups = this.pickups.filter((pk) => !pk.dead);
      }
      for (const ex of this.explosions) ex.update(dt);
      this.explosions = this.explosions.filter((ex) => ex.age < ex.dur);
      for (const pa of this.particles) pa.update(dt);
      this.particles = this.particles.filter((pa) => pa.life > 0);
      for (const ft of this.floats) ft.update(dt);
      this.floats = this.floats.filter((ft) => ft.life > 0);
      if (this.portal) this.portal.update(dt, this);
    }
  }

  /* ---------------- 导出 ---------------- */
  const api = {
    Player, Enemy, Bubble, Explosion, Pickup, Portal, Particle, FloatText, World,
    computeExplosionCells, circleHitsCell,
  };
  global.BubbleEntities = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
