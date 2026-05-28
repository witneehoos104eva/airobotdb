const MODEL = process.env.OPENAI_MODEL || 'gpt-5.5';
const MAX_BODY_CHARS = 160000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function extractOutputText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const chunks = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === 'string') chunks.push(content.text);
      if (typeof content?.output_text === 'string') chunks.push(content.output_text);
    }
  }
  return chunks.join('\n').trim();
}

function parseJsonOnly(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (firstError) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw firstError;
  }
}

function normalizeResult(result, validCodes) {
  const alternatives = Array.isArray(result?.possibleAlternatives) ? result.possibleAlternatives : [];
  const questions = Array.isArray(result?.questionsToAsk) ? result.questionsToAsk : [];
  const split = Array.isArray(result?.separateComponentSuggestions) ? result.separateComponentSuggestions : [];
  return {
    recommendedCode: typeof result?.recommendedCode === 'string' ? result.recommendedCode.trim() : '',
    confidence: ['High', 'Medium', 'Low'].includes(result?.confidence) ? result.confidence : 'Low',
    reason: typeof result?.reason === 'string' ? result.reason.trim() : '',
    questionsToAsk: questions.map(String).slice(0, 6),
    possibleAlternatives: alternatives.map((a) => ({
      code: typeof a?.code === 'string' ? a.code.trim() : '',
      reason: typeof a?.reason === 'string' ? a.reason.trim() : ''
    })).filter((a) => a.code || a.reason).slice(0, 6),
    separateComponentSuggestions: split.map(String).slice(0, 8),
    needsManualReview: Boolean(result?.needsManualReview),
    codeIsInWorkbook: validCodes.has(String(result?.recommendedCode || '').trim())
  };
}

function buildPrompt(payload) {
  return `You are a packaging EPR material-category verification assistant.

Your job is to review the deterministic classifier's recommendation and help the user choose the best workbook material category for one packaging component.

Rules:
1. Use only the material categories provided in compactCategoryList. Do not invent category codes.
2. Treat the workbook categories as the source of truth.
3. Do not estimate fees. Do not give legal compliance advice.
4. If the component is normally separable by the consumer or during normal use, recommend separate component rows rather than forcing one category.
5. For non-separable multi-material packaging, choose the closest category based on dominant material, structure, coating, barrier layer, and format.
6. If key information is missing, provide a best recommended code only when reasonable, mark confidence Low or Medium, and list specific questions to resolve the uncertainty.
7. Be conservative with confidence. Use High only when the provided facts point clearly to one workbook category.
8. Return JSON only. Do not wrap the JSON in markdown.

Return this exact JSON shape:
{
  "recommendedCode": "string, one workbook code or empty string",
  "confidence": "High | Medium | Low",
  "reason": "brief rationale in plain English",
  "questionsToAsk": ["specific missing question"],
  "possibleAlternatives": [{"code": "workbook code", "reason": "why it might apply"}],
  "separateComponentSuggestions": ["component split suggestion"],
  "needsManualReview": true
}

Classification packet:
${JSON.stringify(payload, null, 2)}`;
}

export async function POST(request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return json({ error: 'OPENAI_API_KEY is not configured on the server.' }, 500);
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARS) {
      return json({ error: 'Classification request is too large. Shorten the extra context and try again.' }, 413);
    }

    let payload;
    try {
      payload = JSON.parse(raw || '{}');
    } catch (error) {
      return json({ error: 'Invalid JSON request body.' }, 400);
    }

    const requiredPassword = process.env.AI_VERIFY_PASSWORD || 'HotHoney';
    const providedPassword = typeof payload.aiFeaturePassword === 'string' ? payload.aiFeaturePassword : '';
    if (providedPassword !== requiredPassword) {
      return json({ error: 'Incorrect password.' }, 401);
    }
    delete payload.aiFeaturePassword;

    if (!Array.isArray(payload.compactCategoryList) || payload.compactCategoryList.length === 0) {
      return json({ error: 'Missing workbook category list.' }, 400);
    }

    const validCodes = new Set(payload.compactCategoryList.map((c) => String(c.code || '').trim()).filter(Boolean));
    const prompt = buildPrompt(payload);

    const openaiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        input: prompt,
        temperature: 0.1,
        max_output_tokens: 1200
      })
    });

    const responseData = await openaiResponse.json().catch(() => ({}));
    if (!openaiResponse.ok) {
      const message = responseData?.error?.message || `OpenAI request failed with HTTP ${openaiResponse.status}`;
      return json({ error: message }, openaiResponse.status);
    }

    const outputText = extractOutputText(responseData);
    let parsed;
    try {
      parsed = parseJsonOnly(outputText);
    } catch (error) {
      return json({
        error: 'The AI response was not valid JSON. Try again with less context.',
        rawOutput: outputText.slice(0, 1200)
      }, 502);
    }

    return json(normalizeResult(parsed, validCodes));
  } catch (error) {
    return json({ error: error?.message || 'Unexpected server error.' }, 500);
  }
}

export async function GET() {
  return json({ ok: true, message: 'Use POST /api/classify from the EPR app.' });
}
