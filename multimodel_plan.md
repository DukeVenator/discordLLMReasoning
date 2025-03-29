# Multimodel Mode Implementation Plan (Revised)

**Goal:** Allow the bot to escalate complex tasks to a secondary, more powerful "reasoning" model, triggered by a signal from the default model, with configuration options and separate rate limiting, organizing new logic into a `llmcord/reasoning/` folder.

**Key Revisions:**
1.  **System Prompt:** The instruction for the default model to output the signal (`[USE_REASONING_MODEL]`) will only be added to the system prompt if `multimodel.enabled` is `true` in the configuration.
2.  **Reasoning Rate Limit Handling:** If the reasoning model is triggered but hits its rate limit, the bot will *not* show the signal to the user. Instead, it will proceed using the *original* response from the default model (after removing the signal from it).

**Plan Details:**

1.  **Configuration Updates:**
    *   **`llmcord/config.py`:**
        *   Add a new `multimodel` section to `default_config`:
            *   `enabled`: `false`
            *   `reasoning_model`: `null` (or e.g., `openai/gpt-4o`)
            *   `reasoning_signal`: `"[USE_REASONING_MODEL]"`
            *   `notify_user`: `true`
        *   Add new keys under `rate_limits`:
            *   `reasoning_user_limit`: `2`
            *   `reasoning_user_period`: `300`
            *   `reasoning_global_limit`: `null`
            *   `reasoning_global_period`: `null`
    *   **`config-example.yaml`:**
        *   Mirror the new structure with commented-out examples.

2.  **Reasoning Logic Module (`llmcord/reasoning/`):**
    *   Create directory `llmcord/reasoning/`.
    *   Create `llmcord/reasoning/__init__.py`.
    *   Create `llmcord/reasoning/manager.py`:
        *   Define `ReasoningManager` class.
        *   `__init__(self, config, rate_limiter)`: Store config, rate limiter. Init `reasoning_provider = None`.
        *   `is_enabled(self)`: Check `config.get("multimodel.enabled")`.
        *   `get_reasoning_signal(self)`: Return `config.get("multimodel.reasoning_signal")`.
        *   `should_notify_user(self)`: Return `config.get("multimodel.notify_user")`.
        *   `check_response_for_signal(self, response_content)`: Check for exact signal.
        *   `_get_reasoning_provider(self)`: (async) Lazily create/setup/return reasoning provider instance based on `config.get("multimodel.reasoning_model")`.
        *   `check_rate_limit(self, user_id)`: (async) Call `RateLimiter.check_reasoning_rate_limit`. Return `allowed, cooldown`.
        *   `generate_reasoning_response(self, messages, system_prompt)`: (async) Get provider, call `generate_stream`, yield results.

3.  **Provider Management:**
    *   `llmcord/providers/ProviderFactory` remains for creating the *default* provider.
    *   `ReasoningManager` handles lazy instantiation of the *reasoning* provider.

4.  **Rate Limiting (`llmcord/utils/rate_limit.py`):**
    *   Modify `RateLimiter` class:
        *   Load reasoning limits in `__init__`.
        *   Add separate storage for reasoning timestamps.
        *   Create `check_reasoning_rate_limit(self, user_id)`: (async) Implement logic using reasoning limits/timestamps.
        *   Create `get_reasoning_cooldown_remaining(self, user_id)`: (async) Calculate cooldown for reasoning limits.

