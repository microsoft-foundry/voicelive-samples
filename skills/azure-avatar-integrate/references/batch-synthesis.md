# Batch Synthesis Integration

Generate a finished avatar video from text or SSML, then save the video and synthesis summary in a selected local directory or application-owned storage.

## Delivery

Before recommending architecture, check whether the user wants to control generation or only receive the finished video; ask only if unclear.

| Delivery | Implementation |
|---|---|
| Finished video only | Generate and deliver the video using a trusted local script; no user-facing tool, Web service, or cloud storage is required. |
| Control generation | Provide reusable controls for inputs, settings, job submission, and results through a script, CLI, or existing application. Add a frontend only when needed for the requested workflow. |

In this guide, the backend may be a trusted local script, and owned storage may be the selected local output directory.

## Prepare

Follow the [main skill's access gate](../SKILL.md#configure) before application edits. Use public documentation for static compatibility checks; service calls require separate validation approval.

### 1. Confirm the resource

Reuse the Microsoft Foundry or Speech resource endpoint, region, and backend credential source. If absent, guide resource creation before requesting details. Check the resource and avatar type against [Avatar region support](https://learn.microsoft.com/azure/ai-services/speech-service/regions?tabs=ttsavatar).

Keep the selected authentication; otherwise prefer Entra ID as in the [official Python sample](https://github.com/Azure-Samples/cognitive-services-speech-sdk/blob/master/samples/batch-avatar/python/synthesis.py).

| Method | Backend authentication | Prerequisite |
|---|---|---|
| Entra ID | Reuse `DefaultAzureCredential`; request scope `https://cognitiveservices.azure.com/.default` and send `Authorization: Bearer <entra-token>`. | Custom-subdomain endpoint and `Cognitive Services User` or `Cognitive Services Speech User` role. |
| API key | Send `Ocp-Apim-Subscription-Key` from backend `AZURE_SPEECH_API_KEY`. | Explicit local-save confirmation under the main skill's **Configure** section. |

Use the confirmed endpoint for all service requests. Entra requires `https://<custom-domain>.cognitiveservices.azure.com`; API-key mode also permits `https://<region>.api.cognitive.microsoft.com`. Never switch authentication automatically on failure.

### 2. Define the output

| Input | Confirm |
|---|---|
| Script | Text or SSML, language, and neural voice. |
| Avatar | Character, style, and stock/custom type. |
| Delivery | Video format and durable destinations for both video and summary. |
| Job policy | Polling timeout/backoff and remote/local retention. |

### 3. Locate the backend components

Reuse request validation, HTTP client, job state, storage, and cleanup code for the chosen delivery mode. For finished-video-only requests, keep these in the script; use an existing worker/scheduler only when the application needs one.

Check the [batch guide](https://learn.microsoft.com/azure/ai-services/speech-service/text-to-speech-avatar/batch-synthesis-avatar?pivots=ai-foundry) and [official samples](https://github.com/Azure-Samples/cognitive-services-speech-sdk/tree/master/samples/batch-avatar) before using the REST examples below.

> **Backend only:** submit, poll, download, and delete from the trusted backend. Keep long-lived credentials out of client code and logs.

## Implement

The HTTP examples use the Entra header. For API-key mode, replace it with `Ocp-Apim-Subscription-Key: <speech-key>` on submit, poll, list, and delete requests. Keep bearer tokens and keys on the backend; obtain current Entra tokens through the credential provider rather than hardcoding them.

### Web application access control

Apply only when exposing Web endpoints, including localhost; trusted local scripts or CLIs need no application authentication layer.

- Reuse application authentication; retain CSRF protection when cookies are used. Authorize every submit, status, download, delete, and list request on the backend.
- Persist each job's owner from authentication context; restrict job operations, lists, and stored videos/summaries to that owner. A `SynthesisId` alone is not authorization.
- Enforce server-side submission rate limits and concurrent-job caps per caller before Azure calls.

### 1. Validate content and persist job identity

1. Set `inputKind`: `PlainText` uses a voice in `synthesisConfig`; `SSML` includes the voice in its content.
2. Set `talkingAvatarCharacter`, `talkingAvatarStyle`, and the approved output format.
3. Validate the request against these limits:

| Field | Constraint |
|---|---|
| `SynthesisId` | Unique, 3–64 characters; letters, digits, hyphens, underscores; start/end with a letter or digit. |
| Request body | At most 500 KB. |
| Concurrent jobs | At most 200 per Speech resource. |
| Output duration | At most 20 minutes. |

4. Persist the `SynthesisId`, logical request identity, and pending state before submission. Reuse that ID only for the same logical request.

> **Before billing:** require valid credentials, supported region, valid content/output, persisted identity, and working polling/storage components.

### 2. Submit from the backend without duplicating jobs

Submit the persisted job ID from the backend:

```http
PUT https://<resource>.cognitiveservices.azure.com/avatar/batchsyntheses/<SynthesisId>?api-version=2024-08-01
Authorization: Bearer <entra-token>
Content-Type: application/json
```

Example SSML request:

```json
{
	"inputKind": "SSML",
	"inputs": [
		{
			"content": "<speak version='1.0' xml:lang='en-US'><voice name='en-US-AvaMultilingualNeural'>The rainbow has seven colors.</voice></speak>"
		}
	],
	"avatarConfig": {
		"talkingAvatarCharacter": "lisa",
		"talkingAvatarStyle": "graceful-sitting",
		"videoFormat": "Mp4",
		"videoCodec": "h264",
		"subtitleType": "soft_embedded",
		"bitrateKbps": 2000,
		"customized": false
	}
}
```

**On acceptance:** update the persisted job state.

> **Unknown submission result:** query the same `SynthesisId` before another submission. Do not generate a new ID or assume the service created nothing.

### 3. Poll to a terminal state or application timeout

Request the job periodically with bounded backoff:

```http
GET https://<resource>.cognitiveservices.azure.com/avatar/batchsyntheses/<SynthesisId>?api-version=2024-08-01
Authorization: Bearer <entra-token>
```

Persist each state change and handle the result:

| Result | Action |
|---|---|
| `NotStarted` / `Running` | Continue bounded polling. |
| `Succeeded` | Stop polling and store the artifacts. |
| `Failed` | Stop polling and persist redacted failure details. |
| Transient HTTP error | Apply the main skill's retry budget, `Retry-After`, and overall timeout; do not mark the job failed solely from a transport error. |
| Invalid credentials or configuration | Pause for developer action. |
| Application timeout | Stop local polling; retain the ID for later recovery. |

> **Timeout is not cancellation:** resume the same job after timeout or restart. Never claim that stopping the poller cancelled the remote job.

### 4. Validate and durably store both artifacts

Read both URLs from a `Succeeded` job:

| Field | Artifact |
|---|---|
| `outputs.result` | Generated avatar video. |
| `outputs.summary` | Synthesis summary and debug details. |

1. Download both on the backend with response-size limits. Allow only HTTPS hosts and redirects approved by the service output contract.
2. Validate the video container and summary content; save both in application-owned storage.
3. Persist their durable locations and metadata before marking completion.

**Recovery states:** keep remote success separate from application completion, for example:

```text
REMOTE_SUCCEEDED -> ARTIFACTS_PENDING -> COMPLETE
```

After download/storage failure or restart, query the same job and resume storage idempotently, within the retry/timeout budget. Do not resynthesize or delete remote history while artifacts remain pending.

> **Download boundary:** result URLs are temporary. Never log/expose SAS queries or forward Speech authorization headers to artifact hosts. A service success or temporary URL is not durable application completion.

### 5. Apply retention and clean up

Delete only after artifacts are durable and job history is no longer needed:

```http
DELETE https://<resource>.cognitiveservices.azure.com/avatar/batchsyntheses/<SynthesisId>?api-version=2024-08-01
Authorization: Bearer <entra-token>
```

**Expected response:** `204 No Content`.

| Resource | Retention / cleanup |
|---|---|
| Remote job history | Up to 31 days or `timeToLiveInHours`, whichever is sooner, unless deleted earlier. |
| Application artifacts | Apply the application's separate retention policy. |
| Local runtime resources | Release HTTP responses, streams, temporary files, and owned tasks on success or partial failure. |

Repeated cleanup must leave no orphaned resources and must preserve persisted recovery state.

## Optional capabilities

**Output customization:** add supported gestures, subtitles, codec/bitrate, background, or resolution only when required by delivery needs.

**Job history:** for recovery beyond a known ID, list jobs:

```http
GET https://<resource>.cognitiveservices.azure.com/avatar/batchsyntheses?skip=0&maxpagesize=100&api-version=2024-08-01
Authorization: Bearer <entra-token>
```

Follow `nextLink` until all required pages are read; maximum page size is 100.

## Verify

Run local checks first; follow the [main validation rules](../SKILL.md#validate) for service calls and reporting.

- [ ] **Configuration:** resource, region, API, content, avatar, video, polling, and storage match the plan; no secrets in logs.
- [ ] **Authentication:** the selected method works for service requests; Entra uses the custom endpoint and required role, while API-key mode keeps the key on the backend without authentication fallback.
- [ ] **Web security (when exposed):** with mocked Azure/storage, reject unauthenticated access, cross-user access, over-limit submissions, and invalid CSRF requests (cookie auth) before service calls or artifact reads. Lists and downloads expose only the caller's jobs.
- [ ] **Validation and identity:** enforce input/size/format/duration limits; persist the ID before submission and query it after an uncertain result.
- [ ] **Polling:** reach a terminal state or record local timeout without claiming cancellation; handle transient errors and `Retry-After` separately.
- [ ] **Durable results:** one real job produces validated video and summary in owned storage; no SAS exposure or forwarded Speech headers.
- [ ] **Recovery:** failure/timeout state is persisted; restart resumes the same job or pending storage without duplicate synthesis.
- [ ] **Retention and cleanup:** delete only after durable storage; repeated cleanup leaves no local resources active.

Report verified and remaining checks using the main skill's **Report Results** section.
