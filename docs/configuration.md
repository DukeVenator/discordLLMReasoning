# Configuration Guide (`config.yaml`)

LLMCord is configured using a YAML file, typically named `config.yaml`. You should create this file by copying `config-example.yaml` and modifying it.

```bash
cp config-example.yaml config.yaml
```

Below is a detailed explanation of each configuration section and parameter.

## Discord Settings

Basic settings required for your Discord bot application.

*   `bot_token`: **(Required)** Your Discord bot's unique token. Found in the Discord Developer Portal.
    *   *Example:* `MTA2...`
*   `client_id`: **(Required)** Your bot application's Client ID. Used for generating invite links.
    *   *Example:* `106...`
*   `status_message`: (Optional) The custom status message the bot will display on Discord.
    *   *Example:* `Chatting with LLMs`

## Message Processing

Controls how the bot handles incoming messages and conversation history.

*   `max_text`: (Optional, Default: `100000`) Maximum number of characters from a single message to process.
*   `max_images`: (Optional, Default: `5`) Maximum number of images attached to a message to process (only relevant for vision-capable models).
*   `max_messages`: (Optional, Default: `25`) Maximum number of previous messages (including the current one) to include in the conversation history sent to the LLM.
*   `use_plain_responses`: (Optional, Default: `false`) If `true`, the bot replies with plain text instead of Discord embeds. Embeds are generally recommended for better formatting.
*   `allow_dms`: (Optional, Default: `true`) If `true`, users can interact with the bot in Direct Messages.

## Permissions

Control which users, roles, or channels can interact with the bot. Leave lists empty (`[]`) to allow all.

*   `permissions`:
    *   `users`:
        *   `allowed_ids`: List of user IDs explicitly allowed.
        *   `blocked_ids`: List of user IDs explicitly blocked.
    *   `roles`:
        *   `allowed_ids`: List of role IDs explicitly allowed.
        *   `blocked_ids`: List of role IDs explicitly blocked.
    *   `channels`: Checks the channel ID, parent forum channel ID (if applicable), and category ID.
        *   `allowed_ids`: List of channel/forum/category IDs explicitly allowed.
        *   `blocked_ids`: List of channel/forum/category IDs explicitly blocked.

## Rate Limiting

Prevent abuse and manage API costs by limiting request frequency.

*   `rate_limits`:
    *   `enabled`: (Optional, Default: `true`) Set to `false` to disable all rate limits.
    *   `user_limit`: (Optional, Default: `5`) Max requests per user within `user_period`.
    *   `user_period`: (Optional, Default: `60`) Time window (seconds) for user limit.
    *   `global_limit`: (Optional, Default: `100`) Max total bot requests within `global_period`.
    *   `global_period`: (Optional, Default: `60`) Time window (seconds) for global limit.
    *   **Reasoning Model Limits (Only if `multimodel.enabled` is `true`):**
        *   `reasoning_user_limit`: (Optional, Default: `2`) Max reasoning requests per user within `reasoning_user_period`.
        *   `reasoning_user_period`: (Optional, Default: `300`) Time window (seconds) for user reasoning limit.
        *   `reasoning_global_limit`: (Optional, Default: `2`) Max total reasoning requests within `reasoning_global_period`.
        *   `reasoning_global_period`: (Optional, Default: `61`) Time window (seconds) for global reasoning limit.
    *   `admin_bypass`: (Optional, Default: `false`) If `true`, users with Administrator permissions on the server bypass rate limits.

## Persistent Memory

Allows the bot to remember information about users across conversations.

