# LLM Provider Integration

This document describes how LLMcordTS integrates with various Large Language Model (LLM) providers, allowing flexibility in choosing the underlying AI model.

## Overview

The bot uses a provider pattern, defined by the `BaseProvider` interface (`src/providers/baseProvider.ts`), to abstract the specific details of communicating with different LLM APIs. This allows the core bot logic (`LLMCordBot.ts`) to interact with any supported provider through a consistent interface. The `ProviderFactory` (`src/providers/providerFactory.ts`) is responsible for instantiating the correct provider based on the application configuration.

## Core Components

### 1. Base Provider Interface (`src/providers/baseProvider.ts`)

This interface defines the contract that all specific provider implementations must adhere to. Key aspects include:

*   **`generateStream(messages, systemPrompt?, options?)`**: The primary method for generating responses. It accepts the conversation history (`ChatMessage[]`), an optional system prompt, and optional `GenerationOptions` (like temperature, max tokens, tools). It returns an `AsyncGenerator` that yields `StreamChunk` objects containing response content, tool calls, and finish information.
*   **Capability Checks**: Methods that allow the bot core to query the provider's capabilities:
    *   `supportsVision()`: Can the provider handle image input?
    *   `supportsTools()`: Does the provider support function/tool calling?
    *   `supportsSystemPrompt()`: Does the provider handle a distinct 'system' role message, or does the prompt need merging?
    *   `supportsUsernames()`: Can the provider associate messages with user names/IDs?
    *   `supportsStreaming()`: Does the provider natively support streaming responses?
*   **Data Structures**: Defines common types used for interaction:
    *   `ChatMessage`: Represents a message in the history (role, content, name, tool info). Supports multimodal content (`ChatMessageContentPart`).
    *   `StreamChunk`: Represents a piece of data received from the stream (content delta, tool calls, final status).
    *   `GenerationOptions`: Optional parameters to control the LLM's generation process.

### 2. Provider Factory (`src/providers/providerFactory.ts`)

*   **Role:** Instantiates the appropriate `BaseProvider` implementation based on the application configuration.
*   **Initialization:** Takes the global `Config` object.
*   **`getDefaultProvider()`:** Reads the primary `config.model` setting (e.g., "openai/gpt-4o", "google-gemini/gemini-1.5-pro", "ollama/llama3") to determine the default provider and model.
*   **`getProvider(providerIdentifier, modelName?)`:** Creates a specific provider instance.
    *   Validates that required configuration (API keys, base URLs) exists in the corresponding section of `config.llm` (e.g., `config.llm.openai`, `config.llm.gemini`, `config.llm.ollama`).
    *   Throws `ProviderInitializationError` if configuration is missing or the provider is unsupported.
    *   Passes necessary configuration details (API key, model, baseURL, extraParams, keepAlive) to the provider's constructor.

## Implemented Providers

### a) OpenAI (`src/providers/openaiProvider.ts`)

*   **Targets:** Official OpenAI API and compatible endpoints (Ollama, Groq, Mistral API, etc.).
*   **Client:** Uses the `openai` Node.js library.
*   **Configuration:** Requires `llm.openai.apiKey`. Optional: `llm.openai.defaultModel`, `llm.openai.baseURL`, `llm.openai.extraParams`.
*   **Capabilities:**
    *   Vision: Yes
    *   Tools: Yes
    *   System Prompt: Yes
    *   Usernames: Yes
    *   Streaming: Yes
*   **Notes:** Maps internal base64 images to OpenAI's `data:` URL format. Handles tool call argument streaming.

### b) Gemini (`src/providers/geminiProvider.ts`)

*   **Targets:** Google Gemini API.
*   **Client:** Uses the `@google/genai` SDK.
*   **Configuration:** Requires `providers.google-gemini.apiKey` (or `providers.gemini.apiKey`). Optional: `llm.gemini.defaultModel`, `llm.gemini.extraParams`.
*   **Capabilities:**
    *   Vision: Yes (if model name includes "vision")
    *   Tools: Yes
    *   System Prompt: Yes (via `systemInstruction` config passed during generation)
    *   Usernames: No
    *   Streaming: Yes
*   **Notes:** Maps internal `tool` role messages to `user` role with `functionResponse` part. Maps internal `ToolDefinition` to Gemini `FunctionDeclaration`. System prompt is passed via generation config, not as a history message.

### c) Ollama (`src/providers/ollamaProvider.ts`)

*   **Targets:** Ollama `/api/chat` endpoint.
*   **Client:** Uses `axios`.
*   **Configuration:** Requires `llm.ollama.baseURL`. Optional: `llm.ollama.defaultModel`, `llm.ollama.keepAlive`, `llm.ollama.extraParams`, `llm.ollama.supportsVision` (fallback checks model name for "llava").
*   **Capabilities:**
    *   Vision: Conditional (based on config flag or model name)
    *   Tools: No (API level)
    *   System Prompt: Yes (via 'system' role message)
    *   Usernames: No
    *   Streaming: Yes
*   **Notes:** Maps internal base64 images directly to Ollama's `images` array. Parses newline-delimited JSON stream.

## Adding New Providers

To add support for a new LLM provider:

1.  Create a new provider class in `src/providers/` that implements the `BaseProvider` interface.
2.  Implement the `generateStream` method to handle API calls and stream parsing for the new service.
3.  Implement all capability check methods (`supportsVision`, `supportsTools`, etc.) accurately for the provider.
4.  Update the `ProviderFactory` to recognize the new provider identifier, validate its configuration, and instantiate the new class.
5.  Update the `Config` type definition in `src/types/config.ts` to include any necessary settings for the new provider under `llm` or `providers`.
6.  Add documentation here (`providers.md`) and in `configuration.md` for the new provider.