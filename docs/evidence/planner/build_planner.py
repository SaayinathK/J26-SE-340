"""Build the reviewed Planner workbook and evidence report from the supplied export.

Run: python evidence/planner/build_planner.py
The original four workbook sheets and downloaded file remain unchanged.
"""
import csv
import hashlib
import json
import subprocess
from collections import Counter
from pathlib import Path

from workbook_io import add_sheets, read_workbook, table_records

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
SOURCE = OUT / "source-export.xlsx"
DATE = "2026-10-21"
OWNER = "SAAYINATH K it23304338"
EVIDENCE = {}
TASKS = []
SOURCE_TASKS = table_records(read_workbook(SOURCE)[0])
BY_ROW = {task["_row"]: task for task in SOURCE_TASKS}


def sha(path):
    hasher = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def evidence(key, path, kind, description, anchor=None):
    full = ROOT / path
    if not full.is_file():
        raise FileNotFoundError(full)
    line = None
    if anchor:
        for number, value in enumerate(full.read_text(encoding="utf-8-sig").splitlines(), 1):
            if anchor in value:
                line = number
                break
        if line is None:
            raise ValueError(f"Missing source anchor: {key}: {anchor}")
    EVIDENCE[key] = {"path": path, "kind": kind, "description": description,
                     "line": line, "bytes": full.stat().st_size, "sha256": sha(full)}


def item(text, state="Pending", refs=(), detail=""):
    return {"text": text, "state": state, "evidence": list(refs), "detail": detail}


def update(row, status, assessment, summary, states=None, extras=(), default_refs=(), remaining=""):
    source = BY_ROW[row]
    entries = [text.strip() for text in source.get("Checklist Items", "").split(";") if text.strip()]
    checklist = []
    for index, text in enumerate(entries):
        state = (states or {}).get(index, "Export reported only" if source["Status"] == "Completed" else "Pending")
        if isinstance(state, tuple):
            state, refs = state
        else:
            refs = default_refs if state == "Verified" else ("E-PLANNER",) if state == "Export reported only" else ()
        checklist.append(item(text, state, refs))
    checklist.extend(extras)
    TASKS.append({"audit_key": f"P-{row - 1:02d}", "task_id": source["Task ID"], "name": source["Task Name"],
                  "bucket": source["Bucket"], "assigned_to": source["Assigned To"], "source_row": row,
                  "original_status": source["Status"], "status": status, "assessment": assessment,
                  "summary": summary, "checklist": checklist, "additional_remaining": remaining,
                  "parent": "", "source": source})


def verified(text, *refs, detail=""):
    return item(text, "Verified", refs, detail)


def pending(text, *refs, detail=""):
    return item(text, "Pending", refs, detail)


def add(number, name, bucket, parent_row, checklist, summary, status="Completed"):
    TASKS.append({"audit_key": f"NEW-C4-{number:02d}", "task_id": "", "name": name, "bucket": bucket,
                  "assigned_to": OWNER, "source_row": None, "original_status": "Not in export", "status": status,
                  "assessment": "Verified" if status == "Completed" else "Partial", "summary": summary,
                  "checklist": checklist, "additional_remaining": "", "parent": BY_ROW[parent_row]["Task ID"], "source": {}})


def refs_for(task):
    refs = list(dict.fromkeys(key for entry in task["checklist"] for key in entry["evidence"]))
    if task["source_row"]:
        refs.insert(0, "E-PLANNER")
    return list(dict.fromkeys(refs))


def remaining_for(task):
    result = [entry["text"] + (" (export completion only; attach supporting evidence)" if entry["state"] == "Export reported only" else "")
              for entry in task["checklist"] if entry["state"] != "Verified"]
    if task["additional_remaining"]:
        result.append(task["additional_remaining"])
    return result


def git(*arguments):
    return subprocess.run(["git", *arguments], cwd=ROOT, capture_output=True, text=True, encoding="utf-8").stdout.strip()


