// 给桌面端（Electron helper）补上「蓄力压缩弹射」。
//
// 背景：桌面端没有 TypeScript 源码，只有预编译产物 runtime/electron-helper/*.js。
// 好在它们都是**可读的**（保留注释、未压缩），所以直接按源码方式打补丁：
//   shared-core.js = src/shared 的编译产物（物理/曲线在这里）→ 先加蓄力算法并导出
//   sprite.js      = 桌面宠物本体（PetSprite）→ 再接事件与抛掷
//
// 每个替换点都断言"恰好命中一次"，任何一处对不上就整体中止并还原，避免留下半残补丁。
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';

const DIR = 'C:\\Users\\feng\\.dsh\\profiles\\desktop\\node_modules\\dsh-pet\\runtime\\electron-helper\\';
const CORE = DIR + 'shared-core.js';
const SPRITE = DIR + 'sprite.js';

const coreOrig = readFileSync(CORE, 'utf8');
const spriteOrig = readFileSync(SPRITE, 'utf8');

let core = coreOrig;
let sprite = spriteOrig;
const applied = [];

/** 只替换一次；命中次数不是 1 就抛错 */
function patch(target, name, from, to) {
  const count = target.split(from).length - 1;
  if (count !== 1) {
    throw new Error(`[${name}] 锚点命中 ${count} 次（应为 1）：${from.slice(0, 70).replace(/\n/g, '⏎')}`);
  }
  applied.push(name);
  return target.split(from).join(to);
}

