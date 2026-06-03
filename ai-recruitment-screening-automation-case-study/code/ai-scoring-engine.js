/**
 * ai-scoring-engine.js
 *
 * AI-powered candidate scoring engine.
 *
 * Sends candidate resume text to a large language model (via OpenRouter),
 * receives structured signal extraction, and applies a deterministic scoring
 * function to produce a final 0-100 score plus an explainable breakdown.
 *
 * KEY DESIGN PRINCIPLE
 * --------------------
 * The AI extracts SIGNALS, the code calculates the SCORE.
 *
 * This separation makes scoring:
 *  - Deterministic (same signals → same score, every time)
 *  - Auditable (the breakdown explains every point change)
 *  - Tunable (adjust weights without re-prompting)
 *  - Cheap (smaller prompts since the AI doesn't do math)
 *
 * NOTE
 * ----
 * Actual scoring weights, country preference lists, and prompt text used in
 * production are proprietary and have been replaced with placeholder values
 * here. The structure and approach are faithful to the production system.
 *
 * @author  Hyper Flow Automation
 * @license MIT (case study)
 */

'use strict';

// -----------------------------------------------------------------------------
// Configuration (would be loaded from env / config file in production)
// -----------------------------------------------------------------------------

const CONFIG = Object.freeze({
  // LLM provider configuration
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY, // never hardcode
  OPENROUTER_ENDPOINT: 'https://openrouter.ai/api/v1/chat/completions',
  MODEL: 'openai/gpt-4o-mini',
  MAX_TOKENS: 3000,

  // Scoring weights — replaced with generic placeholders.
  // Production weights are client-specific.
  WEIGHTS: {
    BASE_SCORE: 60,
    NEGATIVE_SIGNAL_A: -30,   // e.g. location mismatch
    NEGATIVE_SIGNAL_B: -30,   // e.g. credential mismatch
    NEGATIVE_SIGNAL_C: -30,   // e.g. registration mismatch
    QUALIFICATION_MISMATCH: -25,
    PREFERRED_REGION: +35,
    ACCEPTABLE_REGION: +20,
  },

  // Country lists — illustrative placeholders only.
  PREFERRED_REGIONS: [
    'Country A', 'Country B', 'Country C', 'Country D',
  ],
});

// -----------------------------------------------------------------------------
// Prompt Construction
// -----------------------------------------------------------------------------

/**
 * Builds the LLM prompt for resume analysis.
 *
 * The actual production prompt is several hundred lines long with specific
 * domain rules and is treated as proprietary. This is a sanitized template
 * showing the structure of how signals are requested.
 *
 * @param {string} resumeText
 * @returns {string}
 */
function buildPrompt(resumeText) {
  return `You are a CV screening assistant. Read the resume carefully and follow every instruction below exactly. Return ONLY a JSON object.

STEP 1 — EXTRACT KEY FIELDS:
- Candidate's highest qualification
- Specialty / role match
- Total years of experience (if stated)
- Experience breakdown by employer/country
- Current city and country
- Phone number prefix
- Professional registrations / certifications
- Countries mentioned in work history

STEP 2 — EVALUATE SIGNALS:
For each signal, return YES/NO + one-line reason.
DO NOT calculate any score — that is done separately.

Signals:
1. NEGATIVE_SIGNAL_A: <client-specific criterion redacted>
2. NEGATIVE_SIGNAL_B: <client-specific criterion redacted>
3. NEGATIVE_SIGNAL_C: <client-specific criterion redacted>
4. QUALIFICATION_MISMATCH: Is the qualification missing or mismatched for the role?
5. PREFERRED_REGION: Is candidate's current country in the preferred list?
6. ACCEPTABLE_REGION: Is candidate's current country acceptable but not preferred?

STEP 3 — PROFILE SUMMARY:
One sentence. Format: "[Qualification], [Specialty]. [X] years — [breakdown]. Currently in [City, Country]."

STEP 4 — METADATA:
- has_target_credential (boolean): true if a target credential is detected
- country_of_residence (string): current or most recent country

OUTPUT FORMAT (strict JSON, no markdown):
{
  "signals": {
    "NEGATIVE_SIGNAL_A": { "detected": "YES/NO", "reason": "..." },
    "NEGATIVE_SIGNAL_B": { "detected": "YES/NO", "reason": "..." },
    "NEGATIVE_SIGNAL_C": { "detected": "YES/NO", "reason": "..." },
    "QUALIFICATION_MISMATCH": { "detected": "YES/NO", "reason": "..." },
    "PREFERRED_REGION": { "detected": "YES/NO", "reason": "..." },
    "ACCEPTABLE_REGION": { "detected": "YES/NO", "reason": "..." }
  },
  "ai_profile_summary": "string",
  "has_target_credential": false,
  "country_of_residence": "string"
}

CV TEXT:
${resumeText}`;
}

// -----------------------------------------------------------------------------
// LLM Call
// -----------------------------------------------------------------------------

/**
 * Call the OpenRouter chat completions endpoint and return parsed AI response.
 *
 * @param {string} prompt
 * @param {Function} httpRequest  n8n-style HTTP helper (injected for testing)
 * @returns {Promise<object>}
 */
