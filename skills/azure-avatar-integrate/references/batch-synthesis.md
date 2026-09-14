# Batch Synthesis Integration

Generate a finished avatar video from text or SSML, then save the video and synthesis summary in application-owned storage.

## Prepare

### 1. Confirm the resource

Reuse the Microsoft Foundry project or Speech resource, name/region, and backend credential source. If absent, guide resource creation before requesting details. Check the resource and avatar type against [Avatar region support](https://learn.microsoft.com/azure/ai-services/speech-service/regions?tabs=ttsavatar).

### 2. Define the output

| Input | Confirm |
|---|---|
| Script | Text or SSML, language, and neural voice. |
| Avatar | Character, style, and stock/custom type. |
| Delivery | Video format and durable destinations for both video and summary. |
| Job policy | Polling timeout/backoff and remote/local retention. |

### 3. Locate the backend components

Reuse request validation, HTTP client, job persistence, worker/scheduler, storage, and cleanup code. Implement missing components rather than blocking local coding or creating a parallel sample.

Check the [batch guide](https://learn.microsoft.com/azure/ai-services/speech-service/text-to-speech-avatar/batch-synthesis-avatar?pivots=ai-foundry) and [official samples](https://github.com/Azure-Samples/cognitive-services-speech-sdk/tree/master/samples/batch-avatar) before using the REST examples below.

> **Backend only:** submit, poll, download, and delete from the trusted backend. Keep long-lived credentials out of client code and logs.

## Implement

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
Ocp-Apim-Subscription-Key: <speech-key>
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
Ocp-Apim-Subscription-Key: <speech-key>
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
Ocp-Apim-Subscription-Key: <speech-key>
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
Ocp-Apim-Subscription-Key: <speech-key>
```

Follow `nextLink` until all required pages are read; maximum page size is 100.

## Verify

- [ ] **Configuration:** resource, region, API, content, avatar, video, polling, and storage match the plan; no secrets in logs.
- [ ] **Validation and identity:** enforce input/size/format/duration limits; persist the ID before submission and query it after an uncertain result.
- [ ] **Polling:** reach a terminal state or record local timeout without claiming cancellation; handle transient errors and `Retry-After` separately.
- [ ] **Durable results:** one real job produces validated video and summary in owned storage; no SAS exposure or forwarded Speech headers.
- [ ] **Recovery:** failure/timeout state is persisted; restart resumes the same job or pending storage without duplicate synthesis.
- [ ] **Retention and cleanup:** delete only after durable storage; repeated cleanup leaves no local resources active.

Report verified and remaining checks using the main skill's **Report Results** section.
