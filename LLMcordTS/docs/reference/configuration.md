# Configuration Reference

This document details the configuration options for the LLMcordTS bot, managed through `config.yaml` in the project root or environment variables. The structure is defined in `src/types/config.ts`.

## Configuration Methods

1.  **`config.yaml`:** Create this file in the project root (copy `config-example.yaml`).
2.  **Environment Variables:** Can override YAML settings. The mapping depends on the loading logic (`src/core/config.ts`), often following `PARENT_CHILD_PROPERTY=value`. Environment variables usually take precedence.

---

## Top-Level Settings

*   **`model`**
    *   **Type:** `string`
    *   **Required:** Yes
    *   **Description:** Specifies the default LLM provider and model to use, in the format `"provider_name/model_name"`. This is used by the `ProviderFactory` to instantiate the default provider.
    *   **Example:** `"openai/gpt-4o"`, `"google-gemini/gemini-1.5-pro"`, `"ollama/llama3"`

*   **`providers`** (Optional)
    *   **Type:** `object`
    *   **Description:** A map to store provider-specific credentials or settings, often API keys, separate from the main `llm` section. Keys should match provider names (e.g., `openai`, `google-gemini`). The `ProviderFactory` may look here for API keys.
    *   **Example:**
        ```yaml
        providers:
          google-gemini:
            apiKey: "YOUR_GEMINI_API_KEY"
          # other providers...
        ```

---

## `discord` Section

Configuration related to the Discord connection and bot behavior.

*   **`token`**
    *   **Type:** `string`
    *   **Required:** Yes
    *   **Description:** Your Discord bot token from the Discord Developer Portal.

*   **`clientId`**
    *   **Type:** `string`
    *   **Required:** Yes
    *   **Description:** Your Discord application's Client ID from the Developer Portal.

*   **`guildId`** (Optional)
    *   **Type:** `string`
    *   **Description:** If provided, slash commands will be registered instantly to this specific guild ID during development/testing, instead of globally (which can take up to an hour). Remove or leave empty for global deployment.

*   **`intents`** (Optional)
    *   **Type:** `number[]`
    *   **Description:** Discord Gateway Intents required by the bot. Usually calculated automatically based on required features.

*   **`partials`** (Optional)
    *   **Type:** `string[]`
    *   **Description:** Discord Partials to enable (e.g., `'CHANNEL'` for DMs). Usually configured automatically.

*   **`presence`** (Optional)
    *   **Type:** `object`
    *   **Description:** Configure the bot's initial presence (status and activity).
    *   **`status`**: (`'online' | 'idle' | 'dnd' | 'invisible'`) - The bot's online status.
    *   **`activity`** (Optional):
        *   **`name`**: (`string`) - The text of the activity (e.g., "with LLMs").
        *   **`type`**: (`'Playing' | 'Streaming' | 'Listening' | 'Watching' | 'Competing'`) - The type of activity.
        *   **`url`** (Optional, `string`): Required if `type` is 'Streaming'. The URL for the stream.

*   **`streamingUpdateIntervalMs`** (Optional)
    *   **Type:** `number`
    *   **Default:** `1500`
    *   **Description:** Interval in milliseconds for updating streaming responses in Discord.

*   **`usePlainResponses`** (Optional)
    *   **Type:** `boolean`
    *   **Default:** `false`
    *   **Description:** If true, use plain text messages for bot responses instead of embeds.

*   **`statuses`** (Optional)
    *   **Type:** `string[]`
    *   **Description:** A list of custom status messages for the bot to cycle through. Managed by `StatusManager`.

*   **`statusUpdateIntervalSeconds`** (Optional)
    *   **Type:** `number`
    *   **Default:** `300` (5 minutes)
    *   **Description:** Interval in seconds for cycling through custom statuses.

*   **`allowDms`** (Optional)
    *   **Type:** `boolean`
    *   **Default:** `true`
    *   **Description:** Allow the bot to respond to interactions in Direct Messages.

---

## `llm` Section

Configuration related to Large Language Models and providers.

*   **`defaultProvider`**
    *   **Type:** `string` (`'openai' | 'gemini' | 'ollama' | string`)
    *   **Required:** Yes (but often inferred from the top-level `model` setting)
    *   **Description:** The identifier of the default LLM provider. Should match a key in the `llm` section below (e.g., `openai`, `ollama`) or a custom provider name. The `ProviderFactory` primarily uses the top-level `model` setting.

*   **`requestTimeoutMs`** (Optional)
    *   **Type:** `number`
    *   **Default:** `10000` (10 seconds, used by Axios default) or provider-specific.
    *   **Description:** Default timeout for LLM API requests in milliseconds.

*   **`defaultMaxTokens`** (Optional)
    *   **Type:** `number`
    *   **Description:** Default maximum number of tokens to generate in LLM responses if not specified per-provider.

