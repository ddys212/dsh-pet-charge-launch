# 实现说明

想改代码或者移植到别的地方时看这份。

## 交互模型

```
时间轴 ──────────────────────────────────────────────►
按下                                              松手
 │                                                 │
 ├─ 观察期 chargeArmMs ─┼─ 蓄力期 chargeFullMs ─────┤
 │   完全不形变          │  逐渐压扁，到点停住        │
 │   拖动/再点 → 作废    │  松手 → 按蓄力进度弹出     │
```

**观察期**是"判断意图"的窗口：用户可能只是想拖走或点一下。这期间不形变、不发光、不跑动画帧，只挂一个 `setTimeout`——所以按住不动几乎零开销。

越过观察期才开始逐帧压扁（`requestAnimationFrame`），到 `chargeArmMs + chargeFullMs` 蓄满，停在最扁处等松手。**蓄满不会自己飞**，必须松手。

## 形变曲线

复用 dsh-pet 点击时那套 Q 弹曲线 `squashScale(u, squash)`：

- 曲线 `u ∈ [0, 1]`，`0 ~ 0.45` 是下压段，`0.45 ~ 1` 是回弹段（带回弹过冲）
- 蓄力只取**下压段**：把蓄力进度 `p` 映射成 `u = p * 0.45`，同时把 `squash` 参数从 1 逐渐降到 `chargeSquash`

这样蓄力过程和点击反馈共用同一条曲线，手感自然一致，不用另外发明一套缓动。

`squash` 目标值随时间用 easeOutQuad 逼近：

```
e = 1 - (1 - p)²
scaleY_target = 1 - (1 - chargeSquash) * e
```

## 力度模型

```
speed = size × chargeSpeedPerSize × p^1.6 × chargePower × throwPower
```

- `p` 是**真实蓄力进度**（`(holdMs - armMs) / fullMs`，不缩放时间轴）
- 指数 `1.6`：前段平缓、后段陡峭。刚过观察期轻轻一动，蓄满时全速
- 用「身宽倍数」而不是绝对像素：宠物大小可调（150~462px），这样大宠物飞得更远但视觉速度一致
- 上限 `MAX_CHARGE_SPEED = 12000` 兜底

**`chargeSquashSpeed` 不参与这个公式**。它是纯视觉旋钮：只缩放形变的时间轴。这样"调压扁快慢"不会顺带改变射程——两个概念正交。

方向固定 `90°`（正上方）。`chargeVelocity` 复用 `throwVelocity` 的角度约定（0 = 正右，逆时针为正，`vy` 取负）。

## 重力：只对本次飞行生效，且用绝对量级

需求是"弹射要不要下落由这个旋钮决定"，但不能改全局重力（那样普通拖拽甩出去的宠物行为也变了）。

做法是给 `startThrow` 加一个**绝对重力覆盖**参数，**只对本次飞行**生效：

```js
const throwPhysics =
  gravityOverride === undefined || gravityOverride === null
    ? cfg.physics                                        // 其它来源：完全用配置
    : { ...cfg.physics, gravity: Math.max(0, gravityOverride) };  // 蓄力弹射：替换重力
```

不修改配置对象本身，所以拖拽、弹弓、接口指令的抛掷完全不受影响。

### 为什么是绝对值而不是"倍率 × 全局重力"

早期版本用的是 `cfg.physics.gravity * scale`，结果踩了坑：用户把全局重力设成 **1**（≈无重力）后，`1 × 5 = 5` 依然等于没有重力——旋钮彻底失效，用户设了重力却发现宠物不落地。

改成绝对量级后：

```
实际重力 = chargeGravityScale × CHARGE_GRAVITY_REF(1400)
```

`chargeGravityScale = 1` 恒定等于"正常重力量级"，与全局设置解耦，手感可预期。

### 想停下来还差一个条件

重力只让宠物**落下**，能不能**停住**取决于全局弹性 `restitution`：

- `restitution = 1`（完全弹性）：每次落地按原速弹回，振幅不衰减 → 永远弹（实测 60 秒 180 次）
- `restitution < 1`：振幅逐次衰减 → 最终 `atRest`

`atRest` 的判定在 `throwStep` 里：贴地且 `|vy| < 1` 且 `|vx| < REST_VX(15)`，或碰边后整体速度低于 `REST_VY(40)`。所以弹性为 1 时这个条件永远不成立。

