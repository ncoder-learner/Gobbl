// supabase/functions/places-search/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── In-memory rate limiter ───────────────────────────────────────────────────
// Limitation: state is per-instance. Supabase Edge Functions are stateless and
// may spin up multiple concurrent instances, each with their own map, so a user
// hitting different instances can exceed 30/min. Acceptable for this use case;
// a DB-backed counter (table with upsert + a count column + a window timestamp)
// would be accurate across instances but adds a round-trip per request.
const rateLimitStore = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT    = 30;
const WINDOW_MS     = 60_000;

function isAllowed(userId: string): boolean {
  const now   = Date.now();
  const entry = rateLimitStore.get(userId);

  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    rateLimitStore.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. API key guard — fail fast, clear message
    const apiKey = Deno.env.get('GOOGLE_PLACES_API_KEY');
    if (!apiKey) {
      return json(
        { error: 'GOOGLE_PLACES_API_KEY is not configured on this function.' },
        500,
      );
    }

    // 2. Authenticate caller via the Supabase JWT in the Authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing Authorization header.' }, 401);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')      ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return json({ error: 'Unauthorized.' }, 401);
    }

    // 3. Rate limit (in-memory, per user ID)
    if (!isAllowed(user.id)) {
      return json({ error: 'Rate limit exceeded. Max 30 requests per minute.' }, 429);
    }

    // 4. Parse body
    const body = await req.json();
    const { query, placeId, sessionToken, lat, lng } = body ?? {};

    // ── Mode A: Place Details (New) ──────────────────────────────────────────
    if (placeId) {
      const url = new URL(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      );
      if (sessionToken) url.searchParams.set('sessionToken', sessionToken);

      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'X-Goog-Api-Key':   apiKey,
          'X-Goog-FieldMask': 'id,displayName,formattedAddress,location',
        },
      });

      if (!res.ok) {
        const detail = await res.text();
        console.error('Place Details error:', detail);
        return json({ error: 'Place Details request failed.', detail }, res.status);
      }

      const data = await res.json();
      return json({
        place_id: data.id                  ?? null,
        name:     data.displayName?.text   ?? null,
        address:  data.formattedAddress    ?? null,
        lat:      data.location?.latitude  ?? null,
        lng:      data.location?.longitude ?? null,
      });
    }

    // ── Mode B: Autocomplete (New) ───────────────────────────────────────────
    if (query) {
      const acBody: Record<string, unknown> = {
        input: query,
        ...(sessionToken && { sessionToken }),
      };

      if (typeof lat === 'number' && typeof lng === 'number') {
        acBody.locationBias = {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: 50_000, // 50 km soft bias; user can still pick results outside it
          },
        };
      }

      const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type':   'application/json',
          'X-Goog-Api-Key': apiKey,
        },
        body: JSON.stringify(acBody),
      });

      if (!res.ok) {
        const detail = await res.text();
        console.error('Autocomplete error:', detail);
        return json({ error: 'Autocomplete request failed.', detail }, res.status);
      }

      const data = await res.json();
      const suggestions = (data.suggestions ?? []).map((s: any) => {
        const p = s.placePrediction;
        return {
          place_id:       p.placeId,
          main_text:      p.structuredFormat?.mainText?.text      ?? p.text?.text ?? '',
          secondary_text: p.structuredFormat?.secondaryText?.text ?? '',
        };
      });

      return json({ suggestions });
    }

    // ── Neither field provided ───────────────────────────────────────────────
    return json(
      { error: 'Request body must include "query" (autocomplete) or "placeId" (details).' },
      400,
    );

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
