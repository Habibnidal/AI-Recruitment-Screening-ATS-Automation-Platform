# Architecture

This document describes the technical architecture of the AI Recruitment Screening & ATS Automation Platform.

## System Overview

The platform is a **event-driven, single-direction pipeline** that ingests candidate events from an Applicant Tracking System and produces a fully enriched candidate record in a tracking sheet. It is built around n8n as the orchestration engine, with external services providing capabilities (storage, AI, communication, etc).

There is no database. The Google Sheet IS the database. This is intentional — recruiters work in spreadsheets natively, so the system state lives where users already operate.

---

## Component Map

```
┌────────────────────────────────────────────────────────────────────┐
│                         External Systems                           │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌──────────────┐    ┌────────────┐    ┌────────────────────────┐  │
│  │ Workable ATS │    │ OpenRouter │    │ Google Workspace       │  │
│  │   (Source)   │    │   (LLM)    │    │ (Drive/Gmail/Sheets)   │  │
│  └──────────────┘    └────────────┘    └────────────────────────┘  │
│         │                   ▲                    ▲                 │
│         │ webhook           │ REST              │ OAuth 2.0       │
│         ▼                   │                    │                 │
└────────────────────────────────────────────────────────────────────┘
          │                   │                    │
          ▼                   │                    │
┌────────────────────────────────────────────────────────────────────┐
│              Self-Hosted n8n on Hostinger VPS                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                                                              │  │
│  │  Trigger → Normalize → Branch → Drive → Doc → AI → Score    │  │
│  │                                ↓        ↑                    │  │
│  │                              Gmail   Sheets                  │  │
│  │                                                              │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  Persistent volume: workflow JSON, credentials, execution logs     │
│  Reverse proxy: HTTPS for webhook + OAuth callback endpoints       │
└────────────────────────────────────────────────────────────────────┘
```

---

## Layers

### 1. Ingestion Layer
- **Workable Trigger node** in n8n auto-registers a webhook subscription with the ATS using API credentials
- ATS POSTs candidate-created events to a unique webhook URL on the n8n instance
- Payload structure: nested under `data` with full candidate profile (name, email, resume URL, job, location, source)

### 2. Normalization Layer
- A JavaScript code node flattens the nested ATS payload into a stable internal schema
- Cleans job titles (strips path-illegal characters for Drive folder names)
- Provides defaults for null/missing fields
- All downstream nodes consume from this normalized object — single source of truth

### 3. Routing Layer
- An IF node splits the workflow into two paths based on resume presence
  - **Path A:** Candidate uploaded a resume → full AI screening
  - **Path B:** Candidate has no resume → logged with placeholder, no AI cost

### 4. Storage Provisioning Layer
- Google Drive folder lookup keyed on cleaned job title
- IF node checks if folder was found
- TRUE: use existing folder
- FALSE: create a new folder under the parent CV directory
- Both branches converge — downstream nodes resolve the folder ID with a fallback expression

### 5. Document Processing Layer
- HTTP node downloads the candidate's resume from the ATS's presigned S3 URL (no auth header — S3 URL contains its own signature)
- Drive node uploads the binary into the target folder (original PDF kept for archive)
- HTTP node calls Drive's `/copy` endpoint to create a Google Doc version with the same content
- HTTP node calls Drive's `/export?mimeType=text/plain` endpoint to extract pure text for AI consumption

### 6. Communication Tracking Layer
- Three parallel Gmail searches (one per recruiter inbox)
- Each search filters by `to:{candidate_email}` to find any prior outreach
- Results aggregated downstream by a filtering function that ignores empty placeholder items

### 7. Duplicate Detection Layer
- Sheets node performs an indexed lookup against the master tracking sheet on the EMAIL ID column
- Returns the first matching row if any
- Downstream nodes interpret presence/absence as `Yes`/`No` duplicate

### 8. AI Analysis Layer
- A code node calls OpenRouter's chat completions endpoint with the resume text and a structured prompt
- Prompt explicitly requests a strict JSON response with `signals`, `summary`, and `metadata`
- Response is parsed with regex fallback for cases where the model wraps JSON in markdown
- Scoring is calculated **in code, not by the AI** — the AI only emits signals; the scoring function is deterministic