## 两个关键坑

### 坑 1：补发的 click 会把抛掷掐死

浏览器在 `pointerup` 之后**总会**补发一次 `click`（只要按下/抬起在同一元素上，按住多久都发）。而 dsh-pet 的 `onClick` 第一件事是：

```js
stopThrow(); // 点击飞行中的宠物 = 收手停住
```

于是时序变成：

```
pointerup → startThrow() 起飞
click     → stopThrow()  当场取消  ✗
```

宠物一动不动。**这正是"压缩正常、松手不飞"的主因。**

拖拽甩飞为什么没这个问题？因为拖拽分支里有 `justDragged = true`，`onClick` 开头会因它早退。蓄力分支漏了这层保护。

修法：弹射前也设 `justDragged`（100ms 后清除）：

```js
justDraggedRef.current = true;
setTimeout(() => { justDraggedRef.current = false; }, 100);
startThrow(px, py, v.vx, v.vy, cp.gravityScale);
```

### 坑 2：5px 拖拽阈值会误杀蓄力

原来的拖拽判定是 `DRAG_THRESHOLD = 5`（px）。用户按住等蓄力时，手会有 1~10px 的自然抖动，一抖就被判成"拖拽"，`disqualifyCharge()` 把本次按压永久标记为已取消——松手自然不弹。

修法：**拆成两个阈值**

| 场景 | 阈值 | 原因 |
|---|---|---|
| 拖拽启动 | `DRAG_THRESHOLD = 5` | 保持跟手，拖拽要立刻响应 |
| 蓄力作废 | `CHARGE_DRAG_THRESHOLD = 30` | 容忍手抖，只有真想拖走才取消 |

同时在松手判定里**不再看 `wasDragging`**：

```js
// 旧：手抖让 dragging 变真就永远不弹
const armed = !wasDragging && chargeArmedNow();
// 新：去留由 CHARGE_DRAG_THRESHOLD 决定
const armed = chargeArmedNow();
```

轻微抖动导致短暂进入拖拽态时，弹射前把拖拽留下的视觉收尾（`setDragging(false)` + 复位 stage 的 transform），否则会偏位。

## 配置为什么必须是"可选键"

dsh-pet 的 `physics` 段是**整段校验**：任一子键非法/缺失就整段判非法、整体回退默认值。

如果 `charge*` 做成必填，所有老用户的 `physics` 段会立刻整段失效——连他们自己调过的重力、弹性也一起丢。

所以 `physicsValid()` 里对 `charge*` 单独处理：`undefined`/`null` 视为"没写"，跳过校验；写了才检查范围。

反过来，**用户层配置会整段顶掉内置默认值**，所以 `charge*` 必须写进用户层（`~/.dsh/dsh-pet/main-config.jsonc`）才真正生效。安装脚本会自动补齐这一点。

## 桌面端为什么要直接改产物

上游 npm 包只发布 `runtime/electron-helper/*.js` 编译产物，**没有对应源码**。这些产物未压缩、保留注释，因此可以按源码方式打补丁：

- `shared-core.js` 是 `src/shared` 的 rolldown 产物，导出集中在文件末尾的 `exports.X = X`
- `sprite.js` 是 `PetSprite` 类，结构与浏览器端 `pet.ts` 高度对应（同名方法、同样的事件流）

`tools/patch-desktop.mjs` 用**精确锚点 + 命中次数断言**逐个打补丁，任何一处对不上就整体中止（不会留下半残补丁）。上游更新后重跑该脚本即可重新适配，对不上时会明确告诉你哪个锚点变了。

## 文件对应关系

| 逻辑 | 网页端 | 桌面端 |
|---|---|---|
| 蓄力算法 | `src/shared/physics.ts` | `shared-core.js` |
| 事件接线 | `src/client/pet.ts` | `sprite.js` |
| 抛掷驱动 | `startThrow` in `pet.ts` | `startThrow` in `sprite.js` |
| 形变曲线 | `squashScale` | `squashScale`（同一套） |
| 配置校验 | `src/host/config.ts` | 同左（宿主共用） |

两端共用同一份配置（`physics.charge*`），所以不需要配两遍。