*   **`defaultTemperature`** (Optional)
    *   **Type:** `number`
    *   **Description:** Default temperature for LLM generation (controls randomness, e.g., 0.7) if not specified per-provider.

*   **`defaultSystemPrompt`** (Optional)
    *   **Type:** `string`
    *   **Default:** `"You are LLMCord, a helpful Discord bot."`
    *   **Description:** Default system prompt sent to the LLM to set its persona or instructions.

*   **`maxAttachmentSizeBytes`** (Optional)
    *   **Type:** `number`
    *   **Default:** `10485760` (10 MB)
    *   **Description:** Maximum size in bytes for a single attachment to be processed (e.g., for vision models).

### `llm.openai` (Optional)

*   **`apiKey`**
    *   **Type:** `string`
    *   **Required:** Yes (if `openai` is the default provider or used)
    *   **Description:** Your OpenAI API key.

*   **`defaultModel`** (Optional)
    *   **Type:** `string`
    *   **Description:** Default OpenAI model to use (e.g., "gpt-4o", "gpt-3.5-turbo"). Overrides the model part from the top-level `model` setting if specified.

*   **`baseURL`** (Optional)
    *   **Type:** `string`
    *   **Description:** For using OpenAI-compatible API proxies or alternative endpoints (like local LLMs via LiteLLM, etc.).

*   **`temperature`** (Optional)
    *   **Type:** `number`
    *   **Description:** Overrides `llm.defaultTemperature` specifically for OpenAI calls.

*   **`maxOutputTokens`** (Optional)
    *   **Type:** `number`
    *   **Description:** Overrides `llm.defaultMaxTokens` specifically for OpenAI calls.

*   **`extraParams`** (Optional)
    *   **Type:** `object` (`Record<string, unknown>`)
    *   **Description:** Provider-specific parameters to pass directly to the OpenAI API (e.g., `top_p`, `frequency_penalty`).

### `llm.gemini` (Optional)

*   **`apiKey`**
    *   **Type:** `string`
    *   **Required:** Yes (if `gemini` is the default provider or used). Note: Often sourced from the top-level `providers` section (e.g., `providers.google-gemini.apiKey`).
    *   **Description:** Your Google AI Gemini API key.

*   **`defaultModel`** (Optional)
    *   **Type:** `string`
    *   **Description:** Default Gemini model to use (e.g., "gemini-1.5-pro", "gemini-1.5-flash"). Overrides the model part from the top-level `model` setting if specified.

*   **`temperature`** (Optional)
    *   **Type:** `number`
    *   **Description:** Overrides `llm.defaultTemperature` specifically for Gemini calls.

*   **`maxOutputTokens`** (Optional)
    *   **Type:** `number`
    *   **Description:** Overrides `llm.defaultMaxTokens` specifically for Gemini calls.

*   **`extraParams`** (Optional)
    *   **Type:** `object` (`Record<string, unknown>`)
    *   **Description:** Provider-specific parameters to pass directly to the Gemini API (e.g., `topP`, `topK`).

### `llm.ollama` (Optional)

*   **`baseURL`**
    *   **Type:** `string`
    *   **Required:** Yes (if `ollama` is the default provider or used)
    *   **Description:** Base URL of your Ollama instance (e.g., "http://localhost:11434").

*   **`defaultModel`** (Optional)
    *   **Type:** `string`
    *   **Description:** Default Ollama model to use (e.g., "llama3:latest", "mistral"). Overrides the model part from the top-level `model` setting if specified.

*   **`keepAlive`** (Optional)
    *   **Type:** `string | number`
    *   **Description:** Ollama `keep_alive` parameter (e.g., "5m", -1) controlling how long models stay loaded in memory.

*   **`temperature`** (Optional)
    *   **Type:** `number`
    *   **Description:** Overrides `llm.defaultTemperature` specifically for Ollama calls.

*   **`maxOutputTokens`** (Optional)
    *   **Type:** `number`
    *   **Description:** Overrides `llm.defaultMaxTokens` specifically for Ollama calls (maps to `num_predict`).

*   **`extraParams`** (Optional)
    *   **Type:** `object` (`Record<string, unknown>`)
    *   **Description:** Provider-specific parameters to pass directly to the Ollama API options (e.g., `num_ctx`, `top_p`).

*   **`supportsVision`** (Optional)
    *   **Type:** `boolean`
    *   **Description:** Explicitly declare if the selected Ollama model supports vision. If unset, the `OllamaProvider` attempts to infer based on model name (checking for "llava", "bakllava").

---

## `memory` Section

Configuration for the conversation memory system.

*   **`enabled`**
    *   **Type:** `boolean`
    *   **Required:** Yes
    *   **Description:** Enables or disables the entire memory feature.

