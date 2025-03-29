# Memory Command Refactor Plan (v4)

This plan outlines the refactoring of the memory command system (`!memory` and `/memory`) for consistency, maintainability, and enhanced features.

## Goals

1.  **Consistency:** Ensure `!memory` commands behave similarly to `/memory` commands where applicable.
2.  **Maintainability:** Move memory command logic out of `bot.py` into a dedicated module.
3.  **Code Reuse:** Implement core memory operations in a shared handler class.
4.  **Enhanced UX:** Introduce an interactive edit/delete flow for both command types.

## Implementation Steps

1.  **Create New Module:**
    *   Create `llmcord/commands/memory_commands.py`.
    *   Define a `MemoryCommandHandler` class within this file.

2.  **Shared `MemoryCommandHandler` Class:**
    *   `__init__(self, bot)`: Takes the `bot` instance for access to config, memory\_store, etc.
    *   **Core Logic Methods:** Implement methods for:
        *   Fetching memory (`get_memory`).
        *   Saving/updating memory (`save_memory`, handling condensation via `memory_store`).
        *   Appending memory (`append_memory`, handling condensation via `memory_store`).
        *   Editing a specific chunk (`edit_chunk`, calling `save_memory`).
        *   Deleting a specific chunk (`delete_chunk`, reconstructing the memory string and calling `save_memory`).
        *   Splitting memory into displayable chunks/lines (`split_memory_for_display`).
        *   Helper for sending chunked messages (adapting based on context: message reply vs. interaction followup).
    *   **Interactive Session Logic:** Implement methods to manage the interactive edit/delete flow:
        *   `start_interactive_session(context)`: Takes a context object (either `discord.Message` or `discord.Interaction`) to determine how to interact (Reactions vs. Buttons/Selects/Modals).
        *   Handles displaying chunks, adding interactive elements, waiting for user input (reactions, button clicks, messages, modal submissions), and calling core edit/delete methods.

3.  **Refactor `bot.py`:**
    *   Import `MemoryCommandHandler`.
    *   Instantiate it in `LLMCordBot` (e.g., `self.memory_command_handler = MemoryCommandHandler(self)`).
    *   In `on_message`, delegate `!memory` commands to `self.memory_command_handler.handle_legacy_command(message, args)`.
    *   Remove the old `handle_memory_command` method from `LLMCordBot`.

4.  **`MemoryCommandHandler.handle_legacy_command(message, args)`:**
    *   Parses `args` for subcommand (`view`, `update`, `clear`, `add`, `edit`).
    *   If invalid/missing args, sends a help message via `message.reply`.
    *   Calls appropriate core logic methods (`handle_view`, `handle_update`, etc.).
    *   `handle_update`, `handle_clear`: Use **Reaction Confirmation** before calling save methods.
    *   `handle_edit`: Calls `start_interactive_session(message)` which uses **Reactions** for interaction and includes a 🗑️ option leading to `delete_chunk` (with reaction confirmation).

5.  **Refactor `slash_commands.py`:**
    *   Ensure the `SlashCommandHandler` has access to the `MemoryCommandHandler` instance (e.g., via `self.bot.memory_command_handler`).
    *   `/memory view`: Calls `memory_command_handler.handle_view(interaction)`.
    *   `/memory update`: Calls `memory_command_handler.handle_update(interaction, content)` (no reaction confirmation needed).
    *   `/memory clear`: Calls `memory_command_handler.handle_clear(interaction)` (no reaction confirmation needed).
    *   `/memory_edit`: Calls `memory_command_handler.start_interactive_session(interaction)`. This uses **Buttons/Select Menus/Modals** on ephemeral messages for interaction and includes a 🗑️ option leading to `delete_chunk` (confirmation might be via Modal or a followup Button).

## Interaction Flow Differences

*   **`!memory edit`:** Uses **Reactions** on standard messages for selecting chunks and confirming actions.
*   **`/memory_edit`:** Uses **Buttons/Select Menus/Modals** on ephemeral messages for selecting chunks and confirming actions.

## Diagram

```mermaid
graph TD
    subgraph bot.py
        A[on_message] --> B{Is `!memory`?};
        B -- Yes --> C[Delegate to MemoryCommandHandler.handle_legacy_command];
        B -- No --> Y[Normal Processing];
    end

    subgraph llmcord/commands/memory_commands.py (MemoryCommandHandler)
        C --> D[handle_legacy_command: Parse args];
        D --> D1{Valid Command?};
        D1 -- No --> D2[Send Help];
        D1 -- Yes --> E{Subcommand?};
        E -- view --> F[handle_view];
        E -- update --> G[handle_update (with Reaction Confirm)];
        E -- clear --> H[handle_clear (with Reaction Confirm)];
        E -- add --> I[handle_add];
        E -- edit --> J[start_interactive_session(message)];

        SlashCMDs[/memory commands] --> SC1[Call appropriate handler methods];
        SC1 -- /memory_edit --> SC2[start_interactive_session(interaction)];
    end

    subgraph Interactive Session (within start_interactive_session)
        direction LR
        J_or_SC2[Input: message or interaction] --> K[Fetch Memory];
        K --> L{Memory Exists?};
        L -- No --> M[Reply "No memory"];
        L -- Yes --> N[Split into numbered lines/chunks];
        N --> O[Send chunks + Interactive Elements (Reactions or Buttons/Selects)];
        O --> P[Wait for user input];
        P --> Q{Input Type?};
        Q -- Cancel --> R[Send "Cancelled"];
        Q -- Select Chunk (Number/Button) --> S[Call _handle_interactive_edit];
        Q -- Select Delete (🗑️ Reaction/Button) --> T[Call _handle_interactive_delete];
    end

    subgraph _handle_interactive_edit
        direction LR
        S --> S1[Prompt for replacement (Message or Modal)];
        S1 --> S2[Wait for input];
        S2 --> S3{Received?};
        S3 -- Yes --> S4[Get replacement text];
        S4 --> S5{Length OK?};
        S5 -- Yes --> S6[Optional: Final Confirm (Reaction or Button/Modal)];
        S6 --> S7{Confirmed?};
        S7 -- Yes --> S8[Call core edit_chunk method];
        S8 --> S9[Send Success/Error];
        S7 -- No/Timeout --> R;
        S5 -- No --> S10[Send "Too long", cancel];
        S3 -- Timeout --> R;
    end

    subgraph _handle_interactive_delete
        direction LR
        T --> T1[Ask Confirm Delete (Reaction or Button/Modal)];
        T1 --> T2{Confirmed?};
        T2 -- Yes --> T3[Call core delete_chunk method];
        T3 --> T4[Send Success/Error];
        T2 -- No/Timeout --> R;
    end

    style R fill:#fcc,stroke:#333,stroke-width:2px
    style S10 fill:#fcc,stroke:#333,stroke-width:2px
    style M fill:#ffc,stroke:#333,stroke-width:2px
    style S9 fill:#cfc,stroke:#333,stroke-width:2px
    style T4 fill:#cfc,stroke:#333,stroke-width:2px