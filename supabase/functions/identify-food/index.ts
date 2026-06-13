import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SAFE_FALLBACK = {
  name: 'Unknown food',
  description: '',
  cuisine: '',
  emoji: '🍽️',
  confidence: 'low',
  is_food: false,
  is_appropriate: true,
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { base64Image, mediaType } = await req.json();
    const imageMediaType = mediaType ?? 'image/jpeg';

    if (!base64Image) {
      return new Response(JSON.stringify({ error: 'No image provided' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ANTHROPIC_API_KEY is stored in Supabase secrets — never exposed to the app
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: imageMediaType, data: base64Image },
              },
              {
                type: 'text',
                text: `Analyze this image and respond ONLY with a JSON object — no preamble, no markdown, no backticks. Use this exact format:
{
  "name": "short food name (e.g. Pepperoni pizza)",
  "description": "one sentence description",
  "cuisine": "cuisine type (e.g. Italian, Mexican, Japanese)",
  "emoji": "single most relevant emoji",
  "confidence": "high | medium | low",
  "is_food": true,
  "is_appropriate": true
}

Rules:
- is_food: true if the image plausibly contains any food or drink, even if the photo is dark, blurry, partially out-of-frame, or from an unusual angle. Set false ONLY when the image clearly contains no food whatsoever.
- is_appropriate: true unless the image contains explicit sexual content, graphic violence, gore, or other clearly unsafe material. When in doubt, set true.
- If is_appropriate is false, you may set all other fields to empty defaults.
- If no food is visible: is_food false, name "Unknown", description "Could not identify food", cuisine "", emoji "🍽️", confidence "low".`,
              },
            ],
          },
        ],
      }),
    });

    console.log('Anthropic response status:', response.status);
    if (!response.ok) {
      const errBody = await response.text();
      console.error('Anthropic error body:', errBody);
      return new Response(JSON.stringify(SAFE_FALLBACK), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const text = data.content?.map((b: any) => b.text || '').join('') || '';

    let parsed: any;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch {
      parsed = { ...SAFE_FALLBACK };
    }

    // Ensure safety booleans are always present and are actual booleans.
    // If the model omitted them or returned non-boolean values, default conservatively.
    if (typeof parsed.is_appropriate !== 'boolean') parsed.is_appropriate = true;
    if (typeof parsed.is_food !== 'boolean') parsed.is_food = false;

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