*   `memory`:
    *   `enabled`: (Optional, Default: `true`) Set to `false` to disable memory features.
    *   `database_path`: (Optional, Default: `"llmcord_memory.db"`) Path to the SQLite database file where memories are stored.
    *   `prompt_injection_method`: (Optional, Default: `"system_prompt_prefix"`) How memory is added to the LLM prompt:
        *   `"system_prompt_prefix"`: Prepends memory to the system prompt (Recommended).
        *   `"user_message_prefix"`: Adds memory as a separate user message.
    *   `memory_prefix`: (Optional, Default: `"[User Memory/Notes]:\n"`) Text added before the user's memory content in the prompt.
    *   `max_memory_length`: (Optional, Default: `1500`) Maximum character length for a user's stored memory.
    *   **LLM-Suggested Memory:** Allows the LLM to suggest additions to a user's memory based on the conversation.
        *   `llm_suggests_memory`: (Optional, Default: `true`) Set to `false` to disable this feature.
        *   `memory_suggestion_prompt`: (Optional) The specific instruction added to the LLM's prompt telling it how and when to suggest memory updates using the defined markers. See `config-example.yaml` for the default prompt.
        *   `memory_suggestion_start_marker`: (Optional, Default: `"[MEM_UPDATE]"`) The text marker indicating the start of a memory suggestion from the LLM.
        *   `memory_suggestion_end_marker`: (Optional, Default: `"[MEM_UPDATE]"`) The text marker indicating the end of a memory suggestion.
        *   `memory_suggestion_mode`: (Optional, Default: `"append"`) How to handle new suggestions:
            *   `"append"`: Adds the suggestion as a new line to existing memory.
            *   `"replace"`: Overwrites the entire existing memory with the suggestion (Use with caution!).
        *   `memory_suggestion_append_prefix`: (Optional, Default: `"\n- "`) Text prepended to each *new* memory item when using `append` mode (e.g., for bullet points).
        *   `show_addition_confirmation`: (Optional, Default: `true`) If `true`, the bot sends a confirmation message when memory is successfully updated via LLM suggestion.

## Multimodel (Reasoning) Settings

(Optional) Configure the bot to use a secondary, potentially more powerful, LLM for complex reasoning tasks when triggered by the primary model.

*   `multimodel`:
    *   `enabled`: (Optional, Default: `false`) Set to `true` to enable this feature. Requires careful configuration of the primary model's system prompt to include instructions on *when* to output the `reasoning_signal`.
    *   `reasoning_model`: **(Required if `enabled` is `true`)** The provider and model name for reasoning tasks. Must be a configured provider.
        *   *Example:* `openai/gpt-4o` or `google-gemini/gemini-1.5-pro-latest`
    *   `reasoning_signal`: **(Required if `enabled` is `true`)** The exact text string the *primary* model must output in its response to trigger the switch to the `reasoning_model`. The primary model needs to be prompted to use this signal appropriately.
        *   *Example:* `"[USE_REASONING_MODEL]"`
    *   `notify_user`: (Optional, Default: `true`) If `true`, sends a message like "Thinking deeper..." to the user when switching to the reasoning model.
    *   `reasoning_extra_api_parameters`: (Optional) A dictionary of API parameters (like `max_tokens`, `temperature`) specifically for the reasoning model, overriding the global `extra_api_parameters`.

## LLM Providers

Configure the API endpoints and keys for the LLM providers you want to use. Many providers offer OpenAI-compatible APIs.

*   `providers`: A dictionary where each key is a provider name (e.g., `openai`, `google-gemini`, `groq`).
    *   **For OpenAI-compatible APIs (OpenAI, Groq, Mistral, OpenRouter, local models like Ollama, LMStudio, etc.):**
        *   `base_url`: **(Required)** The API endpoint URL.
        *   `api_key`: **(Required for most cloud services)** Your API key for the provider. May not be needed for local models.
    *   **For Google Gemini (Native API):**
        *   `api_key`: **(Required)** Your Google API Key (from AI Studio or GCP).
        *   `base_url`: *Not needed*, handled by the `google-generativeai` library.

See `config-example.yaml` for example URLs and provider names.

## Model Selection

Choose the default LLM provider and model the bot will use.

*   `model`: **(Required)** The provider name and model name, separated by a slash (`/`). Must match a configured provider under `providers`.
    *   *Examples:* `openai/gpt-4o`, `google-gemini/gemini-1.5-pro-latest`, `groq/llama3-70b-8192`, `ollama/llama3`

## Extra API Parameters

(Optional) Pass additional parameters directly to the selected LLM's API during generation. These parameters must be supported by the chosen provider and model.

*   `extra_api_parameters`: A dictionary of parameters.
    *   *Common Examples (OpenAI-compatible):* `max_tokens`, `temperature`, `top_p`, `frequency_penalty`, `presence_penalty`
    *   *Google Gemini Examples:* `candidate_count` (within `generation_config`)
    *   Consult your LLM provider's documentation for available parameters.

## System Prompt

The initial instruction given to the LLM at the start of a conversation.

*   `system_prompt`: **(Required)** The base text for the system prompt. The bot automatically appends the current date/time and user ID information. Use YAML multi-line syntax (`>`) for longer prompts.
    *   *Example:*
        ```yaml
        system_prompt: >
          You are a helpful Discord chatbot.
          Respond conversationally. Format replies using Discord markdown.