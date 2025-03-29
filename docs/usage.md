# Usage Guide

This guide explains how to interact with the LLMCord bot.

## Talking to the Bot

The primary way to get a response from the LLM is by directly interacting with the bot in a configured channel or DM (if allowed):

1.  **Mention the Bot:** Start your message by mentioning the bot (e.g., `@LLMCordBot What is the weather like?`).
2.  **Reply to the Bot:** Reply directly to one of the bot's previous messages.

The bot will process your message, potentially including recent conversation history and your saved memory notes (if enabled), and generate a response from the configured LLM.

## Using Vision Features

If the configured LLM supports vision (e.g., GPT-4 Vision, Gemini Pro Vision, Claude 3), you can include images in your prompts:

1.  **Attach Images:** Simply attach one or more images directly to your Discord message when you mention or reply to the bot.
2.  **Add Text Prompt:** Include your text prompt in the same message as the attachments.

The bot will send both the text and the image(s) to the LLM for processing.

*Note: Check the `supported_image_formats` in `config.yaml` for allowed image types.*

## Understanding Multimodel Reasoning

If `multimodel.enabled` is `true` in the configuration, the bot might use a secondary, more powerful LLM for complex tasks.

*   **Automatic Trigger:** This is usually triggered automatically. The primary LLM might include a special signal (like `[USE_REASONING_MODEL]`) in its *internal* thought process (not usually visible to you) if it determines the query requires deeper analysis.
*   **User Notification:** You might see a temporary message like "🧠 Thinking deeper..." while the reasoning model processes your request.
*   **Seamless Response:** The final response will come from the reasoning model, providing a more comprehensive answer.

This feature allows the bot to handle complex queries effectively while using a faster/cheaper model for standard interactions.

## Slash Commands

LLMCord uses Discord's slash commands for specific actions. Type `/` in a channel where the bot is present to see available commands. All memory-related command responses are ephemeral (only visible to you).

*(Memory commands are only available if `memory.enabled` is `true` in `config.yaml`)*

### `/memory`

Manage your persistent memory notes stored by the bot. This command performs bulk actions on your entire memory.

*   **Syntax:** `/memory action:<action> [content:<content>]`

*   **Parameters:**
    *   `action` (Required): What you want to do with your memory.
        *   `view`: Displays your current notes.
        *   `update`: **Replaces** your entire current notes with the provided `content`.
        *   `clear`: Deletes all of your notes.
    *   `content` (Optional): The text to save as your notes. **Required** when `action` is `update`. The maximum length is defined by `memory.max_memory_length` in the configuration.

*   **Examples:**
    *   `/memory action:view` - Shows your current notes.
    *   `/memory action:update content:My favorite color is blue. I prefer concise answers.` - Saves the provided text as your new notes, overwriting anything previous.
    *   `/memory action:clear` - Clears your notes.

### `/memory_edit`

Interactively edit or delete specific lines within your memory notes.

*   **Syntax:** `/memory_edit` (No parameters needed to start)

*   **Usage:**
    1.  Run `/memory_edit`.
    2.  The bot will display your current notes (up to a certain limit) with numbered lines and present a dropdown menu.
    3.  **Using the Dropdown:**
        *   Select a line number to **edit** that specific line. A modal (popup window) will appear for you to enter the new content for that line.
        *   Select the "🗑️ Delete a line..." option. A second dropdown will appear, allowing you to choose the specific line number to **delete**.
        *   Select "❌ Cancel" to exit the interactive session.
    4.  Follow the prompts to confirm deletions or submit edits.

*   **Note:** This command provides fine-grained control over your memory, allowing you to modify individual lines without replacing the entire content.

### `/debug_sync_commands`

*   **Description:** [Admin Only] Force sync slash commands with Discord.
*   **Permissions:** Requires Administrator permissions on the server.
*   **Usage:** This command is typically only needed if slash commands are not appearing correctly after an update or initial setup. Regular users do not need and cannot use this command.

## Legacy Prefix Commands

Older versions of the bot used prefix commands (like `!memory`). While some might still function (`!memory add`, `!memory edit`, `!forget`), using the **slash commands (`/memory`, `/memory_edit`) is recommended** as they provide a more user-friendly and standardized interface. The `!forget` command (if enabled via config) clears the bot's recent message history for the current channel/DM context.