# LLMCord Feature Enhancement Plan (March 2025)

This document outlines the plan for implementing new features and improvements for the LLMCord bot.

## Summary of Current State (as of March 29, 2025)

Based on a review of `bot.py`, `utils/slash_commands.py`, `commands/memory_commands.py`, and the `build_message_history` function:

*   **Core:** Interacts with LLMs (configurable providers like OpenAI, Gemini), supports streaming responses, handles basic message processing, permissions (user/role/channel), and rate limiting.
*   **Memory:**
    *   Persistent, user-specific memory storage.
    *   LLM can be prompted to generate special tags (`[MEM_APPEND]`, `[MEM_REPLACE]`) in its response to automatically update a user's memory.
    *   Commands for users to manage their memory:
        *   `/memory view`: Show notes.
        *   `/memory update <text>`: Replace notes.
        *   `/memory clear`: Clear notes.
        *   `/memory_edit`: Interactively edit/delete specific lines using Discord UI (Select Menus, Modals).
        *   Legacy `!memory [view|update|add|clear|edit]` commands are also supported.
*   **Multi-Model Reasoning:** Can switch to a secondary, potentially more powerful, LLM if the primary LLM includes a specific signal (`[REASON]`) in its response.
*   **Vision:** Supports sending images from messages to vision-capable LLMs.
*   **History:** Builds a conversation history by traversing message reply chains, configurable via `max_messages` in `config.yaml` (defaults to 25).
*   **Admin:** A single `/debug_sync_commands` command exists for admins to force slash command updates.
*   **Reply Handling Issue:** Bot currently triggers on *any* reply in a channel it sees (if not a DM or direct mention), not just replies *to the bot*. This can lead to incorrect activation and potentially mentioning the wrong user when responding.

## Proposed Plan for New Features

### 1. Configurable History (User/Channel Level)

*   **Goal:** Allow users or admins to set history length overrides per-user or per-channel.
*   **Steps:**
    *   **Database:** Add new tables/columns to the database (likely SQLite, managed by `MemoryStorage`) to store user/channel history length overrides.
    *   **Command:** Create a new slash command (e.g., `/config history [user|channel] [limit]`) with appropriate permissions (e.g., admin-only, or allow users to set their own).
    *   **Logic:** Modify `LLMCordBot.build_message_history` to:
        *   Check for a channel-specific override for the current channel.
        *   If none, check for a user-specific override for the triggering user.
        *   If none, use the global `max_messages` from `config.yaml`.
    *   **Documentation:** Update `docs/configuration.md` and potentially `docs/usage.md`.

### 2. Admin Stats & Commands

*   **Goal:** Provide administrators with insights into bot usage and more control.
*   **Steps:**
    *   **Stats Tracking:**
        *   Enhance logging or add database entries to track: LLM requests (count, user, provider, model), tokens used (if available), errors, memory operations, rate limits hit.
        *   Create `/admin stats [period]` command to display metrics.
    *   **Admin Commands:**
        *   Create `/admin memory [view|clear] <user_id>`: View/clear user memory.
        *   Create `/admin config reload`: Reload `config.yaml` without restart.
        *   Create `/admin ratelimit [view|reset] [user_id]`: Manage rate limits.
    *   Implement backend logic with permissions and safety checks.
    
### 4. Improved Reply Handling

*   **Goal:** Prevent activation on replies not directed at the bot and ensure appropriate mentioning.
*   **Steps:**
    *   **Trigger Logic:** Modify `LLMCordBot.on_message`:
        *   Inside the `if new_msg.reference:` check, fetch the referenced message.
        *   Change the condition to *only* proceed if the referenced message was fetched successfully AND its author is the bot itself.
    *   **Response Behavior:** Review `LLMCordBot.update_discord_response` to ensure `reply(mention_author=False)` or `channel.send()` is used appropriately to avoid unwanted pings.

## Mermaid Diagram of Proposed Flow

```mermaid
graph TD
    A[User Message Received (on_message)] --> B{Is DM?};
    B -- Yes --> F{Has Permission?};
    B -- No --> C{Bot Mentioned?};
    C -- Yes --> F;
    C -- No --> D{Is Reply?};
    D -- No --> X[Ignore Message];
    D -- Yes --> E{Fetch Referenced Msg};
    E -- Success --> E1{Referenced Author == Bot?};
    E -- Fail --> X;
    E1 -- Yes --> F;
    E1 -- No --> X;

    F -- Yes --> G[Process Message (process_message)];
    F -- No --> X;

    G --> H[Build History (build_message_history)];
    H --> H1{Check History Overrides (DB)};
    H1 -- User/Channel Override --> I[Use Override Value];
    H1 -- No Override --> J[Use Global Config Value];
    I --> K[Fetch Messages];
    J --> K;
    K --> L[Format for LLM];

    G --> M[Prepare System Prompt];
    G --> N[Call LLM Provider (with Tools if supported)];
    N --> O{Response Stream / Function Call?};

    subgraph Tool Handling
        O -- Function Call Detected --> P[Call ToolManager.execute];
        P --> Q[Format Tool Result];
        Q --> N; // Re-invoke LLM
        O -- Tool Tag Detected --> P; // Alternative trigger
    end

    O -- Normal Text --> R{Detect Memory Tags?};
    R -- Yes --> S[Process Memory Actions];
    R -- No --> T[Format Final Response];
    S --> T;
    T --> U[Send Response (update_discord_response)];

    subgraph Admin Features
        V[Admin Commands] --> W[Admin Logic (Stats, DB Access, Config Reload)];
    end

    subgraph User Config
        Y[/config history Command] --> Z[Store/Retrieve History Limit Override (DB)];
    end

    style X fill:#f9f,stroke:#333,stroke-width:2px
    style E1 fill:#ccf,stroke:#333,stroke-width:1px