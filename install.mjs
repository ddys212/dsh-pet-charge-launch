#!/usr/bin/env node
/**
 * dsh-pet 蓄力弹射补丁 —— 安装 / 回滚脚本
 *
 * 用法：
 *   node install.mjs                  安装到自动探测到的 dsh-pet 插件目录
 *   node install.mjs --with-desktop   安装，并把宠物显示位置设为「桌面 + 网页」
 *   node install.mjs --verify         只检查环境与将要安装的文件，不写入
 *   node install.mjs --rollback       回滚到最近一次备份
 *   node install.mjs --plugin-dir <path>   手动指定插件目录
 *   node install.mjs --dsh-home <path>    手动指定 DSH 数据目录（默认 ~/.dsh）
 *
 * 设计要点：
 *   - 所有文件按**字节**复制，不经过文本编码转换（避免中文配置被写坏）；
 *   - 覆盖前先备份，`--rollback` 可逐字节还原；
 *   - 用户配置只**补齐**缺失的 charge* 键，绝不覆盖你已调好的参数；
 *   - 插件目录/DSH 目录自动探测，也支持手动指定（跨平台）。
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  readdirSync,
  statSync,
  mkdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, 'dist');

// ---------- 命令行参数 ----------
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const DO_ROLLBACK = flags.has('--rollback');
const VERIFY_ONLY = flags.has('--verify');
const WITH_DESKTOP = flags.has('--with-desktop');

const DSH_HOME =
  opt('--dsh-home') || process.env.DSH_HOME || join(homedir(), '.dsh');

const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\..+/, '');

/** 安装前原始快照的后缀。只在第一次安装时写入，之后永不覆盖——回滚靠它才可靠。 */
const ORIG_SUFFIX = '.orig-charge-launch';

let failed = 0;
const ok = (m) => console.log('  \x1b[32m✓\x1b[0m ' + m);
const info = (m) => console.log('  \x1b[90m·\x1b[0m ' + m);
const warn = (m) => console.log('  \x1b[33m!\x1b[0m ' + m);
const bad = (m) => {
  failed++;
  console.log('  \x1b[31m✗\x1b[0m ' + m);
};
const die = (m) => {
  console.error('\n\x1b[31m✗ ' + m + '\x1b[0m\n');
  process.exit(1);
};

/** 去掉 JSONC 的注释与尾逗号后解析（用户配置可能带注释） */
function parseJsonc(text) {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') {
        out += n ?? '';
        i += 2;
        continue;
      }
      if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      i++;
      continue;
    }
    if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

// ---------- 定位插件目录 ----------
function findPluginDir() {
  const explicit = opt('--plugin-dir');
  if (explicit) return explicit;

  const candidates = [];
  // 常见布局：<dsh home>/profiles/<profile>/node_modules/dsh-pet
  const profiles = join(DSH_HOME, 'profiles');
  if (existsSync(profiles)) {
    for (const name of readdirSync(profiles)) {
      candidates.push(join(profiles, name, 'node_modules', 'dsh-pet'));
    }
  }
  // 少数布局：直接装在 home 下
  candidates.push(join(DSH_HOME, 'node_modules', 'dsh-pet'));
  candidates.push(join(DSH_HOME, 'dsh-pet'));

  return candidates.find((c) => existsSync(join(c, 'package.json')));
}

console.log('\n\x1b[1mdsh-pet 蓄力弹射补丁\x1b[0m');
console.log('DSH 数据目录：' + DSH_HOME);

const PLUGIN = findPluginDir();
if (!PLUGIN || !existsSync(join(PLUGIN, 'package.json'))) {
  die(
    '没有找到 dsh-pet 插件目录。\n' +
      '  请确认已安装 dsh-pet 插件，或用 --plugin-dir 手动指定，例如：\n' +
      '    node install.mjs --plugin-dir "C:\\Users\\你\\.dsh\\profiles\\desktop\\node_modules\\dsh-pet"',
  );
}

let pkg;
try {
  pkg = JSON.parse(readFileSync(join(PLUGIN, 'package.json'), 'utf8'));
} catch (e) {
  die('插件 package.json 读不出来：' + e.message);
}
if (pkg.name !== 'dsh-pet') die('目标目录不是 dsh-pet（package.json name=' + pkg.name + '）');

console.log('插件目录：' + PLUGIN);
console.log('插件版本：' + pkg.version + '（本补丁基于 0.3.8 制作）');
if (!/^0\.3\./.test(pkg.version)) {
  warn('版本与制作基准（0.3.8）不同，补丁可能不适用。建议先 --verify 检查，或改用 --rollback 回退。');
}