### 9. Sheet Persistence Layer
- Sheets node in append mode writes a 13-column row with all enriched data
- HYPERLINK formula constructed for clickable candidate name → ATS profile
- `valueInputOption = USER_ENTERED` so formulas are parsed by Google Sheets, not stored as strings

---

## Authentication Strategy

Five distinct authentication mechanisms are in play:

| System | Mechanism | Credential Storage |
|---|---|---|
| Workable (Trigger) | API token via native Workable credential | n8n encrypted credentials |
| Workable (HTTP) | Bearer token via Header Auth | n8n encrypted credentials |
| Google Drive | OAuth 2.0 (refresh token rotation) | n8n encrypted credentials |
| Google Sheets | OAuth 2.0 (same client, separate scope) | n8n encrypted credentials |
| Gmail × 3 | OAuth 2.0 (one per recruiter inbox) | n8n encrypted credentials |
| OpenRouter | Bearer API key | Environment variable (production) |
| S3 (resume download) | Presigned URL (no header auth) | Provided in webhook payload |

Each credential is scoped to its specific service and rotated on a regular cadence.

---

## Failure Modes & Handling

| Failure | Detection | Handling |
|---|---|---|
| ATS webhook delivery fails | Workable retries on 5xx | Workflow re-runs on retry; idempotency via candidate ID |
| Resume URL expired | A2 returns 403 from S3 | Workflow halts, logged in n8n executions |
| Drive folder name conflict | Drive returns existing folder | Handled via find-then-create logic |
| OpenRouter rate limit | API returns 429 | A9 code returns error object, workflow continues without score |
| Malformed AI response | JSON.parse fails | Regex extracts JSON substring; if all parsing fails, error logged |
| Empty Gmail inbox | Node returns no items | "Always Output Data" toggle ensures empty result, custom filter ignores it |
| Sheets append conflict | Concurrent writes | Append operation is atomic at the Sheets API level |

---

## Deployment

### Infrastructure
- **VPS:** Hostinger Linux instance, 4 GB RAM, 2 vCPU
- **Runtime:** Docker Compose with n8n container + persistent volume
- **Reverse proxy:** HTTPS termination via Nginx with Let's Encrypt
- **Domain:** Subdomain mapped to VPS IP for webhook + OAuth callback endpoints

### Configuration
- Environment variables for OpenRouter API key, n8n encryption key, basic auth
- Workflow exported as JSON for version control
- Credentials stored encrypted on disk by n8n (master encryption key in env)

### Backup Strategy
- Daily snapshot of n8n's SQLite database (workflows + credentials)
- Workflow JSON committed to private Git repository on each meaningful change
- Google Sheet history provides natural data backup (revision-controlled)

### Monitoring
- n8n's built-in execution log retained for 14 days
- Failed-execution email alerts configured on critical workflows
- OpenRouter spend dashboard checked weekly for cost anomalies

---

## Performance Characteristics

- **Latency per candidate:** ~30-60 seconds end-to-end
- **Throughput ceiling:** ~120 candidates/hour (limited by AI API rate, not infrastructure)
- **Concurrent execution:** n8n handles parallel webhook calls without queuing
- **Resource usage:** ~200 MB RAM steady state, peaks during PDF processing

At 60 candidates/day, the system uses <5% of available capacity — substantial headroom for growth or onboarding additional clients.

---

## Security Considerations

- All external API calls use HTTPS
- Credentials never logged or surfaced in execution data
- Webhook URLs include unguessable random IDs (n8n's default behavior)
- Drive folder access scoped to a single service account (no broad permissions)
- AI prompts do not contain personally identifiable data labels beyond what's in the resume itself
- Resume text is sent to OpenRouter, which retains data per their data policy — clients are notified of this in onboarding
- No candidate data persisted on the n8n server beyond execution logs (which auto-expire)

---

## Why Not... (Alternatives Considered)

- **Zapier:** Per-task pricing made daily volumes economically unsustainable; complex branching limited
- **Make.com:** Better than Zapier on price but still per-operation; less code flexibility for AI calls
- **Custom Python/Node service:** Faster execution but 5x more code to maintain; harder for non-developers to update
- **Workato:** Enterprise pricing not justified at SMB scale
- **Pure AI agent (e.g., LangChain):** Less deterministic, harder to debug, no visual workflow for non-developers

n8n won because it offers the visual orchestration of Zapier with the flexibility of code, on infrastructure the client owns.