*   **`storageType`**
    *   **Type:** `string` (`'sqlite'`)
    *   **Required:** Yes (currently only 'sqlite' is supported)
    *   **Description:** Specifies the storage backend for memory.

*   **`sqlite`**
    *   **Type:** `object`
    *   **Required:** Yes (if `storageType` is 'sqlite')
    *   **`path`**: (`string`, required) - Path to the SQLite database file (e.g., "./memory.db").

*   **`memoryPrefix`** (Optional)
    *   **Type:** `string`
    *   **Default:** `"[User Memory/Notes]:\n"`
    *   **Description:** Prefix added to memory content when formatting it for the system prompt.

*   **`maxHistoryLength`** (Optional)
    *   **Type:** `number`
    *   **Default:** `25`
    *   **Description:** Maximum number of user/assistant message pairs to retrieve from history for context when calling the LLM.

*   **`maxMemoryLength`** (Optional)
    *   **Type:** `number`
    *   **Description:** Approximate character length limit for the total stored memory content per user before condensation might be triggered.

*   **`maxTokensPerMessage`** (Optional)
    *   **Type:** `number`
    *   **Description:** Approximate token limit for truncating individual messages stored in history.

*   **`maxImages`** (Optional)
    *   **Type:** `number`
    *   **Default:** `2`
    *   **Description:** Maximum number of images from the recent history to include when sending context to a vision-capable LLM.

*   **`publishMemory`** (Optional)
    *   **Type:** `boolean`
    *   **Default:** `false`
    *   **Description:** If true, memory update confirmations (append/replace/forget) might be published as separate messages in the channel.

*   **`suggestions`** (Optional)
    *   **Type:** `object`
    *   **Description:** Configures LLM-suggested memory updates via tags in responses.
    *   **`appendMarkerStart`** (Optional, `string`, default: `'[MEM_APPEND]'`)
    *   **`appendMarkerEnd`** (Optional, `string`, default: `'[/MEM_APPEND]'`)
    *   **`replaceMarkerStart`** (Optional, `string`, default: `'[MEM_REPLACE]'`)
    *   **`replaceMarkerEnd`** (Optional, `string`, default: `'[/MEM_REPLACE]'`)
    *   **`stripFromResponse`** (Optional, `boolean`, default: `true`): Remove suggestion tags from the final response sent to the user.

*   **`condensation`** (Optional)
    *   **Type:** `object`
    *   **Description:** Configures automatic memory condensation/summarization.
    *   **`enabled`**: (`boolean`, required) - Enable/disable condensation.
    *   **`condensationThresholdPercent`** (Optional, `number`, default: `80`): Percentage of `maxMemoryLength` at which condensation triggers.
    *   **`targetLengthPercent`** (Optional, `number`, default: `50`): Target percentage of `maxMemoryLength` to aim for after condensation.
    *   **`intervalMinutes`** (Optional, `number`): How often (in minutes) to attempt condensation.
    *   **`prompt`** (Optional, `string`): Custom prompt template for the condensation LLM. Use `{current_memory}` and `{target_length}` placeholders. (Renamed from `condensationPrompt`).
    *   **`condensationSystemPrompt`** (Optional, `string`): Optional system prompt for the condensation LLM.
    *   **`provider`** (Optional, `string`): Specific LLM provider (e.g., "openai") to use for condensation (defaults to main provider).
    *   **`model`** (Optional, `string`): Specific LLM model to use for condensation.
    *   **`maxTokens`** (Optional, `number`): Max tokens for the generated condensation summary.
    *   **`fallbackTruncateTokens`** (Optional, `number`): Target token count for simple truncation if LLM condensation fails (defaults to 75% of `maxTokens`).
    *   **`temperature`** (Optional, `number`): Generation temperature for the condensation LLM.

---

## `reasoning` Section (Optional)

Configuration for the secondary reasoning LLM feature.

*   **`enabled`**
    *   **Type:** `boolean`
    *   **Required:** Yes (if section exists)
    *   **Description:** Enables or disables the reasoning feature.

*   **`provider`** (Optional)
    *   **Type:** `string`
    *   **Description:** Specific LLM provider (e.g., "openai") to use for reasoning calls (defaults to main provider).

*   **`reasoningModel`** (Optional)
    *   **Type:** `string`
    *   **Description:** Specific LLM model to use for reasoning calls.

*   **`systemPrompt`** (Optional)
    *   **Type:** `string`
    *   **Description:** Custom system prompt specifically for reasoning calls.

*   **`includeDefaultPrompt`** (Optional)
    *   **Type:** `boolean`
    *   **Default:** `true`
    *   **Description:** Whether to include the main `llm.defaultSystemPrompt` in reasoning calls.

*   **`extraInstructions`** (Optional)
    *   **Type:** `string`
    *   **Description:** Additional instructions appended to the system prompt for reasoning calls.

