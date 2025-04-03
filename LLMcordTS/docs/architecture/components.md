# Major System Components

This document describes the primary components of the LLMcordTS bot and their responsibilities.

## Component Diagram

```mermaid
graph TD
    subgraph User Interface
        UI[Discord Client]
    end

    subgraph "Bot Backend (LLMcordTS)"
        A[Discord Gateway Listener] --> B(Event Handlers);

        B -- InteractionCreate --> D[Slash Command Handler];
        B -- MessageCreate --> BC[LLMCordBot Core Logic];

        D -- Autocomplete --> D;
        D --> J[Command Handlers];

        BC --> F[Message Processor]; # Calls buildMessageHistory
        F --> BC; # Returns history/warnings

        BC --> I[Memory Manager]; # Fetches memory, processes suggestions, stores context
        I -- Read/Write --> N[(Memory Storage)];

        BC --> K[LLM Providers]; # Calls generateStream
        K --> BC; # Returns stream chunks

        BC --> L[Tool Registry]; # Executes tool calls detected in stream
        L --> BC; # Returns tool results

        BC --> H[Reasoning Manager]; # Calls if reasoning signal detected
        H --> BC; # Returns reasoning stream

        BC --> O[Response Manager]; # Sends initial, updates, finalizes response

        J --> K; # Command Handlers may call LLM Providers
        J --> L; # Command Handlers may use Tools
        J --> O; # Command Handlers send response via Interaction
        L --> M[Tools];

        subgraph Response Handling
            O[Response Manager]
        end

        O --> A; # Sending response back via Gateway
    end

    UI --> A; # User sends message/interaction
    A --> UI; # Bot sends response
```

## Component Descriptions

*   **Discord Gateway Listener / Event Handlers (`discord/eventHandlers.ts`)**:
    *   Establishes and maintains the WebSocket connection to the Discord Gateway via Discord.js client.
    *   Listens for key Discord events:
        *   `ready`: Initializes components like `MessageProcessor`, starts `StatusManager`, registers slash commands via `SlashCommandHandler`.
        *   `messageCreate`: Handles regular messages. Applies filters (ignore bots, empty messages, non-mention/reply/DM based on config, rate limits, permissions). If filters pass, calls `bot.processMessage()` (handing off to the main `LLMCordBot` core logic).
        *   `interactionCreate`: (Implicitly handled, likely by the main bot class or client listener) Passes the interaction object to `SlashCommandHandler.handleInteraction`.

*   **Slash Command Handler (`discord/slashCommandHandler.ts`)**:
    *   **Registration:** Dynamically loads command definitions (`.toJSON()`) from `src/commands/definitions/` on startup (`registerCommands` method, called by `onReady`). Registers commands globally or per-guild via Discord API.
    *   **Interaction Handling (`handleInteraction`):** Receives `Interaction` objects.
        *   **Autocomplete:** Identifies autocomplete interactions (`isAutocomplete`) and routes them to specific autocomplete functions (e.g., `handleConfigAutocomplete`).
        *   **Chat Input Commands:** Identifies slash commands (`isChatInputCommand`). Routes the command to the correct handler function based on `interaction.commandName`:
            *   Uses a dedicated `MemoryCommandHandler` instance for `/memory` and `/forget`.
            *   Uses an internal map for other commands (`/ping`, `/help`, `/config`).
        *   Executes the chosen handler, passing the `ChatInputCommandInteraction`.
        *   Includes error handling and replies to the interaction.

*   **Message Processor (`processing/MessageProcessor.ts`)**:
    *   **Role:** Primarily responsible for **building and formatting message history** for LLM input, specifically for regular message conversations. It does *not* handle the overall orchestration or LLM calls for these messages.
    *   **Functionality (`buildMessageHistory`):**
        *   Receives the latest `Message` object (likely called by `LLMCordBot.processMessage`).
        *   Traverses the message reply chain backwards.
        *   Uses a cache (`messageNodeCache`) to optimize processing.
        *   Processes each message node (`processMessageNode`): cleans text, handles image attachments (fetching, encoding, checking provider support/limits), determines role, fetches parent message.
        *   Formats the history into a `ChatMessage` array suitable for the configured `LLMProvider`, considering provider capabilities and config limits.
        *   Returns the formatted `history` array and any `warnings` (e.g., truncation) to the caller (likely `LLMCordBot`).

*   **Command Handlers (`commands/handlers/`, `MemoryCommandHandler`)**:
    *   Contains the specific logic for executing each slash command (e.g., `pingHandler`, `helpHandler`, `configHandler`, `memoryCommandHandler`).
    *   Invoked by the `SlashCommandHandler`.
    *   Receives the `ChatInputCommandInteraction` object to access options, user info, and channel context.
    *   Performs the command's actions, potentially interacting with `LLM Providers`, `Tool Registry`, or `Memory Manager`.
    *   Responsible for sending the response back to Discord via the `interaction` object (e.g., `interaction.reply`, `interaction.followUp`).

