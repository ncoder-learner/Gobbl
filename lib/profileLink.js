import { Share } from 'react-native';

export function buildProfileLink(username) {
  return `com.ncoderpro.foodwrapped://profile/${encodeURIComponent(username)}`;
}

// The scheme link only opens something for recipients who already have the
// app installed, so the message also carries the plain @username as a
// fallback they can search for manually (mirrors FeedScreen's handleInvite).
export async function shareProfileLink(username) {
  if (!username) return;
  try {
    await Share.share({
      message: `Add me on Gobbl — @${username}\n${buildProfileLink(username)}`,
    });
  } catch {
    // user cancelled or share sheet unavailable
  }
}