def register_evidence():
    evidence("E-PLANNER", "evidence/planner/source-export.xlsx", "Supplied export", "Original 36 assigned tasks and reported statuses. Contains no item-level completion flags.")
    evidence("E-SCHEMA", "db/migrations/001_init.sql", "Source", "Tenant/user/knowledge/audit schema, pgvector, UUIDs, forced RLS.", "CREATE TABLE IF NOT EXISTS tenants")
    evidence("E-DBROLE", "db/migrations/002_app_role.sql", "Source", "Restricted c4_app role without RLS bypass.", "CREATE ROLE c4_app")
    evidence("E-AUTH", "services/gateway/src/routes/authRoutes.js", "Source", "Password login, registration, profile, logout, Google challenge and token verification.", "router.post('/login'")
    evidence("E-SESSIONS", "services/gateway/src/services/session.js", "Source", "HTTP-only cookies, database sessions, tenant transactions and CSRF checks.", "async function createSession")
    evidence("E-RBAC", "services/gateway/src/policies/rbac.js", "Source", "Administrator/marketer/viewer permission matrix.", "const policy")
    evidence("E-AUDIT", "services/gateway/src/middleware/audit.js", "Source", "Authenticated request outcome, tenant, user, route, action and status audit inserts.", "function audit")
    evidence("E-TEAM", "services/gateway/src/routes/teamRoutes.js", "Source", "Single-use invitations, roles, deactivation, self-change and last-admin protections.", "router.post('/invitations'")
    evidence("E-PLATFORM", "services/gateway/src/routes/platformRoutes.js", "Source", "Persistent campaigns, knowledge, drafts, activity, status, and explicit disconnected integrations.", "router.get('/status'")
    evidence("E-AGENT", "services/gateway/src/services/emailAgent.js", "Source", "Tenant text context, reusable prompt, real Ollama generation, timeout handling and unsubscribe footer.", "async function generateSequence")
    evidence("E-GUARDS", "services/gateway/src/services/guardrails.js", "Source", "PII, unsubscribe, spam and capitalization checks.", "function runGuardrails")
    evidence("E-RENDER", "services/gateway/src/services/emailTemplates.js", "Source", "Delivery-boundary name/link replacement and unresolved-tag rejection; not wired to sending.", "function renderEmailForLead")
    evidence("E-SEQUENCE", "services/gateway/src/services/workspace.js", "Source", "Three-email day 0/3/7 validation and database persistence; no word-count or grounding validator.", "function validSequence")
    evidence("E-RECORDS-SCHEMA", "db/migrations/005_workspace_records.sql", "Source", "RLS-backed campaigns, email sequences, activity and version columns.", "CREATE TABLE")
    evidence("E-ACCOUNTS-SCHEMA", "db/migrations/004_accounts_and_sessions.sql", "Source", "Account registration, Google identities, session resolution and invitation database functions.", "CREATE TABLE")
    evidence("E-MIGRATOR", "services/gateway/scripts/migrate.js", "Source", "Migration checksums, existing-schema adoption, application-role and forced-RLS validation.", "async function main")
    evidence("E-DEPLOY", "docker-compose.yml", "Source", "Local PostgreSQL, migration, gateway, Nginx frontend, healthchecks, optional Ollama.", "services:")
    evidence("E-DOCKER-DOC", "docker/README.md", "Documentation", "Local startup, existing volumes, CPU/GPU options and local HTTP scope.", "# Run")
    evidence("E-UI", "frontend/src/components/AccountShell.jsx", "Source", "Authenticated navigation and permission-based workspace pages.", "export default")
    evidence("E-KB-UI", "frontend/src/pages/Workspace.jsx", "Source", "Knowledge upload, integration scopes, monitoring and activity views.", "export function")
    evidence("E-SYNC", "frontend/src/hooks/useWorkspace.js", "Source", "Tenant/role-scoped state, five-second polling, focus refresh and stale-response protection.", "export function useWorkspace")
    evidence("E-API-DOC", "frontend/PLATFORM_API.md", "Documentation", "Implemented C4 endpoints, request/response fields, cookies/bearer/CSRF and error status codes.", "# Component")
    evidence("E-AUTH-DOC", "frontend/AUTH_SETUP.md", "Documentation", "Account setup, Google configuration and invitation flow.", "# Account")
    evidence("E-UNIT", "evidence/planner/checks/unit-tests.txt", "Fresh test", "12/12 frontend/API/CSV/preferences/template tests pass.")
    evidence("E-INTEGRATION", "evidence/planner/checks/accounts-platform-tests.txt", "Fresh test", "42/42 account/platform tests pass against an isolated database; Google and Ollama responses are test doubles.")
    evidence("E-BROWSER", "evidence/planner/checks/browser-ui-tests.txt", "Fresh browser test", "Real browser/account/database flows pass, including responsive 320/390/768px routes. Optional live AI generation disabled in this run.")
    evidence("E-RUNTIME", "evidence/planner/checks/runtime-audit.json", "Fresh read-only check", "Nginx/gateway health, unauthenticated denial, c4_app/RLS, three sample tenants, installed models and configured base model.")
    evidence("E-ACCESS", "evidence/planner/checks/access-audit.json", "Fresh isolated test", "Nine role/route combinations; three-tenant read/write isolation; nine persisted audit records; temporary database removed.")
    evidence("E-CONTENT", "evidence/planner/checks/content-audit.json", "Fresh content check", "Six guardrail cases pass; incorrect sequence timing rejected; 165-word body and unsupported offer accepted by save validator.")
    evidence("E-MIGRATION-TEST", "evidence/planner/checks/migration-tests.txt", "Fresh isolated test", "All five migrations apply to a fresh database and a repeated migration run passes.")
    evidence("E-BUILD", "evidence/planner/checks/frontend-build.txt", "Fresh build transcript", "Production frontend build succeeded; output transcribed from this audit session.")
    evidence("E-LOAD", "evidence/planner/checks/health-load-summary.json", "Fresh load test", "5 VUs / 30 seconds, 143 health requests, 286 checks, zero failures; health-only workload.")
    evidence("E-FT-DATA", "evidence/planner/checks/dataset-verification.json", "Fresh artifact verification", "715 train + 171 validation examples; all supplied references and runtime prompt contracts pass; five disjoint validation products.")
    evidence("E-FT-SCRIPT", "ml/finetune/prepare_email_ft.py", "Source", "CSV cleaning, offer rewriting, three-step assembly and product-level split implementation; execution needs pandas.", "def main")
    evidence("E-FT-NOTEBOOK", "ml/finetune/c4_finetune_mistral_qlora.ipynb", "Training artifact", "QLoRA configuration, answer-only loss, baseline generation, training/resume, post-training evaluation and packaging.")
    evidence("E-FT-EVAL", "evidence/c4-ft/c4-ft_finetune_summary.json", "Supplied training results", "715 training examples, 25 evaluated prompts, base/fine-tuned metrics and loss summaries.")
    evidence("E-FT-WEIGHTS", "ml/finetune/models/c4-email-lora/adapter_model.safetensors", "Supplied model artifact", "167,832,240-byte adapter, 448 tensor entries and valid data offsets; not loaded or retrained in this audit.")
    evidence("E-FT-AUDIT", "evidence/planner/checks/fine-tuning-audit.json", "Fresh artifact audit", "Recomputed 6/25 versus 19/25 all-checks pass; best recorded validation loss at step 40; weights checksum; rebuild dependency failure.")
    evidence("E-FT-REBUILD", "evidence/planner/checks/dataset-rebuild.txt", "Failed environment check", "CSV rebuild could not start: ModuleNotFoundError for pandas in the current Python environment.")
    evidence("E-FT-MODELFILE", "ml/finetune/Modelfile", "Source", "Prepared Ollama base/adapter definition for c4-email-ft; model is not installed in observed runtime.")
    evidence("E-AI-FAIL", "evidence/planner/checks/browser-tests.txt", "Failed live inference check", "Isolated browser test with actual Ollama failed HTTP 503 (unavailable or timed out); database cleanup completed.")
    evidence("E-SCREEN-OVERVIEW", "evidence/planner/screenshots/authenticated-overview-light.png", "Fresh screenshot", "Authenticated overview captured by the successful isolated browser test.")
    evidence("E-SCREEN-TEAM", "evidence/planner/screenshots/live-team-access.png", "Fresh screenshot", "Live team and role controls captured by the successful isolated browser test.")
    evidence("E-SCREEN-MOBILE", "evidence/planner/screenshots/register-mobile.png", "Fresh screenshot", "390px registration screenshot; browser assertions also checked 320px and 768px.")
    evidence("E-GIT", "evidence/planner/checks/repository-snapshot.json", "Fresh metadata", "Current branch/HEAD, local branches, working-tree status and source hashes; local implementation is not proof of authorship or merged remote work.")


