# Project Structure

This document outlines the directory structure and key files within the LLMcordTS project.

## Directory Organization

```
LLMcordTS/
├── src/                      # Main source code directory
│   ├── index.ts              # Application entry point
│   ├── commands/             # Bot command definitions and handlers
│   │   ├── definitions/      # Slash command definitions (structure, options)
│   │   └── handlers/         # Logic for executing commands
│   ├── core/                 # Core bot functionalities (initialization, config, logging, tools)
│   ├── discord/              # Discord API interactions (event handling, responses, slash commands)
│   ├── memory/               # Conversation memory management
│   │   └── storage/          # Adapters for different memory storage backends (e.g., SQLite)
│   ├── processing/           # Message processing pipeline and logic
│   ├── providers/            # Integrations with different LLM providers (OpenAI, Gemini, Ollama)
│   ├── reasoning/            # Bot's reasoning and decision-making logic
│   ├── status/               # Bot status management (e.g., 'typing' indicators)
│   ├── tools/                # Tools the bot can use (e.g., calculator, web search)
│   ├── types/                # TypeScript type definitions and interfaces
│   └── utils/                # Utility functions (caching, permissions, rate limiting)
├── tests/                    # Automated tests (unit, integration)
├── docs/                     # Project documentation (you are here!)
├── node_modules/             # Project dependencies (managed by npm/yarn, not version controlled)
├── .eslintrc.json          # Configuration for ESLint (code linting)
├── .gitignore                # Specifies intentionally untracked files that Git should ignore
├── .prettierrc.json        # Configuration for Prettier (code formatting)
├── config-example.yaml     # Example configuration file
├── package.json              # Project metadata, dependencies, and scripts
├── tsconfig.json             # TypeScript compiler options
└── README.md                 # Main project README (different from docs/README.md)
```

## Key Files & Directories

*   **`src/index.ts`**: The main entry point for the application. Initializes the bot and starts the connection to Discord.
*   **`src/core/LLMCordBot.ts`**: Contains the main `LLMCordBot` class, orchestrating various components like command handling, message processing, and memory.
*   **`src/processing/MessageProcessor.ts`**: Handles the pipeline for processing incoming messages or interactions, deciding whether to invoke a command, use reasoning, etc.
*   **`src/discord/slashCommandHandler.ts`**: Specifically handles the registration and routing of Discord slash commands to their respective handlers.
*   **`src/discord/eventHandlers.ts`**: Manages listeners for various Discord gateway events (e.g., `messageCreate`, `interactionCreate`).
*   **`src/commands/definitions/`**: Defines the structure (name, description, options) of available slash commands.
*   **`src/commands/handlers/`**: Contains the implementation logic for each command.
*   **`src/providers/`**: Houses the logic for interacting with different LLM APIs.
*   **`src/memory/`**: Manages the bot's conversation history and context.
*   **`src/types/`**: Central location for shared TypeScript interfaces and types, ensuring consistency across the codebase.
*   **`config-example.yaml` / `config.yaml`**: Used for configuring bot settings like API keys, tokens, and behavior parameters. (Or environment variables).