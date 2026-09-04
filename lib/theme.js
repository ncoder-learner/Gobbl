// Gobbl Signature — shared dark theme. Screens previously each declared their
// own local `const C = {...}`; this is the single source of truth so the
// black/orange/gold rebrand doesn't drift file to file the way the old
// per-screen copies did.
export const THEME = {
  bg: '#000000',
  surface: '#171717',
  border: '#363636',
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

  glassBg: '#171717',
  glassBorder: '#363636',

  // Fully pill-shaped controls.
  pill: 8,

  serif: 'InstrumentSerif_400Regular',
  serifItalic: 'InstrumentSerif_400Regular_Italic',
};

export function textAlpha(alpha) {
  return `rgba(245,245,247,${alpha})`;
}