def original_updates():
    update(2, "Completed", "Verified", "Database/RLS setup and sample tenants verified live; fresh migrations and isolated three-tenant negative tests pass.",
           {i: "Verified" for i in range(7)}, default_refs=("E-SCHEMA", "E-DBROLE", "E-RUNTIME", "E-ACCESS", "E-MIGRATION-TEST"))
    update(3, "Completed", "Export reported only", "Git repository and local branches exist. Preserve reported completion; collaborator access and remote branch protection cannot be established from this checkout.",
           {0: ("Verified", ("E-GIT",)), 3: ("Verified", ("E-GIT",))}, remaining="Attach remote collaborator/access and branch-protection evidence if required.")
    update(4, "Completed", "Export reported only", "Supervisor approval/signature and individual reports are reported complete in the export. Supporting meeting/report files are not in this workspace.")
    update(5, "Completed", "Verified", "The supplied export demonstrates an existing plan, assignees, sprint buckets and tasks.", {i: "Verified" for i in range(4)}, default_refs=("E-PLANNER",))
    update(6, "Completed", "Export reported only", "Preserve reported completion. Export says Completed but 0/4 checklist items; named diary/AI-log/SharePoint evidence is not available locally.")
    update(7, "Completed", "Export reported only", "Implementation reflects a stack and tenancy design, but team agreement, decision log and meeting attendance are not locally evidenced.")
    update(8, "Completed", "Partial", "Implemented C4 API contract is documented with payloads, error codes, identity and permissions. Preserve team completion; referenced C3 YAML/mock files are absent from this checkout.",
           {1: ("Verified", ("E-API-DOC",)), 2: ("Verified", ("E-API-DOC",)), 5: ("Verified", ("E-API-DOC",)), 8: ("Verified", ("E-API-DOC",))},
           extras=[verified("Document the currently implemented C4 platform endpoints and integration limitations", "E-API-DOC")],
           remaining="Attach team-reviewed cross-component contracts, actual C1/C2/C3 mocks and the contract commit/review evidence.")
    update(9, "Completed", "Export reported only", "Sprint review/lessons/risk updates are reported complete. The risk register and review minutes are not present locally.")
    update(10, "Completed", "Verified", "Password login, session-bound tenant identity, bcrypt, JWT validation and protected routes are covered by fresh account/API tests.",
           {i: "Verified" for i in range(6)}, default_refs=("E-AUTH", "E-SESSIONS", "E-INTEGRATION", "E-RUNTIME"),
           extras=[verified("Restore identity through HTTP-only cookies and revoke sessions on logout", "E-SESSIONS", "E-BROWSER"),
                   verified("Reject forged tenant/role registration and cross-origin/CSRF mutations", "E-INTEGRATION")])
    update(11, "Completed", "Verified", "All nine legacy role/route combinations were rerun and passed. Current database roles override stale JWT role claims.",
           {i: "Verified" for i in range(6)}, default_refs=("E-RBAC", "E-ACCESS", "E-INTEGRATION"),
           extras=[verified("Apply live role changes and account deactivation to existing sessions", "E-INTEGRATION", "E-BROWSER")])
    update(12, "In progress", "Partial", "C4 has authenticated tenant/role-protected APIs and documented integration boundaries. C1/C2/C3 services and a gateway proxy for them are not implemented.",
           {5: ("Verified", ("E-RBAC", "E-INTEGRATION"))},
           extras=[verified("Expose implemented C4 workspace and email APIs with explicit disconnected statuses", "E-PLATFORM", "E-API-DOC"),
                   verified("Test C4 denied, unavailable-model and malformed-model responses", "E-INTEGRATION")],
           remaining="C4 boundary documentation and provider test doubles do not prove the shared C1-C3 proxy contract, deployed mocks or connected agent services.")
    update(13, "Completed", "Verified", "Authenticated allowed/denied audit logging is now independently verified: 6 allowed and 3 denied records with tenant/user/route/status in PostgreSQL.",
           {i: "Verified" for i in range(5)}, default_refs=("E-AUDIT", "E-ACCESS"),
           remaining="Scope: authenticated routes using the audit middleware. Missing/invalid JWT requests and all platform CRUD routes are not universally covered.")
    update(14, "In progress", "Partial", "C4 implementation and fresh screenshots support demo preparation. No supervisor invitation, actual demo, feedback or follow-up record is available.",
           extras=[verified("Collect C4 overview, account, membership and mobile demo screenshots", "E-SCREEN-OVERVIEW", "E-SCREEN-TEAM", "E-SCREEN-MOBILE")])
    update(15, "Completed", "Export reported only", "Preserve team-reported completion. Export says Completed but 0/5 checklist items; commits are visible locally but PR review/merge and team review records are not established.")
    update(16, "In progress", "Unverified", "No user-feedback invitation, participant list, completed session or feedback analysis is available locally.", extras=[
        pending("Agree the user-feedback goals and participant criteria"), pending("Invite participants and record the confirmed session"),
        pending("Prepare a runnable user journey and feedback questions"), pending("Collect feedback and link the findings and resulting tasks")])
    update(17, "Completed", "Verified", "Three real sample tenants pass read isolation; three isolated test tenants pass cross-tenant read/write rejection; all nine RBAC combinations pass.",
           {i: "Verified" for i in range(6)}, default_refs=("E-RUNTIME", "E-ACCESS", "E-INTEGRATION"))
    update(18, "In progress", "Implemented; live test pending", "Three-step generation, tenant context, validation and persistence are implemented and integration-tested with model responses stubbed. Live Ollama generation returned HTTP 503 during this audit.",
           {0: ("Verified", ("E-AGENT", "E-FT-EVAL", "E-RENDER")), 1: ("Verified", ("E-AGENT", "E-INTEGRATION")),
            2: ("Verified", ("E-AGENT", "E-RUNTIME")), 4: ("Verified", ("E-FT-EVAL", "E-INTEGRATION")),
            5: ("Verified", ("E-GUARDS", "E-CONTENT")), 6: ("Verified", ("E-SEQUENCE", "E-INTEGRATION"))},
           extras=[pending("Pass a live tenant-context generation and persistence smoke test", "E-AI-FAIL"),
                   verified("Persist and reload manual email sequences without an AI dependency", "E-INTEGRATION", "E-BROWSER")],
           remaining="The trained adapter is separate from the configured base-model runtime. Live name/link rendering is a helper awaiting a delivery integration; context retrieval is recent/source-selected text, not vector similarity search.")
    update(19, "In progress", "Partial", "The C4 account-to-campaign/knowledge/manual-sequence workflow passes browser checks. No complete C1-C4 agent workflow exists in this checkout.", extras=[
        verified("Run C4 registration, campaign, knowledge and saved-sequence workflow against PostgreSQL", "E-BROWSER", "E-INTEGRATION"),
        pending("Connect Component 1 strategy service", "E-PLATFORM"), pending("Connect Component 2 content service", "E-PLATFORM"),
        pending("Connect Component 3 lead-intelligence service", "E-PLATFORM"), pending("Verify identity/context handoffs between all four components"),
        pending("Run complete multi-agent success, denial and failure scenarios"), pending("Capture a complete integrated workflow trace and output evidence")])
    update(20, "In progress", "Partial", "PII, unsubscribe, spam and caps checks are implemented and verified. Factual offer grounding is measured offline but not enforced by the save validator; recipient consent is not implemented.", extras=[
        verified("Reject detected email/phone PII", "E-CONTENT", "E-GUARDS"), verified("Require unsubscribe wording on saved drafts", "E-CONTENT", "E-INTEGRATION"),
        verified("Reject spam phrases and excessive capitals", "E-CONTENT"), verified("Measure offline offer/fact grounding on generated responses", "E-FT-EVAL", "E-FT-AUDIT"),
        pending("Enforce runtime grounding against selected tenant facts before persistence", "E-CONTENT", "E-SEQUENCE"),
        pending("Enforce the 150-word body limit in the save validator", "E-CONTENT"),
        pending("Verify recipient consent and process real opt-outs before delivery", "E-PLATFORM"), pending("Review factual relevance and tone manually on an independent test set")])
    update(21, "Not started", "Unverified", "A working C4 implementation is not evidence of a supervisor checkpoint meeting. No checkpoint approval or feedback is available.", extras=[
        pending("Prepare individual progress, results and known limitations"), pending("Arrange and conduct the 50% supervisor checkpoint"),
        pending("Record supervisor feedback and approval"), pending("Assign and track follow-up actions")])
    update(22, "In progress", "Partial", "A reproducible baseline-versus-fine-tuned generation comparison exists for 25 shared validation prompts. This is not a personalized-versus-generic ablation or a measured CTR experiment.", extras=[
        verified("Use identical held-out validation prompts for base and fine-tuned models", "E-FT-NOTEBOOK", "E-FT-EVAL"),
        verified("Save per-response checks, latency, comparison table and training loss", "E-FT-EVAL", "E-FT-AUDIT"),
        verified("Recalculate all-checks pass rates: base 6/25, fine-tuned 19/25", "E-FT-AUDIT"),
        pending("Compare the same campaign briefs with and without personalization/context"),
        pending("Evaluate all 171 validation prompts and a separate untouched test set"),
        pending("Use a blinded human rubric for relevance, factuality, tone and personalization"),
        pending("Report uncertainty and grounding regressions; do not claim real CTR improvement")])
    update(23, "In progress", "Partial", "Day 0/3/7 sequence metadata is enforced and unsubscribe text is checked. These do not implement scheduling, per-recipient consent or suppression.", extras=[
        verified("Validate three emails scheduled at offsets 0, 3 and 7 days", "E-SEQUENCE", "E-CONTENT"),
        verified("Require unsubscribe wording before saving", "E-GUARDS", "E-CONTENT"),
        pending("Store recipient consent and auditable consent changes"), pending("Maintain tenant-scoped suppression/unsubscribe records"),
        pending("Check consent and suppression at the delivery boundary"), pending("Implement a scheduler with timezone, cancellation, retries and duplicate-send prevention"),
        pending("Test opt-out processing and suppression before subsequent steps")])
    update(24, "In progress", "Partial", "Health checks, database/model status, five-second workspace activity and 15-second service polling exist. Distributed request traces, metrics collection and alerts are not present.", extras=[
        verified("Expose health, database latency and actual model availability", "E-RUNTIME", "E-PLATFORM"),
        verified("Persist and display workspace activity", "E-INTEGRATION", "E-BROWSER"),
        verified("Show disconnected delivery and agent services explicitly", "E-PLATFORM", "E-KB-UI"),
        pending("Add request/correlation IDs and traces across connected services"), pending("Collect retained latency/error/throughput metrics"),
        pending("Configure alert rules and notification delivery"), pending("Trigger a failure and capture its alert and trace evidence")])
    update(25, "Not started", "Not implemented", "No engagement prediction training/inference service or experiment assignment/event store is present. Email language-model fine-tuning is a different deliverable.", extras=[
        pending("Define genuine engagement labels and avoid synthetic CTR as measured outcomes"), pending("Build leakage-controlled train/validation/test splits"),
        pending("Train and evaluate an engagement predictor against a baseline"), pending("Store tenant-scoped experiment variants and assignments"),
        pending("Persist provider-confirmed delivery/open/click events with deduplication"), pending("Expose prediction/experiment APIs and validate tenant isolation")])
    update(26, "In progress", "Partial", "A local Docker deployment is running and the health-only 5-VU/30-second workload passes. This does not establish email-generation or multi-agent performance, cloud deployment or production readiness.", extras=[
        verified("Provide a Compose stack for the frontend, gateway, database and migrations", "E-DEPLOY", "E-DOCKER-DOC"),
        verified("Build the frontend and verify Nginx/gateway reachability", "E-BUILD", "E-RUNTIME"),
        verified("Verify fresh and repeated migrations", "E-MIGRATION-TEST"), verified("Run and save a local health load test", "E-LOAD"),
        pending("Pass live AI generation under realistic concurrency and latency budgets", "E-AI-FAIL"),
        pending("Test authenticated database workflows and connected agents under load"), pending("Record target-environment deployment, recovery and full-workflow performance evidence")])
    update(27, "In progress", "Partial", "C4 three-tenant isolation and the C4 browser workflow are verified. Full cross-component and live AI workflow checks remain incomplete.", extras=[
        verified("Verify own-record reads for all three sample tenants", "E-RUNTIME"), verified("Reject cross-tenant reads and inserts in three isolated workspaces", "E-ACCESS"),
        verified("Verify campaign/knowledge/sequence ownership and stale-write rejection", "E-INTEGRATION"),
        verified("Run the C4 account/campaign/knowledge/manual-sequence browser journey", "E-BROWSER"),
        pending("Complete live AI generation for each tenant", "E-AI-FAIL"), pending("Connect and verify the C1-C4 workflow across all three tenants"),
        pending("Capture complete multi-agent workflow and isolation evidence for the team")])
    update(28, "Not started", "Unverified", "No PP1 slide deck exists in this workspace. The report and screenshots can support a future C4 deck; they are not a completed presentation.", extras=[
        pending("Prepare the C4 problem, architecture and individual contribution slides"), pending("Include measured evaluation results and their limitations"),
        pending("Add screenshots, demo sequence and remaining work"), pending("Review and combine each member's PP1 slides")])
    update(29, "In progress", "Partial", "This audit packages the C4 planner mapping, checklists, regression logs, screenshots and fine-tuning evidence. Other members' evidence and team submission location are not verified.", extras=[
        verified("Create a C4 evidence index linking source, tests, screenshots and model results", "E-FT-AUDIT", "E-BROWSER", "E-ACCESS"),
        verified("Retain successes, failures and unverified claims in the task audit", "E-AI-FAIL", "E-FT-REBUILD", "E-CONTENT"),
        pending("Collect and review the other three members' evidence"), pending("Publish the agreed team evidence folder and record its final location")])
    update(30, "Not started", "Unverified", "No timed rehearsal or Q&A attendance/recording is available.", extras=[
        pending("Agree the presentation/demo order and time budget"), pending("Run and time the full team rehearsal"),
        pending("Practise individual Q&A and record weak areas"), pending("Record feedback and assign corrective tasks")])
    update(31, "Not started", "Unverified", "No supervisor rehearsal invitation, attendance or feedback is available.", extras=[
        pending("Schedule the supervisor rehearsal"), pending("Rehearse the actual presentation and live demo"), pending("Capture supervisor feedback and resulting actions")])
    update(32, "Not started", "Unverified", "No rehearsal feedback register is present; audit findings must not be represented as supervisor feedback.", extras=[
        pending("Collect the actual rehearsal feedback register"), pending("Assign and implement each correction"), pending("Retest affected behavior and record acceptance")])
    update(33, "Not started", "Unverified", "No individual Q&A practice record or completed explanation pack is available.", extras=[
        pending("Explain tenancy, RLS, session auth, roles and implementation ownership"), pending("Explain QLoRA, dataset split, evaluation and grounding limitations"),
        pending("Practise individual questions and record completed practice")])
    update(34, "In progress", "Partial", "Fresh schema and local build/browser checks pass. The checkout has substantial staged/unstaged work; no frozen release or separate clean-machine validation is established.", extras=[
        verified("Run production build and existing unit/integration/browser checks", "E-BUILD", "E-UNIT", "E-INTEGRATION", "E-BROWSER"),
        verified("Verify fresh-database setup and repeated migrations", "E-MIGRATION-TEST"),
        pending("Resolve and commit the intended staged/unstaged changes", "E-GIT"), pending("Create and record the agreed release/freeze commit or tag"),
        pending("Clone and validate startup on a separate clean environment"), pending("Verify clean-machine AI/runtime dependencies and model setup", "E-FT-REBUILD", "E-AI-FAIL")])
    update(35, "In progress", "Partial", "C4 implementation/evaluation evidence is packaged by this audit. Diaries, AI logs, signed reports, slides and final team submission are not available locally.", extras=[
        verified("Package C4 source references, tests, screenshots and fine-tuning evidence", "E-ACCESS", "E-BROWSER", "E-FT-AUDIT"),
        pending("Complete each member's diary and AI-use log"), pending("Attach approved reports, final slides and supervisor evidence"),
        pending("Check links and upload the final submission to the required team location"), pending("Record submission confirmation and final review")])
    update(36, "In progress", "Partial", "Google identity sign-in and explicit linking are implemented and pass provider-boundary tests. External-service OAuth/token refresh, webhooks, synchronization and recovery remain unimplemented.", extras=[
        verified("Implement Google ID-token verification, nonce challenges and explicit account linking", "E-AUTH", "E-INTEGRATION"),
        verified("Test provider failures, replay rejection, email mismatch and unverified identities", "E-INTEGRATION"),
        pending("Complete a real Google account sign-in/link acceptance test"), pending("Implement required external-service OAuth grants and credential refresh"),
        pending("Add authenticated, replay-safe, tenant-routed webhooks"), pending("Implement synchronization, retries, recovery and reconciliation")])
    update(37, "Not started", "Not implemented", "No tenant opt-in preference table/API or enforcement path exists; visual theme/motion preferences are unrelated.", extras=[
        pending("Define opt-in purposes, defaults and permission rules"), pending("Persist tenant-scoped settings and changes"), pending("Add authenticated settings APIs and an administrator UI"),
        pending("Enforce opt-in decisions in integrations and delivery"), pending("Test authorization, isolation and opt-in/opt-out transitions")])


