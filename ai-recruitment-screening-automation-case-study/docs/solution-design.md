# Solution Design

This document explains *why* the system was designed the way it was — the engineering decisions, alternatives considered, and tradeoffs accepted.

## Design Goals

In priority order:

1. **Zero recruiter touchpoints during intake** — From application submission to enriched sheet row, no human action required
2. **Deterministic, auditable scoring** — Recruiters and clients must be able to see exactly why a candidate received a specific score
3. **Self-hosted, cost-predictable** — No per-execution SaaS pricing that scales with success
4. **Resilient to data variation** — Real-world resumes vary wildly; the system handles missing fields, weird formatting, and edge cases gracefully
5. **Editable by non-developers** — Tweaks to scoring criteria, prompts, or rules should not require code deployment
6. **Compliance-friendly** — Full audit trail, no data persisted unnecessarily, candidate PII handled appropriately

## Architectural Decisions

### Decision 1: n8n over Zapier / Make / custom code

**Chosen:** n8n self-hosted
**Alternatives:** Zapier, Make.com, custom Node.js service

| Factor | Zapier | Make | Custom Code | n8n |
|---|---|---|---|---|
| Pricing model | Per-task | Per-operation | Infrastructure only | Infrastructure only |
| Complex branching | Limited | OK | Native | Native |
| Custom JavaScript | Limited | OK | Native | First-class |
| Visual debugging | Yes | Yes | No | Yes |
| Self-hosting | No | No | Yes | Yes |
| Non-dev editability | Yes | Yes | No | Yes |
| AI integration | Via API | Via API | Via API | Via API |

n8n won on combined criteria: visual editing for the operator, code flexibility for the developer, predictable cost, and self-hosted ownership of data.

### Decision 2: Webhook event-driven, not polling

The platform reacts to ATS events in real time via webhook subscriptions rather than polling for new candidates on a schedule.

**Why:**
- Sub-minute latency from application to enriched record
- No wasted API calls on quiet days
- ATS already supports webhook subscriptions natively

**Tradeoff:** Webhook delivery can fail. Mitigated by ATS-side retry logic.

### Decision 3: Google Workspace as the data layer

The platform uses Google Sheets as its "database" rather than a real RDBMS.

**Why:**
- Recruiters live in spreadsheets — no behavior change required
- Sheet revisions provide free version history
- Sharing/permissions/comments work out of the box
- Zero infrastructure to maintain

**Tradeoff:** Sheets is not transactional. Concurrent writes could in theory cause issues. In practice, candidates arrive in a queue (one at a time per workflow execution), so no concurrency conflicts occur.

When the system outgrows Sheets, the migration path is to swap the append operation for a database insert without touching the rest of the pipeline.

### Decision 4: AI for extraction, code for scoring

A key architectural principle: **the LLM evaluates signals, the code calculates scores**.

The AI prompt asks the model to extract structured signals from the resume ("UAE_PHONE: YES/NO, reason: ..."). The deterministic JavaScript scoring function applies weighted rules to those signals.

**Why:**
- LLM outputs vary between calls; scoring stays consistent
- Score adjustments don't require prompt engineering — just update the weight in code
- Easier to audit ("why did this candidate score 60?" answers itself)
- Lower AI cost (smaller, focused prompts)

**Tradeoff:** Two layers to maintain. Mitigated by clear separation: prompt extracts, code scores. Neither layer worries about the other's job.

### Decision 5: Find-or-create folder logic vs. pre-provisioned folders

When a new job is posted in the ATS, the platform doesn't require recruiters to pre-create a Drive folder. The first application for a new role auto-creates the folder.

**Why:**
- Zero manual setup when a new job opens
- New jobs are immediately ready for applications
- No "broken on day 1" scenarios where the folder didn't exist yet

**Tradeoff:** Folder names depend on job title cleanliness. Mitigated by a sanitization function that strips path-illegal characters.

### Decision 6: Two paths (CV vs. no-CV) instead of one

The workflow splits early into Path A (candidates with resumes) and Path B (candidates without). The two paths share the same end-state (a row in the tracking sheet) but skip steps that don't apply.