// ============================================================
// ① shared-core.js：加蓄力算法 + 导出
// ============================================================
const CHARGE_BLOCK = `
// ---- 蓄力压缩弹射（桌面端）：与浏览器 src/shared/physics.ts 同一套数学模型 ----
// 两段式：观察期 armMs 内不形变（其间拖动/再点即作废）；之后按蓄力进度逐渐压扁，
// 总时长 armMs+fullMs 蓄满。**力度随蓄力进度递增**（压得越扁弹得越快），初速与按住时长无关的部分由公式体现。
const CHARGE_SQUASH = .45;
const CHARGE_ARM_MS = 500;
const CHARGE_FULL_MS = 1500;
const CHARGE_SQUASH_SPEED = 1;
const CHARGE_SPEED_PER_SIZE = 10;
const MAX_CHARGE_SPEED = 12000;
const CHARGE_GRAVITY_SCALE = 0;
const CHARGE_ANGLE_DEG = 90;
// 蓄力期间转入拖拽的阈值：比 DRAG_THRESHOLD(5px) 大得多——按住等蓄力时手会抖 1~10px，
// 用 5px 会把"想蓄力"误判成拖拽并作废弹射（表现为"有压缩、不弹"）。
const CHARGE_DRAG_THRESHOLD = 30;
/** 不缩放时间轴的真实蓄力进度 0~1（力度用它，形变用 chargeProgress） */
const rawChargeProgress = (holdMs, armMs = CHARGE_ARM_MS, fullMs = CHARGE_FULL_MS) => {
	const arm = Number.isFinite(armMs) && armMs >= 0 ? armMs : CHARGE_ARM_MS;
	const full = Number.isFinite(fullMs) && fullMs > 0 ? fullMs : CHARGE_FULL_MS;
	const held = Number.isFinite(holdMs) ? holdMs : 0;
	if (held <= arm) return 0;
	return Math.min((held - arm) / full, 1);
};
/** 蓄力进度（形变用；squashSpeed 只缩放蓄力段时间轴） */
const chargeProgress = (holdMs, armMs = CHARGE_ARM_MS, fullMs = CHARGE_FULL_MS, squashSpeed = CHARGE_SQUASH_SPEED) => {
	const arm = Number.isFinite(armMs) && armMs >= 0 ? armMs : CHARGE_ARM_MS;
	const full = Number.isFinite(fullMs) && fullMs > 0 ? fullMs : CHARGE_FULL_MS;
	const speed = Number.isFinite(squashSpeed) && squashSpeed > 0 ? squashSpeed : CHARGE_SQUASH_SPEED;
	const held = Number.isFinite(holdMs) ? holdMs : 0;
	if (held <= arm) return 0;
	return Math.min(Math.max((held - arm) * speed / full, 0), 1);
};
/** 按住时长 → 压深（1 = 不形变） */
const chargeSquash = (holdMs, squash = CHARGE_SQUASH, armMs = CHARGE_ARM_MS, fullMs = CHARGE_FULL_MS, squashSpeed = CHARGE_SQUASH_SPEED) => {
	const target = Number.isFinite(squash) ? Math.min(Math.max(squash, .2), 1) : CHARGE_SQUASH;
	const t = chargeProgress(holdMs, armMs, fullMs, squashSpeed);
	if (t <= 0) return 1;
	const e = 1 - (1 - t) * (1 - t);
	return 1 - (1 - target) * e;
};
/** 是否已越过观察期 */
const chargeArmed = (holdMs, armMs = CHARGE_ARM_MS) => {
	const arm = Number.isFinite(armMs) && armMs >= 0 ? armMs : CHARGE_ARM_MS;
	return (Number.isFinite(holdMs) ? holdMs : 0) > arm;
};
/** 蓄力进度 → 弹射初速（px/s）：size × speedPerSize × progress^1.6 × power × throwPower */
const chargeSpeed = (holdMs, size, speedPerSize = CHARGE_SPEED_PER_SIZE, armMs = CHARGE_ARM_MS, power = 1, throwPower = DEFAULT_THROW_POWER, fullMs = CHARGE_FULL_MS) => {
	if (!chargeArmed(holdMs, armMs)) return 0;
	const p = rawChargeProgress(holdMs, armMs, fullMs);
	if (p <= 0) return 0;
	const sz = Number.isFinite(size) && size > 0 ? size : 300;
	const per = Number.isFinite(speedPerSize) && speedPerSize > 0 ? speedPerSize : CHARGE_SPEED_PER_SIZE;
	const pw = Number.isFinite(power) && power > 0 ? power : 1;
	const tp = Number.isFinite(throwPower) && throwPower > 0 ? throwPower : DEFAULT_THROW_POWER;
	return Math.min(sz * per * Math.pow(p, 1.6) * pw * tp, MAX_CHARGE_SPEED);
};
/** 蓄力弹射速度向量（角度约定与 throwVelocity 相同：90 = 正上） */
const chargeVelocity = (holdMs, size, angleDeg = CHARGE_ANGLE_DEG, speedPerSize = CHARGE_SPEED_PER_SIZE, armMs = CHARGE_ARM_MS, power = 1, throwPower = DEFAULT_THROW_POWER, fullMs = CHARGE_FULL_MS) => {
	const speed = chargeSpeed(holdMs, size, speedPerSize, armMs, power, throwPower, fullMs);
	if (speed <= 0) return { vx: 0, vy: 0, speed: 0 };
	const rad = angleDeg * Math.PI / 180;
	return { vx: Math.cos(rad) * speed, vy: -Math.sin(rad) * speed, speed };
};
/** 从配置的 physics 段取蓄力参数并归一化（缺失/非法一律回默认，绝不产生 NaN） */
const chargeParamsOf = (physics) => {
	const p = physics || {};
	const num = (v, def, min, max) => {
		const n = Number(v);
		if (!Number.isFinite(n)) return def;
		return Math.min(Math.max(n, min), max);
	};
	return {
		enabled: p.chargeEnabled === true,
		armMs: num(p.chargeArmMs, CHARGE_ARM_MS, 0, 1e4),
		fullMs: num(p.chargeFullMs, CHARGE_FULL_MS, 100, 6e4),
		squashSpeed: num(p.chargeSquashSpeed, CHARGE_SQUASH_SPEED, .1, 20),
		speedPerSize: num(p.chargeSpeedPerSize, CHARGE_SPEED_PER_SIZE, .1, 50),
		power: num(p.chargePower, 1, .01, 10),
		squash: num(p.chargeSquash, CHARGE_SQUASH, .2, 1),
		gravityScale: num(p.chargeGravityScale, CHARGE_GRAVITY_SCALE, 0, 5)
	};
};
`;

core = patch(core, 'core: 插入蓄力算法', 'const throwBounds = (o) => {', CHARGE_BLOCK + 'const throwBounds = (o) => {');

