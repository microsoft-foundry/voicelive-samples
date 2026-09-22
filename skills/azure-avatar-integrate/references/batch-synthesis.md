# Batch Synthesis Integration

Generate a finished avatar video from text or SSML, then save the video and synthesis summary in a selected local directory or application-owned storage.

## Delivery

If the user only needs a finished video, use a trusted local script. Add reusable controls to the existing application only when the user needs to submit and manage jobs.

## Prepare

Follow the [main skill's access gate](../SKILL.md#configure) before application edits. Use public documentation for static compatibility checks and follow the main validation rules for service calls.

### 1. Confirm the resource

Reuse the Microsoft Foundry or Speech resource endpoint, region, and backend credential source. If absent, guide resource creation before requesting details. Check the resource and avatar type against [Avatar region support](https://learn.microsoft.com/azure/ai-services/speech-service/regions?tabs=ttsavatar).

Keep the selected authentication; otherwise prefer Entra ID as in the [official Python sample](https://github.com/Azure-Samples/cognitive-services-speech-sdk/blob/master/samples/batch-avatar/python/synthesis.py).

| Method | Backend authentication | Prerequisite |
|---|---|---|
| Entra ID | Reuse `DefaultAzureCredential`; request scope `https://cognitiveservices.azure.com/.default` and send `Authorization: Bearer <entra-token>`. | Custom-subdomain endpoint and `Cognitive Services User` or `Cognitive Services Speech User` role. |
| API key | Send `Ocp-Apim-Subscription-Key` from backend `AZURE_SPEECH_API_KEY`. | Explicit local-save confirmation under the main skill's **Configure** section. |

Use the confirmed endpoint for all service requests. Entra requires `https://<custom-domain>.cognitiveservices.azure.com`; API-key mode also permits `https://<region>.api.cognitive.microsoft.com`. Never switch authentication automatically on failure.

### 2. Confirm the job

Confirm text or SSML, language/voice, avatar character/style, video format, durable output location, polling timeout, and retention. Reuse existing HTTP, job-state, storage, and cleanup components.

> **Backend only:** submit, poll, download, and delete from the trusted backend. Keep long-lived credentials out of client code and logs.

## Implement

The HTTP examples use the Entra header. For API-key mode, replace it with `Ocp-Apim-Subscription-Key: <speech-key>` on submit, poll, list, and delete requests. Keep bearer tokens and keys on the backend; obtain current Entra tokens through the credential provider rather than hardcoding them.

For Web endpoints, reuse application authentication and CSRF protection, bind each job to its owner, authorize every operation, and enforce per-caller rate/concurrency limits. A `SynthesisId` alone is not authorization. Trusted local scripts need no application authentication layer.

### 1. Validate content and persist job identity

Set `inputKind` (`PlainText` uses `synthesisConfig`; `SSML` includes its voice), avatar character/style, and output format. Validate:

| Field | Constraint |
|---|---|
| `SynthesisId` | Unique, 3–64 characters; letters, digits, hyphens, underscores; start/end with a letter or digit. |
| Request body | At most 500 KB. |
| Concurrent jobs | At most 200 per Speech resource. |
| Output duration | At most 20 minutes. |

Persist the `SynthesisId`, logical request identity, owner, and pending state before submission. Reuse the ID only for the same logical request.

> **Before billing:** require valid credentials, supported region, valid content/output, persisted identity, and working polling/storage components.

### 2. Submit from the backend without duplicating jobs

Submit the persisted job ID from the backend with the [documented request schema](https://learn.microsoft.com/azure/ai-services/speech-service/text-to-speech-avatar/batch-synthesis-avatar?pivots=ai-foundry):

```http
PUT https://<resource>.cognitiveservices.azure.com/avatar/batchsyntheses/<SynthesisId>?api-version=2024-08-01
Authorization: Bearer <entra-token>
Content-Type: application/json
```

**On acceptance:** update the persisted job state.

> **Unknown submission result:** query the same `SynthesisId` before another submission. Do not generate a new ID or assume the service created nothing.

### 3. Poll to a terminal state or application timeout

Request the job periodically with bounded backoff:

```http
GET https://<resource>.cognitiveservices.azure.com/avatar/batchsyntheses/<SynthesisId>?api-version=2024-08-01
Authorization: Bearer <entra-token>
```

Persist state changes:

| Result | Action |
|---|---|
| `NotStarted` / `Running` | Continue bounded polling. |
| `Succeeded` | Stop polling and store the artifacts. |
| `Failed` | Stop polling and persist redacted failure details. |
| Transient HTTP error | Honor `Retry-After` and the retry budget; do not mark the job failed from a transport error alone. |
| Invalid credentials/configuration | Pause for developer action. |
| Application timeout | Stop polling and retain the ID for recovery. |

> **Timeout is not cancellation:** resume the same job after timeout or restart. Never claim that stopping the poller cancelled the remote job.

### 4. Validate and durably store both artifacts

Download both `outputs.result` (video) and `outputs.summary` on the backend. Enforce response-size limits and approved HTTPS hosts/redirects, validate both artifacts, and persist their durable locations before completion.

After download/storage failure or restart, query the same job and resume storage without resynthesis. Keep remote success distinct from durable application completion.

> **Download boundary:** result URLs are temporary. Never log/expose SAS queries or forward Speech authorization headers to artifact hosts. A service success or temporary URL is not durable application completion.

### 5. Apply retention and clean up

Delete only after both artifacts are durable and job history is no longer needed:

```http
DELETE https://<resource>.cognitiveservices.azure.com/avatar/batchsyntheses/<SynthesisId>?api-version=2024-08-01
Authorization: Bearer <entra-token>
```

Expect `204 No Content`. Remote history lasts up to 31 days or `timeToLiveInHours`, whichever is sooner. Apply separate application retention, release local resources, and preserve recoverable job state.

## Verify

Run local checks first; follow the [main validation rules](../SKILL.md#validate) for service calls and reporting.

- [ ] **Access and validation:** authentication works, secrets stay on the backend, request limits hold, and Web endpoints enforce owner access.
- [ ] **Job lifecycle:** the persisted ID survives uncertain submission, polling, timeout, and restart without duplicate synthesis.
- [ ] **Results:** one real job stores validated video and summary without exposing SAS URLs or forwarding Speech headers.
- [ ] **Cleanup:** deletion follows durable storage; repeated cleanup leaves no local resources active.

Report verified and remaining checks using the main skill's **Report Results** section.
