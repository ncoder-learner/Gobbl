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
  items: [{ name: 'Food item', amount: 1, unit: 'serving', calories: 650, protein_g: 30, carbs_g: 70, fat_g: 25, sodium_mg: 700 }],
  confidence: 'low',
  is_food: false,
  is_appropriate: true,
};

serve(async (req) => {
  const requestId = crypto.randomUUID();
  console.log(`[identify-food:${requestId}] request received`, req.method);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { base64Image, mediaType } = await req.json();
    console.log(`[identify-food:${requestId}] payload received`, {
      hasImage: Boolean(base64Image),
      imageLength: typeof base64Image === 'string' ? base64Image.length : 0,
      mediaType: mediaType ?? 'image/jpeg',
    });
    const imageMediaType = mediaType ?? 'image/jpeg';

    if (!base64Image) {
      return new Response(JSON.stringify({ error: 'No image provided' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ANTHROPIC_API_KEY is stored in Supabase secrets — never exposed to the app
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicKey) {
      console.error(`[identify-food:${requestId}] missing ANTHROPIC_API_KEY`);
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY is not configured.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const controller = new AbortController();
    // Stay below LogMealScreen's 12-second client deadline so the upstream
    // request is canceled here before the client abandons the invocation.
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    let response;
    try {
      console.log(`[identify-food:${requestId}] calling Anthropic`);
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 700,
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
  "items": [{ "name": "food item", "amount": 1, "unit": "serving", "calories": 650, "protein_g": 30, "carbs_g": 70, "fat_g": 25, "sodium_mg": 700 }],
  "confidence": "high | medium | low",
  "is_food": true,
  "is_appropriate": true
}

Rules:
- is_food: true if the image plausibly contains any food or drink, even if the photo is dark, blurry, partially out-of-frame, or from an unusual angle. Set false ONLY when the image clearly contains no food whatsoever.
- is_appropriate: true unless the image contains explicit sexual content, graphic violence, gore, or other clearly unsafe material. When in doubt, set true.
- items: list each distinct food or drink separately. Group portions of the same food into ONE item: for example, a whole pineapple and pineapple slices are one "Pineapple" item with the total visible amount, not two items. Do not split a food into "whole", "slice", "piece", or similar entries. For each distinct item, estimate the visible amount and its nutrition. Use whole-number calories and grams/milligrams. These are estimates, not medical advice. Do not copy the example values. If is_food is true, every item must have a realistic non-zero calorie estimate based on the visible food and amount, even when confidence is low.
- If is_appropriate is false, you may set all other fields to empty defaults.
- If no food is visible: is_food false, name "Unknown", description "Could not identify food", cuisine "", emoji "🍽️", confidence "low".`,
              },
            ],
          },
          ],
        }),
      });
    } catch (error) {
      const message = error?.name === 'AbortError'
        ? 'Food identification timed out. Try a smaller photo or try again.'
        : `Food identification request failed: ${error?.message || 'unknown error'}`;
      console.error(`[identify-food:${requestId}] ${message}`);
      return new Response(JSON.stringify({ error: message }), {
        status: 504,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } finally {
      clearTimeout(timeoutId);
    }

    console.log(`[identify-food:${requestId}] Anthropic response status:`, response.status);
    if (!response.ok) {
      const errBody = await response.text();
      console.error(`[identify-food:${requestId}] Anthropic error body:`, errBody.slice(0, 1000));
      return new Response(JSON.stringify({ error: `Anthropic returned ${response.status}.` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    console.log(`[identify-food:${requestId}] Anthropic response parsed`);
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
    const rawItems = Array.isArray(parsed.items) && parsed.items.length > 0 ? parsed.items : [SAFE_FALLBACK.items[0]];
    const normalizedItems = rawItems.map((item: any) => ({
      name: String(item.name || 'Food item'),
      amount: Math.max(0.25, Number(item.amount) || 1),
      unit: String(item.unit || 'serving'),
      calories: Math.max(0, Math.round(Number(item.calories) || 0)),
      protein_g: Math.max(0, Math.round(Number(item.protein_g) || 0)),
      carbs_g: Math.max(0, Math.round(Number(item.carbs_g) || 0)),
      fat_g: Math.max(0, Math.round(Number(item.fat_g) || 0)),
      sodium_mg: Math.max(0, Math.round(Number(item.sodium_mg) || 0)),
    }));

    // Models sometimes split one food into visible portions (for example,
    // "whole pineapple" and "pineapple slice"). Merge those portions so the
    // app exposes one amount control for one food, while leaving distinct
    // foods such as pineapple and yogurt separate.
    const portionWords = /\b(whole|slice|slices|piece|pieces|chunk|chunks|cut|cut-up|half|halves)\b/gi;
    const mergedItems: any[] = [];
    for (const item of normalizedItems) {
      const key = item.name.toLowerCase().replace(portionWords, '').replace(/[^a-z0-9]+/g, ' ').trim();
      const existing = mergedItems.find(candidate => candidate.key === key && key.length > 2);
      if (!existing) {
        const cleanName = key.replace(/\b\w/g, (character: string) => character.toUpperCase()) || item.name;
        mergedItems.push({ ...item, name: cleanName, key });
        continue;
      }
      existing.amount += item.amount;
      existing.calories += item.calories;
      existing.protein_g += item.protein_g;
      existing.carbs_g += item.carbs_g;
      existing.fat_g += item.fat_g;
      existing.sodium_mg += item.sodium_mg;
    }
    parsed.items = mergedItems.map(({ key, ...item }) => item);

    console.log(`[identify-food:${requestId}] returning success`, {
      isFood: parsed.is_food,
      itemCount: parsed.items.length,
      calories: parsed.items.reduce((sum: number, item: any) => sum + item.calories, 0),
    });
    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(`[identify-food:${requestId}] unhandled error`, err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
