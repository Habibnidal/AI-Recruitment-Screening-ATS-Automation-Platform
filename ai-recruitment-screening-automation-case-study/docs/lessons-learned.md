# Lessons Learned

An honest retrospective on what worked, what didn't, and what we'd do differently. Written for engineers and project leads who might be considering a similar build.

## What Worked Well

### 1. Visual orchestration paid off
n8n's canvas turned out to be valuable not just for development but for **stakeholder communication**. Showing the recruiting team a flowchart they could understand at a glance dramatically reduced "what does the automation actually do?" questions. Walking through a live execution while the team watched was the single best onboarding moment.

### 2. Two-stage AI design (extract + score)
Separating "extract signals" (AI) from "calculate score" (code) was the most impactful architectural decision. It made the system explainable, auditable, and easy to tune. Anyone questioning a score can read the breakdown and see exactly which signal triggered which adjustment.

### 3. Sheet as database
Recruiters never had to learn a new tool. The tracking sheet looks and behaves like every other sheet they use. Adoption was immediate. We avoided the classic "the system is great but nobody uses it" trap.

### 4. Self-hosting from day 1
The team owns the infrastructure, the data, the code, and the rate of change. No vendor lock-in, no per-task fees scaling with success. The total monthly cost is fixed and predictable regardless of volume.

### 5. Ship early, iterate
We resisted the temptation to build the "perfect" v1. Initial release was webhook → sheet only, no AI. Even that minimal version saved hours per day. AI was layered in on a working foundation, not bolted onto a half-built one.

---

## What Didn't Work (And How We Fixed It)

### 1. We assumed the ATS webhook payload was flat
Initial design assumed candidate data would be at the root of the webhook body. It turned out to be nested under `data` and the first webhook event was just a stub with `id` and `created_at`. We had to refactor the normalization layer to handle the actual payload structure.

**Lesson:** **Always inspect a real webhook payload before designing the consumer.** Never trust documentation — fire a test event and read the actual JSON.

### 2. The resume URL is presigned S3, not an authenticated API endpoint
We initially configured the resume download node to send a Bearer token, which caused S3 to reject the request with "only one auth mechanism allowed." The presigned URL contains its own signature; adding an auth header is actively wrong.

**Lesson:** **Understand the auth model of every external URL you call.** Presigned URLs and bearer-token APIs are different beasts.

### 3. Google Drive's "convert during upload" option doesn't exist in n8n
We expected a one-step PDF→Doc conversion during upload. The native node doesn't expose this. We had to add a separate API call to copy the file as a Doc.

**Lesson:** **Don't assume parity between platforms.** Each platform exposes a subset of underlying API capabilities. Test the exact flow you need before committing to an architecture.

### 4. "Always Output Data" turned 0 emails into 3 fake emails
n8n's "Always Output Data" setting outputs a placeholder item when a node returns nothing. We needed this to keep the workflow running, but it broke our email counting (3 Gmail nodes × 1 placeholder = 3 fake emails counted).

**Lesson:** **Side effects of platform settings can break downstream logic.** Whenever you enable a "always do X" toggle, audit every consumer of that node's output for assumptions about emptiness.

### 5. Credentials configured to prevent HTTP usage
n8n's newer versions restrict app-specific OAuth credentials (like Google Drive's) from being used inside generic HTTP Request nodes by default. We hit "credential configured to prevent use" errors when calling Drive's REST API directly.

**Lesson:** **Read security defaults before debugging.** The fix was a one-field configuration change (`Allowed HTTP Request Domains`), but we burned hours assuming it was a bigger problem.

### 6. AI model availability assumptions
At one point we assumed a specific LLM model didn't exist on OpenRouter because it was newer than our knowledge cutoff. We swapped it out unnecessarily.

**Lesson:** **Verify, don't assume.** Especially for fast-moving services like LLM providers, check the live model catalog before changing a working configuration.

### 7. Job title sanitization
Job titles often contain characters that can't be Drive folder names (`/`, `\`, etc.). Our first attempt at folder creation crashed for these cases.

**Lesson:** **Sanitize external strings before using them as filesystem-like identifiers.** Always.

### 8. API tokens exposed during debugging
During development, API tokens got pasted into chat logs and screenshots more than once. Each instance required immediate rotation.

**Lesson:** **Treat tokens like passwords.** Use environment variables or credential stores; never embed in code or share in screenshots.

---

## What We'd Do Differently Next Time

### 1. Start with a config file for client-specific rules
Scoring weights, country preferences, prompt language, and similar variables are baked into the JavaScript. Adapting the platform for a second client means editing code. A `config.json` file at the workflow level would have made the platform multi-tenant from day 1.

### 2. Add a "test mode" toggle from the start
We added retry/test capabilities late. Earlier visibility would have caught the webhook payload structure assumption faster.

### 3. Use a dedicated staging environment
We tested in production behind a "test" flag. A separate n8n instance for staging would have been cleaner — same workflow, separate credentials, separate sheet.

### 4. Build the error notification step earlier
We added Slack/email notifications for failed executions late. Before that, failures only surfaced when someone happened to look at the execution log. Build this on day 1.

### 5. Document the credential setup as you go
Setting up OAuth for Drive + Sheets + Gmail × 3 + Workable is a lot of clicks. We rebuilt the credential setup docs from memory after the fact. Should have written the runbook during setup.

### 6. Externalize the AI prompt
The prompt is currently a multi-line string inside a code node. A separate `prompt.md` file with versioning would have been cleaner and easier to iterate on.

### 7. Add an idempotency check
The workflow has no explicit idempotency. If the same webhook is delivered twice, the candidate gets two rows. Adding a `WORKABLE RECORD ID` lookup before append would prevent this.

### 8. Plan the migration off Sheets early
Sheets is the right answer for v1. It won't be the right answer at 1000+ candidates/day or with multiple concurrent recruiters editing. Knowing the migration path before you need it is cheap insurance.

---

## Skills That Mattered

For anyone considering a similar build, the skills that mattered most were not specific tools but general engineering muscle:

- **API debugging** — Reading HTTP responses, decoding error messages, understanding auth headers
- **JSON literacy** — Navigating nested structures, building expressions to extract specific fields
- **Webhook hygiene** — Understanding delivery, retries, idempotency, timeouts
- **Prompt engineering** — Structured output, validation, JSON parsing fallbacks
- **OAuth flow comprehension** — Why some credentials work in some nodes and not others
- **Patience** — Real-world automation is 80% edge cases. The happy path is the easy part.

---

## Closing Thoughts

This kind of automation looks impressive when finished, but most of the work is unglamorous: handling empty fields, fixing weird character encodings, dealing with API quirks, retrying failed requests, and explaining to stakeholders why a thing that "should just work" sometimes doesn't.

The win isn't in the AI or the visual workflow. The win is in the **discipline of mapping a messy human process into a deterministic pipeline** — and being honest about the parts that still need a human in the loop.
