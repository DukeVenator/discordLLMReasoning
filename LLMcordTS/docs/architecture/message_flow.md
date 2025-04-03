# Message Processing Flow

## Overview

This document explains the typical journey of a user interaction (like a slash command or potentially a message) through the LLMcordTS bot system, from initial receipt to the final response sent back to the user.

## Flow Diagram

```mermaid
sequenceDiagram
    participant User
    participant DiscordGateway
    participant EventHandler
    participant SlashHandler
    participant LLMCordBot as BotCore
    participant MsgProcessor
    participant CmdHandler
    participant LLMProvider
    participant MemoryMgr
    participant ToolRegistry
    participant ReasoningMgr
    participant ResponseMgr

    User->>DiscordGateway: Sends Interaction / Message
    DiscordGateway->>EventHandler: InteractionCreate / MessageCreate Event

    alt Interaction (Slash Command / Autocomplete)
        note right of EventHandler: InteractionCreate event received
        EventHandler->>SlashHandler: handleInteraction(interaction)
        alt Autocomplete Request
            note right of SlashHandler: interaction.isAutocomplete() is true
            SlashHandler->>SlashHandler: Handle Autocomplete (e.g., config)
            SlashHandler-->>EventHandler: Autocomplete Response Sent (via interaction.respond)
            note left of DiscordGateway: Response handled internally by Discord.js
        else Chat Input Command
            note right of SlashHandler: interaction.isChatInputCommand() is true
            SlashHandler->>CmdHandler: Execute Command (via map or memory handler)
            note right of CmdHandler: Includes LLM/Tool use if needed by command
            CmdHandler->>LLMProvider: Request Completion / Reasoning (Optional)
            CmdHandler->>ToolRegistry: Execute Tool (Optional)
            ToolRegistry-->>CmdHandler: Tool Result
            LLMProvider-->>CmdHandler: LLM Response
            note right of CmdHandler: Response sent via interaction.reply/followUp
            CmdHandler->>ResponseMgr: Format Response Data (Implicit)
            ResponseMgr->>DiscordGateway: Send Response (via interaction reply/followUp)
        end
    else MessageCreate Event (Regular Message)
        note right of EventHandler: MessageCreate event received
        EventHandler->>EventHandler: Apply Filters (Bot?, Empty?, DM/Mention/Reply?, Rate Limit?, Perms?)
        alt Message Passes Filters
            EventHandler->>BotCore: processMessage(message)
            BotCore->>ResponseMgr: sendInitialResponse() (e.g., "Thinking...")
            BotCore->>MsgProcessor: buildMessageHistory(message)
            note right of MsgProcessor: Traverses reply chain, uses cache, processes attachments
            MsgProcessor-->>BotCore: Formatted History & Warnings
            BotCore->>MemoryMgr: getUserMemory(userId)
            MemoryMgr-->>BotCore: User Memory Data
            note right of BotCore: Format System Prompt (with memory)
            BotCore->>LLMProvider: generateStream(Formatted History, System Prompt, Tools?)
            loop LLM Stream Processing
                LLMProvider-->>BotCore: Stream Chunk (Content / Tool Call / Final)
                opt Content Chunk
                    BotCore->>ResponseMgr: updateResponse(Chunk Content)
                end
                opt Tool Call Chunk
                    note right of BotCore: Tool call(s) detected
                    BotCore->>ToolRegistry: executeTool(Tool Name, Args)
                    ToolRegistry-->>BotCore: Tool Result
                    note right of BotCore: Add Tool Request & Result to History
                    BotCore->>LLMProvider: generateStream(Updated History, System Prompt)
                    note right of BotCore: Process second stream...
                end
                opt Final Chunk
                    note right of BotCore: Stream finished (Reason: Stop, Length, Error, etc.)
            end
            note right of BotCore: Check final response for Reasoning Signal
            opt Reasoning Signal Detected
                BotCore->>ReasoningMgr: generateReasoningResponse(History, Prompt)
                ReasoningMgr-->>BotCore: Reasoning Response Stream
                loop Reasoning Stream Processing
                    BotCore->>ResponseMgr: updateResponse(Reasoning Chunk Content)
                end
            end
            note right of BotCore: Process Memory Suggestions (Async)
            BotCore->>MemoryMgr: processMemorySuggestions(userId, Final Response)
            BotCore->>ResponseMgr: finalize()
            ResponseMgr->>DiscordGateway: Send/Edit Final Response
        else Message Filtered
            EventHandler-->>DiscordGateway: (No Action or Rate Limit Reply)
        end
    end

    DiscordGateway->>User: Display Response / Autocomplete
```

## Detailed Flow Steps

1.  **Interaction/Message Receipt:**
    *   The Discord Gateway sends an event (e.g., `InteractionCreate` for slash commands, `MessageCreate` for messages) to the bot.
    *   The corresponding listener in `discord/eventHandlers.ts` receives the event.

