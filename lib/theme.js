// Gobbl Signature — shared dark theme. Screens previously each declared their
// own local `const C = {...}`; this is the single source of truth so the
// black/orange/gold rebrand doesn't drift file to file the way the old
// per-screen copies did.
export const THEME = {
  bg: '#000000',
  surface: '#1a1a1a',
  // A translucent white overlay this faint (the mockup's literal
  // rgba(245,245,247,0.05/0.08) values) is essentially invisible in a real
  // RN render against a flat #000000 — the mockup only gets away with it
  // because those cards sit on a lighter radial-gradient backdrop, not flat
  // black. Solid, slightly-elevated dark grays read reliably instead.
  border: 'rgba(245,245,247,0.16)',
  orange: '#FB7238',
  orangeDim: '#E05B22',
  gold: '#E9B872',
  green: '#00c896',
  red: '#ff4444',
  redDim: '#2a0a0a',
  redBorder: '#5a1a1a',
  white: '#f5f5f7',
  gray1: '#888888',
  gray2: '#666666',
  gray3: '#555555',
  gray4: '#444444',
  gray5: '#333333',
  inputBg: '#161616',

  // Glassy card treatment used throughout the mockup — solid, not
  // translucent, so it's visible against flat black (see note on `border`).
  glassBg: '#161616',
  glassBorder: 'rgba(245,245,247,0.16)',

  // Fully pill-shaped controls.
  pill: 999,

  serif: 'InstrumentSerif_400Regular',
  serifItalic: 'InstrumentSerif_400Regular_Italic',
};

export function textAlpha(alpha) {
  return `rgba(245,245,247,${alpha})`;
}
