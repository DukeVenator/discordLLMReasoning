# Memory Management Improvement Plan

This document outlines the plan to address several issues identified in the `llmcord` memory management system.

## Summary of Issues

1.  **Discord Character Limit:** The `/memory view` command truncates output at 2000 characters.
2.  **Lack of Condensation:** Memory is truncated when full, not intelligently condensed.
3.  **Suggestion Rehashing/Appending:** The default `append` mode for LLM-suggested memory updates leads to redundancy and bloating.
4.  **Lack of Granular Modification:** Only full memory replacement or clearing is possible via commands.

## Agreed-Upon Plan

The following sub-tasks will be implemented:

### 1. Sub-task: Fix Discord 2000 Character Limit

*   **Problem:** The `/memory view` command truncates output at 2000 characters due to Discord limits (`slash_commands.py`, line 48).
*   **Solution:** Modify the `/memory view` command in `llmcord/utils/slash_commands.py` to implement pagination. If the memory text exceeds ~1900 characters (allowing for Discord's formatting), send it in multiple, numbered ephemeral messages.

### 2. Sub-task: Implement Memory Condensation

*   **Problem:** When memory reaches `max_length`, it's simply truncated (`storage.py`, line 74). There's no intelligent condensation.
*   **Solution:**
    *   Introduce a new mechanism (e.g., a `/memory condense` command or an automatic trigger when `save_user_memory` detects approaching `max_length`).
    *   This mechanism will call an LLM with a specific prompt (e.g., "Summarize the following notes, removing redundancy and keeping the most important points, staying under {max_length - buffer} characters: {current_memory}").
    *   Save the condensed result back using `save_user_memory`.
    ```mermaid
    sequenceDiagram
        participant User
        participant Bot (Slash Command)
        participant MemoryStorage
        participant LLM

        User->>Bot (Slash Command): /memory condense
        Bot (Slash Command)->>MemoryStorage: get_user_memory(user_id)
        MemoryStorage-->>Bot (Slash Command): current_memory
        alt Memory Exceeds Threshold
            Bot (Slash Command)->>LLM: Condense this text: {current_memory}
            LLM-->>Bot (Slash Command): condensed_memory
            Bot (Slash Command)->>MemoryStorage: save_user_memory(user_id, condensed_memory)
            MemoryStorage-->>Bot (Slash Command): Success/Failure
            Bot (Slash Command)-->>User: Memory condensed successfully / Error
        else Memory OK
            Bot (Slash Command)-->>User: Memory is already concise.
        end
    ```

### 3. Sub-task: Address Rehashing/Appending in Suggestions (Using LLM Merge)

*   **Problem:** The `append` mode in `suggestions.py` (lines 73-75) adds LLM-generated suggestions (`[MEM_UPDATE]`) directly, leading to potential redundancy and bloating.
*   **Solution (Option B - LLM Merge):**
    *   Modify `process_and_save_suggestion` in `suggestions.py`. Instead of simple appending/replacing, when a suggestion is received:
        1.  Retrieve `current_memory`.
        2.  Call the LLM with a prompt like: "Merge the following new information into the existing notes, refining, deduplicating, and ensuring coherence. Existing Notes: {current_memory}. New Info: {suggestion}. Combined Notes:".
        3.  Save the LLM's merged output using `save_user_memory`.
    *   Review and refine the prompt that generates the LLM responses containing the `[MEM_UPDATE]` blocks to encourage more concise and less redundant suggestions.
    ```mermaid
     sequenceDiagram
        participant LLM (Chat Response)
        participant Bot (Suggestion Processor)
        participant MemoryStorage
        participant LLM (Merge)

        LLM (Chat Response)-->>Bot (Suggestion Processor): Response with [MEM_UPDATE]suggestion[/MEM_UPDATE]
        Bot (Suggestion Processor)->>Bot (Suggestion Processor): extract_suggestion()
        Bot (Suggestion Processor)->>MemoryStorage: get_user_memory(user_id)
        MemoryStorage-->>Bot (Suggestion Processor): current_memory
        Bot (Suggestion Processor)->>LLM (Merge): Merge Notes: {current_memory} + New Info: {suggestion}
        LLM (Merge)-->>Bot (Suggestion Processor): merged_memory
        Bot (Suggestion Processor)->>MemoryStorage: save_user_memory(user_id, merged_memory)
        MemoryStorage-->>Bot (Suggestion Processor): Success/Failure
     ```

### 4. Sub-task: Implement Granular Memory Modification

*   **Problem:** Currently, only full replacement (`/memory update`) or clearing is possible.
*   **Solution:** Introduce a new command, e.g., `/memory edit`.
    *   This command could take parameters like `search_text` and `replace_text`.
    *   It would retrieve the current memory, perform the search/replace operation, and save the modified memory back.
    ```mermaid
    sequenceDiagram
        participant User
        participant Bot (Slash Command)
        participant MemoryStorage

        User->>Bot (Slash Command): /memory edit search="old text" replace="new text"
        Bot (Slash Command)->>MemoryStorage: get_user_memory(user_id)
        MemoryStorage-->>Bot (Slash Command): current_memory
        Bot (Slash Command)->>Bot (Slash Command): Perform search & replace on current_memory
        Bot (Slash Command)->>MemoryStorage: save_user_memory(user_id, modified_memory)
        MemoryStorage-->>Bot (Slash Command): Success/Failure
        Bot (Slash Command)-->>User: Memory edited successfully / Error / Text not found