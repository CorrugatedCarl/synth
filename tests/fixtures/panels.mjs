// Fixture hardware layouts for the tests (IMPL-panels §6.2 / §6.3 special areas) on the real models.js models: positions
// illustrative (the AUTHORS' panels/<model>.js carry the research ones). Not a test file itself: tests/cv-panel.test.mjs
// renders them on wk-dom; the page simulations load them through globalThis.__synthTest.panels (cv-panel usable()).
export const TB_FX = (() => {
  const keys = Array.from({ length: 13 }, (_, i) => ({ id: 'seq:key', kind: 'button', note: i, x: 80 + i * 15.5, y: 105, w: 7, h: 12, hit: [15, 20], led: 'above' }));
  const row = ['seq:down', 'seq:up', 'seq:accent', 'seq:slide', 'seq:back', 'seq:next'].map((id, i) => ({ id, kind: 'button', x: 90 + i * 20, y: 130, w: 12, h: 6 }));
  return {
    v: 1, id: 'tb303', hw: 'fixture', scheme: { panel: '#cfcfcb', legend: '#111111' },
    areas: [{ id: 'main', src: [0, 0, 300, 146], at: [0, 0] }],
    sections: [{ id: 'top', label: 'TOP', x: 0, y: 0, w: 300, h: 30, frame: 'none' }, { id: 'mid', label: 'MID', x: 0, y: 30, w: 300, h: 45, frame: 'none' },
      { id: 'prog', label: 'PROGRAM', x: 0, y: 75, w: 300, h: 71, frame: 'box' }],
    controls: [
      { id: 'wf', kind: 'switch', style: 'slide', orient: 'h', x: 20, y: 12, w: 12, h: 5, legends: ['SAW', 'SQUARE'] },
      ...['tu', 'cf', 'rs', 'em', 'dc', 'ac'].map((id, i) => ({ id, kind: 'knob', x: 70 + i * 22, y: 15, d: 15.5 })),
      { id: 'seq:tempo', kind: 'knob', x: 40, y: 52, d: 23, label: 'TEMPO' },
      { id: 'vol', kind: 'knob', x: 260, y: 52, d: 23, label: 'VOLUME' },
      { id: 'seq:runLed', kind: 'led', x: 25, y: 88, d: 3 },
      { id: 'seq:run', kind: 'button', x: 25, y: 100, w: 18, h: 11.6, label: 'RUN/STOP' },
      { id: 'seq:clear', kind: 'button', x: 25, y: 125, w: 14, h: 6, label: 'PATTERN CLEAR' },
      { id: 'seq:pitch', kind: 'button', x: 55, y: 95, w: 12, h: 6, label: 'PITCH MODE' },
      { id: 'seq:time', kind: 'button', x: 55, y: 120, w: 12, h: 6, label: 'TIME MODE' },
      ...keys, ...row,
    ],
    decor: [],
    extras: { ids: ['al', 'seq:sync', 'seq:swing', 'seq:random', 'seq:demo', 'seq:toRoll', 'seq:grid'] },
  };
})();
export const DX_FX = (() => {
  const btns = Array.from({ length: 32 }, (_, i) => ({ id: 'dx:btn', kind: 'button', n: i + 1, x: 500 + (i % 16) * 21.1, y: i < 16 ? 100 : 125, w: 19, h: 9.5, label: 'B' + (i + 1) }));
  return {
    v: 1, id: 'dx7', hw: 'fixture', scheme: { panel: '#3a2a22', legend: '#eeeeee' },
    areas: [{ id: 'main', src: [0, 0, 1018, 172], at: [0, 0] }],
    sections: [{ id: 'graphics', label: 'GRAPHICS', x: 0, y: 0, w: 1018, h: 75, frame: 'none' }, { id: 'strip', label: 'STRIP', x: 0, y: 75, w: 1018, h: 97, frame: 'none' }],
    controls: [
      { id: 'dx:chart', kind: 'display', x: 660, y: 40, w: 330, h: 50 },
      { id: 'vol', kind: 'slider', x: 96, y: 120, len: 40, cap: [10, 6], label: 'VOLUME' },
      { id: 'dx:data', kind: 'slider', x: 147, y: 120, len: 40, cap: [10, 6], label: 'DATA ENTRY' },
      { id: 'dx:no', kind: 'button', x: 177, y: 120, w: 12, h: 8 }, { id: 'dx:yes', kind: 'button', x: 198, y: 120, w: 12, h: 8 },
      { id: 'dx:opsel', kind: 'button', x: 240, y: 110, w: 14, h: 8 }, { id: 'dx:edit', kind: 'button', x: 260, y: 110, w: 14, h: 8 },
      { id: 'dx:function', kind: 'button', x: 280, y: 110, w: 14, h: 8 }, { id: 'dx:memInt', kind: 'button', x: 300, y: 110, w: 14, h: 8 },
      { id: 'dx:led', kind: 'display', x: 360, y: 110, w: 20, h: 12 }, { id: 'dx:lcd', kind: 'display', x: 430, y: 110, w: 60, h: 14 },
      ...btns,
    ],
    decor: [],
    extras: { ids: ['dac'] },
  };
})();
