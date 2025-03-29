# Usage Guide

This guide explains how to interact with the LLMCord bot.

## Talking to the Bot

The primary way to get a response from the LLM is by directly interacting with the bot in a configured channel or DM (if allowed):

1.  **Mention the Bot:** Start your message by mentioning the bot (e.g., `@LLMCordBot What is the weather like?`).
2.  **Reply to the Bot:** Reply directly to one of the bot's previous messages.

The bot will process your message, potentially including recent conversation history and your saved memory notes (if enabled), and generate a response from the configured LLM.

## Slash Commands

LLMCord uses Discord's slash commands for specific actions. Type `/` in a channel where the bot is present to see available commands.

### `/memory`

Manage your persistent memory notes stored by the bot. This command is only available if the `memory.enabled` setting is `true` in `config.yaml`. All responses from this command are ephemeral (only visible to you).

*   **Syntax:** `/memory action:<action> [content:<content>]`

*   **Parameters:**
    *   `action` (Required): What you want to do with your memory.
        *   `view`: Displays your current notes.
        *   `update`: Replaces your current notes with the provided `content`.
        *   `clear`: Deletes all of your notes.
    *   `content` (Optional): The text to save as your notes. Only used when `action` is `update`. The maximum length is defined by `memory.max_memory_length` in the configuration.

*   **Examples:**
    *   `/memory action:view` - Shows your current notes.
    *   `/memory action:update content:My favorite color is blue. I prefer concise answers.` - Saves the provided text as your notes.
    *   `/memory action:clear` - Clears your notes.

### `/debug_sync_commands`

*   **Description:** [Admin Only] Force sync slash commands with Discord.
*   **Permissions:** Requires Administrator permissions on the server.
*   **Usage:** This command is typically only needed if slash commands are not appearing correctly after an update or initial setup. Regular users do not need and cannot use this command.