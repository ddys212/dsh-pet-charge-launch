# NOTICE — 来源与修改清单

## 上游

| 项 | 值 |
|---|---|
| 项目 | dsh-pet |
| 仓库 | https://github.com/PC2005-cloud/dsh-pet |
| 作者 | PC2005-cloud |
| 版本（本补丁基准） | 0.3.8 |
| 许可证 | MIT（见 [LICENSE](LICENSE)，版权归 PC2005-cloud） |

本仓库包含该项目的若干**修改版本文件**。按 MIT 许可证要求，原始版权声明与许可全文已保留在 [LICENSE](LICENSE) 中。

## 本仓库新增的内容

以下文件为**本补丁原创**，不来自上游：

- `install.mjs` —— 安装 / 校验 / 回滚脚本
- `config/charge-defaults.json` —— 蓄力参数的默认值
- `tools/patch-desktop.mjs` —— 桌面端补丁生成器（上游更新后用于重新适配）
- `patches/web-src.patch` —— 网页端源码改动的 unified diff（供审阅与重建）
- `README.md` / `NOTICE.md` / `docs/` —— 文档

## 被修改的上游文件

### 网页端（源码修改 → 重新构建）

对应 `patches/web-src.patch`，涉及 6 个 TypeScript 源文件：

| 源文件 | 改动 |
|---|---|
| `src/shared/physics.ts` | 新增蓄力弹射的纯函数：`chargeParamsOf` / `chargeProgress` / `chargeSquash` / `chargeArmed` / `chargeSpeed` / `chargeVelocity` 及常量 |
| `src/shared/types.ts` | `PhysicsParams` 增加 8 个可选 `charge*` 字段 |
| `src/shared/constants.ts` | 新增 `CHARGE_DRAG_THRESHOLD = 30`（蓄力期间转入拖拽的独立阈值） |
| `src/client/pet.ts` | 蓄力状态机与事件接线；`startThrow` 增加 `gravityScale` 参数；抑制补发 click |
| `src/client/settings.ts` | 设置面板新增「蓄力弹射」卡片、校验与中英文案 |
| `src/host/config.ts` | 配置校验接受 `charge*`（可选键，缺失不判非法，避免老配置整段失效） |

由上述源码构建出的产物即 `dist/client.js`（浏览器端）与 `dist/index.js`（宿主端）。

### 桌面端（直接修补编译产物）

`runtime/electron-helper/` 在上游 npm 包中**只发布编译产物、没有源码**。因此这两份是直接对产物打补丁：

| 产物 | 改动 |
|---|---|
| `runtime/electron-helper/shared-core.js` | 内联同一套蓄力算法并挂到 `PetShared` 导出上（`dist/shared-core.js`） |
| `runtime/electron-helper/sprite.js` | `PetSprite` 增加蓄力方法；`onPointerDown/Move/Up` 接线；`startThrow` 支持重力缩放；抑制补发 click（`dist/sprite.js`） |

补丁过程可复现：`tools/patch-desktop.mjs` 对**未改动的上游产物**逐点打补丁，并校验每个锚点恰好命中一次。脚本顶部注释说明了各补丁点的作用。

## 未改动的部分

宠物素材（图片 / 视频 / 表情包）、动画定义、网络请求、余额与碎碎念逻辑、菜单与对话框、桌面端的窗口管理与穿透逻辑，均未改动。

## 商标与归属

"dsh-pet"、"DeepSeek Harness" 等名称与标识归各自权利人所有。本仓库为非官方补丁，与上游作者及 DeepSeek 官方无隶属关系。
