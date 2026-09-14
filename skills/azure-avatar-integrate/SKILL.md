---
name: azure-avatar-integrate
description: 'Plan, build, validate, or troubleshoot Azure AI Speech Avatar integrations using Batch Synthesis, the Real-time Speech SDK, or Voice Live. Use for downloadable avatar videos, adding a live avatar to an STT/LLM pipeline or agent, and Azure Avatar authentication, WebRTC, playback, or session failures. Not for generic video editing, other avatar providers, or custom avatar training.'
---

# Azure Avatar Integrate

Integrate Azure Avatar through Batch Synthesis, the Real-time Speech SDK, or Voice Live. Custom avatar training is out of scope.

## Workflow

Inspect the existing app before every recommendation. First tell the developer what you will inspect, then start immediately without confirmation:

> I'll quickly inspect the app's stack and conversation flow, then recommend one integration path. This may take a moment.

Read dependency manifests, primary client/backend entry points, and one targeted search for avatar, speech, STT, LLM, TTS, and agent signals. Identify the existing integration, input type, conversation owner, reusable components, and non-secret Azure configuration. Avoid broad exploration and never read secret values.

For implementation, clear two gates before editing:

1. Recommend one path with inspection evidence, architecture, and minimal changes; wait for confirmation.
2. After confirmation, collect access settings once and complete any required local credential confirmation.

Other interaction follows the developer's request. Ask again only when blocked.

## Route

Explicit Batch Synthesis, Real-time Speech SDK, and Voice Live requests have equal precedence. Otherwise use the first matching signal:

| Signal | Path |
|---|---|
| Batch Synthesis, downloadable video, or script-to-video | [Batch Synthesis](./references/batch-synthesis.md) |
| Voice Live, user audio, two-way conversation, or unspecified live/realtime avatar | [Voice Live](./references/voice-live.md) |
| Final text or SSML supplied only for rendering | [Real-time Speech SDK](./references/realtime-sdk.md) |

For an explicit Real-time request, prefer Voice Live unless the app must preserve its STT, LLM, tools, or turn flow and send only final text or SSML for rendering. For a vague request, choose the smallest path that preserves working components; default a live avatar to Voice Live. Present one path, not alternatives.

## Recommendation

Keep the first exchange focused on the path decision. Use exactly these sections:

1. **Recommended path:** one sentence naming the path and why it fits.
2. **What I found:** up to three bullets of inspected facts relevant to the decision.
3. **Architecture:** a compact text tree with one responsibility per line.
4. **What changes:** up to three bullets describing the minimum integration work.
5. **Confirmation:** one direct question confirming the path.

Do not include endpoint, region, authentication, model selection, billing, detailed validation cases, or documentation links in this exchange. Handle them after path confirmation. Distinguish inspected facts from proposed changes.

Use these flows and adapt them to the app:

| Path | Required flow |
|---|---|
| Batch Synthesis | App → backend submit/poll → Azure render → durable video storage/delivery |
| Real-time Speech SDK | Existing final text → browser renderer; backend → short-lived Speech/ICE credentials; Azure → WebRTC audio/video |
| Voice Live | Browser microphone/controls → backend relay → Azure Voice Live; Azure → WebRTC audio/video; credentials stay on backend |

Do not claim a temporary client token unless the selected Azure API issues one. Ask the developer to confirm the path, then stop.

## Access

After path confirmation, say that Azure access is needed and read the selected guide's **Prepare** section. Reuse known settings, then collect the rest in one interaction.

| Path | Settings |
|---|---|
| Batch or Real-time Speech SDK | Resource endpoint/name, region, auth method |
| Voice Live | Endpoint, region, model or Agent target, auth method |

Use the environment's structured question tool when available. Ask separate questions and include examples:

- **Endpoint:** `https://my-resource.services.ai.azure.com`
- **Region:** `eastus2`
- **Model or Agent target:** `gpt-realtime-mini` or actual `project_id` and `agent_id`
- **Authentication:** Entra ID or API key

Prefill known values. Do not ask for a credential value. Structured question tools differ by agent; when unavailable, show the same fields as a short copyable template.

After the response, validate only field presence and format; do not run project tests or live verification yet. Then give the credential instruction required by the selected method:

- **API key:** tell the developer exactly which backend file and variable to use, for example `AZURE_VOICE_LIVE_API_KEY=<key>` in `backend/.env`. Use `AZURE_SPEECH_API_KEY` for Batch or Real-time Speech SDK. Never request or inspect the value. Stop and ask the developer to reply after saving the file.
- **Entra ID:** state the selected local identity source or ask for it only if implementation is blocked.

An authentication choice or form submission is not proof that credentials are configured. For API-key authentication, begin only after the developer explicitly confirms that the key was saved locally. This confirms configuration, not validity; only an approved Azure call can validate the key.

## Implement and Validate

Do not create a separate plan, enter plan mode, or request plan approval. The confirmed recommendation is the implementation plan.

Modify only required code, config templates, and tests. Do not change README or other explanatory files, including during validation, unless the developer approves it first.

After access is confirmed and before using edit tools, tell the developer that implementation is starting. Briefly name the components you will change and the first local check you will run. Then follow the selected guide's **Implement** section, reuse the existing architecture and configuration, and validate each edit with the smallest relevant local check. Run the full **Verify** checklist only after implementation. Live verification requires separate approval.

Billable calls, Azure/IAM changes, deployment, destructive actions, and architecture changes require separate approval. For failures, use [troubleshooting](./references/troubleshooting.md), preserve the first service error, retry a transient stage once, and clean up owned sessions, media, tasks, and processes.

### Live Completion Gate

For **Voice Live** and **Real-time Speech SDK**:

1. **Local checks:** Passing tests, builds, and mocks means **implementation complete** only. Request separate approval for one bounded real local Azure connection test; disclose possible charges. Path or credential confirmation is not test approval.
2. **Live validation:** Run the selected guide's full **Verify** checklist. Record each result as passed, failed, or unverified, separating measured evidence from user observations. Ask the developer to confirm video, audio, lip-sync, microphone-to-response when conversational, interruption, same-session next turn, and disconnect cleanup.
3. **Completion:** Report **integration complete** only when every required live check passes and the developer confirms the results. Otherwise report **implementation complete; live validation pending** and list outstanding checks. Troubleshoot failures or unconfirmed results within approved scope; stop live calls if approval is refused or testing is paused/unavailable.

### Completion Feedback

Offer [feedback](./references/feedback.md) once the selected path's completion requirements pass, including the gate above for live paths. Ask once; draft or open the form only with separate explicit consent. Developer-requested feedback on an incomplete attempt is allowed but does not change completion status.
