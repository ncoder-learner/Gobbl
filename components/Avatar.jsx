import { useEffect } from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';

// One initial per word — a single-word name ("rizx") gets one letter, not
// first+last-character ("RZ"), which read as a made-up pair of initials.
// Multi-word names ("Maya Chen") still get first-word + last-word initials.
function initialsFromName(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0][0].toUpperCase();
}

// profiles.first_name/last_name (structured, from the post-signup profile
// step) take priority over display_name (free text, may or may not be two
// words) over username (always present, but a single "word" by
// construction — usernames can't contain spaces).
function initialsFor({ firstName, lastName, displayName, username }) {
  const f = firstName?.trim()?.[0];
  const l = lastName?.trim()?.[0];
  if (f && l) return (f + l).toUpperCase();
  if (f) return f.toUpperCase();
  if (l) return l.toUpperCase();
  return initialsFromName(displayName) || initialsFromName(username) || '?';
}

// Single shared avatar: profile photo if present, otherwise initials on a
// neutral background. Used anywhere a profile photo renders (map pins,
// SlotViewer, profile headers, comments) so the fallback treatment never
// drifts between screens.
// `onLoadEnd` is optional and only needed by callers that must know when
// the photo (or the decision that there isn't one) has actually rendered —
// e.g. MapScreen's markers, see PinMarker for why.
export default function Avatar({ uri, firstName, lastName, displayName, username, size = 32, style, textStyle, onLoadEnd }) {
  const dim = { width: size, height: size, borderRadius: size / 2 };

  useEffect(() => {
    if (!uri) onLoadEnd?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  return (
    <View style={[styles.wrap, dim, style]}>
      {uri ? (
        <Image source={{ uri }} style={dim} onLoadEnd={onLoadEnd} />
      ) : (
        <Text style={[styles.initials, { fontSize: size * 0.4 }, textStyle]}>
          {initialsFor({ firstName, lastName, displayName, username })}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#2a2a2a',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  initials: { fontWeight: '700', color: '#ffffff' },
});