**Why:**
- Avoid sending AI a non-existent CV (no point, wasted cost)
- Path B candidates still get logged so they're not lost
- Recruiters can see in the sheet that the candidate exists but didn't upload a resume

**Tradeoff:** More nodes to maintain. Mitigated by keeping Path B minimal.

### Decision 7: PDF + Doc retention, then cleanup

Each candidate gets both a PDF (the original) and a Google Doc (for AI consumption) created in their job folder. A cleanup step optionally deletes the PDF after text extraction.

**Why:**
- Google Doc enables Drive's native text export (which Drive's PDF text extraction doesn't always handle well)
- PDF is kept (or kept temporarily) for archival fidelity
- Recruiters who want to view the original resume can open the PDF

**Tradeoff:** Storage costs (negligible at this scale).

### Decision 8: Three Gmail accounts, one per recruiter

The platform searches three separate Gmail accounts to aggregate recruiter contact history.

**Why:**
- Each recruiter has their own inbox in the agency's workflow
- A single shared inbox isn't culturally feasible at this firm
- The platform respects the existing organization, doesn't try to change it

**Tradeoff:** Three OAuth credentials to maintain. Each requires consent and rotates independently.

### Decision 9: Append-only sheet, no updates

The tracking sheet only ever has rows added — never edited or deleted by the workflow.

**Why:**
- Append operations are simple, atomic, and conflict-free
- Recruiters can edit/annotate rows manually without the workflow overwriting their changes
- Immutable history is naturally maintained

**Tradeoff:** Duplicates are tracked via a `DUPLICATE` column flag rather than being prevented entirely. This is intentional — recruiters want to see that someone re-applied.

### Decision 10: Code nodes for complex transformations, not no-code

Wherever logic exceeded simple field mapping, a JavaScript code node was used instead of trying to chain multiple no-code nodes.

**Why:**
- Easier to reason about
- Testable in isolation
- Self-documenting via comments
- Easier to optimize

Examples: candidate normalization, AI scoring, email count filtering, duplicate logic.

## Tradeoffs Accepted

### We accepted Google's data retention policies for AI input
Resume text is sent to OpenRouter, which routes to the chosen LLM provider. Both providers have data policies that may retain prompts for safety/training purposes (opt-out available on enterprise tiers). Clients are made aware of this in onboarding.

### We accepted "best-effort" scoring
The AI is not perfect. It occasionally misreads ambiguous CVs, fails to detect signals, or invents qualifications that aren't there. The scoring is a tool for ranking, not a final judgment. Recruiters retain authority to override.

### We accepted single-tenancy
The current platform is configured for one agency, with their specific scoring weights and country preferences. Adapting for a different client requires editing code, not just config. A future iteration would externalize all client-specific rules to a configuration layer.

### We accepted scheduled credential rotation
OAuth tokens and API keys need rotation on a regular cadence. This is a manual process today. Could be automated but not worth the complexity at current scale.

## What the Solution Does NOT Do

To be clear about scope:

- **Does NOT make hiring decisions** — Surfaces candidates; humans decide
- **Does NOT send communication to candidates** — All recruiter outreach is still human-initiated
- **Does NOT integrate with calendar/interview scheduling** — Could be added later
- **Does NOT auto-reject candidates** — Even low-scoring candidates remain visible to recruiters
- **Does NOT replace the ATS** — Workable remains the system of record for the candidate journey
- **Does NOT scrape external data** — Works only with what the candidate submits

## Iterative Evolution

The system was built and shipped in stages:

1. **MVP (Week 1):** Just the webhook → Sheet pipeline, no AI, no folder logic
2. **AI integration (Week 2):** Added LLM scoring
3. **Folder automation (Week 3):** Added Drive folder find/create
4. **Communication tracking (Week 4):** Added Gmail searches
5. **Hardening (Week 5):** Error handling, security, edge cases
6. **Production rollout (Week 6):** Live with the recruiting team

Each stage was deployable on its own. The team got value from week 1, even before the AI was wired in.

This is a deliberate choice: **show value early, then layer in sophistication**.
