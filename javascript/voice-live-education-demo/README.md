# Voice Live Education Demo — English Pronunciation Coach

A browser-based English pronunciation coaching sample that pairs the **Azure Voice Live SDK** with the **Azure Speech SDK** (pronunciation assessment, PA). The user speaks, PA scores their pronunciation per word, and the LLM uses those scores to deliver targeted coaching feedback in real time.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:3000, then:

1. Enter your **Voice Live endpoint** (e.g., `https://your-resource.services.ai.azure.com/`)
2. Paste your **API key** (the only supported auth method in this browser sample).
3. Choose a **PA scenario** (the instructions field is auto-filled with the matching coaching prompt; edit if needed).
4. Click **Connect**, then **Start Conversation**, and allow microphone access.

## PA Scenarios

| Scenario | Description |
|----------|-------------|
| **Conversation** (default) | Free-form chat with pronunciation feedback woven into natural replies. |
| **Concise** | Same coaching, capped at ≤2 short sentences / <30 words. |
| **Read Along** | Bilingual (Chinese + English) guided read-along. The assistant calls a `set_reference_text` tool to set the expected sentence; PA scores the user's read-back against it. The voice picker is restricted to DragonHD voices. |

## Pronunciation Assessment

PA always runs in streaming mode: audio is pushed to the Speech recognizer as the user speaks, for lower latency.

- **Read Along** — when the assistant offers a new sentence to read, it calls the `set_reference_text` tool to supply the target text; the next user turn is then scored against it (omissions / insertions / mispronunciations). Turns without a new tool call run without reference text.
- **Conversation / Concise** — no reference text; PA scores what the recognizer transcribes from the user's speech.

## Features

- **Per-word PA visualization** — words colored by score / error type (good / mispronunciation / omission / insertion); score and error type in the tooltip.
- **Real-time conversation UX** — streaming assistant text + audio, typing cursor, barge-in support, mic level meter, live event panel.
- **Optional latency metrics** — PA start→end, speech end→PA ready, PA ready→first TTS chunk, speech end→first TTS chunk.
- **Scenario-aware UI** — switching scenarios refreshes the instructions and filters the voice list.

## Development

### Commands
```bash
npm run dev        # Development server with hot reload
npm run build      # Production build
npm run preview    # Preview production build
npm run type-check # TypeScript type checking
```

### Browser Requirements
| Browser | Minimum Version |
|---------|-----------------|
| Chrome  | 66+ (recommended) |
| Firefox | 60+ |
| Safari  | 11.1+ |
| Edge    | 79+ |

**Required browser features:**
- HTTPS connection (for microphone access)
- Web Audio API
- ES2020 module support
- WebSocket

## Troubleshooting

### "Microphone not accessible"
- Ensure you're using **HTTPS** (required for microphone access)
- Check browser permissions for microphone access
- Try refreshing the page and re-allowing permissions

### "Connection failed"
- Verify your **API key** and **endpoint** are correct
- Check browser console for detailed error messages  
- Ensure your Voice Live service is accessible

### "No audio playback"
- Check browser audio permissions and system volume
- Verify speakers/headphones are working
- Check browser console for audio errors

### "Events not showing"
- Click **"Show Events"** to display the events panel
- Toggle **"Filter Important Events Only"** to see key events

For advanced debugging (WebSocket inspection, SDK source debugging, performance monitoring), see [DEBUG_GUIDE.md](DEBUG_GUIDE.md).

## **License**

This sample is licensed under the MIT License. See the main SDK LICENSE file for details.