def added_work():
    add(1, "Build the responsive authenticated C4 workspace interface", "Sprint 3", 18, [
        verified("Implement overview, campaigns, email builder, knowledge, integrations, team, monitoring and settings routes", "E-UI", "E-KB-UI"),
        verified("Enforce route/action permissions and real account/session state", "E-BROWSER", "E-INTEGRATION"),
        verified("Support light/dark appearance and motion preferences", "E-BROWSER", "E-UNIT"),
        verified("Validate authenticated/login/register layouts at 320, 390 and 768 pixels", "E-BROWSER", "E-SCREEN-MOBILE")],
        "Delivered UI work not explicitly named as a standalone task in the export; scope is the implemented C4 interface, with disconnected integrations shown honestly.")
    add(2, "Implement self-service account registration and database-backed sessions", "Sprint 2", 10, [
        verified("Create a server-assigned administrator and new workspace on registration", "E-AUTH", "E-INTEGRATION"),
        verified("Validate passwords and reject client-selected role/tenant identity", "E-INTEGRATION"),
        verified("Restore sessions through HTTP-only cookies with CSRF/origin checks", "E-SESSIONS", "E-BROWSER"),
        verified("Persist profile changes and revoke sessions on logout/deactivation", "E-INTEGRATION", "E-BROWSER")],
        "Extends the original login task with account lifecycle and browser-session behavior. No email verification/password-reset service is claimed.")
    add(3, "Implement Google identity verification and account linking", "Sprint 2", 36, [
        verified("Provide Google challenge and verified ID-token handlers", "E-AUTH", "E-ACCOUNTS-SCHEMA"),
        verified("Enforce single-use nonce, verified email and configured audience checks", "E-INTEGRATION"),
        verified("Reject automatic email-only linking and require authenticated explicit linking", "E-INTEGRATION"),
        verified("Test failure, replay, registration and linking paths with provider verification stubbed", "E-INTEGRATION")],
        "Implementation and automated provider-boundary tests are complete. No real Google-account acceptance test or general external-service OAuth flow is claimed; those remain on the parent backlog task.")
    add(4, "Add workspace invitations and live team membership controls", "Sprint 3", 11, [
        verified("Create single-use, expiring invitations bound to recipient/workspace/role", "E-TEAM", "E-INTEGRATION"),
        verified("Accept invitations without allowing tenant or role substitution", "E-INTEGRATION", "E-BROWSER"),
        verified("Implement role changes and deactivation with live permission refresh", "E-INTEGRATION", "E-BROWSER"),
        verified("Protect self-role changes and last active administrator in code", "E-TEAM", "E-INTEGRATION")],
        "Invitation links are shared manually; no invitation email delivery is connected. Last-admin protection is source-reviewed; the existing suite checks self-change rejection.")
    add(5, "Persist campaign drafts, ownership and versioned changes", "Sprint 3", 19, [
        verified("Store tenant-scoped campaign drafts and archive/restore updates", "E-PLATFORM", "E-RECORDS-SCHEMA"),
        verified("Reject foreign workspace updates and stale versions", "E-INTEGRATION"),
        verified("Keep delivery metrics unavailable until real provider events exist", "E-INTEGRATION", "E-API-DOC"),
        verified("Verify database persistence and cross-tab refresh", "E-BROWSER")],
        "Campaign management now has persisted records rather than only role-demonstration routes; sending and Active state are intentionally unavailable.")
    add(6, "Build the persistent manual email-sequence editor and library", "Sprint 3", 18, [
        verified("Create, edit, reopen and delete saved three-email drafts", "E-PLATFORM", "E-BROWSER", "E-INTEGRATION"),
        verified("Validate sequence structure, guardrails, source ownership and optimistic versions", "E-SEQUENCE", "E-INTEGRATION"),
        verified("Retain saved work across page reload and new login", "E-BROWSER", "E-INTEGRATION"),
        verified("Deny viewers and foreign tenants access to sequence content", "E-INTEGRATION")],
        "Manual drafting works independently of model availability; live model generation remains a separate pending acceptance check.")
    add(7, "Build the tenant knowledge library and generation source controls", "Sprint 3", 18, [
        verified("Add and remove actual workspace knowledge text with administrator permissions", "E-PLATFORM", "E-INTEGRATION"),
        verified("Provide text upload/source selection UI and saved knowledge", "E-KB-UI", "E-BROWSER"),
        verified("Retrieve only the authenticated tenant's selected/recent text", "E-AGENT", "E-INTEGRATION"),
        verified("Reject foreign source IDs before contacting the model", "E-INTEGRATION")],
        "Current retrieval is source-selected/recent text, capped by source count and characters. pgvector availability and an embedding seed script do not establish semantic vector retrieval.")
    add(8, "Add workspace activity, database totals and automatic refresh", "Sprint 4", 24, [
        verified("Commit activity alongside campaign/knowledge/sequence changes", "E-PLATFORM", "E-INTEGRATION"),
        verified("Expose database totals and UTC daily aggregates without invented metrics", "E-PLATFORM", "E-UNIT"),
        verified("Refresh visible workspace data every five seconds and service status every fifteen seconds", "E-SYNC", "E-KB-UI"),
        verified("Verify cross-tab updates and data reset for tenant/role changes", "E-BROWSER", "E-SYNC")],
        "Delivered operational UI and polling are separate from distributed tracing or external alert delivery.")
    add(9, "Containerize C4 and verify repeatable database migrations", "Sprint 4", 26, [
        verified("Package React/Nginx, gateway and pgvector PostgreSQL in Compose", "E-DEPLOY", "E-RUNTIME"),
        verified("Provide ordered startup, loopback ports, persistent volumes and healthchecks", "E-DEPLOY", "E-DOCKER-DOC"),
        verified("Track migration checksums and validate restricted-role forced RLS", "E-MIGRATOR"),
        verified("Pass fresh-database and repeated-migration checks", "E-MIGRATION-TEST")],
        "Completed scope is local Docker deployment and migration verification. Cloud HTTPS, production operations and clean-machine release validation remain outside this completed item.")
    add(10, "Verify fine-tuning examples and the application prompt contract", "Sprint 3", 18, [
        verified("Verify 715 training and 171 validation sequences", "E-FT-DATA"),
        verified("Check supplied reference answers and actual application guardrails", "E-FT-DATA"),
        verified("Confirm exact runtime prompt reconstruction and fixed personalization line", "E-FT-DATA"),
        verified("Confirm five validation products with no training-product overlap", "E-FT-DATA")],
        "Completed item is supplied-artifact verification. CSV regeneration could not run in this Python environment because pandas is missing; the old README's claim that the builder is absent is stale.")
    add(11, "Train and retain the Mistral 7B QLoRA email adapter", "Sprint 3", 18, [
        verified("Retain the configured two-epoch QLoRA notebook and training log", "E-FT-NOTEBOOK", "E-FT-EVAL"),
        verified("Retain the trained LoRA adapter and tokenizer artifacts", "E-FT-WEIGHTS"),
        verified("Validate the adapter tensor offsets and compute a reproducible checksum", "E-FT-AUDIT"),
        verified("Record training/validation loss and the observed validation-loss regression", "E-FT-AUDIT")],
        "Training completion is supported by supplied logs/weights; this audit did not retrain or load the adapter. Final validation loss 0.9924 exceeds the best recorded 0.8709 at step 40.")
    add(12, "Evaluate base and fine-tuned email generation on held-out prompts", "Sprint 4", 22, [
        verified("Retain per-response results for the same 25 validation prompts", "E-FT-EVAL", "E-FT-NOTEBOOK"),
        verified("Compare JSON/sequence/unsubscribe/grounding/offer/length/guardrail metrics", "E-FT-EVAL"),
        verified("Recalculate all-seven-check pass rates as 24% base and 76% fine-tuned", "E-FT-AUDIT"),
        verified("Record grounding regression from 92% to 76% and small-sample limitations", "E-FT-EVAL", "E-FT-AUDIT")],
        "Completed scope is the existing 25-prompt base-versus-fine-tuned evaluation. It is not personalized-versus-generic ablation, independent final test accuracy, measured CTR or live deployment acceptance.")
    add(13, "Implement safe lead-name and campaign-link template rendering", "Sprint 3", 18, [
        verified("Preserve reusable first_name/cta_link tags in stored sequences", "E-RENDER", "E-UNIT"),
        verified("Replace tags in a rendered copy using actual provided lead/link values", "E-UNIT"),
        verified("Reject missing values, header injection, unsafe URLs and unresolved tags", "E-UNIT"),
        verified("Handle dollar signs in lead names without replacement-string expansion", "E-UNIT")],
        "The standalone renderer and tests are delivered. It has not been wired into a delivery provider and does not send messages.")
    add(14, "Automate isolated account/platform and responsive browser regression checks", "Sprint 4", 27, [
        verified("Run 42 database-backed account/platform integration tests", "E-INTEGRATION"),
        verified("Run 12 frontend/template unit tests", "E-UNIT"),
        verified("Run the isolated database-backed browser journey and save screenshots", "E-BROWSER", "E-SCREEN-OVERVIEW", "E-SCREEN-TEAM"),
        verified("Verify nine RBAC combinations, three-tenant write/read isolation and audit persistence", "E-ACCESS")],
        "The tested C4 regression scope passes. The separately executed real-AI check failed HTTP 503 and is retained as evidence, rather than included in this passed test scope.")
    add(15, "Register and activate the fine-tuned Ollama model", "Sprint 4", 18, [
        verified("Provide the adapter, tokenizer and Ollama Modelfile", "E-FT-WEIGHTS", "E-FT-MODELFILE"),
        pending("Verify adapter compatibility with the exact Ollama base version"),
        pending("Create c4-email-ft and confirm it appears in the installed model list", "E-RUNTIME"),
        pending("Set the gateway model to the fine-tuned model and recreate/restart the gateway", "E-RUNTIME"),
        pending("Pass tenant-context generation, guardrails and persistence using that model", "E-AI-FAIL")],
        "Artifacts are ready for deployment work, but the observed installed/configured generator is base mistral:7b-instruct-q4_K_M. No runtime switch was made during the audit.", status="In progress")


