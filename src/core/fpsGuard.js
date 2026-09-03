// ————— FPS 统计与自动画质降级 —————
// 每 0.5s 汇总一次帧率文本；持续低帧率时回调 onDegrade，保住交互流畅度。
// 采样从 warmup 秒后起算（避开装配/着色器编译抖动期），未达标则继续观察；
// 降级只作用于本次会话（是否写偏好存储由调用方决定——本项目刻意不写）。

export function createFpsGuard({ onDegrade, warmup = 12, threshold = 24 } = {}) {
  let frames = 0;
  let time = 0;
  let totalFrames = 0;
  let totalTime = 0;
  let autoChecked = false;

  return {
    // 返回更新后的帧率文本（未更新时返回 null）
    frame(rawDt) {
      // 跳过切后台恢复等造成的长帧，避免误判
      if (rawDt < 1) {
        frames++;
        time += rawDt;
        totalFrames++;
        totalTime += rawDt;
      }
      let updated = null;
      if (time >= 0.5) {
        updated = Math.round(frames / time) + ' FPS';
        frames = 0;
        time = 0;
      }
      if (!autoChecked && totalTime >= warmup && totalFrames / totalTime < threshold) {
        autoChecked = true;
        onDegrade?.();
      }
      return updated;
    },
  };
}