5.  **Bot Core Integration (`llmcord/bot.py`):**
    *   In `LLMCordBot.__init__`: Add `self.reasoning_manager = None`.
    *   In `LLMCordBot.initialize`: Instantiate `self.reasoning_manager = ReasoningManager(...)`.
    *   Modify `LLMCordBot.process_message`:
        *   After default stream: `default_response_content = response_content_full`.
        *   Check if `reasoning_manager.is_enabled()` and `reasoning_manager.check_response_for_signal(default_response_content)`.
        *   If true (Signal Found):
            *   Log signal.
            *   If `should_notify_user`: Send "Thinking..." message.
            *   Call `allowed, cooldown = await reasoning_manager.check_rate_limit(...)`.
            *   If `allowed` (Reasoning OK):
                *   Log switch. Reset response vars. Start *new* stream loop with `reasoning_manager.generate_reasoning_response(...)`. Use `update_discord_response`. Delete "Thinking...". Proceed with *reasoning* response.
            *   If `not allowed` (Reasoning Rate Limit Hit):
                *   Log rate limit. Send rate limit message. Delete "Thinking...".
                *   **Clean signal:** `response_content_full = default_response_content.replace(reasoning_manager.get_reasoning_signal(), "").strip()`.
                *   Proceed with *cleaned default* response (fallback).
        *   If false (No Signal / Disabled):
            *   Proceed with `default_response_content`.
    *   Modify `LLMCordBot.prepare_system_prompt`:
        *   Get base system prompt.
        *   **Dynamically add signal instruction:** If `reasoning_manager and reasoning_manager.is_enabled()`, append the signal instruction text.
        *   Return potentially modified prompt.

**Flow Diagram:**

```mermaid
sequenceDiagram
    participant User
    participant Discord
    participant LLMCordBot
    participant DefaultProvider
    participant ReasoningManager
    participant ReasoningProvider
    participant RateLimiter

    User->>Discord: Sends message
    Discord->>LLMCordBot: on_message(msg)
    LLMCordBot->>RateLimiter: check_rate_limit(user_id) # Default limit
    alt Default Rate Limit OK
        RateLimiter-->>LLMCordBot: Allowed
        LLMCordBot->>LLMCordBot: build_message_history(msg)
        LLMCordBot->>LLMCordBot: prepare_system_prompt() # Adds signal instruction ONLY if multimodel enabled
        LLMCordBot->>DefaultProvider: generate_stream(history, system_prompt)
        DefaultProvider-->>LLMCordBot: Stream chunks (default_response)
        LLMCordBot->>Discord: Update message with default_response (streaming)
        LLMCordBot->>ReasoningManager: check_response_for_signal(default_response)
        alt Signal Detected & Enabled
            ReasoningManager-->>LLMCordBot: Signal Found
            opt Notify User
                LLMCordBot->>Discord: Send "Thinking..." message (thinking_msg)
            end
            LLMCordBot->>ReasoningManager: check_rate_limit(user_id) # Reasoning limit
            alt Reasoning Rate Limit OK
                RateLimiter-->>LLMCordBot: Allowed
                LLMCordBot->>ReasoningManager: generate_reasoning_response(history, system_prompt) # Uses base system prompt
                ReasoningManager->>ReasoningProvider: generate_stream(...)
                ReasoningProvider-->>ReasoningManager: Stream chunks (reasoning_response)
                ReasoningManager-->>LLMCordBot: Stream chunks (reasoning_response)
                LLMCordBot->>Discord: Edit message with reasoning_response (streaming, replaces default)
                opt Notify User
                     LLMCordBot->>Discord: Delete thinking_msg
                end
                LLMCordBot->>LLMCordBot: Process memory suggestion (using reasoning_response)
            else Reasoning Rate Limit Hit
                RateLimiter-->>LLMCordBot: Denied (cooldown)
                LLMCordBot->>Discord: Send reasoning rate limit message
                 opt Notify User
                     LLMCordBot->>Discord: Delete thinking_msg
                end
                LLMCordBot->>LLMCordBot: Clean signal from default_response # REMOVE signal
                LLMCordBot->>LLMCordBot: Process memory suggestion (using cleaned default_response) # Fallback to default output
            end
        else No Signal or Disabled
            ReasoningManager-->>LLMCordBot: No Signal
            LLMCordBot->>LLMCordBot: Process memory suggestion (using default_response)
        end
        LLMCordBot->>Discord: Final message edit (if needed)
    else Default Rate Limit Hit
        RateLimiter-->>LLMCordBot: Denied (cooldown)
        LLMCordBot->>Discord: Send default rate limit message
    end