FINDINGS = [
    ("F01", "High", "Live email generation failed", "The optional real-Ollama browser test returned HTTP 503 (unavailable or timed out).", "E-AI-FAIL", "P-17; NEW-C4-15", "Diagnose local model availability/latency and rerun live generation before accepting the generation task."),
    ("F02", "High", "Fine-tuned model not active", "Host environment and installed model list show base Mistral; the trained adapter is a separate local artifact.", "E-RUNTIME; E-FT-WEIGHTS", "NEW-C4-15", "Validate compatibility, register the adapter model, select it deliberately and capture an authenticated smoke test."),
    ("F03", "High", "Runtime offer grounding not enforced", "A source=none sequence containing an unsupported 90% offer is accepted by validSequence; grounding is currently a prompt rule and offline check.", "E-CONTENT; E-SEQUENCE", "P-19", "Validate supported facts/offers against tenant context before persistence/delivery."),
    ("F04", "Medium", "150-word limit not enforced on save", "The save validator accepts the audit's 165-word body. The notebook separately measures the word limit.", "E-CONTENT; E-SEQUENCE", "P-19", "Add a body word-count rule and suitable negative checks before treating the runtime limit as enforced."),
    ("F05", "High", "Consent, suppression and delivery missing", "Day offsets and unsubscribe wording exist, but there is no recipient-consent/suppression store, sending provider or scheduler.", "E-PLATFORM; E-SEQUENCE", "P-22; P-24; P-36", "Implement auditable recipient consent, opt-outs, suppression, sending and event handling before claiming delivery functionality."),
    ("F06", "High", "Other agents are not connected", "C1 strategy, C2 content and C3 lead intelligence are explicitly reported not_connected; integrations UI describes future scope.", "E-PLATFORM; E-KB-UI", "P-11; P-18; P-26", "Obtain actual contracts/services, connect authenticated routes and test the full workflow."),
    ("F07", "Medium", "Evaluation scope and regression", "All-check pass rate improves 24% to 76% on 25 prompts, while grounding decreases 92% to 76%. Validation loss is best at step 40 and higher at the final step.", "E-FT-EVAL; E-FT-AUDIT", "P-21; NEW-C4-11; NEW-C4-12", "Compare available checkpoints; evaluate all validation prompts and an untouched test set; add human review and a real personalization ablation."),
    ("F08", "Medium", "CSV rebuild blocked by environment", "prepare_email_ft.py exists, but the current Python environment lacks pandas. Supplied-artifact verification passes; regeneration is not established.", "E-FT-REBUILD; E-FT-DATA", "NEW-C4-10", "Use the intended ML environment and compare rebuilt examples/reports without overwriting the supplied dataset."),
    ("F09", "Medium", "Fine-tuning documentation is stale", "README.md and the top-level verification report still say prepare_email_ft.py/Modelfile were not supplied, although both now exist. The report remains artifact verification, not model accuracy.", "E-FT-SCRIPT; E-FT-MODELFILE; E-FT-DATA", "NEW-C4-10", "Reconcile documentation after a successful CSV rebuild; retain the distinction between data quality and model output metrics."),
    ("F10", "Medium", "Audit coverage is limited", "Authenticated routes using audit middleware record allowed/denied outcomes. Authentication failures and platform CRUD operations are not all handled by that middleware; workspace events are a separate stream.", "E-AUDIT; E-PLATFORM; E-ACCESS", "P-12", "Define required audit coverage and add it to uncovered actions if full request auditing is required."),
    ("F11", "Medium", "Monitoring and load scope", "Health checks/activity/model status exist. No retained distributed traces or alert pipeline exists, and k6 exercises /health only.", "E-LOAD; E-PLATFORM; E-KB-UI", "P-23; P-25", "Add connected-service metrics, traces/alerts and authenticated/generation workload testing."),
    ("F12", "Medium", "Team evidence remains external", "Reports, signatures, meetings, diaries, slides, risk logs, remote branch protection and C3 contract/mock files named in the export are not present here.", "E-PLANNER; E-GIT", "Team/shared tasks", "Attach existing external evidence. Preserve reported completion without inventing local verification or claiming another member's work."),
    ("F13", "Medium", "Release not frozen", "The checkout includes extensive staged/unstaged work. Local source presence does not demonstrate a merged release or clean-machine installation.", "E-GIT; E-BUILD; E-MIGRATION-TEST", "P-33", "Review and commit the intended changes; identify a freeze commit and validate a fresh clone on a separate machine."),
]


