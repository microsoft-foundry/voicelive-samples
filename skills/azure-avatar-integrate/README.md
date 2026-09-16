# Azure Avatar Integration

Agent skills for creating Azure Avatar videos, adding talking avatars to applications, and troubleshooting integration issues

## Installation

To use these Agent Skills, open the project where your coding agent is configured and install them either from the command line or manually.

### Skills CLI

Run this command from the project :

```bash
npx skills add https://github.com/microsoft-foundry/voicelive-samples/tree/main/.agent/skills/azure-avatar-integrate
```

### Manual Installation

Use the project-level skills directory:
- **.agents/skills**  for GitHub Copilot and Codex
- **.claude/skills** for Claude Code

```sh
git clone https://github.com/microsoft-foundry/voicelive-samples.git

cp -R voicelive-samples/.agent/skills/azure-avatar-integrate .agents/skills/
```

## Skill Structure

```text
azure-avatar-integrate/
├── README.md
├── SKILL.md
├── references/
└── scripts/
```

## Quick Reference

| Path | Description |
|---|---|
| [SKILL.md](SKILL.md) | Skill entry point, integration path selection, and workflow. |
| [references/batch-synthesis.md](references/batch-synthesis.md) | Generate a downloadable avatar video from text or SSML. |
| [references/realtime-sdk.md](references/realtime-sdk.md) | Stream avatar speech and video in real time from text or SSML supplied by your app |
| [references/voice-live.md](references/voice-live.md) | Build an AI avatar that listens and responds in real time with synchronized speech and video. |
| [references/troubleshooting.md](references/troubleshooting.md) | Diagnose connection, playback, or session failures. |
| [references/feedback.md](references/feedback.md) | Share optional feedback with consent and review. |
| [scripts/feedback_form_url.py](scripts/feedback_form_url.py) | Generate a prefilled feedback form URL after consent. |

## Example Prompts

Open your coding agent and use the following prompt to activate the skill:

> I want to add an Azure avatar to my app. Where do I start?

> Add an Azure avatar to my website.

> I want to generate a video of an Azure avatar reading my script.

> I already have a chatbot. How can an Azure avatar speak its replies?

> Build an Azure avatar I can talk to and ask questions.

> I can't get my Azure avatar to connect. What should I check?

> The avatar shows up, but I can't hear anything.

> I'd like to give some feedback about setting up Azure Avatar.

## Requirements

- **Coding agent:** Supports Agent Skills, file editing, and terminal commands.
- **Azure access:** Resources and authentication supported by your chosen integration.
- **Real-time browser use:** WebRTC support; microphone access for voice conversations.

## Optional Tools

- **Node.js/npm:** For installation via `npx skills add`.
- **Python 3.10+:** For the feedback helper.

> Keep long-lived secrets on a trusted backend, never in chat or client code. Local checks do not prove end-to-end success. Azure usage may be billable; obtain approval before live calls.

## Related Resources

- [Azure Avatar Documentation](https://learn.microsoft.com/azure/ai-services/speech-service/text-to-speech-avatar/what-is-text-to-speech-avatar)
- [Azure Voice Live Documentation](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live)
- [Azure Avatar Supported Regions](https://learn.microsoft.com/azure/ai-services/speech-service/regions?tabs=ttsavatar)
- [Azure Speech SDK Samples](https://github.com/Azure-Samples/cognitive-services-speech-sdk)
- [Agent Skills Specification](https://agentskills.io/specification)