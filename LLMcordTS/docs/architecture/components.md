# Major System Components

This document describes the primary components of the LLMcordTS bot and their responsibilities.

## Component Diagram

```mermaid
graph TD
    subgraph User Interface
        UI[Discord Client]
    end

    subgraph Bot Backend (LLMcordTS)
        A[Discord Gateway Listener] --> B(Event Handlers);
        B --> C{Interaction Router};
        C -- Command --> D[Slash Command Handler];
        C -- Other Events --> E[Other Event Handlers];

        D --> F[Message Processor];
        E --> F;

        F --> G[Command Executor];
        F --> H[Reasoning Manager];
        F --> I[Memory Manager];

        G --> J[Command Handlers];
        J --> K[LLM Providers];
        J --> L[Tool Registry];
        L --> M[Tools];

        H --> K;
        H --> I;

        I -- Read/Write --> N[(Memory Storage)];

        subgraph Response Handling
            O[Response Manager]
        end

        J --> O;
        H --> O;
        F --> O;

        O --> A;
    end

    UI --> A;
    A --> UI;
```

## Component Descriptions

*   **Discord Gateway Listener / Event Handlers (`discord/`)**:
    *   Establishes and maintains the WebSocket connection to the Discord Gateway.
    *   Listens for incoming events (interactions, messages, presence updates, etc.).
    *   Initial parsing and validation of events.
    *   Routes events to the appropriate internal handlers (e.g., `Slash Command Handler`, `Message Processor`).

*   **Interaction Router / Slash Command Handler (`discord/`)**:
    *   Specifically handles `InteractionCreate` events, particularly for slash commands.
    *   Parses command names and arguments.
    *   Validates command structure.
    *   Routes valid command interactions to the `Message Processor`.

*   **Message Processor (`processing/MessageProcessor.ts`)**:
    *   Acts as a central orchestrator for handling user requests (commands or messages).
    *   Retrieves necessary context from the `Memory Manager`.
    *   Determines the appropriate action (e.g., execute a command, invoke reasoning).
    *   Invokes `Command Handlers` or the `Reasoning Manager`.
    *   Coordinates storing updated context back into `Memory Manager`.
    *   Passes results to the `Response Manager`.

*   **Command Executor / Command Handlers (`commands/`)**:
    *   `definitions/`: Defines the structure, names, descriptions, and options for all available slash commands.
    *   `handlers/`: Contains the specific logic for executing each command. Handlers receive parsed arguments and context, perform actions (potentially calling LLMs or Tools), and return results.

*   **Reasoning Manager (`reasoning/`)**:
    *   Handles more complex interactions that require LLM reasoning beyond simple command execution.
    *   May involve multi-step thought processes or dynamic decision-making based on context and LLM responses.
    *   Interacts with `LLM Providers` and `Memory Manager`.

*   **Memory Manager (`memory/`)**:
    *   Manages the bot's short-term and long-term memory.
    *   Provides an interface for storing and retrieving conversation history, user preferences, or other contextual data.
    *   Uses storage adapters (`memory/storage/`) like SQLite to persist memory.

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

*   **Core (`core/`)**:
    *   Contains essential setup and shared functionalities like bot initialization (`LLMCordBot.ts`), configuration loading (`config.ts`), and logging (`logger.ts`).