*   **Reasoning Manager (`reasoning/`)**:
    *   Handles more complex interactions that require LLM reasoning beyond simple command execution.
    *   May involve multi-step thought processes or dynamic decision-making based on context and LLM responses.
    *   Interacts with `LLM Providers` and `Memory Manager`.

*   **Memory Manager (`memory/MemoryManager.ts`)**:
    *   **Role:** Manages user-specific persistent memory, acting as an intermediary between the core logic/commands and the storage adapter.
    *   **Functionality:**
        *   Retrieves memory entries for a user (`getUserMemory`) from the storage adapter.
        *   Formats fetched memories for inclusion in the LLM system prompt (`formatSystemPrompt`), adding configured prefixes.
        *   Processes LLM response text for memory suggestion tags (`processMemorySuggestions`), parsing `[MEM_APPEND]` and `[MEM_REPLACE]` tags (using configured markers) and calling appropriate storage methods (`addMemory`, `replaceMemory`). This runs asynchronously.
        *   Provides manual CRUD operations (Create, Read, Update, Delete) for memory entries (`addMemory`, `replaceMemory`, `clearUserMemory`, `getMemoryById`, `updateMemoryById`, `deleteMemoryById`), which interact with the underlying `IMemoryStorageAdapter`.
    *   **Dependencies:** Requires an `IMemoryStorageAdapter` (e.g., `SQLiteMemoryAdapter`), `Config`, and `Logger`.
    *   **Note:** Does *not* directly manage short-term conversation history for LLM context; that is handled by `MessageProcessor`. This manager focuses on persistent, long-term notes/facts about users.

*   **LLM Providers (`providers/`)**:
    *   Abstracts the communication details for different LLM APIs (OpenAI, Gemini, Ollama, etc.).
    *   Provides a consistent interface for making requests (e.g., completions, chat) to the configured LLM.
    *   Handles API key management and request formatting.

*   **Tool Registry / Tools (`core/toolRegistry.ts`, `tools/`)**:
    *   `Tool Registry`: Manages the collection of available tools.
    *   `Tools`: Individual modules representing specific capabilities the bot can use (e.g., calculator, web search, code execution). Tools are often invoked by command handlers or the reasoning manager, potentially based on LLM suggestions.

*   **Response Manager (`discord/ResponseManager.ts`)**:
    *   Takes processed results and formats them into appropriate Discord messages (text, embeds, ephemeral replies).
    *   Handles message sending, editing, and potential pagination or chunking of long responses.
    *   Interacts with the Discord API via the Gateway Listener/Discord.js client.

*   **Core (`core/LLMCordBot.ts`, etc.)**:
    *   **`LLMCordBot.ts`:** The main class orchestrating the bot's lifecycle and core logic.
        *   **Initialization (`initialize`):** Instantiates and wires together all major components: Discord Client, Config, Logger, StatusManager, SlashCommandHandler, RateLimiter, ProviderFactory, LLMProvider, ToolRegistry, MemoryStorage (adapter), MemoryManager, MemoryCommandHandler, ReasoningManager.
        *   **Event Registration (`registerEventHandlers`):** Connects Discord client events (`ready`, `messageCreate`, `interactionCreate`) to their respective handlers (`eventHandlers.ts`, `SlashCommandHandler`).
        *   **Message Orchestration (`processMessage`):** This complex method handles the end-to-end flow for regular messages received via `onMessageCreate`:
            *   Initiates response handling via `ResponseManager`.
            *   Calls `MessageProcessor.buildMessageHistory` to get formatted history/context.
            *   Fetches user memory via `MemoryManager`.
            *   Formats the system prompt (potentially including memory).
            *   Calls `LLMProvider.generateStream`, passing history, system prompt, and tool definitions.
            *   Processes the response stream, updating the Discord message via `ResponseManager`.
            *   Handles **Tool Calls** detected in the stream by: executing the tool via `ToolRegistry`, adding results to history, and re-calling the LLM provider with the updated context.
            *   Checks the final LLM response for a **Reasoning Signal**. If found, invokes `ReasoningManager` to generate a more detailed response, processing its stream and updating the final output.
            *   Asynchronously processes **Memory Suggestions** (`[MEM_APPEND]`, `[MEM_REPLACE]`) found in the final response via `MemoryManager`.
            *   Finalizes the response message via `ResponseManager`.
        *   **Tool Execution (`_executeToolCall`):** Helper method called during `processMessage` to execute tools via `ToolRegistry`.
        *   **Lifecycle (`run`, `shutdown`):** Handles bot login and graceful shutdown (including closing memory storage).
    *   **Other Core Files:** Include configuration loading (`config.ts`), logging (`logger.ts`), tool registry (`toolRegistry.ts`).