*   **`signalStart`** (Optional)
    *   **Type:** `string`
    *   **Default:** `'[USE_REASONING_MODEL]'`
    *   **Description:** The string in the primary LLM's response that triggers a reasoning call.

*   **`signalEnd`** (Optional)
    *   **Type:** `string`
    *   **Default:** `'[/USE_REASONING_MODEL]'`
    *   **Description:** The string that signals the end of a reasoning request block (used for extraction).

*   **`historyModificationStrategy`** (Optional)
    *   **Type:** `string` (`'keep_all' | 'truncate'`)
    *   **Default:** `'keep_all'`
    *   **Description:** How to modify the conversation history before sending it to the reasoning LLM.

*   **`maxHistoryLength`** (Optional)
    *   **Type:** `number`
    *   **Description:** Max number of message pairs to use if `historyModificationStrategy` is 'truncate'.

*   **`generationParams`** (Optional)
    *   **Type:** `object` (`Record<string, any>`)
    *   **Description:** LLM generation parameters (e.g., `temperature`, `maxOutputTokens`) specific to reasoning calls.

*   **`rateLimit`** (Optional)
    *   **Type:** `object`
    *   **Description:** Rate limiting specifically for reasoning calls per user.
    *   **`intervalSeconds`**: (`number`, required) - Time window in seconds.
    *   **`maxCalls`**: (`number`, required) - Max calls allowed in the window.

---

## `search` Section (Optional)

Configuration for the web search tool.

*   **`provider`**
    *   **Type:** `string` (`'brave' | 'none'`)
    *   **Required:** Yes (if section exists)
    *   **Description:** Specifies the search provider. Currently, only 'brave' is supported by the `webSearchTool`. Set to 'none' to disable.

*   **`brave`** (Optional)
    *   **Type:** `object`
    *   **Required:** Yes (if `provider` is 'brave')
    *   **`apiKey`**: (`string`, required) - Your Brave Search API key.

*   **`maxResults`** (Optional)
    *   **Type:** `number`
    *   **Default:** `3`
    *   **Description:** The maximum number of search results to return and display.

---

## `logging` Section

Configuration for application logging.

*   **`level`**
    *   **Type:** `string` (`'debug' | 'info' | 'warn' | 'error'`)
    *   **Required:** Yes
    *   **Description:** Minimum log level to output.

*   **`filePath`** (Optional)
    *   **Type:** `string`
    *   **Description:** If provided, logs will also be written to this file path.

---

## `permissions` Section

Configuration for controlling bot access.

*   **`allowedRoles`** (Optional)
    *   **Type:** `string[]`
    *   **Description:** List of Discord Role IDs allowed to use the bot. If empty/undefined, all roles are allowed unless blocked.

*   **`allowedUsers`** (Optional)
    *   **Type:** `string[]`
    *   **Description:** List of Discord User IDs allowed to use the bot. If empty/undefined, all users are allowed unless blocked.

*   **`adminUsers`** (Optional)
    *   **Type:** `string[]`
    *   **Description:** List of User IDs with admin privileges, bypassing other permission checks.

*   **`blockUsers`** (Optional)
    *   **Type:** `string[]`
    *   **Description:** List of User IDs explicitly blocked from using the bot.

*   **`blockRoles`** (Optional)
    *   **Type:** `string[]`
    *   **Description:** List of Role IDs explicitly blocked from using the bot.

*   **`allowedChannels`** (Optional)
    *   **Type:** `string[]`
    *   **Description:** List of Channel IDs where the bot is allowed. If empty/undefined, allowed in all channels unless blocked.

*   **`blockedChannels`** (Optional)
    *   **Type:** `string[]`
    *   **Description:** List of Channel IDs where the bot is explicitly blocked.

*   **`allowedCategories`** (Optional)
    *   **Type:** `string[]`
    *   **Description:** List of Category IDs where the bot is allowed. If empty/undefined, allowed in all categories unless blocked.

*   **`blockedCategories`** (Optional)
    *   **Type:** `string[]`
    *   **Description:** List of Category IDs where the bot is explicitly blocked.

---

## `rateLimit` Section

Configuration for command rate limiting.

*   **`user`**
    *   **Type:** `object`
    *   **Required:** Yes
    *   **Description:** Per-user rate limit settings.
    *   **`intervalSeconds`**: (`number`, required) - Time window in seconds.
    *   **`maxCalls`**: (`number`, required) - Max commands allowed per user in the window.

*   **`global`** (Optional)
    *   **Type:** `object`
    *   **Description:** Global rate limit settings across all users.
    *   **`intervalSeconds`**: (`number`, required) - Time window in seconds.
    *   **`maxCalls`**: (`number`, required) - Max total commands allowed globally in the window.