const EXPORTS = `
exports.CHARGE_ANGLE_DEG = CHARGE_ANGLE_DEG
exports.CHARGE_ARM_MS = CHARGE_ARM_MS
exports.CHARGE_DRAG_THRESHOLD = CHARGE_DRAG_THRESHOLD
exports.CHARGE_FULL_MS = CHARGE_FULL_MS
exports.CHARGE_GRAVITY_SCALE = CHARGE_GRAVITY_SCALE
exports.CHARGE_SPEED_PER_SIZE = CHARGE_SPEED_PER_SIZE
exports.CHARGE_SQUASH = CHARGE_SQUASH
exports.chargeArmed = chargeArmed
exports.chargeParamsOf = chargeParamsOf
exports.chargeProgress = chargeProgress
exports.chargeSpeed = chargeSpeed
exports.chargeSquash = chargeSquash
exports.chargeVelocity = chargeVelocity
`;
core = patch(core, 'core: 导出蓄力 API', '\nreturn exports;', EXPORTS + '\nreturn exports;');

// ============================================================
// ② sprite.js：状态字段
// ============================================================
const FIELDS = `    this.pendingSquash = false;
    // 蓄力压缩弹射（与浏览器 pet.ts 同构）：
    //   chargeStart      = 按下时刻（0 = 当前没在按压；松手判定靠它算按住时长）
    //   chargeDisqualified = 本次按压已被拖动/再次点击取消资格（永久，直到下次按下）
    //   chargeRef/chargeTimer = 蓄力 rAF / 观察期定时器
    this.chargeStart = 0;
    this.chargeDisqualified = false;
    this.chargeRef = null;
    this.chargeTimer = null;
    this.chargeToken = 0;`;

sprite = patch(
  sprite,
  'sprite: 构造函数字段',
  '    this.squashToken = 0;\n    this.pendingSquash = false;',
  '    this.squashToken = 0;\n' + FIELDS,
);

// ============================================================
// ③ sprite.js：startThrow 支持重力缩放
// ============================================================
sprite = patch(
  sprite,
  'sprite: startThrow 签名',
  '  startThrow(px, py, vx, vy) {\n    this.stopDragFollow();\n    this.stopMove();',
  `  startThrow(px, py, vx, vy, gravityScale = 1) {
    this.stopDragFollow();
    this.stopMove();
    // 本次飞行的物理参数：只缩放重力（蓄力弹射默认 gravityScale=0 → 匀速直线、永不下落）。
    // 其它参数（弹性/摩擦/顶反弹）沿用全局配置；不修改 this.physics 本身，不影响别的抛掷。
    const chargeGs = Number.isFinite(gravityScale) && gravityScale >= 0 ? gravityScale : 1;
    const throwPhysics =
      chargeGs === 1 ? this.physics : Object.assign({}, this.physics, { gravity: this.physics.gravity * chargeGs });`,
);

sprite = patch(sprite, 'sprite: throwStepRegion 用 throwPhysics(1)', 'S.throwStepRegion(state, dt / substeps, sp, this.physics, lockScreen)', 'S.throwStepRegion(state, dt / substeps, sp, throwPhysics, lockScreen)');
sprite = patch(sprite, 'sprite: throwStepRegion 用 throwPhysics(2)', 'S.throwStepRegion(res, dt / substeps, sp, this.physics, lockScreen)', 'S.throwStepRegion(res, dt / substeps, sp, throwPhysics, lockScreen)');

