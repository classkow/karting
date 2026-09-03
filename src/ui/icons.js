// ————— 内联 SVG 图标库（stroke: currentColor）—————

const ICONS = {
  play: '<polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/>',
  eye: '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>',
  'eye-off': '<path d="M4 4l16 16"/><path d="M9.9 5.1A10.7 10.7 0 0 1 12 4.8c6.5 0 10 7.2 10 7.2a17 17 0 0 1-3.3 4.1M6.1 6.5A16.5 16.5 0 0 0 2 12s3.5 7.2 10 7.2a10 10 0 0 0 4-.8"/><path d="M9.9 9.9a2.8 2.8 0 0 0 4 4"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  close: '<path d="M5 5l14 14M19 5L5 19"/>',
  help: '<circle cx="12" cy="12" r="9.2"/><path d="M9.3 9.2a2.8 2.8 0 0 1 5.5.7c0 1.9-2.7 2.2-2.7 4"/><circle cx="12" cy="17.6" r="0.4" fill="currentColor"/>',
  chevron: '<path d="M8 10l4 4 4-4"/>',
  volume: '<path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4z" fill="currentColor" stroke="none"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"/>',
  'volume-off': '<path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4z" fill="currentColor" stroke="none"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  spark: '<path d="M13 2L5 13h5l-1 9 8-11h-5l1-9z" fill="currentColor" stroke="none"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  gauge: '<path d="M5 19a9 9 0 1 1 14 0"/><path d="M12 14l3.5-4.5"/><circle cx="12" cy="14" r="1.4" fill="currentColor" stroke="none"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="10" y="10" width="4" height="4"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
};

export function icon(name, size = 15) {
  const body = ICONS[name] ?? '';
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