// ---------- 目标文件清单 ----------
const FILES = [
  { src: 'client.js', dst: join(PLUGIN, 'lib', 'client.js'), label: 'lib/client.js（网页端）', required: true },
  { src: 'index.js', dst: join(PLUGIN, 'lib', 'index.js'), label: 'lib/index.js（宿主）', required: true },
  {
    src: 'shared-core.js',
    dst: join(PLUGIN, 'runtime', 'electron-helper', 'shared-core.js'),
    label: 'runtime/electron-helper/shared-core.js（桌面端物理）',
    required: false,
  },
  {
    src: 'sprite.js',
    dst: join(PLUGIN, 'runtime', 'electron-helper', 'sprite.js'),
    label: 'runtime/electron-helper/sprite.js（桌面端本体）',
    required: false,
  },
];

// ---------- 回滚 ----------
if (DO_ROLLBACK) {
  console.log('\n\x1b[1m回滚\x1b[0m');
  let restored = 0;
  for (const f of FILES) {
    const dir = dirname(f.dst);
    if (!existsSync(dir)) continue;
    const base = f.dst.slice(dir.length + 1);
    // 优先用「安装前原始快照」：它只在第一次安装时创建、之后永不覆盖。
    // 为什么不能用最近一次 .bak-*：第二次安装时打出的备份里已经是**打过补丁**的文件，
    // 拿它回滚等于什么都没做（这个坑在测试里被抓到过）。
    const orig = f.dst + ORIG_SUFFIX;
    if (existsSync(orig)) {
      copyFileSync(orig, f.dst);
      ok(base + ' ← 安装前原始快照');
      restored++;
      continue;
    }
    // 兼容老版本脚本留下的备份：取**最旧**的一份（= 最早那次安装前的状态）
    const baks = readdirSync(dir)
      .filter((n) => n.startsWith(base + '.bak-'))
      .map((n) => join(dir, n))
      .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
    if (baks.length) {
      copyFileSync(baks[0], f.dst);
      ok(base + ' ← ' + baks[0].slice(dir.length + 1) + '（最旧备份）');
      restored++;
    }
  }
  // 用户配置一并回滚
  const userCfg = join(DSH_HOME, 'dsh-pet', 'main-config.jsonc');
  const userOrig = userCfg + ORIG_SUFFIX;
  if (existsSync(userOrig)) {
    copyFileSync(userOrig, userCfg);
    ok('main-config.jsonc ← 安装前原始快照');
    restored++;
  } else if (existsSync(userCfg)) {
    const dir = dirname(userCfg);
    const baks = readdirSync(dir)
      .filter((n) => n.startsWith('main-config.jsonc.bak-'))
      .map((n) => join(dir, n))
      .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
    if (baks.length) {
      copyFileSync(baks[0], userCfg);
      ok('main-config.jsonc ← ' + baks[0].slice(dir.length + 1) + '（最旧备份）');
      restored++;
    }
  }
  if (!restored) die('没有找到任何备份，无法回滚（可能从未安装过本补丁）。');
  console.log('\n共还原 ' + restored + ' 个文件。\n\x1b[33m请完全退出并重新启动 DSH 使改动生效。\x1b[0m\n');
  process.exit(0);
}

// ---------- 安装前检查 ----------
console.log('\n\x1b[1m1/3 检查待安装文件\x1b[0m');
for (const f of FILES) {
  const p = join(DIST, f.src);
  if (!existsSync(p)) {
    if (f.required) die('缺少必需文件：' + p);
    warn('缺少可选文件：' + p + '（将跳过该项）');
    f.skip = true;
    continue;
  }
  if (!existsSync(dirname(f.dst))) {
    f.skip = true;
    info(f.label + ' → 目标目录不存在，跳过');
    continue;
  }
  ok(f.label + '（' + statSync(p).size + ' 字节）');
  f.install = true;
}

// 用户配置
const USER_DIR = join(DSH_HOME, 'dsh-pet');
const USER_CFG = join(USER_DIR, 'main-config.jsonc');
let chargeDefaults;
try {
  chargeDefaults = JSON.parse(readFileSync(join(HERE, 'config', 'charge-defaults.json'), 'utf8'));
} catch (e) {
  die('config/charge-defaults.json 读不出来：' + e.message);
}

if (VERIFY_ONLY) {
  console.log('\n\x1b[1m仅检查模式，未写入任何文件。\x1b[0m');
  console.log('用户配置路径：' + USER_CFG + (existsSync(USER_CFG) ? '（已存在）' : '（不存在，安装时会创建）'));
  console.log('');
  process.exit(failed ? 1 : 0);
}

if (failed) die('检查未通过，已中止（未写入任何文件）。');

// ---------- 备份 + 写入 ----------
console.log('\n\x1b[1m2/3 备份并安装\x1b[0m');
for (const f of FILES) {
  if (!f.install) continue;
  if (existsSync(f.dst)) {
    // 每次安装都留一份带时间戳的备份（便于排查）
    copyFileSync(f.dst, f.dst + '.bak-' + stamp);
    // 「安装前原始快照」只写一次：重复安装时**绝不覆盖**，
    // 否则快照会变成"上一版补丁"，回滚就恢复不到原状了（测试里踩过）
    if (!existsSync(f.dst + ORIG_SUFFIX)) {
      copyFileSync(f.dst, f.dst + ORIG_SUFFIX);
    }
  }
  writeFileSync(f.dst, readFileSync(join(DIST, f.src)));
  ok('已安装 ' + f.label + '（' + statSync(f.dst).size + ' 字节）');
}

