# Data Model and Structures

This document outlines the key data structures and schemas used throughout the LLMcordTS application. The primary source of truth for these structures are the TypeScript type definitions located in the `src/types/` directory.

## Core Data Types

*   **Configuration (`src/types/config.ts`)**: Defines the structure of the bot's configuration, loaded from `config.yaml` or environment variables. This includes settings for Discord connection, LLM providers, memory, logging, etc.
    *   *Key Interfaces/Types:* `BotConfig`, `LLMProviderConfig`, `MemoryConfig`, etc.

*   **Messages & Interactions (`src/types/message.ts`, `src/types/discord.ts`)**: Defines structures representing incoming Discord messages and interactions, often extending or wrapping types from the Discord.js library. Includes context added by the bot during processing.
    *   *Key Interfaces/Types:* `ExtendedMessage`, `CommandContext`, `InteractionContext`.

*   **Memory (`src/types/memory.ts`, `src/types/messageNode.ts`)**: Defines the structures used for storing conversation history and context within the memory management system. This often involves representing messages, summaries, or user states.
    *   *Key Interfaces/Types:* `MemoryRecord`, `MessageNode`, `ConversationHistory`.

*   **Commands (`src/commands/definitions/`, `src/types/discord.ts`)**: While command logic resides in handlers, the structure of commands (name, description, options) is defined, often using types that align with Discord.js's command builders.
    *   *Key Interfaces/Types:* Structures related to `SlashCommandBuilder` options, potentially custom types for command arguments.

*   **Tools (`src/types/tools.ts`)**: Defines the interface and structures for tools that the bot can use, including their input parameters and output format.
    *   *Key Interfaces/Types:* `ToolDefinition`, `ToolInput`, `ToolOutput`.

## Data Flow

Data structures are passed between components as outlined in the [Message Flow](message_flow.md) and [Components](components.md) documents. For example:

1.  Raw Discord event data is received and potentially wrapped into internal context types (`InteractionContext`).
2.  Context and history (`ConversationHistory`, `MessageNode`) are retrieved from Memory.
3.  Command handlers receive context and arguments, potentially conforming to specific input types.
4.  LLM Providers receive structured prompts and return responses.
5.  Tool inputs and outputs adhere to their defined schemas (`ToolInput`, `ToolOutput`).
6.  Updated memory structures are saved.
7.  Response data is formatted for Discord.

## Source of Truth

For the most accurate and up-to-date definitions, always refer to the type definition files within the `src/types/` directory. This documentation provides a high-level overview and points to those key areas.