// ============================================================
// ④ sprite.js：蓄力相关方法（插在 stopSquash 之后）
// ============================================================
const METHODS = `
  // ---- 蓄力压缩弹射（按住不放 → 逐渐压扁；松手整体弹出，压得越扁弹得越快） ----
  /** 当前生效的蓄力参数（每次现算：保存配置后无需重新挂事件） */
  chargeParams() {
    return S.chargeParamsOf(this.physics);
  }

  /** 前台视频元素（压扁目标，与 startSquash 一致） */
  chargeFrontEl() {
    return this.front === 0 ? this.videoA : this.videoB;
  }

  /** 把压深写进视频元素 transform（保留镜像朝向） */
  applyChargeSquash(scaleY) {
    const el = this.chargeFrontEl();
    if (!el) return;
    el.style.transformOrigin = 'bottom';
    el.style.transform = (this.facing === 'right' ? 'scaleX(-1) ' : '') + 'scaleY(' + scaleY + ')';
  }

  /** 恢复未形变状态 */
  restoreChargeSquash() {
    const el = this.chargeFrontEl();
    if (!el) return;
    el.style.transform = this.facing === 'right' ? 'scaleX(-1)' : '';
    el.style.transformOrigin = '';
  }

  clearChargeTimer() {
    if (this.chargeTimer !== null) {
      clearTimeout(this.chargeTimer);
      this.chargeTimer = null;
    }
  }

  /** 按下：记时刻、起观察期（观察期内不形变也不跑 rAF，到点才起循环） */
  startCharge() {
    const cp = this.chargeParams();
    if (!cp.enabled) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      console.log('[dsh-pet] pet=' + this.pet.id + ' [charge] 跳过：系统开启了「减少动画」');
      return;
    }
    this.clearChargeTimer();
    this.chargeToken++;
    this.chargeStart = performance.now();
    this.chargeDisqualified = false;
    this.chargeRef = null;
    const token = this.chargeToken;
    console.log(
      '[dsh-pet] ' + new Date().toTimeString().slice(0, 8) + ' pet=' + this.pet.id +
        ' [charge] 已按下 arm=' + cp.armMs + 'ms full=' + cp.fullMs + 'ms speed=' + cp.speedPerSize + 'x g=' + cp.gravityScale,
    );
    if (cp.armMs <= 0) {
      this.runChargeLoop();
      return;
    }
    this.chargeTimer = setTimeout(() => {
      this.chargeTimer = null;
      if (this.chargeToken !== token) return;
      if (this.chargeDisqualified) {
        console.log('[dsh-pet] pet=' + this.pet.id + ' [charge] 观察期结束但已被取消，不蓄力');
        return;
      }
      console.log('[dsh-pet] pet=' + this.pet.id + ' [charge] 观察期结束，开始压扁');
      this.runChargeLoop();
    }, cp.armMs);
  }

  /** 蓄力逐帧循环：按按住时长压扁；蓄满后停在最扁处等松手 */
  runChargeLoop() {
    if (this.chargeRef !== null) return;
    const cp = this.chargeParams();
    if (!this.chargeFrontEl()) {
      console.warn('[dsh-pet] pet=' + this.pet.id + ' [charge] 放弃：取不到前台视频元素');
      return;
    }
    // 抢占 squash 所有权：作废进行中的点击 Q 弹/落地 Q 弹，免得两套 rAF 抢同一个 transform
    this.stopSquash();
    const token = this.chargeToken;
    const step = () => {
      if (this.chargeToken !== token) return;
      const holdMs = performance.now() - this.chargeStart;
      const p = S.chargeProgress(holdMs, cp.armMs, cp.fullMs, cp.squashSpeed);
      const depth = S.chargeSquash(holdMs, cp.squash, cp.armMs, cp.fullMs, cp.squashSpeed);
      // 曲线下压段占 0~0.45：把蓄力进度映射到这一段
      this.applyChargeSquash(S.squashScale(p * 0.45, depth));
      if (p < 1) this.chargeRef = requestAnimationFrame(step);
      else this.chargeRef = null;
    };
    this.chargeRef = requestAnimationFrame(step);
  }

  /** 中止蓄力：停 rAF、按需恢复立绘；返回本次按住时长（ms） */
  stopCharge(restore) {
    const holdMs = this.chargeStart > 0 ? performance.now() - this.chargeStart : 0;
    this.chargeToken++;
    this.clearChargeTimer();
    if (this.chargeRef !== null) {
      cancelAnimationFrame(this.chargeRef);
      this.chargeRef = null;
    }
    this.chargeStart = 0;
    if (restore) this.restoreChargeSquash();
    return holdMs;
  }

  /** 观察期内发生其它操作（真拖动 / 再次点击）：本次按压永久失去弹射资格 */
  disqualifyCharge() {
    if (this.chargeStart === 0) return;
    this.chargeDisqualified = true;
    this.stopCharge(true);
  }

  /** 观察期是否已过，且没被取消（松手时用它决定弹不弹） */
  chargeArmedNow() {
    if (this.chargeStart === 0) return false;
    if (this.chargeDisqualified) return false;
    return S.chargeArmed(performance.now() - this.chargeStart, this.chargeParams().armMs);
  }
`;

sprite = patch(
  sprite,
  'sprite: 插入蓄力方法',
  `  stopSquash() {
    this.squashToken++;
    if (this.squashRef !== null) {
      cancelAnimationFrame(this.squashRef);
      this.squashRef = null;
    }
  }
`,
  `  stopSquash() {
    this.squashToken++;
    if (this.squashRef !== null) {
      cancelAnimationFrame(this.squashRef);
      this.squashRef = null;
    }
  }
${METHODS}`,
);

