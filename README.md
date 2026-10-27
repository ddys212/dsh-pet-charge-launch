# dsh-pet 蓄力弹射补丁

给 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（DeepSeek Harness 桌宠插件）加一个**蓄力压缩弹射**的交互：

> **按住宠物不放 → 它越压越扁 → 松手整体向上弹出。压得越扁，弹得越快。**

网页里的宠物和桌面悬浮窗都支持。

> ⚠️ 这是**第三方非官方补丁**，不是 dsh-pet 官方功能。基于 dsh-pet **0.3.8** 制作。

---

## 效果

| 按住时长 | 高度压缩到 | 松手初速 | 手感 |
|---|---|---|---|
| 不到 0.5 秒 | 不形变 | 不弹（正常点击） | 与原生一致 |
| 0.5 秒 | 开始变扁 | 刚能动 | 轻微弹动 |
| 1.2 秒 | 61% | 886 px/s | 明显弹出 |
| 2.0 秒（蓄满） | 45% | 3000 px/s | 全速飞出，不再变 |

- 默认**无重力**：弹出后匀速直线飞，碰到屏幕边缘反弹，不会掉下来（可调）
- 蓄力期间一旦拖动超过 30px，或再次点击，本次按压不算蓄力，走原有拖拽/点击逻辑
- 所有参数都能在「设置 → 桌宠配置 → 蓄力弹射」里调，也能直接改配置

---

## 安装

需要 **Node.js 18+**（只用标准库，不需要 `npm install`）。

```bash
git clone <本仓库地址>
cd dsh-pet-charge-launch

# 先看看会改哪些文件（不写入）
node install.mjs --verify

# 安装
node install.mjs

# 安装，并顺便把宠物显示位置改成「桌面 + 网页」
node install.mjs --with-desktop
```

装完**完全退出并重新启动 DSH**。网页端的插件代码是页面加载时注入的，不重启看到的还是旧代码（至少按 `Ctrl+F5` 强制刷新页面）。

### 装了但没反应？先确认是不是真的加载了

按 `F12` 打开控制台，按住宠物不动，应该看到：

```
[dsh-pet] ... [charge] 已按下 arm=500ms full=1500ms speed=10x g=0
[dsh-pet] ... [charge] 观察期结束，开始压扁
[dsh-pet] ... charge hold=1200ms p=0.47 g=0 vy=-886 |v|=886
```

- **一条都没有** → 新代码没加载，重启 DSH（确认进程真的退出了，不是只关窗口）
- **只有前两条** → 松手被判成了拖拽或点击，看是否手抖超过了阈值，可调大 `chargeArmMs` 或检查是否有其它操作
- **第三条出现但仍不飞** → 把控制台日志开出来提 issue

### 手动指定路径

自动探测失败时：

```bash
node install.mjs --plugin-dir "/path/to/.dsh/profiles/desktop/node_modules/dsh-pet"
node install.mjs --dsh-home "/path/to/.dsh"
```

默认查找 `<DSH_HOME>/profiles/*/node_modules/dsh-pet`，`DSH_HOME` 默认 `~/.dsh`。

---

## 配置

装好后再「设置 → 桌宠配置」底部会多出**蓄力弹射**卡片，也能直接改 `~/.dsh/dsh-pet/main-config.jsonc` 的 `physics` 段：

| 键 | 默认 | 说明 |
|---|---|---|
| `chargeEnabled` | `true` | 总开关 |
| `chargeArmMs` | `500` | 起步时间（ms）。按住超过它才开始变扁；此期间拖动/再点即取消 |
| `chargeFullMs` | `1500` | 蓄力时间（ms）。从开始变扁到完全蓄满 |
| `chargeSquashSpeed` | `1` | 形变速度倍率。`>1` 压得更快，只改快慢不改力度 |
| `chargeSpeedPerSize` | `10` | **蓄满时**每秒飞过几个宠物身宽（300px 宠物 ≈ 3000px/s） |
| `chargeGravityScale` | `0` | 弹射时的重力倍率。`0` = 匀速直线；`1` = 与普通甩抛相同 |
| `chargePower` | `1` | 力度倍率，乘在上面那个速度上 |
| `chargeSquash` | `0.45` | 蓄满时的高度比例，`0.45` = 压到 45% |

