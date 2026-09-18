---
name: azure-avatar-integrate
description: 'Plan, build, validate, or troubleshoot Azure AI Speech Avatar integrations using Batch Synthesis, the Real-time Speech SDK, or Voice Live. Use for downloadable avatar videos, adding a live avatar to an STT/LLM pipeline or agent, and Azure Avatar authentication, WebRTC, playback, or session failures.'
---

# Azure Avatar Integrate

Integrate Azure Avatar through Batch Synthesis, the Real-time Speech SDK, or Voice Live. Custom avatar training is out of scope.

## Global Rules

- Never request or read secrets; keep service keys and backend identity tokens on the backend.
- Obtain separate approval for scope/architecture changes, documentation edits, Azure/IAM changes, deployment, or destructive actions.
- Before the first end-to-end Azure call for an integration, state once that usage may incur charges; do not request approval or repeat the notice for later calls, tests, reconnects, app restarts, or developer use with the confirmed configuration.
- Resume from the same record and valid confirmations; records do not authorize edits.
- Follow the developer's request; ask only for required confirmations/approvals or when blocked.
- On failure, preserve the first service error, retry transient stages at most once, and release owned runtime resources.

## Inspect

For standalone troubleshooting, read and follow [troubleshooting](./references/troubleshooting.md) without restarting onboarding. Otherwise, start each recommendation by announcing and running these focused checks without waiting for confirmation:

| Check | Identify |
|---|---|
| Read dependency manifests | Declared frameworks and SDKs |
| Read primary client/backend entry points | Existing integration, input type, conversation owner, reusable components |
| Run one targeted search for avatar, speech, STT, LLM, TTS, and agent signals | Integration signals and non-secret Azure configuration |

## Choose

Honor an explicitly selected Batch Synthesis, Real-time Speech SDK, or Voice Live path. Otherwise choose the smallest path that preserves working components, using the first matching signal:

| Signal | Path |
|---|---|
| Batch Synthesis, downloadable video, or script-to-video | [Batch Synthesis](./references/batch-synthesis.md) |
| Final text or SSML supplied only for rendering, preserving existing STT, LLM, tools, or turn flow as required | [Real-time Speech SDK](./references/realtime-sdk.md) |
| Voice Live, user audio, two-way conversation, or unspecified live/realtime avatar | [Voice Live](./references/voice-live.md) |

## Recommend

Defer configuration, billing, validation details, and links until path confirmation unless requested or needed for the decision.

Read the selected guide for architecture and supported API/SDK credential flows. Present one path, not alternatives, using exactly these sections:

1. **Recommended path:** one sentence naming the path and why it fits.
2. **What I found:** up to three inspected facts, separate from proposed changes.
3. **Architecture:** a compact text tree with one responsibility per line.
4. **What changes:** up to three bullets describing the minimum integration work.
5. **Confirmation:** ask one direct question confirming the path, then wait.

## Confirm

For recommendation-only requests, stop after path confirmation without creating records, configuring access, or editing application files.

For implementation requests with a confirmed path:

1. Create or load the [issue record](./references/feedback.md) and keep it updated.
2. Complete **Configure** next. Application edits require both path and access confirmation.

## Configure

For implementation requests with a confirmed path, explain that Azure access is needed and read the selected guide's **Prepare** section.

Prefill known values; collect missing settings once using separate structured questions with examples, or a copyable template if unavailable.

| Setting | Applies to | Example |
|---|---|---|
| Resource endpoint/name | Batch / Real-time Speech SDK | `https://my-resource.cognitiveservices.azure.com` |
| Endpoint | Voice Live | `https://my-resource.services.ai.azure.com` |
| Region | All paths | `eastus2` |
| Model or Agent target | Voice Live | `gpt-realtime-mini`, or `project_name` and `agent_name` |
| Authentication | Batch / Voice Live model | Entra ID or API key |
| Authentication | Voice Live Agent | Entra ID; Microsoft Foundry resource required |
| Authentication | Real-time Speech SDK guide | Backend API key; browser STS token |

### Credential Setup

During configuration, check fields and static compatibility using local settings and public documentation. Defer project tests to implementation and Azure calls until end-to-end validation.

- For API keys, name the backend file and `AZURE_VOICE_LIVE_API_KEY` (Voice Live) or `AZURE_SPEECH_API_KEY` (other paths). Ask for local saving and wait for explicit confirmation before application edits.
- For Entra ID in Batch or Voice Live, state the local identity source; ask for it only if blocked. Follow the selected guide's endpoint and role requirements.

Local confirmation establishes setup, not credential validity; only an Azure call can validate it.

## Implement

Use the confirmed recommendation without repeating plan approval.

1. **Start:** After access confirmation, announce the affected components and first local check before editing.
2. **Edit:** Follow the selected guide's **Implement** section and reuse existing components. Change only necessary code, config templates, tests, and the issue record.
3. **Check:** Run focused local checks after a coherent batch of related edits, not after every edit. Resolve failures before starting the next batch.

## Validate

### 1. Local Checks

Complete the selected guide's remaining local **Verify** checks, reusing still-applicable passing results. Local success is not end-to-end acceptance.

### 2. Azure Verification

Keep automated validation focused, retry transient stages at most once, and stop immediately when requested. Obtain approval only when validation requires a scope/configuration change, Azure/IAM change, deployment, or destructive action.

For Voice Live and Real-time Speech SDK, use an external browser, not VS Code's integrated browser. If automation is unavailable, explain and guide manual validation.

On pause or stop, block new test calls, stop polling, end live sessions, and release owned runtime resources. Retain recovery records; stopping a poller does not cancel a remote Batch job.

### 3. Report Results

| Status | Required evidence |
|---|---|
| Implementation complete; Azure validation pending | Local checks pass; Azure validation remains pending. |
| Integration complete | All required checks in **Prepare**, **Implement**, and **Verify** have passing evidence; reuse still-valid results. Voice Live and Real-time Speech SDK also require real-media evidence and developer confirmation. |

Concisely report the outcome, usage, key file/configuration/dependency changes, validation and remaining work, credential and billable-call handling, and runtime status; omit secret values and include counts only when requested.

## Complete and Invite Feedback

After integration acceptance, or an explicit feedback request, read and follow [feedback](./references/feedback.md) for cleanup, invitation, review, sharing, and closeout.

- Feedback is optional; external sharing requires approval of the reviewed content.
- Retain the issue record until feedback closeout; temporary pauses are not final closeout.