2.  **Initial Event Handling (`discord/eventHandlers.ts`):**
    *   **`InteractionCreate`:** This event (for slash commands, autocomplete, buttons, etc.) is received. The handler likely passes the `Interaction` object directly to `SlashCommandHandler.handleInteraction`.
    *   **`MessageCreate`:** This event for regular messages is received. The `onMessageCreate` handler performs several checks:
        *   Ignores bots and empty messages.
        *   Filters based on context (DM vs. Guild, Mention vs. Reply) according to `config.discord.allowDms`.
        *   Applies rate limiting (`RateLimiter`).
        *   Checks bot permissions in the channel (`utils/permissions`).
        *   If the message passes all filters, it calls `bot.processMessage(message)` (the main bot logic).

3.  **Slash Command / Autocomplete Handling (`discord/slashCommandHandler.ts`):**
    *   Receives the `Interaction` object from the event handler.
    *   **Autocomplete:** If `interaction.isAutocomplete()`, it identifies the command (e.g., `/config`) and calls the specific autocomplete logic (e.g., `handleConfigAutocomplete`) which responds directly via `interaction.respond()`.
    *   **Chat Input Command:** If `interaction.isChatInputCommand()`, it extracts the `commandName`.
        *   It routes the command to the correct handler: either the dedicated `MemoryCommandHandler` (for `/memory`, `/forget`) or a handler found in its internal map (for `/ping`, `/help`, `/config`).
        *   The chosen handler is executed, receiving the `interaction` object.

4.  **Command Handler Execution (`commands/handlers/*` or `MemoryCommandHandler`):**
    *   The specific command handler (e.g., `handlePing`, `handleMemoryCommand`) executes its logic using the interaction object to access options and context.
    *   **LLM/Tool Interaction:** The handler *may* interact with `LLMProvider` or `ToolRegistry` as needed to fulfill the command's purpose.
    *   **Response:** The handler is responsible for responding to the interaction using `interaction.reply()`, `interaction.followUp()`, or `interaction.deferReply()`. It implicitly uses the `ResponseManager` for formatting and sending.

5.  **History Building (`processing/MessageProcessor.ts`):**
    *   Called by the main bot logic (e.g., `LLMCordBot.processMessage`) for regular messages that passed filters.
    *   Receives the latest `Message` object.
    *   **`buildMessageHistory`:** Traverses the message reply chain backwards.
        *   Uses a cache (`messageNodeCache`) to avoid reprocessing messages.
        *   Processes each message (`processMessageNode`): cleans text, handles image attachments (fetching, encoding, checking provider support/limits), determines role, fetches parent.
        *   Formats the processed nodes into a `ChatMessage` array suitable for the LLM, considering provider capabilities (vision, usernames) and config limits (history length, images, text length).
        *   Returns the formatted `history` array and any `warnings` (e.g., truncation).

6.  **Core Message Orchestration (`LLMCordBot.processMessage`):**
    *   Receives the filtered `Message` object from `onMessageCreate`.
    *   Sends an initial placeholder response (e.g., "Thinking...") via `ResponseManager`.
    *   Calls `MessageProcessor.buildMessageHistory` to get the formatted context/history and warnings.
    *   Fetches user-specific memory data from `MemoryManager`.
    *   Formats the base system prompt, potentially incorporating the fetched user memory.
    *   Prepares generation options (temperature, max tokens) and includes tool definitions if the provider supports them.
    *   Calls `LLMProvider.generateStream` with the history, system prompt, and options.
    *   **Processes the LLM stream:**
        *   Updates the Discord message incrementally via `ResponseManager.updateResponse`.
        *   **Tool Call Handling:** If a tool call is detected in the stream:
            *   Adds the assistant's tool request message to the history.
            *   Executes the requested tool(s) via `ToolRegistry`.
            *   Adds the tool result message(s) to the history.
            *   Calls `LLMProvider.generateStream` *again* with the updated history.
            *   Processes the second stream response.
        *   **Reasoning Check:** After the stream(s) complete, checks the final accumulated response for a reasoning signal (e.g., `[USE_REASONING_MODEL]`).
            *   If detected (and not rate-limited), calls `ReasoningManager.generateReasoningResponse`.
            *   Processes the reasoning stream, updating the response via `ResponseManager`.
            *   Updates the final response content with the reasoning result.
    *   **Memory Suggestion Processing:** Asynchronously calls `MemoryManager.processMemorySuggestions` with the final response text to handle `[MEM_APPEND]` or `[MEM_REPLACE]` tags.
    *   Finalizes the response message via `ResponseManager.finalize`.
    *   Includes robust error handling throughout the process.

7.  **Response Delivery (`ResponseManager.ts`):**
    *   Formats the final response content (from command handlers or the core logic) into Discord messages (text, embeds, etc.).
    *   Interacts with the Discord API (via Discord.js client) to send the response. For slash commands, this uses `interaction.reply/followUp`; for regular messages, it uses `message.reply` or `channel.send`.

## Error Handling

Errors can occur at various stages (event handling, command execution, history building, LLM interaction, response sending). The general approach is:
*   Log errors using the configured logger (`core/logger.ts`).
*   Use try/catch blocks within handlers and core logic to prevent crashes.
*   Send informative error messages back to the user via interaction replies or message replies when appropriate (e.g., "Sorry, something went wrong...").