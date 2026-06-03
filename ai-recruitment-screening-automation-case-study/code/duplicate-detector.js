/**
 * duplicate-detector.js
 *
 * Detects duplicate candidates by performing an indexed lookup against the
 * master tracking sheet using the candidate's email address as the key.
 *
 * Also includes a helper for counting prior outreach emails across multiple
 * recruiter inboxes — used both as a scoring signal and as a tracking column.
 *
 * @author  Hyper Flow Automation
 * @license MIT (case study)
 */

'use strict';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const LOOKUP_COLUMN = 'EMAIL ID';

// -----------------------------------------------------------------------------
// Duplicate Detection
// -----------------------------------------------------------------------------

/**
 * Check whether a candidate's email already exists in the tracking sheet.
 *
 * The lookup is performed in the calling n8n node (Sheets "Get Row(s)"
 * operation). This function interprets the lookup result.
 *
 * @param {object|null} lookupResult  The first matching row, or null
 * @returns {{ isDuplicate: boolean, matchedEmail: string }}
 */
function checkDuplicate(lookupResult) {
  if (!lookupResult || typeof lookupResult !== 'object') {
    return { isDuplicate: false, matchedEmail: '' };
  }

  const matchedEmail = lookupResult[LOOKUP_COLUMN] || '';
  return {
    isDuplicate: Boolean(matchedEmail),
    matchedEmail,
  };
}

/**
 * Convenience function: returns simple "Yes"/"No" string for sheet writing.
 *
 * @param {object|null} lookupResult
 * @returns {'Yes' | 'No'}
 */
function duplicateFlag(lookupResult) {
  return checkDuplicate(lookupResult).isDuplicate ? 'Yes' : 'No';
}

// -----------------------------------------------------------------------------
// Email Communication Tracking
// -----------------------------------------------------------------------------

/**
 * Filter only items that represent real Gmail messages.
 *
 * The n8n "Always Output Data" setting causes Gmail nodes to return an empty
 * placeholder item when no emails are found, instead of nothing. Without this
 * filter, three "empty" inboxes would erroneously appear as 3 emails when
 * counted by .length.
 *
 * Real Gmail messages always have an `id` or `threadId`. Placeholders do not.
 *
 * @param {Array<{ json: object }>} items
 * @returns {Array<{ json: object }>}
 */
function filterRealEmails(items) {
  if (!Array.isArray(items)) return [];
  return items.filter(item => {
    const data = item && item.json;
    return Boolean(data && (data.id || data.threadId));
  });
}

/**
 * Count real emails across N inbox result sets.
 *
 * @param {...Array<{ json: object }>} inboxResults
 * @returns {number}
 */
function countEmails(...inboxResults) {
  return inboxResults
    .map(filterRealEmails)
    .reduce((total, list) => total + list.length, 0);
}

/**
 * Aggregate the contact history across multiple inboxes into a single record.
 *
 * @param {object[][]} inboxes  Array of inbox result arrays
 * @returns {object}
 */
function aggregateContactHistory(inboxes) {
  const counts = inboxes.map(filterRealEmails).map(list => list.length);
  const total = counts.reduce((sum, n) => sum + n, 0);

  return {
    total_emails: total,
    per_inbox: counts,
    has_prior_contact: total > 0,
  };
}

// -----------------------------------------------------------------------------
// Composite Check (full duplicate + contact info)
// -----------------------------------------------------------------------------

/**
 * Run the full duplicate + contact-history analysis for a candidate.
 *
 * @param {object} args
 * @param {object|null} args.lookupResult        Sheets lookup result
 * @param {Array[]}     args.inboxes             Array of inbox result arrays
 * @returns {object}                              Combined record for downstream use
 */
function analyzeCandidate({ lookupResult, inboxes }) {
  const duplicate = checkDuplicate(lookupResult);
  const contact = aggregateContactHistory(inboxes || []);

  return {
    duplicate_email: duplicate.matchedEmail,
    duplicate_flag: duplicate.isDuplicate ? 'Yes' : 'No',
    email_count: contact.total_emails,
    contact_per_inbox: contact.per_inbox,
    has_prior_contact: contact.has_prior_contact,
  };
}

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

module.exports = {
  checkDuplicate,
  duplicateFlag,
  filterRealEmails,
  countEmails,
  aggregateContactHistory,
  analyzeCandidate,
};

// -----------------------------------------------------------------------------
// Example usage (not executed when imported)
// -----------------------------------------------------------------------------
//
// // Duplicate check
// const lookup = { 'EMAIL ID': 'jane.doe@example.com', 'APPLICANT NAME': 'Jane Doe' };
// console.log(checkDuplicate(lookup));
// // → { isDuplicate: true, matchedEmail: 'jane.doe@example.com' }
//
// // Email counting (with mixed real + placeholder items)
// const inbox1 = [{ json: { id: 'msg-1' } }, { json: { id: 'msg-2' } }];
// const inbox2 = [{ json: {} }];                       // empty placeholder
// const inbox3 = [{ json: { threadId: 'thr-99' } }];
// console.log(countEmails(inbox1, inbox2, inbox3));    // → 3
//
// // Composite
// console.log(analyzeCandidate({
//   lookupResult: lookup,
//   inboxes: [inbox1, inbox2, inbox3],
// }));
// // →
// // {
// //   duplicate_email: 'jane.doe@example.com',
// //   duplicate_flag: 'Yes',
// //   email_count: 3,
// //   contact_per_inbox: [2, 0, 1],
// //   has_prior_contact: true,
// // }
