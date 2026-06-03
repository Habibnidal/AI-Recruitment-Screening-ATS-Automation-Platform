/**
 * folder-provisioning.js
 *
 * Dynamic Google Drive folder provisioning for new job openings.
 *
 * When a candidate applies for a job, the workflow needs to file their CV
 * into a job-specific folder. If the folder doesn't exist yet (first
 * applicant for a new role), it's created automatically — no manual setup.
 *
 * This module implements the "find-or-create" pattern that powers the
 * folder layer of the recruitment pipeline.
 *
 * @author  Hyper Flow Automation
 * @license MIT (case study)
 */

'use strict';

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const CONFIG = Object.freeze({
  // Parent folder under which all job-specific folders are created.
  // Real folder ID redacted; replace with your own in deployment.
  PARENT_FOLDER_ID: '<PARENT_FOLDER_ID_REDACTED>',

  // Drive API base
  DRIVE_API: 'https://www.googleapis.com/drive/v3/files',

  // MIME type for Google Drive folders
  FOLDER_MIME_TYPE: 'application/vnd.google-apps.folder',
});

// -----------------------------------------------------------------------------
// Drive API Helpers
// -----------------------------------------------------------------------------

/**
 * Escape a string for safe use in a Drive query (q= parameter).
 * Drive uses single-quoted strings; embedded apostrophes must be escaped.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeDriveQueryValue(value) {
  return String(value).replace(/'/g, "\\'");
}

/**
 * Build the Drive query string that finds a folder by name within a parent.
 *
 * @param {string} folderName
 * @param {string} parentId
 * @returns {string}
 */
function buildFolderSearchQuery(folderName, parentId) {
  const safeName = escapeDriveQueryValue(folderName);
  return [
    `name='${safeName}'`,
    `mimeType='${CONFIG.FOLDER_MIME_TYPE}'`,
    `'${parentId}' in parents`,
    `trashed=false`,
  ].join(' and ');
}

// -----------------------------------------------------------------------------
// Find Folder
// -----------------------------------------------------------------------------

/**
 * Search Drive for a folder matching the given job title within the parent.
 *
 * @param {string} folderName
 * @param {Function} httpRequest      Authenticated HTTP helper
 * @param {string} [parentId]         Override default parent
 * @returns {Promise<{ id: string, name: string } | null>}
 */
async function findFolder(folderName, httpRequest, parentId = CONFIG.PARENT_FOLDER_ID) {
  if (!folderName) return null;

  const q = buildFolderSearchQuery(folderName, parentId);
  const url = `${CONFIG.DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id,name)`;

  const response = await httpRequest({
    method: 'GET',
    url,
    json: true,
  });

  const files = response?.files || [];
  return files.length > 0 ? { id: files[0].id, name: files[0].name } : null;
}

// -----------------------------------------------------------------------------
// Create Folder
// -----------------------------------------------------------------------------

/**
 * Create a new folder in Drive under the given parent.
 *
 * @param {string} folderName
 * @param {Function} httpRequest
 * @param {string} [parentId]
 * @returns {Promise<{ id: string, name: string }>}
 */
async function createFolder(folderName, httpRequest, parentId = CONFIG.PARENT_FOLDER_ID) {
  if (!folderName) {
    throw new Error('Cannot create folder: name is empty');
  }

  const response = await httpRequest({
    method: 'POST',
    url: CONFIG.DRIVE_API,
    headers: { 'Content-Type': 'application/json' },
    body: {
      name: folderName,
      mimeType: CONFIG.FOLDER_MIME_TYPE,
      parents: [parentId],
    },
    json: true,
  });

  if (!response?.id) {
    throw new Error(`Folder creation failed: ${JSON.stringify(response).slice(0, 200)}`);
  }

  return { id: response.id, name: response.name };
}

// -----------------------------------------------------------------------------
// Find-or-Create
// -----------------------------------------------------------------------------

/**
 * Get or create a folder by name. The core entry point for the pipeline.
 *
 * Returns the folder ID along with a flag indicating whether it was created
 * fresh (useful for logging / analytics — e.g. "we just opened a new role").
 *
 * @param {string} folderName
 * @param {Function} httpRequest
 * @param {string} [parentId]
 * @returns {Promise<{ id: string, name: string, created: boolean }>}
 */
async function findOrCreateFolder(folderName, httpRequest, parentId = CONFIG.PARENT_FOLDER_ID) {
  const existing = await findFolder(folderName, httpRequest, parentId);
  if (existing) {
    return { id: existing.id, name: existing.name, created: false };
  }

  const fresh = await createFolder(folderName, httpRequest, parentId);
  return { id: fresh.id, name: fresh.name, created: true };
}

// -----------------------------------------------------------------------------
// Folder Name Resolution Helper
// -----------------------------------------------------------------------------

/**
 * Resolve which folder ID to use given outputs from two possible upstream nodes
 * (find-first, create-second).
 *
 * The n8n workflow has both nodes feed into A3 with a fallback expression:
 *   A1.id || CreateFolder.id
 *
 * This is the JavaScript equivalent used inside code nodes.
 *
 * @param {{ id?: string }} findResult
 * @param {{ id?: string }} createResult
 * @returns {string}
 */
function resolveFolderId(findResult, createResult) {
  return (findResult && findResult.id) || (createResult && createResult.id) || '';
}

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

module.exports = {
  findFolder,
  createFolder,
  findOrCreateFolder,
  resolveFolderId,
  buildFolderSearchQuery,    // exported for unit testing
  escapeDriveQueryValue,     // exported for unit testing
};

// -----------------------------------------------------------------------------
// Example usage (not executed when imported)
// -----------------------------------------------------------------------------
//
// // Assume `httpRequest` is an authenticated Drive API caller
// const folder = await findOrCreateFolder('Senior Engineer Backend', httpRequest);
//
// console.log(folder);
// // First applicant for a new role:
// //   { id: '1abc...', name: 'Senior Engineer Backend', created: true }
// //
// // Subsequent applicants:
// //   { id: '1abc...', name: 'Senior Engineer Backend', created: false }
