---
name: mistral-mcp-openclaw
description: Configure OpenClaw to use the community mistral-mcp stdio server for Mistral OCR, Codestral FIM, Voxtral audio, durable workflows, moderation, classification, files, batch, and model/voice resources.
version: 0.2.0
metadata:
  openclaw:
    requires:
      env:
        - MISTRAL_API_KEY
      bins:
        - openclaw
        - node
        - npm
    install:
      - kind: node
        package: mistral-mcp
        bins:
          - mistral-mcp
    primaryEnv: MISTRAL_API_KEY
    emoji: "🌊"
    homepage: https://github.com/Swih/mistral-mcp
---

# Mistral MCP for OpenClaw

> Created by the maintainer of `mistral-mcp`. This is a community skill, not an official OpenClaw or Mistral integration.

Use this skill when you want OpenClaw to access Mistral capabilities beyond the built-in chat/model routing provider:

- OCR for documents and images (Mistral Document AI)
- Codestral fill-in-the-middle (FIM) code completion
- Voxtral transcription with speaker diarization, and TTS
- Durable workflows with human-in-the-loop signals (`workflow_execute / status / interact`)
- Moderation and classification endpoints
- Files and batch API workflows
- Live model and voice resources

OpenClaw already includes a built-in Mistral provider for chat. This skill is for tool-level MCP access alongside that provider.

## Requirements

- Node.js 18+
- OpenClaw CLI
- `MISTRAL_API_KEY` in your environment
- `mistral-mcp` installed from npm

## Setup

Install the MCP server package globally:

```bash
npm install -g mistral-mcp
```

Set your Mistral API key in your shell environment:

```bash
export MISTRAL_API_KEY="sk-..."
```

Register the stdio MCP server in OpenClaw:

```bash
openclaw mcp set mistral '{"command":"mistral-mcp","env":{"MISTRAL_API_KEY":"${MISTRAL_API_KEY}"}}'
```

Check the saved definition:

```bash
openclaw mcp show mistral --json
```

## When to use it

Use this skill for workflows where the agent needs a Mistral-specific tool, not just a chat model:

- Extract text from a PDF or image with OCR
- Ask Codestral for FIM / inline code completion
- Transcribe or generate audio with Voxtral (diarization supported)
- Run durable multi-step workflows with human approval gates
- Run moderation or classification before taking an action
- Submit larger async workloads through the batch API
- Inspect live model and voice catalogs as MCP resources

## Safety notes

- Do not paste API keys into chat or commit them to source files. Prefer environment variables or your normal secret manager.
- Review the `mistral-mcp` package before installing it if you operate in a sensitive workspace. Source: https://github.com/Swih/mistral-mcp.
- Mistral has its own pricing and rate limits. Check the current Mistral plan and usage policies before running batch or large transcription workloads.
