// ————— 演示序列脚本单元测试 —————
// 运行：npm test（node --test 显式列文件，勿改回目录模式，Windows 有坑）。
// 断言独立实现（不复用 demoScripts.validateDemoScript，避免"自己验自己"）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_SCRIPTS } from '../src/ui/demoScripts.js';
import { VIEWS } from '../src/interaction/views.js';

const RANGES = {
  steer: [-1, 1],
  throttle: [-1, 1],
  explode: [0, 1],
};

test('演示脚本：id/label 唯一且非空，actions 非空', () => {
  assert.ok(DEMO_SCRIPTS.length >= 3, '至少内置 3 条脚本');
  const ids = new Set();
  for (const s of DEMO_SCRIPTS) {
    assert.ok(typeof s.id === 'string' && s.id, 'id 非空');
    assert.ok(!ids.has(s.id), `id 重复: ${s.id}`);
    ids.add(s.id);
    assert.ok(typeof s.label === 'string' && s.label, 'label 非空');
    assert.ok(Array.isArray(s.actions) && s.actions.length > 0, 'actions 非空数组');
  }
});

test('演示脚本：actions 按 t 升序且 t 非负', () => {
  for (const s of DEMO_SCRIPTS) {
    let prev = -Infinity;
    for (const [i, a] of s.actions.entries()) {
      assert.ok(Number.isFinite(a.t) && a.t >= 0, `${s.id} actions[${i}] t 非法: ${a.t}`);
      assert.ok(a.t >= prev, `${s.id} actions[${i}] t=${a.t} 破坏升序（上一动作 t=${prev}）`);
      prev = a.t;
    }
  }
});

test('演示脚本：view 键存在于 VIEWS', () => {
  for (const s of DEMO_SCRIPTS) {
    for (const a of s.actions) {
      if ('view' in a) {
        assert.ok(a.view in VIEWS, `${s.id} view 不存在: ${a.view}`);
      }
    }
  }
});

test('演示脚本：数值字段在合法范围（steer/throttle/explode/jacking/scale）', () => {
  for (const s of DEMO_SCRIPTS) {
    for (const [i, a] of s.actions.entries()) {
      for (const [k, [lo, hi]] of Object.entries(RANGES)) {
        if (k in a) {
          assert.ok(Number.isFinite(a[k]) && a[k] >= lo && a[k] <= hi,
            `${s.id} actions[${i}] ${k}=${a[k]} 越界 [${lo},${hi}]`);
        }
      }
      if ('jacking' in a) {
        assert.ok(a.jacking === 0 || a.jacking === 1, `${s.id} actions[${i}] jacking 只允许 0/1`);
      }
      if ('scale' in a) {
        assert.ok([1, 4, 8].includes(a.scale), `${s.id} actions[${i}] scale 只允许 1/4/8`);
      }
    }
  }
});

test('演示脚本：duration ≥ 最后动作 t', () => {
  for (const s of DEMO_SCRIPTS) {
    assert.ok(Number.isFinite(s.duration) && s.duration > 0, `${s.id} duration 非法`);
    const lastT = s.actions[s.actions.length - 1].t;
    assert.ok(s.duration >= lastT, `${s.id} duration(${s.duration}) < 最后动作 t(${lastT})`);
  }
});

test('演示脚本：每条至少 3 条 caption 且全部为非空中文', () => {
  for (const s of DEMO_SCRIPTS) {
    const captions = s.actions
      .map((a) => a.caption)
      .filter((c) => typeof c === 'string' && c.length > 0);
    assert.ok(captions.length >= 3, `${s.id} caption 仅 ${captions.length} 条（要求 ≥3）`);
    for (const [i, a] of s.actions.entries()) {
      if ('caption' in a && a.caption !== null) {
        assert.ok(typeof a.caption === 'string' && a.caption.trim() !== '',
          `${s.id} actions[${i}] caption 为空`);
        assert.ok(/[\u4e00-\u9fff]/.test(a.caption), `${s.id} actions[${i}] caption 不含中文: ${a.caption}`);
      }
    }
  }
});
