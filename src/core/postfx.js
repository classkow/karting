import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ————— 后期处理链 —————
// Render → GTAO 环境光遮蔽 → 悬停描边 → 选中描边 → 轻量 Bloom → 输出（色调映射）
// MSAA(4x) + HalfFloat 渲染目标保证线条与高光质量。

export function createPostFX(renderer, scene, camera, w, h) {
  const size = new THREE.Vector2(w, h);
  const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4, type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  composer.addPass(new RenderPass(scene, camera));

  try {
    const gtao = new GTAOPass(scene, camera, w, h);
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.updateGtaoMaterial({
      radius: 0.07, distanceExponent: 1.2, thickness: 1, scale: 1.4,
      samples: 12, distanceFallOff: 1, screenSpaceRadius: false,
    });
    composer.addPass(gtao);
  } catch {
    // 环境不支持 GTAO 时优雅降级（跳过该 Pass，不阻断渲染）
  }

  const hoverPass = new OutlinePass(size, scene, camera);
  hoverPass.edgeStrength = 2.4;
  hoverPass.edgeGlow = 0;
  hoverPass.edgeThickness = 1;
  hoverPass.visibleEdgeColor.set('#8fd8ff');
  hoverPass.hiddenEdgeColor.set('#132234');
  composer.addPass(hoverPass);

  const selectPass = new OutlinePass(size, scene, camera);
  selectPass.edgeStrength = 4.6;
  selectPass.edgeGlow = 0.3;
  selectPass.edgeThickness = 1.6;
  selectPass.visibleEdgeColor.set('#ffb547');
  selectPass.hiddenEdgeColor.set('#41300a');
  composer.addPass(selectPass);

  const bloom = new UnrealBloomPass(size.clone(), 0.22, 0.5, 0.92);
  composer.addPass(bloom);

  composer.addPass(new OutputPass());

  function setSize(w, h) {
    composer.setSize(w, h);
  }

  return { composer, hoverPass, selectPass, setSize };
}
