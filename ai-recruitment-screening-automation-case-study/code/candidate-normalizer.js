/**
 * candidate-normalizer.js
 *
 * Normalizes incoming ATS webhook payloads into a clean, predictable candidate
 * object for downstream consumption by the rest of the pipeline.
 *
 * The ATS sends candidate data nested under a `data` property with a webhook
 * envelope around it (event_type, fired_at, resource_type, etc). This module
 * flattens that into a single object with consistent field names, sane
 * defaults for missing values, and a sanitized job title suitable for use
 * as a filesystem folder name.
 *
 * This file is illustrative; the production version contains additional
 * client-specific fields and edge-case handling that have been removed.
 *
 * Usage:
 *   const normalized = normalizeCandidate(webhookPayload);
 *
 * @author  Hyper Flow Automation
 * @license MIT (case study)
 */

'use strict';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/**
 * Characters not permitted in folder names by most filesystem-like storage
 * systems (e.g. Google Drive, Windows, etc).
 */
const FOLDER_NAME_ILLEGAL_CHARS = /[\/\\:*?"<>|]/g;

/**
 * Default values used when a field is missing from the webhook payload.
 */
const DEFAULTS = Object.freeze({
  id: '',
  name: '',
  firstname: '',
  lastname: '',
  email: '',
  phone: '',
  resume_url: '',
  profile_url: '',
  sourced: false,
  common_source: '',
  job_title: '',
  country: '',
});

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Safely access a nested property; returns fallback if any step is undefined.
 *
 * @param {object} obj
 * @param {string[]} path
 * @param {*} fallback
 */
function getNested(obj, path, fallback = undefined) {
  return path.reduce(
    (acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined),
    obj
  ) ?? fallback;
}

/**
 * Sanitize a job title for use as a folder name. Strips path-illegal
 * characters, collapses repeated whitespace, and trims.
 *
 * Example:
 *   "Senior Engineer / DevOps - Remote"
 *   → "Senior Engineer DevOps - Remote"
 *
 * @param {string} rawTitle
 * @returns {string}
 */
function sanitizeFolderName(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') return '';
  return rawTitle
    .replace(FOLDER_NAME_ILLEGAL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build a candidate's full name from first + last or fall back to a
 * pre-composed name field.
 *
 * @param {object} candidate
 * @returns {string}
 */
function deriveFullName(candidate) {
  if (candidate.name && candidate.name.trim()) return candidate.name.trim();
  const first = candidate.firstname || '';
  const last = candidate.lastname || '';
  return `${first} ${last}`.trim();
}

/**
 * Extract the resume URL from one of several possible shapes the ATS uses.
 *
 * @param {object} candidate
 * @returns {string}
 */
function extractResumeUrl(candidate) {
  return (
    candidate.resume_url ||
    getNested(candidate, ['resume', 'url']) ||
    getNested(candidate, ['cv', 'url']) ||
    ''
  );
}

// -----------------------------------------------------------------------------
// Main Normalizer
// -----------------------------------------------------------------------------

/**
 * Normalize an ATS webhook payload into a flat, consistent candidate object.
 *
 * The webhook payload arrives in one of two shapes:
 *
 *   Shape A (event envelope):
 *     { event_type, fired_at, resource_type, data: { ...candidate fields... } }
 *
 *   Shape B (direct):
 *     { ...candidate fields... }
 *
 * This function handles both transparently.
 *
 * @param {object} rawPayload  The raw webhook payload
 * @returns {object}           Normalized candidate object
 */
function normalizeCandidate(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return { ...DEFAULTS, error: 'Invalid payload' };
  }

  // Unwrap the event envelope if present
  const candidate = rawPayload.data || rawPayload.candidate || rawPayload;

  const rawJobTitle = getNested(candidate, ['job', 'title']) || candidate.job_title || '';

  return {
    id: candidate.id || DEFAULTS.id,
    name: deriveFullName(candidate),
    firstname: candidate.firstname || DEFAULTS.firstname,
    lastname: candidate.lastname || DEFAULTS.lastname,
    email: (candidate.email || DEFAULTS.email).toLowerCase().trim(),
    phone: candidate.phone || DEFAULTS.phone,
    resume_url: extractResumeUrl(candidate),
    profile_url: candidate.profile_url || DEFAULTS.profile_url,
    created_at: candidate.created_at || new Date().toISOString(),
    sourced: candidate.sourced === true,
    common_source: candidate.common_source || candidate.source || DEFAULTS.common_source,
    job_title: rawJobTitle,
    folder_name: sanitizeFolderName(rawJobTitle),
    country:
      getNested(candidate, ['location', 'country']) ||
      candidate.country ||
      candidate.address ||
      DEFAULTS.country,
  };
}

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

module.exports = {
  normalizeCandidate,
  sanitizeFolderName, // exported for unit testing
  deriveFullName,     // exported for unit testing
};

// -----------------------------------------------------------------------------
// Example (for demonstration only — not executed when imported)
// -----------------------------------------------------------------------------
//
// const samplePayload = {
//   event_type: 'candidate_created',
//   fired_at: '2026-06-01T07:23:53Z',
//   resource_type: 'candidate',
//   data: {
//     id: 'abc123def456',
//     firstname: 'Jane',
//     lastname: 'Doe',
//     email: 'Jane.Doe@example.com',
//     phone: '+1-555-0100',
//     job: { title: 'Senior Engineer / Backend - Remote' },
//     location: { country: 'United Kingdom' },
//     resume_url: 'https://files.example.com/resume.pdf?sig=xyz',
//     profile_url: 'https://ats.example.com/candidates/abc123',
//     common_source: 'Careers page',
//   },
// };
//
// console.log(normalizeCandidate(samplePayload));
//
// →
// {
//   id: 'abc123def456',
//   name: 'Jane Doe',
//   firstname: 'Jane',
//   lastname: 'Doe',
//   email: 'jane.doe@example.com',
//   phone: '+1-555-0100',
//   resume_url: 'https://files.example.com/resume.pdf?sig=xyz',
//   profile_url: 'https://ats.example.com/candidates/abc123',
//   created_at: '...',
//   sourced: false,
//   common_source: 'Careers page',
//   job_title: 'Senior Engineer / Backend - Remote',
//   folder_name: 'Senior Engineer Backend - Remote',
//   country: 'United Kingdom',
// }