def write_report(manifest, verification):
    lines = ["# Planner audit and task update", "", f"Audit date: {DATE}, Asia/Colombo. Assignee: {OWNER}.", "",
             "Open [the updated workbook](J26-SE-340_updated_2026-10-21.xlsx). The Updated Tasks sheet contains updated statuses, per-item checklists, evidence and remaining work. The four original export sheets are retained unchanged for comparison.", "",
             "This is an updated export and evidence package. No live Microsoft Planner board was changed. New task IDs are blank because these are proposed additions, not existing Planner objects. NEW-C4 keys are local review identifiers. Parent references show where new deliverables expand existing tasks, so they should not be double-counted as unrelated effort.", "",
             f"Reviewed {len(SOURCE_TASKS)} existing assigned tasks and added {len(TASKS) - len(SOURCE_TASKS)} proposed tasks for work not separately tracked in the export. Of the new items, 14 describe delivered implementation/artifacts and one tracks deployment of the fine-tuned model.", "",
             "## How completion was assessed", "",
             "- Verified: source/artifact evidence establishes the stated item, with fresh runtime/tests where its wording requires execution. A verified source implementation does not imply a live external-service acceptance test.",
             "- Export reported only: completion was reported in the supplied planner, but supporting local evidence is unavailable. Existing Completed statuses are preserved; original dates and attribution are not invented.",
             "- Pending: the item is missing, unverified or failed during this audit. A failed live check stays open even if mocked integration tests pass.",
             "- Verified checklist counts describe this audit only. They do not recover individual original checkbox flags: the export contains only an aggregate count and item labels.",
             "- Shared task status and completion attribution remain team-level. Presence of code in this checkout does not establish which individual authored it.", "",
             "## Verification results", "", "| Check | Result | Evidence |", "|---|---|---|"]
    for name, state, result, keys in verification:
        links = ", ".join(f'[{key}]({relative(EVIDENCE[key]["path"])})' for key in keys)
        lines.append(f"| {name} | {state}: {result} | {links} |")
    lines += ["", "## Existing planner changes", "", "| Task | Previous | Updated | Assessment |", "|---|---|---|---|"]
    for task in TASKS[:len(SOURCE_TASKS)]:
        lines.append(f'| {task["audit_key"]}: {task["name"]} | {task["original_status"]} | {task["status"]} | {task["assessment"]} |')
    lines += ["", "## Work added to make existing contributions visible", "", "| Local key | Proposed task | Status | Parent task |", "|---|---|---|---|"]
    for task in TASKS[len(SOURCE_TASKS):]:
        parent = next(t["audit_key"] for t in TASKS if t["task_id"] == task["parent"])
        lines.append(f'| {task["audit_key"]} | {task["name"]} | {task["status"]} | {parent} |')
    lines += ["", "## Material findings", ""]
    for key, severity, title, observation, refs, tasks, action in FINDINGS:
        links = ", ".join(f'[{ref}]({relative(EVIDENCE[ref]["path"])})' for ref in refs.split("; "))
        lines += [f"### {key}: {title} ({severity})", "", f"{observation} Evidence: {links}.", "", f"Next action: {action} Related tasks: {tasks}.", ""]
    lines += ["## Task-by-task checklists", "", "Use the workbook's Checklist Evidence sheet to filter one item per row. The same detail is reproduced below for copying into Planner.", ""]
    for task in TASKS:
        lines += [f'### {task["audit_key"]}: {task["name"]}', "", f'Status: **{task["status"]}**. Assessment: {task["assessment"]}.', "", task["summary"], ""]
        if task["task_id"]:
            lines += [f'Planner task ID: `{task["task_id"]}`. Source row: {task["source_row"]}.', ""]
        else:
            lines += [f'Proposed new task; assign to {OWNER}. Parent task ID: `{task["parent"]}`.', ""]
        for entry in task["checklist"]:
            links = ", ".join(f'[{ref}]({relative(EVIDENCE[ref]["path"])})' for ref in entry["evidence"])
            checkbox = "x" if entry["state"] == "Verified" else " "
            suffix = (f' ({entry["state"]})' if entry["state"] != "Verified" else "") + (f" — {links}" if links else "")
            lines.append(f'- [{checkbox}] {entry["text"]}{suffix}')
        if task["additional_remaining"]:
            lines += ["", "Scope / remaining evidence: " + task["additional_remaining"]]
        lines.append("")
    lines += ["## Reproducing the audit", "", "Run from the repository root:", "", "```powershell",
              "node --test frontend/tests/api.test.js frontend/tests/records.test.js ml/finetune/prompt.test.cjs",
              "powershell -NoProfile -File services/gateway/scripts/verify-accounts.ps1",
              "powershell -NoProfile -File services/gateway/scripts/verify-migrations.ps1",
              "node evidence/planner/audit_runtime.cjs", "node evidence/planner/verify_access.cjs",
              "node evidence/planner/audit_content.cjs", "python evidence/planner/audit_artifacts.py",
              "k6 run --summary-export evidence/planner/checks/health-load-summary.json k6/load.js",
              "python evidence/planner/build_planner.py", "```", "",
              "The isolated database scripts require a running local PostgreSQL service and the existing gateway environment. verify_access.cjs uses POSTGRES_PASSWORD/MIGRATION_DB_PASSWORD (or the documented local-development owner default) only in memory, and deletes only its generated c4_planner_verify database. It does not change the workspace database.", "",
              "Browser checks use frontend/scripts/verify-auth.ps1 and Playwright. This machine reused an existing playwright-core installation through CIFTRON_PLAYWRIGHT_PATH; it is not installed by this audit. The passing run set CIFTRON_VERIFY_REAL_AI=0. The separate failed live-AI run used 1 and remains in checks/browser-tests.txt.", "",
              "audit_artifacts.py returns a nonzero exit code when the attempted CSV rebuild is blocked (currently missing pandas), while still writing recomputed model metrics and adapter verification. Install/use the intended ML environment before attempting reproduction. It does not modify the provided data or train a model.", "",
              "The workbook builder uses only the Python standard library, validates XML/relationships/row round-trips, checks all referenced evidence paths and preserves original sheet XML byte-for-byte. Source hashes identify this working-tree snapshot; tests are not claims about a remote merged commit.", ""]
    (OUT / "README.md").write_text("\n".join(lines), encoding="utf-8")


