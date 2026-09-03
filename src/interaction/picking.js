import * as THREE from 'three';

// ————— 部件拾取：射线拾取 + 描边高亮（由后期链的 OutlinePass 渲染）—————
// hover：淡蓝细描边 + 浮动标签；select：琥珀描边 + 信息卡。
// 性能：悬停射线经 rAF 节流（每帧至多一次），且跳过 InstancedMesh——链条 250+
// 实例逐个求交成本高，链条改从部件清单聚焦/高亮。

export function initPicking({ canvas, camera, kartRoot, registry, hoverPass, selectPass, onHover, onSelect }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovered = null;

  function select(id) {
    selectPass.selectedObjects = id ? [registry.getPart(id).group] : [];
    onSelect?.(id ? registry.getPart(id) : null);
  }

  const meshToPart = new Map();
  const pickables = [];
  kartRoot.traverse((o) => {
    if (o.isMesh && !o.isInstancedMesh) {
      let p = o.parent;
      while (p && !p.userData.partId) p = p.parent;
      if (p) {
        meshToPart.set(o, p.userData.partId);
        pickables.push(o);
      }
    }
  });

  function partVisible(id) {
    const part = registry.getPart(id);
    return part ? part.visible : false;
  }

  function pick(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    for (const hit of hits) {
      const id = meshToPart.get(hit.object);
      if (id && partVisible(id)) return id;
    }
    return null;
  }

  function setHover(id, x, y) {
    hovered = id;
    hoverPass.selectedObjects = id ? [registry.getPart(id).group] : [];
    canvas.style.cursor = id ? 'pointer' : 'grab';
    onHover?.(id, x, y);
  }

  // rAF 节流：pointermove 一帧内可能触发多次，只保留最新坐标，每帧求交一次
  let pending = null;
  let scheduled = false;
  function flushHover() {
    scheduled = false;
    if (!pending) return;
    const [x, y] = pending;
    pending = null;
    setHover(pick(x, y), x, y);
  }

  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons !== 0) {
      pending = null;
      if (hovered) setHover(null);
      return;
    }
    pending = [e.clientX, e.clientY];
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(flushHover);
    }
  });
  canvas.addEventListener('pointerleave', () => {
    pending = null;
    if (hovered) setHover(null);
  });

  let downPos = null;
  canvas.addEventListener('pointerdown', (e) => (downPos = [e.clientX, e.clientY]));
  canvas.addEventListener('pointerup', (e) => {
    if (!downPos || Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) > 5) return;
    select(pick(e.clientX, e.clientY));
  });

  return {
    select, // 供部件清单调用
    setHoverExternal(id) {
      // 清单行悬停时高亮 3D 部件（不显示光标标签）；离开后恢复画布内的悬停高亮
      const pid = (id && partVisible(id) ? id : null) ?? hovered;
      hoverPass.selectedObjects = pid ? [registry.getPart(pid).group] : [];
    },
  };
}
