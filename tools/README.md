# tools/

## patch-desktop.mjs

桌面端补丁生成器。**普通用户不需要运行它** —— `dist/` 里已经是打好补丁的文件，`install.mjs` 直接复制即可。

它存在的意义：dsh-pet 升级后 `runtime/electron-helper/*.js` 会被覆盖，如果上游改了这些文件的结构，`dist/` 里的旧版就不适用了。这时需要**基于新版产物重新打补丁**。

### 用法

1. 先确认目标文件是**未打补丁的上游原版**（从备份恢复，或重装 dsh-pet）
2. 按需修改脚本里的 `DIR` 常量（指向 `runtime/electron-helper/`）
3. 运行：

```bash
node tools/patch-desktop.mjs
```

脚本会：

- 对 `shared-core.js` 和 `sprite.js` 逐点打补丁
- **每个锚点都断言"恰好命中一次"**，任何一处对不上就整体报错中止（不写文件，不会留下半残补丁）
- 打印实际改动的字节数

### 打完之后

把产物复制回仓库并提交：

```bash
cp "<插件目录>/runtime/electron-helper/shared-core.js" dist/shared-core.js
cp "<插件目录>/runtime/electron-helper/sprite.js"       dist/sprite.js
```

### 锚点对不上怎么办

报错信息会指出是哪个补丁点、期望的锚点文本是什么。通常是上游改了这些函数的实现。按报错定位到新版文件里对应的代码，更新脚本里的 `from` 字符串即可。

补丁点共 10 处，注释里都写明了作用：

| 补丁点 | 作用 |
|---|---|
| core: 插入蓄力算法 | 在 `squashScale` 后插入整套蓄力数学与常量 |
| core: 导出蓄力 API | 挂到 `PetShared` 导出上 |
| sprite: 构造函数字段 | 初始化蓄力状态（`chargeStart` 等） |
| sprite: startThrow 签名 | 增加 `gravityScale` 参数并派生 `throwPhysics` |
| sprite: throwStepRegion ×2 | 改用派生后的物理参数 |
| sprite: 插入蓄力方法 | `startCharge` / `runChargeLoop` / `stopCharge` / `disqualifyCharge` / `chargeArmedNow` |
| sprite: onPointerDown 起蓄力 | 按下即进观察期 |
| sprite: onPointerMove 作废判定 | 独立大阈值（30px） |
| sprite: onPointerUp 弹射 | 松手弹出 + 抑制补发 click |

## 网页端怎么重建

网页端是**真源码修改**，改动在 `patches/web-src.patch` 里。想自己从源码构建：

1. 取 dsh-pet 0.3.8 的源码
2. `git apply patches/web-src.patch`
3. 构建客户端与宿主产物：

```bash
npm i -D tsdown@0.8.0 typescript@5
# 配置 tsdown 同时产出 lib/index.js（ESM, platform node）与 lib/client.js（IIFE, platform browser）
npx tsdown
```

`dist/client.js` 与 `dist/index.js` 就是这么来的。构建时 `@deepseek-ai/*`、`react` 等一律 external（由 DSH 运行时提供）。
