# Feedback

Offer feedback only after the selected path's **Verify** checklist passes, including the [live completion gate](../SKILL.md#live-completion-gate) for Voice Live and Real-time Speech SDK. Otherwise, start only on an explicit developer request; feedback does not change completion status.

## 1. Consent

Report the outcome accurately, including incomplete or failed work. Then ask once using the environment's question tool, or a numbered list if unavailable:

**Share feedback about this Azure Avatar integration?**

| Option | Meaning |
|---|---|
| **Open redacted feedback form** (recommended) | Consent to generate a redacted prefilled form and open it. The prefilled text is sent to Microsoft Forms through the URL and may remain in browser history; nothing is submitted automatically. |
| **Open blank feedback form** | Open without a generated summary or prefilled answers; the developer fills in the form. |
| **Not now** | End the feedback flow and do not ask again for this attempt. |

On either **Open** choice, proceed without another confirmation. For a blank form, skip section 2 and do not prepare or pass a summary. On refusal, stop and do not ask again for this attempt. Silence and validation confirmation are not feedback consent.

Each new path is an independent attempt; do not carry consent or summaries across paths.

## 2. Prepare and Redact

For consented prefill only, prepare a short title and body from current-session facts. Separate facts from hypotheses; use `unknown` for missing information.

**Title:** prioritize the main unresolved blocker or issue; use its `feedback_type`.

```text
Azure Avatar integration feedback: <path> - <short symptom>
```

**Body:** at most 4,000 characters:

```text
Summary
<one sentence describing the outcome and main issue>

Environment
- <integration path and relevant stack>
- <model, avatar, voice, browser, or OS only when relevant>

Issue
- Observed: <what the developer experienced>
- Impact: <why it matters>
- Cause: <verified cause, suspected cause, or unknown>

Verified
- <one independently verified fact per line>

Actions taken
- <one action and its result per line>

Remaining
- <unresolved question or next diagnostic step>
```

Omit empty sections; use one short fact, hypothesis, action, or next step per bullet.

Use one form per attempt. Group issues by root cause and owner; put secondary issues in the body.

| Special case | Use |
|---|---|
| Smooth attempt, no issue | Title suffix `completed validation`, type `skill`; omit problem sections and do not invent friction. |
| Unsupported capability encountered | Path `unsupported request`; record the requested capability separately, not as covered. |

- **Evidence:** use existing evidence. Read additional artifacts only if essential, after explaining why and obtaining separate permission. Include only a minimal redacted summary, never raw artifacts.
- **Redaction:** remove secrets, identifiers, private URLs/IPs, personal/customer data, and unnecessary proprietary details. Omit uncertain content; review even if builder validation passes.

**Session only:** no feedback summary before consent. Keep notes minimal; do not persist or transmit them outside the session without a separate developer request. The consented handoff sends only the redacted summary.

## 3. Generate, Open, and Hand Off

1. Resolve the absolute installed path of `scripts/feedback_form_url.py` and the selected Python interpreter; quote both paths.
2. Always use `--consent-confirmed`; it records prior consent, not obtains it. Choose the mode below:

| Choice | Additional flags | Standard input |
|---|---|---|
| Open prefilled form | `--open` | JSON with only `title`, `body`, `integration_path`, `feedback_type`. |
| Open blank form | `--blank --open` | None. |
| Explicit link-only request | Omit `--open`; add `--blank` for a blank form. | JSON for prefill; none for blank. |

Never put feedback in command arguments. Open mode reports status only; do not echo the prefilled URL. Link-only mode prints it into chat/tool logs, so use it only on explicit request. Avoiding URL output does not remove browser history or transmission on opening.

| Failure | Recovery |
|---|---|
| URL exceeds 8,000 characters | Shorten and retry once; repeat redaction and validation. |
| Sensitive content or other rejection | Report the category, never the value. Review and remove the content or offer a blank form; never bypass validation. |
| Open failure | Report failure without the URL. Show a link only on explicit request. |
| Execution unavailable | Offer only the unfilled form after consent. |

The developer reviews/edits fields, selects approval, and submits. Never prefill/preselect approval or submit for them.

The form needs no GitHub account. Submission approval permits internal review and possible public use, including a public GitHub issue after review.

Do not claim the page loaded from an open request alone; report submission only if the developer confirms it.

**Close:** discard the summary after handoff/cancellation; retain only the attempt's decision/status. This does not erase chat/tool logs or browser history. Do not open another form unless explicitly requested.

For product support, offer the appropriate Microsoft support or documentation feedback route separately, without automatic submission.