def relative(path):
    return "../../" + path


def main():
    assert len(SOURCE_TASKS) == 36
    assert all(OWNER in task["Assigned To"].split(";") for task in SOURCE_TASKS)
    source_hash = sha(SOURCE)
    paths = git("ls-files", "--cached", "--others", "--exclude-standard").splitlines()
    hashes = {}
    for name in paths:
        full = ROOT / name
        if full.is_file() and not name.startswith("evidence/planner/") and full.suffix.lower() in {".js", ".jsx", ".cjs", ".mjs", ".py", ".sql", ".yml", ".md", ".ipynb"}:
            hashes[name] = sha(full)
    snapshot = {"audit_date": DATE, "branch": git("branch", "--show-current"), "head": git("rev-parse", "HEAD"),
                "local_branches": git("branch", "--format=%(refname:short)").splitlines(),
                "working_tree": git("status", "--short"), "source_sha256": hashes,
                "attribution_note": "Source presence and local history do not establish individual ownership, collaborator permissions, remote PR review or a merged release."}
    (OUT / "checks/repository-snapshot.json").write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")
    register_evidence()
    original_updates()
    added_work()
    assert len(TASKS) == 51 and len({t["audit_key"] for t in TASKS}) == 51
    assert {t["task_id"] for t in TASKS if t["task_id"]} == {t["Task ID"] for t in SOURCE_TASKS}
    for task in TASKS:
        assert task["checklist"], task["name"]
        for entry in task["checklist"]:
            assert all(key in EVIDENCE for key in entry["evidence"])
            if entry["state"] == "Verified":
                assert entry["evidence"], entry
        if task["original_status"] == "Not in export" and task["status"] == "Completed":
            assert all(entry["state"] == "Verified" for entry in task["checklist"])
    load = json.loads((OUT / "checks/health-load-summary.json").read_text(encoding="utf-8-sig"))
    duration = load["metrics"]["http_req_duration"]["p(95)"]
    verification = [
        ("Frontend/template unit tests", "Passed", "12/12 tests", ["E-UNIT"]),
        ("Account/platform integration", "Passed", "42/42 tests; isolated PostgreSQL; external Google/Ollama responses stubbed", ["E-INTEGRATION"]),
        ("RBAC and audit persistence", "Passed", "9/9 role/route combinations, 6 allowed + 3 denied audit records", ["E-ACCESS"]),
        ("Three-tenant isolation", "Passed", "Own records visible; cross-tenant reads/inserts blocked; sample tenant A/B/C read checks pass", ["E-ACCESS", "E-RUNTIME"]),
        ("Fresh and repeated migrations", "Passed", "Five migrations and restricted-role forced-RLS checks", ["E-MIGRATION-TEST"]),
        ("Frontend production build", "Passed", "1603 modules transformed; exit 0", ["E-BUILD"]),
        ("Browser/database journey", "Passed", "Registration, profile, invite, roles, drafts, knowledge, cross-tab refresh, logout, themes; 320/390/768px", ["E-BROWSER"]),
        ("Local runtime", "Passed", "Gateway 200, Nginx 200; protected unauthenticated routes 401; restricted c4_app and seven forced-RLS tables", ["E-RUNTIME"]),
        ("Health load test", "Passed", f"5 VUs / 30 seconds, 143 requests, 286 checks, zero failed requests; p95 {duration:.2f} ms; health only", ["E-LOAD"]),
        ("Supplied dataset/prompt contract", "Passed", "715 train + 171 validation; all reference/application checks; 5 disjoint validation products", ["E-FT-DATA"]),
        ("Adapter structure and saved results", "Passed", "448 tensor offsets valid; all-check pass 6/25 base vs 19/25 fine-tuned; no training rerun", ["E-FT-AUDIT"]),
        ("Content guardrails", "Passed", "6/6 selected cases; incorrect day rejected; limited regex-based scope", ["E-CONTENT"]),
        ("Live AI generation", "Failed", "Actual Ollama attempt returned HTTP 503; separate from passing provider-stubbed integration/UI tests", ["E-AI-FAIL"]),
        ("Runtime grounding and 150-word limit", "Failed", "Unsupported offer and 165-word body both accepted by save validator", ["E-CONTENT"]),
        ("CSV dataset regeneration", "Blocked", "Builder exists, but this Python environment lacks pandas; no regeneration claimed", ["E-FT-REBUILD"]),
    ]
    manifest = {"audit_date": DATE, "timezone": "Asia/Colombo", "owner": OWNER,
                "source_file": "source-export.xlsx", "source_sha256": source_hash, "live_planner_updated": False,
                "original_tasks": 36, "proposed_new_tasks": 15, "tasks": TASKS, "evidence": EVIDENCE,
                "findings": [dict(zip(["key", "severity", "title", "observation", "evidence", "related_tasks", "action"], row)) for row in FINDINGS],
                "verification": [dict(zip(["name", "status", "result", "evidence"], row)) for row in verification]}
    (OUT / "planner-audit.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (OUT / "source-tasks.json").write_text(json.dumps(SOURCE_TASKS, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    headers = ["Audit key", "Task ID (existing only)", "Task name", "Bucket", "Assigned to", "Original status", "Updated status", "Verified checklist items", "Checklist", "Evidence references", "Remaining / unverified", "Audit assessment", "Notes / evidence summary", "Original due date", "Audit date", "Original completed date", "Original completed by", "Original notes", "Parent task ID (new deliverables)"]
    task_rows = []
    check_headers = ["Task key", "Task ID", "Task name", "Item", "Checklist item", "Verification state", "Evidence", "Detail / scope"]
    check_rows = []
    for task in TASKS:
        source = task["source"]
        verified_count = sum(entry["state"] == "Verified" for entry in task["checklist"])
        checklist = "\n".join(("[x] " if entry["state"] == "Verified" else "[?] " if entry["state"] == "Export reported only" else "[ ] ") + entry["text"] for entry in task["checklist"])
        refs = "\n".join(key + ": " + EVIDENCE[key]["path"] for key in refs_for(task))
        task_rows.append([task["audit_key"], task["task_id"], task["name"], task["bucket"], task["assigned_to"], task["original_status"], task["status"],
                          f'{verified_count}/{len(task["checklist"])}', checklist, refs, "\n".join(remaining_for(task)), task["assessment"], task["summary"],
                          source.get("Due date", ""), DATE, source.get("Completed Date", ""), source.get("Completed By", ""), source.get("Notes", ""), task["parent"]])
        for number, entry in enumerate(task["checklist"], 1):
            check_rows.append([task["audit_key"], task["task_id"], task["name"], number, entry["text"], entry["state"],
                               "\n".join(key + ": " + EVIDENCE[key]["path"] for key in entry["evidence"]), entry["detail"]])
    with (OUT / "tasks-for-planner.csv").open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.writer(file); writer.writerow(headers); writer.writerows(task_rows)
    with (OUT / "checklists-for-planner.csv").open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.writer(file); writer.writerow(check_headers); writer.writerows(check_rows)
    evidence_rows = [[key, value["path"], value["line"] or "", value["kind"], value["description"], value["bytes"], value["sha256"]] for key, value in EVIDENCE.items()]
    evidence_links = {f"B{index + 2}": relative(value["path"]) for index, value in enumerate(EVIDENCE.values())}
    overview_rows = [
        ["Audit date", DATE + " / Asia/Colombo"], ["Assignee", OWNER], ["Existing tasks reviewed", "36"], ["New proposed deliverables/tasks", "15 (14 delivered, 1 in progress)"],
        ["Original workbook", "Four original sheets remain unchanged. Source copy: source-export.xlsx"], ["Live Planner", "Not changed; this file is an updated export/review package."],
        ["How to use", "Review Updated Tasks; use Checklist Evidence for one item per row; copy desired changes to Planner by existing Task ID. New tasks have blank Task IDs."],
        ["Checked [x]", "Verified against named source/artifact/test evidence for the stated scope; not a blanket external-service acceptance claim."],
        ["Question [?]", "Reported complete in export but supporting local evidence unavailable; preserve the original claim without inventing verification."],
        ["Unchecked [ ]", "Pending, failed or unverified. Remaining column describes outstanding requirements."],
        ["Checklist counts", "Verified item counts from this audit. Original per-item checkbox state is absent from the export; source aggregate counts remain in original sheets."],
        ["Dates and attribution", "Original due/completion dates and Completed By are copied exactly. New audit completions have no invented historical date or person."],
        ["Shared team tasks", "Original Completed statuses are preserved if external evidence is unavailable. Source presence does not establish individual authorship."],
        ["New tasks overlap parent scope", "New deliverables expand named parent tasks. They make existing work visible; do not double-count effort."],
        ["Model result", "19/25 (76%) fine-tuned sequences pass all seven checks vs 6/25 (24%) base. Grounding drops 92% to 76%. This is task compliance on 25 validation prompts."],
        ["Live AI status", "Live generation returned HTTP 503. Base Mistral remains configured; adapter activation is pending."],
        ["Runtime content gaps", "Save validator accepted an unsupported offer and a 165-word body. Consent/suppression/sending and C1-C3 integrations are not implemented."],
        ["Environment limitation", "CSV rebuild requires pandas, absent in current Python. Provided dataset verification passed. Playwright was reused from another local project."],
        ["Detailed report", "README.md and planner-audit.json contain task details, findings, evidence and reproducible commands."],
        ["Source workbook SHA-256", source_hash],
    ]
    definitions = [
        {"name": "Audit Guide", "headers": ["Item", "Details"], "rows": overview_rows, "widths": [32, 125]},
        {"name": "Updated Tasks", "headers": headers, "rows": task_rows, "widths": [17, 34, 58, 15, 42, 20, 20, 16, 80, 65, 80, 30, 90, 18, 18, 22, 36, 65, 34], "status_column": 7},
        {"name": "Checklist Evidence", "headers": check_headers, "rows": check_rows, "widths": [17, 34, 54, 9, 95, 25, 85, 70], "status_column": 6},
        {"name": "Work Beyond Planner", "headers": ["Key", "Proposed task", "Status", "Parent task ID", "Summary", "Checklist"], "rows": [[t["audit_key"], t["name"], t["status"], t["parent"], t["summary"], "\n".join(e["text"] for e in t["checklist"])] for t in TASKS[36:]], "widths": [18, 65, 20, 35, 100, 100], "status_column": 3},
        {"name": "Evidence Index", "headers": ["Evidence ID", "File (click to open)", "Source line", "Evidence type", "What it establishes", "Bytes", "SHA-256"], "rows": evidence_rows, "widths": [26, 85, 12, 30, 110, 18, 70], "links": evidence_links},
        {"name": "Verification", "headers": ["Check", "Result", "Observed result", "Evidence IDs"], "rows": [[a, b, c, "; ".join(d)] for a, b, c, d in verification], "widths": [40, 20, 120, 45], "status_column": 2},
        {"name": "Findings and Gaps", "headers": ["ID", "Severity", "Finding", "Observation", "Evidence IDs", "Related tasks", "Next action"], "rows": FINDINGS, "widths": [12, 15, 45, 110, 50, 45, 110]},
    ]
    destination = OUT / "J26-SE-340_updated_2026-10-21.xlsx"
    add_sheets(SOURCE, destination, definitions)
    assert sha(SOURCE) == source_hash
    write_report(manifest, verification)
    result = {"workbook": destination.name, "original_tasks": 36, "new_tasks": 15, "checklist_items": len(check_rows), "evidence_files": len(EVIDENCE),
              "original_statuses": dict(Counter(t["original_status"] for t in TASKS[:36])),
              "updated_existing_statuses": dict(Counter(t["status"] for t in TASKS[:36])),
              "new_statuses": dict(Counter(t["status"] for t in TASKS[36:])),
              "source_sha256": source_hash, "workbook_sha256": sha(destination), "original_sheet_xml_preserved": True,
              "all_xml_parsed": True, "all_new_cell_values_round_tripped": True, "evidence_paths_exist": True,
              "original_task_ids_preserved": True, "live_planner_updated": False}
    (OUT / "checks/workbook-validation.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