> **注意**：`physics` 段是**整段替换**语义——你在 `main-config.jsonc` 里写了 `physics`，就会整段顶掉插件内置默认值。所以这些 `charge*` 键必须写在你的用户配置里才生效（本补丁的安装脚本会自动补齐）。

---

## 回滚

```bash
node install.mjs --rollback
```

会把 `client.js` / `index.js` / 桌面端两份文件 / `main-config.jsonc` 全部还原到安装前的备份（逐字节还原）。然后重启 DSH。

> 插件更新（`npm update` 或重装 dsh-pet）会覆盖掉本补丁，重跑一次 `node install.mjs` 即可恢复。

---

## 它是怎么实现的

改动集中在 4 个文件：

| 文件 | 改了什么 |
|---|---|
| `dist/client.js` | 网页端插件产物（由源码重新构建） |
| `dist/index.js` | 宿主端产物（配置校验支持 `charge*`，否则设置面板存不住） |
| `dist/shared-core.js` | 桌面端共享物理层：蓄力算法 |
| `dist/sprite.js` | 桌面端宠物本体：事件接线 |

**两段式时间轴**：观察期（`chargeArmMs`）内完全不形变，是"判断你想拖还是想蓄力"的窗口；越过之后才逐渐压扁，到 `chargeArmMs + chargeFullMs` 蓄满。

**力度**：`速度 = 身宽 × chargeSpeedPerSize × 进度^1.6 × chargePower`。指数 1.6 让前段平缓、后段陡峭，所以"多按一会儿"能明显感觉到力度在攒。

**形变**：复用 dsh-pet 原有的 `squashScale` 曲线（就是点击时那个 Q 弹），只取它的下压段。

### 开发过程中踩到的两个坑（都值得记一下）

1. **补发的 click 会掐掉抛掷**：浏览器在 `pointerup` 后还会补发一次 `click`，而 `onClick` 第一件事就是 `stopThrow()` —— 刚起飞的抛掷当场被取消，表现为"压缩正常，就是不飞"。修法是弹射后设 `justDragged` 标记跳过这次 click（拖拽甩飞原本就有这层保护，蓄力路径漏了）。

2. **拖拽阈值 5px 会误杀蓄力**：按住不动等蓄力时，手会自然抖动 1~10px。原来的拖拽判定是 5px，一抖就被判成"拖拽"，蓄力资格被永久取消。修法是给蓄力单独一个 `CHARGE_DRAG_THRESHOLD = 30`：拖拽启动仍用 5px（保持跟手），只有真拖走超过 30px 才取消蓄力。

细节见 [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md)。

---

## 已知限制

- **桌面端的两份是预编译产物**：`runtime/electron-helper/*.js` 没有随包发布源码，所以是直接对编译产物打补丁（好在未压缩、可读）。网页端则是完整源码构建。
- 只在 **Windows** 上实测过。macOS / Linux 理论上一致（都是同一套 Chromium/Electron），但未验证。
- 与 dsh-pet **0.3.8** 配套。插件升级后文件结构若变化，补丁可能失效（安装脚本会提示版本不一致）。
- 不修改宠物素材、动画、网络行为，只动交互与物理。

---

## 许可与致谢

- 本补丁遵循 **MIT**，与上游一致，见 [LICENSE](LICENSE)。
- 原始项目：[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，版权归其作者 **PC2005-cloud** 所有。
- 本仓库包含的 `dist/` 是对该 MIT 项目产物的修改版本，按 MIT 要求保留原始版权声明。
- 上游若愿意收编这个功能，欢迎直接把改动合并回去，本仓库即可废弃。

修改清单与来源说明见 [NOTICE.md](NOTICE.md)。
