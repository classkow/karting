import * as THREE from 'three';
import { getPart } from '../kart/registry.js';

// ————— 部件拾取：射线拾取 + 描边高亮（由后期链的 OutlinePass 渲染）—————
// hover：淡蓝细描边 + 浮动标签；select：琥珀描边 + 信息卡。

export function initPicking({ canvas, camera, kartRoot, hoverPass, selectPass, onHover, onSelect }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovered = null;
  let selected = null;

  const meshToPart = new Map();
  kartRoot.traverse((o) => {
    if (o.isMesh) {
      let p = o.parent;
      while (p && !p.userData.partId) p = p.parent;
      if (p) meshToPart.set(o, p.userData.partId);
    }
  });

  function partVisible(id) {
    const part = getPart(id);
    return part ? part.visible : false;
  }

  function pick(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(kartRoot, true);
    for (const hit of hits) {
      const id = meshToPart.get(hit.object);
      if (id && partVisible(id)) return id;
    }
    return null;
  }

  function setHover(id, x, y) {
    hovered = id;
    hoverPass.selectedObjects = id ? [getPart(id).group] : [];
    canvas.style.cursor = id ? 'pointer' : 'grab';
    onHover?.(id, x, y);
  }

  function select(id) {
    selected = id;
    selectPass.selectedObjects = id ? [getPart(id).group] : [];
    onSelect?.(id ? getPart(id) : null);
  }

  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons !== 0) {
      if (hovered) setHover(null);
      return;
    }
    setHover(pick(e), e.clientX, e.clientY);
  });
  canvas.addEventListener('pointerleave', () => { if (hovered) setHover(null); });

  let downPos = null;
  canvas.addEventListener('pointerdown', (e) => (downPos = [e.clientX, e.clientY]));
  canvas.addEventListener('pointerup', (e) => {
    if (!downPos || Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) > 5) return;
    select(pick(e));
  });

  return {
    select, // 供部件清单调用
    setHoverExternal(id) {
      // 清单行悬停时高亮 3D 部件（不显示光标标签）
      const pid = id && partVisible(id) ? id : null;
      hoverPass.selectedObjects = pid ? [getPart(pid).group] : hovered ? [getPart(hovered).group] : [];
      if (!pid && !hovered) hoverPass.selectedObjects = [];
    },
  };
}