async function callLLM(prompt, httpRequest) {
  const response = await httpRequest({
    method: 'POST',
    url: CONFIG.OPENROUTER_ENDPOINT,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CONFIG.OPENROUTER_API_KEY}`,
    },
    body: {
      model: CONFIG.MODEL,
      max_tokens: CONFIG.MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    },
    json: true,
  });

  if (!response?.choices?.length) {
    throw new Error(`No choices returned: ${JSON.stringify(response).slice(0, 300)}`);
  }

  return parseAIResponse(response.choices[0].message.content);
}

/**
 * The model occasionally wraps JSON in markdown fences despite instructions.
 * This parser strips them and falls back to regex extraction.
 *
 * @param {string} rawContent
 * @returns {object}
 */
function parseAIResponse(rawContent) {
  let cleaned = rawContent.replace(/```json|```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) cleaned = match[0];
  return JSON.parse(cleaned);
}

// -----------------------------------------------------------------------------
// Scoring Function (pure, deterministic)
// -----------------------------------------------------------------------------

/**
 * Apply weighted scoring rules to the AI-extracted signals.
 *
 * Returns both the final clamped score and an explainable breakdown,
 * so any score can be justified after the fact.
 *
 * @param {object} signals       AI-extracted signal object
 * @param {number} emailCount    Number of prior contact emails found
 * @returns {{ score: number, breakdown: string[] }}
 */
function calculateScore(signals, emailCount = 0) {
  const W = CONFIG.WEIGHTS;
  const breakdown = [];
  let score = W.BASE_SCORE;

  const isDetected = (key) =>
    signals?.[key]?.detected === 'YES';

  const reason = (key) =>
    signals?.[key]?.reason || '(no reason)';

  // -- Negative signals (deductions) ----------------------------------------
  const deductions = [
    ['NEGATIVE_SIGNAL_A', W.NEGATIVE_SIGNAL_A],
    ['NEGATIVE_SIGNAL_B', W.NEGATIVE_SIGNAL_B],
    ['NEGATIVE_SIGNAL_C', W.NEGATIVE_SIGNAL_C],
    ['QUALIFICATION_MISMATCH', W.QUALIFICATION_MISMATCH],
  ];

  for (const [key, weight] of deductions) {
    if (isDetected(key)) {
      score += weight;
      breakdown.push(`${key}: YES ${weight} | ${reason(key)}`);
    } else {
      breakdown.push(`${key}: NO 0 | ${reason(key)}`);
    }
  }

  // -- Positive signals (additions, mutually exclusive) ---------------------
  // Preferred takes priority over acceptable; never both.
  if (isDetected('PREFERRED_REGION')) {
    score += W.PREFERRED_REGION;
    breakdown.push(`PREFERRED_REGION: YES +${W.PREFERRED_REGION} | ${reason('PREFERRED_REGION')}`);
    breakdown.push('ACCEPTABLE_REGION: NO 0 | preferred already applied');
  } else if (isDetected('ACCEPTABLE_REGION')) {
    score += W.ACCEPTABLE_REGION;
    breakdown.push(`PREFERRED_REGION: NO 0 | ${reason('PREFERRED_REGION')}`);
    breakdown.push(`ACCEPTABLE_REGION: YES +${W.ACCEPTABLE_REGION} | ${reason('ACCEPTABLE_REGION')}`);
  } else {
    breakdown.push(`PREFERRED_REGION: NO 0 | ${reason('PREFERRED_REGION')}`);
    breakdown.push(`ACCEPTABLE_REGION: NO 0 | ${reason('ACCEPTABLE_REGION')}`);
  }

  // -- Email contact penalty -----------------------------------------------
  // Each prior contact email reduces score by 1 (heavily-chased = lower priority)
  score -= emailCount;
  if (emailCount > 0) {
    breakdown.push(`PRIOR_CONTACT: -${emailCount} | ${emailCount} email(s) found across inboxes`);
  }

  // -- Clamp -----------------------------------------------------------------
  score = Math.min(100, Math.max(0, score));

  return { score, breakdown };
}

// -----------------------------------------------------------------------------
// Top-Level Entry Point
// -----------------------------------------------------------------------------

/**
 * Run the full scoring pipeline against a candidate's resume.
 *
 * @param {object} input
 * @param {string} input.resumeText      Plain text of the resume
 * @param {number} input.emailCount      Prior contact count (from communication tracking)
 * @param {string} input.duplicateEmail  Email if duplicate found, empty string otherwise
 * @param {Function} httpRequest         Injected HTTP helper
 * @returns {Promise<object>}            Final scored candidate object
 */
async function scoreCandidate({ resumeText, emailCount = 0, duplicateEmail = '' }, httpRequest) {
  if (!resumeText || !resumeText.trim()) {
    return { error: 'Empty resume text' };
  }

  let aiResult;
  try {
    aiResult = await callLLM(buildPrompt(resumeText), httpRequest);
  } catch (err) {
    return { error: `LLM call failed: ${err.message}` };
  }

  const { score, breakdown } = calculateScore(aiResult.signals, emailCount);

  return {
    ai_profile_summary: aiResult.ai_profile_summary || 'Not stated',
    score,
    has_target_credential: aiResult.has_target_credential ?? false,
    country_of_residence: aiResult.country_of_residence || 'Not stated',
    score_breakdown: breakdown.join('\n'),
    duplicate: duplicateEmail ? 'Yes' : 'No',
  };
}

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

module.exports = {
  scoreCandidate,
  calculateScore,    // exported for unit testing
  buildPrompt,       // exported for prompt iteration
  parseAIResponse,   // exported for unit testing
};