// ============================================================
// ⑤ sprite.js：onPointerDown 末尾开始蓄力
// ============================================================
sprite = patch(
  sprite,
  'sprite: onPointerDown 起蓄力',
  '    this.dragState.anchorY = this.pos.y + this.halfH;',
  `    this.dragState.anchorY = this.pos.y + this.halfH;
    // 蓄力压缩弹射：按下即进观察期。拖动超过 CHARGE_DRAG_THRESHOLD 才作废（见 onPointerMove），
    // 松手时若仍在蓄力资格内 → 按蓄力时长整体弹出（见 onPointerUp）。
    this.startCharge();`,
);

// ============================================================
// ⑥ sprite.js：onPointerMove 蓄力作废判定
// ============================================================
sprite = patch(
  sprite,
  'sprite: onPointerMove 作废判定',
  `    if (!d.dragging) {
      if (Math.hypot(dx, dy) < S.DRAG_THRESHOLD) return;`,
  `    // 蓄力作废：只有**明确要拖走**（超过 CHARGE_DRAG_THRESHOLD=30px）才取消弹射资格。
    // 不能沿用 DRAG_THRESHOLD(5px)——按住等蓄力时手会抖 1~10px，用 5px 会误判成拖拽并永久
    // 取消本次弹射（现象："压缩正常、松手不飞"）。拖拽启动本身仍用 5px，保证跟手。
    if (Math.hypot(dx, dy) > S.CHARGE_DRAG_THRESHOLD) this.disqualifyCharge();
    if (!d.dragging) {
      if (Math.hypot(dx, dy) < S.DRAG_THRESHOLD) return;`,
);

// ============================================================
// ⑦ sprite.js：onPointerUp 松手弹射
// ============================================================
sprite = patch(
  sprite,
  'sprite: onPointerUp 弹射',
  `    if (wasDragging) {
      this.justDragged = true;
      setTimeout(() => {
        this.justDragged = false;
      }, 100);`,
  `    // ---- 蓄力弹射（先于拖拽分支判定）----
    // 只要越过观察期且没被判定为真拖动，松手就弹。刻意**不看 wasDragging**：
    // 手抖会让 dragging 在 5px 就置真，但那不是"想拖走"的意图（去留由 CHARGE_DRAG_THRESHOLD 决定）。
    const chargeArmed = this.chargeArmedNow();
    const chargeHoldMs = this.stopCharge(chargeArmed || wasDragging);
    if (chargeArmed) {
      const cp = this.chargeParams();
      const v = S.chargeVelocity(
        chargeHoldMs,
        this.size,
        S.CHARGE_ANGLE_DEG,
        cp.speedPerSize,
        cp.armMs,
        cp.power,
        this.physics.throwPower,
        cp.fullMs,
      );
      // 抑制紧随 pointerup 补发的 click：onClick 第一件事就是 stopThrow()，
      // 会把刚起飞的抛掷立刻掐掉（"压缩有、松手不弹"的主因）。与拖拽松手同一套标记。
      this.justDragged = true;
      setTimeout(() => {
        this.justDragged = false;
      }, 100);
      if (!this.resumeWorkStatusAnim()) {
        if (this.animations.idle.length) this.playOnce(S.pick(this.animations.idle, this.anim));
      }
      console.log(
        '[dsh-pet] ' + new Date().toTimeString().slice(0, 8) + ' pet=' + this.pet.id +
          ' charge hold=' + Math.round(chargeHoldMs) + 'ms g=' + cp.gravityScale +
          ' vx=' + Math.round(v.vx) + ' vy=' + Math.round(v.vy) + ' |v|=' + Math.round(v.speed),
      );
      if (v.speed > 0) {
        this.startThrow(this.pos.x, this.pos.y, v.vx, v.vy, cp.gravityScale);
      } else {
        this.customPos = { rx: (this.pos.x + this.halfW) / VIEW.w, ry: (this.pos.y + this.halfH) / VIEW.h };
        this.position();
      }
      return; // 已处理本次松手，跳过常规拖拽分支
    }
    if (wasDragging) {
      this.justDragged = true;
      setTimeout(() => {
        this.justDragged = false;
      }, 100);`,
);

// ============================================================
// 写入
// ============================================================
writeFileSync(CORE, core, 'utf8');
writeFileSync(SPRITE, sprite, 'utf8');

console.log('补丁点（全部命中一次）：');
for (const a of applied) console.log('  ✓ ' + a);
console.log('\nshared-core.js: ' + coreOrig.length + ' → ' + core.length + ' 字节');
console.log('sprite.js    : ' + spriteOrig.length + ' → ' + sprite.length + ' 字节');
