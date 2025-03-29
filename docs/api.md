# API Information

This document provides information about the primary Application Programming Interfaces (APIs) used by LLMCord.

## External APIs Consumed

LLMCord relies on the following external APIs:

1.  **Discord API:**
    *   Used for all interactions with the Discord platform (receiving messages, sending replies, managing slash commands, checking permissions, etc.).
    *   Interaction is handled via the [discord.py](https://discordpy.readthedocs.io/en/stable/) library.
    *   Requires a `bot_token` configured in `config.yaml`.

2.  **LLM Provider APIs:**
    *   Used to send prompts and receive generated text from Large Language Models.
    *   Supports various providers like OpenAI, Google Gemini, Groq, Mistral, OpenRouter, and local models via OpenAI-compatible endpoints.
    *   Configuration details (endpoints, API keys) for each provider are managed in the `providers` section of `config.yaml`.
    *   See the [Provider Configuration Guide](./providers.md) for detailed setup instructions.

## Internal APIs / Exposed Endpoints

LLMCord does **not** currently expose its own external API for other applications to consume. Its functionality is primarily accessed through direct interaction within Discord.