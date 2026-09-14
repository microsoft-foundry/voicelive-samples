# Azure Avatar Integration

An AI coding agent skill to help you create Azure Avatar videos, add a talking avatar to your app, and troubleshoot integration issues.

## Installation

### Skills CLI

Open the project where you use your coding agent, then run this command from the project:

```bash
npx skills add https://github.com/microsoft-foundry/voicelive-samples/tree/main/.agent/skills/azure-avatar-integrate
```

### Manual Installation

These are project-level installation directories: `.agents/skills` for GitHub Copilot and Codex, or `.claude/skills` for Claude Code.

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
| [references/batch-synthesis.md](references/batch-synthesis.md) | Generate a finished video from text or SSML. |
| [references/realtime-sdk.md](references/realtime-sdk.md) | Render final text from an existing conversation pipeline. |
| [references/voice-live.md](references/voice-live.md) | Build a service-managed avatar conversation. |
| [references/troubleshooting.md](references/troubleshooting.md) | Diagnose connection, playback, or session failures. |
| [references/feedback.md](references/feedback.md) | Share optional feedback with consent and review. |
| [scripts/feedback_form_url.py](scripts/feedback_form_url.py) | Generate a prefilled feedback form URL after consent. |

## Example Prompts

Ask your agent to use `azure-avatar-integrate`, then try:

> I want to add an Azure avatar to my app. Where do I start?

> Add an Azure avatar to my website.

> I want to generate a video of an Azure avatar reading my script.

> I already have a chatbot. How can an Azure avatar speak its replies?

> Build an Azure avatar I can talk to and ask questions.

> I can't get my Azure avatar to connect. What should I check?

> The avatar shows up, but I can't hear anything.

> I'd like to give some feedback about setting up Azure Avatar.

## Requirements

- **Coding agent:** Supports Agent Skills and file and terminal tools.
- **Node.js/npm:** Only for CLI installation.
- **Azure access:** A supported Azure resource and credentials for live calls.
- **Python 3.10+:** Only for the optional feedback helper.

> Keep long-lived secrets on a trusted backend, never in chat or client code. Local checks do not prove end-to-end success. Azure usage may be billable; obtain approval before live calls.

## Related Resources

- [Azure Avatar Documentation](https://learn.microsoft.com/azure/ai-services/speech-service/text-to-speech-avatar/what-is-text-to-speech-avatar)
- [Azure Voice Live Documentation](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live)
- [Azure Avatar Supported Regions](https://learn.microsoft.com/azure/ai-services/speech-service/regions?tabs=ttsavatar)
- [Azure Speech SDK Samples](https://github.com/Azure-Samples/cognitive-services-speech-sdk)
- [Agent Skills Specification](https://agentskills.io/specification)