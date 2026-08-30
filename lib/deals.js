// lib/deals.js
import { supabase } from './supabase'; // adjust to your actual client import

// Haversine distance in miles
function distanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function getNearbyDeals(userLat, userLng, radiusMiles = 10) {
  const { data, error } = await supabase
    .from('deals')
    .select(`
      id, title, description, deal_type, image_url, deep_link_url, expires_at,
      deal_businesses ( id, name, latitude, longitude )
    `)
    .eq('status', 'active');

  if (error) throw error;

  return (data ?? [])
    .filter(d => d.deal_businesses?.latitude && d.deal_businesses?.longitude)
    .map(d => ({
      ...d,
      distance: distanceMiles(
        userLat, userLng,
        d.deal_businesses.latitude, d.deal_businesses.longitude
      ),
    }))
    .filter(d => d.distance <= radiusMiles)
    .sort((a, b) => a.distance - b.distance);
}