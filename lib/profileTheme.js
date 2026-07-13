// Curated banner color presets — pulled from tones already used across the
// app (scoreToneColor, the shared `C` theme objects), so any pick fits in.
export const BANNER_COLORS = [
  { key: 'orange', hex: '#FF6B3D' },
  { key: 'purple', hex: '#8855cc' },
  { key: 'green',  hex: '#00c896' },
  { key: 'red',    hex: '#e5484d' },
  { key: 'amber',  hex: '#f5a524' },
  { key: 'gold',   hex: '#ffd166' },
];

export function bannerColorHex(key) {
  return BANNER_COLORS.find(c => c.key === key)?.hex ?? BANNER_COLORS[0].hex;
}

export const BIO_MAX_LENGTH = 150;
