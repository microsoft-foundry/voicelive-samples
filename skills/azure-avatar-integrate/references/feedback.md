# Feedback

Track integration issues and offer optional feedback after acceptance.

## 1. Record

On path confirmation for an implementation request, not a recommendation-only request:

1. Create or load `.azure-avatar-integrate/<integration-id>.json` in the target project.
2. Tell the developer its location. Exclude it from Git locally or use an approved private local location; never upload it.

| Record | Contents |
|---|---|
| Integration | Local ID, short non-sensitive goal, path, status, acceptance results with evidence sources, and `cleanup_complete` (initially `false`, excludes the feedback record). |
| Invitation | `feedback_invited=false`, `feedback_response=not_asked` for a new integration. |
| Issues | Stable issue ID, symptom, action/verification history, status (`pending`, `in_progress`, `resolved`). Mark untested results `unverified`. |

| Event | Action |
|---|---|
| Issue update | Update the same issue ID; preserve failed fixes and resolved history until closeout. |
| New work | Reset acceptance and cleanup results invalidated by the changes. |
| Resume, retry, or path change | Reload the same record; preserve integration identity and consent state. |
| Missing, invalid, or deleted record | Report unavailable history and block automatic invitations; never recreate an uninvited record for the same integration. |
| Storage failure | Report the failure; chat-only tracking is not a substitute. |

### Privacy

- Keep records and drafts minimal and redacted. Exclude secrets, private identifiers/addresses, personal/customer data, proprietary details, and raw media, logs, or SDP.
- Reuse existing evidence; read extra artifacts only when essential and separately authorized.
- Review content even after script validation; omit uncertain content.

## 2. Invite and Review

### Invitation Gate

Invite only after reporting completion and meeting all conditions:

- All required **Verify** checks pass under the [completion rules](../SKILL.md#validate), with developer confirmation for live paths.
- Runtime resources and intermediates are cleaned up; the issue record remains available.
- The saved record has `feedback_invited=false`.

Otherwise, update records only. Explicit feedback requests may proceed earlier without changing acceptance or bypassing consent; mark them invited without resetting history.

Ask once using the question tool or a numbered list:

> Share feedback about this Azure Avatar integration? **Review feedback draft** / **Not now**.

Save `feedback_invited=true` and `feedback_response=pending` immediately, before waiting; set the response to `accepted` or `declined` after the reply. Never repeat an invitation after refusal, silence, resume, or another result report.

### Draft Review

After consent to draft:

1. Reload the record and summarize all issues, including resolved ones, into one form.
2. Separate facts from hypotheses; use `unknown` for missing details.
3. Show the draft for developer corrections. Preserve issue IDs and history when grouping; agree on shortening rather than dropping issues.

**Title:** `Azure Avatar integration feedback: <path> - <main issue>`; at most 200 characters.
**Body:** at most 4,000 characters; omit empty sections:

```text
Summary: <outcome>
Environment: <path and relevant stack/settings>
Issues (repeat, including resolved issues):
- ID / Status: <local issue ID and status>
- Observed / Impact: <symptom and effect>
- Actions / Verification: <attempts, results, and evidence sources>
Remaining: <unresolved questions>
```

| Case | Use |
|---|---|
| No issues | Type `skill`; use `completed validation` only after acceptance. Do not invent issues. |
| Unsupported capability | Path `unsupported request`; do not present it as supported. |

## 3. Share and Close

### Sharing Approval

1. Explain that opening a prefilled form sends its content to Microsoft Forms through the URL and may leave browser history. Offer a blank form as an alternative.
2. Obtain explicit approval of the reviewed content before generating or opening the prefilled form. Changed content requires renewed approval.

Draft consent, validation confirmation, and silence are not sharing approval.

### Open the Form

Run the installed [helper](../scripts/feedback_form_url.py) with the selected Python interpreter; quote both absolute paths. Use `--consent-confirmed` only after approval.

Use these exact, case-sensitive `integration_path` values in the JSON input:

| Integration | `integration_path` |
|---|---|
| Voice Live | `Voice Live` |
| Batch Synthesis | `batch` |
| Real-time Speech SDK | `real-time SDK` |
| Unsupported request | `unsupported request` |

Set `feedback_type` to one of: `product`, `docs`, `sample`, `sdk`, `skill`, `unsupported`.

| Choice | Additional flags | Standard input |
|---|---|---|
| Open prefilled form | `--open` | JSON with only `title`, `body`, `integration_path`, `feedback_type`. |
| Open blank form | `--blank --open` | None. |
| Explicit link-only request | Omit `--open`; add `--blank` for a blank form. | JSON for prefill; none for blank. |

- Pass feedback through standard input, never command arguments.
- In open mode, suppress prefilled URLs. Link-only output enters chat/tool logs and requires an explicit request.

| Failure | Recovery |
|---|---|
| URL over 8,000 characters | Shorten, obtain renewed review/approval, and retry once. |
| Validation rejection | Report category, not content; redact or offer blank. Never bypass validation. |
| Open failure | Report failure without the URL; show a link only on explicit request. |
| Execution unavailable | Offer only a blank form after consent. |

### Submission

- Explain that submission approval permits internal review and possible public use, including a reviewed GitHub issue.
- The developer alone selects submission approval and submits the form.
- Opening is not proof of page load or submission; report submission only after developer confirmation.

### Cleanup

| Stage | Cleanup |
|---|---|
| Before invitation | Release owned runtime resources and remove intermediate files (temporary scripts, test outputs, logs, screenshots, recordings); keep the issue record for feedback. |
| Pause or incomplete integration | Clean runtime resources and disposable intermediates; retain the recovery record. |
| Final closeout | After acceptance and feedback handoff, refusal, cancellation, or session end without a reply, delete records, drafts, and remaining intermediates. Explicit abandonment also permits cleanup, without an invitation. |

- Delete only confirmed task-created files; preserve the final application, required files, deliverables, and user-owned/unrelated files.
- Remove unused task-created directories and exclusions; report cleanup failures.
- Leave no record archive or invitation marker. Deleted history is unavailable; file cleanup does not erase chat/tool logs or browser history.

Route product support to Microsoft support or documentation feedback.
