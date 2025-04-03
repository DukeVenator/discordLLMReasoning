# Bot Commands Reference

This document provides a reference for the slash commands available in the LLMcordTS bot. Command definitions are located in `src/commands/definitions/` and their logic in `src/commands/handlers/`.

## Available Commands

### `/ping`

*   **Description:** Replies with Pong! A simple command to check if the bot is responsive.
*   **Usage:** `/ping`
*   **Options:** None

### `/help`

*   **Description:** Displays information about available commands.
*   **Usage:** `/help`
*   **Options:** None

### `/forget`

*   **Description:** Clear your entire persistent memory associated with the bot. This is an alternative to `/memory forget`.
*   **Usage:** `/forget`
*   **Options:** None
*   **Note:** Requires the memory feature to be enabled (`memory.enabled: true` in config).

### `/memory`

*   **Description:** Manage your persistent memory with the bot. Allows viewing, adding, replacing, editing, and deleting memory entries.
*   **Usage:** `/memory <subcommand> [options]`
*   **Note:** Requires the memory feature to be enabled (`memory.enabled: true` in config).
*   **Subcommands:**
    *   **`show`**
        *   **Description:** Show your current memory content. The response is typically ephemeral (only visible to you).
        *   **Usage:** `/memory show`
        *   **Options:** None
    *   **`append`**
        *   **Description:** Append text to your current memory.
        *   **Usage:** `/memory append text:<your text>`
        *   **Options:**
            *   `text` (String, Required): The text content to append to your memory.
    *   **`replace`**
        *   **Description:** Replace your entire memory with new text. This deletes all previous entries and adds the new text as a single entry.
        *   **Usage:** `/memory replace text:<new memory content>`
        *   **Options:**
            *   `text` (String, Required): The new content for your memory.
    *   **`forget`**
        *   **Description:** Clear your entire memory. Deletes all entries associated with your user ID.
        *   **Usage:** `/memory forget`
        *   **Options:** None
    *   **`edit`**
        *   **Description:** Edit the content of a specific memory entry using its unique ID.
        *   **Usage:** `/memory edit id:<memory_entry_id> content:<new content>`
        *   **Options:**
            *   `id` (String, Required): The ID of the memory entry to edit (obtained typically via `/memory show` or similar).
            *   `content` (String, Required): The new text content for the memory entry.
    *   **`delete`**
        *   **Description:** Delete a specific memory entry using its unique ID.
        *   **Usage:** `/memory delete id:<memory_entry_id>`
        *   **Options:**
            *   `id` (String, Required): The ID of the memory entry to delete.
    *   **`view`**
        *   **Description:** View the content of a specific memory entry by its ID. The response is typically ephemeral.
        *   **Usage:** `/memory view id:<memory_entry_id>`
        *   **Options:**
            *   `id` (String, Required): The ID of the memory entry to view.

### `/config`

*   **Description:** View or modify bot configuration settings (runtime settings, not the YAML file directly).
*   **Usage:** `/config <subcommand> [options]`
*   **Permissions:** Requires the 'Manage Server' (`ManageGuild`) permission. Cannot be used in DMs.
*   **Subcommands:**
    *   **`view`**
        *   **Description:** View the current value of a configuration setting.
        *   **Usage:** `/config view [setting:<setting_name>]`
        *   **Options:**
            *   `setting` (String, Optional, Autocomplete): The configuration setting to view (e.g., `defaultProvider`, `logLevel`). If omitted, might show all viewable settings. Autocomplete suggests available settings.
    *   **`set`**
        *   **Description:** Set the value of a modifiable configuration setting.
        *   **Usage:** `/config set setting:<setting_name> value:<new_value>`
        *   **Options:**
            *   `setting` (String, Required, Autocomplete): The configuration setting to modify (e.g., `defaultProvider`, `logLevel`). Autocomplete suggests available settings.
            *   `value` (String, Required): The new value for the setting.

---
*(Note: This documentation should be kept up-to-date as commands are added, removed, or modified.)*