// ---------- 用户配置：只补缺失的键 ----------
console.log('\n\x1b[1m3/3 用户配置\x1b[0m');
// 全新用户（没有 main-config.jsonc）时**绝不能**写入 `pets: []`：
// 用户层的 pets 是整段替换语义，写空数组等于把插件内置的宠物列表整个清空——
// 用户装完补丁会发现宠物不见了。所以这里只写 physics 段，pets 一律不碰：
// 文件里原来没有 pets 键，就保持没有，让插件继续用内置默认。
let userDoc = {};
if (existsSync(USER_CFG)) {
  try {
    userDoc = parseJsonc(readFileSync(USER_CFG, 'utf8'));
  } catch (e) {
    die('现有 main-config.jsonc 解析失败，为安全起见不修改它：' + e.message);
  }
  copyFileSync(USER_CFG, USER_CFG + '.bak-' + stamp);
  // 只在第一次留下"安装前原始快照"，之后不再覆盖（回滚靠它）
  if (!existsSync(USER_CFG + ORIG_SUFFIX)) {
    copyFileSync(USER_CFG, USER_CFG + ORIG_SUFFIX);
  }
  ok('已备份 main-config.jsonc → main-config.jsonc.bak-' + stamp);
} else {
  mkdirSync(USER_DIR, { recursive: true });
  info('用户配置不存在，将新建一份（只写 physics 段，不动宠物列表）');
}

userDoc.physics = userDoc.physics || {};
const added = [];
for (const [k, v] of Object.entries(chargeDefaults)) {
  if (!(k in userDoc.physics)) {
    userDoc.physics[k] = v;
    added.push(k);
  }
}
// 没写过 chargeEnabled 就一定打开；写过则尊重用户
if (!('chargeEnabled' in userDoc.physics) || added.includes('chargeEnabled')) {
  userDoc.physics.chargeEnabled = true;
}

// --with-desktop：把宠物显示位置设为「桌面 + 网页」
if (WITH_DESKTOP) {
  if (Array.isArray(userDoc.pets) && userDoc.pets.length) {
    for (const p of userDoc.pets) {
      if (p && p.display === 'web') {
        p.display = 'both';
        ok('宠物「' + (p.name || p.id) + '」显示位置：网页 → 桌面 + 网页');
      }
    }
  } else {
    // 没有自定义宠物条目 = 用的是插件内置默认宠物，这里**不能**凭空造一个 pets 数组
    // （那会把内置列表顶掉）。提示用户去设置面板改，最安全。
    info('你的配置里没有自定义宠物列表（用的是插件内置宠物），无法在此改显示位置');
    info('→ 请在「设置 → 桌宠配置 → 宠物列表」里把显示位置改成「桌面 + 网页」');
  }
}

writeFileSync(USER_CFG, Buffer.from(JSON.stringify(userDoc, null, 2) + '\n', 'utf8'));
if (added.length) {
  ok('已补齐蓄力参数：' + added.join(', '));
} else {
  ok('蓄力参数已齐备，保持你原有的值不变');
}

const ph = userDoc.physics;
console.log(
  '  当前生效：' +
    ['chargeArmMs', 'chargeFullMs', 'chargeSquashSpeed', 'chargeSpeedPerSize', 'chargeGravityScale', 'chargeSquash']
      .filter((k) => k in ph)
      .map((k) => k + '=' + ph[k])
      .join('  '),
);

// ---------- 收尾 ----------
console.log('\n\x1b[32m\x1b[1m安装完成\x1b[0m');
console.log('');
console.log('\x1b[1m接下来必须做\x1b[0m：完全退出并重新启动 DSH —— 网页端的插件代码是页面加载时注入的，');
console.log('不重启（或至少强制刷新页面 Ctrl+F5）看到的还是旧代码。');
console.log('');
console.log('用法：按住宠物立绘不动 → 越压越扁 → 松手向上弹出（压得越扁弹得越快）。');
console.log('参数在「设置 → 桌宠配置 → 蓄力弹射」里调整。');
if (!WITH_DESKTOP && Array.isArray(userDoc.pets) && userDoc.pets.every((p) => p.display === 'web')) {
  console.log('');
  console.log('\x1b[33m提示\x1b[0m：你的宠物当前只在网页显示。想让桌面悬浮窗也有这功能，');
  console.log('      把显示位置改成「桌面 + 网页」，或重跑：node install.mjs --with-desktop');
}
console.log('');
console.log('回滚：node install.mjs --rollback');
console.log('');
