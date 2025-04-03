# Configuration Reference

This document details the configuration options for the LLMcordTS bot. Configuration is primarily managed through a `config.yaml` file in the project root or via environment variables.

The structure of the configuration is defined in `src/types/config.ts`. Please refer to this file for the most precise definitions.

## Configuration Methods

1.  **`config.yaml`:** Create a `config.yaml` file in the project root (you can copy `config-example.yaml`). This is often the easiest way to manage settings.
2.  **Environment Variables:** Settings can often be overridden using environment variables. The exact mapping depends on the configuration loading logic (see `src/core/config.ts`), but typically follows a pattern like `PARENT_CHILD_PROPERTY=value` (e.g., `DISCORD_TOKEN=your_token`, `LLM_PROVIDERS_OPENAI_API_KEY=your_key`). Environment variables usually take precedence over the YAML file.

## Core Configuration

*   `discord_token` (string, **required**): Your Discord bot token obtained from the Discord Developer Portal.
*   `status_manager` (object, optional): Settings for the bot's status updates.
    *   `enabled` (boolean): Whether to show status updates (e.g., "typing"). Default: `true`.
    *   `show_llm_provider` (boolean): Whether to include the LLM provider name in the status. Default: `false`.
*   `logger` (object, optional): Logging configuration.
    *   `level` (string): Minimum log level (e.g., 'debug', 'info', 'warn', 'error'). Default: 'info'.
    *   `log_to_file` (boolean): Whether to log output to a file. Default: `false`.
    *   `log_file_path` (string): Path to the log file if `log_to_file` is true. Default: './llmcord.log'.

## LLM Providers (`llm_providers`)

This section configures the Large Language Model providers the bot can use. Configure at least one.

*   **General Structure (for each provider, e.g., `openai`, `gemini`, `ollama`):**
    *   `enabled` (boolean, **required**): Set to `true` to enable this provider.
    *   `api_key` (string, optional/required): API key for the service (required for most cloud providers like OpenAI, Gemini).
    *   `model` (string, optional/required): The specific model name to use (e.g., `gpt-4`, `gemini-1.5-pro`, `llama3`).
    *   *(Provider-specific options):* Some providers might have additional settings (e.g., `base_url` for self-hosted models like Ollama).

*   **Example (`openai`):**
    ```yaml
    openai:
      enabled: true
      api_key: "sk-..."
      model: "gpt-4o"
    ```

*   **Example (`ollama`):**
    ```yaml
    ollama:
      enabled: true
      base_url: "http://localhost:11434" # Default Ollama URL
      model: "llama3:latest"
    ```

Refer to `src/types/config.ts` and potentially `src/providers/providerFactory.ts` for all available providers and their specific options.

## Memory (`memory`)

Configuration for the conversation memory system.

*   `enabled` (boolean): Whether to enable conversation memory. Default: `true`.
*   `storage_adapter` (string): Which storage backend to use. Default: 'sqlite'.
*   `max_context_tokens` (number): Approximate maximum tokens to retain in the active context window sent to the LLM. Default: `4096`.
*   `max_history_messages` (number): Maximum number of past messages to store per conversation. Default: `50`.
*   `summarization_threshold` (number): Number of messages after which summarization might occur (if implemented). Default: `10`.
*   `pruning_threshold` (number): Number of messages after which older messages might be pruned. Default: `40`.
*   `sqlite` (object, optional): Configuration specific to the SQLite adapter.
    *   `database_path` (string): Path to the SQLite database file. Default: './memory.db'.

## Tools (`tools`)

Configuration for specific tools.

*   **Example (`web_search`):**
    ```yaml
    web_search:
      enabled: true
      # Potentially API keys or other settings for the search provider
    ```

*(Refer to `src/types/config.ts` and individual tool files in `src/tools/` for specific tool configurations.)*

---

*Always consult `src/types/config.ts` for the definitive structure and available options.*