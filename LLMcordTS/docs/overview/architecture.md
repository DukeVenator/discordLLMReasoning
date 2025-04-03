# High-Level System Architecture

This document provides a high-level overview of the LLMcordTS bot's architecture.

## Core Concepts

The bot is designed around a modular architecture, separating concerns like Discord interaction, command processing, LLM communication, and state management.

*   **Event-Driven:** The bot primarily reacts to events received from the Discord Gateway (e.g., messages, slash commands).
*   **Command Pattern:** Slash commands are handled using a command pattern, with clear separation between command definitions and their execution logic.
*   **Provider Abstraction:** Interactions with different Large Language Models (LLMs) are abstracted through a provider pattern, allowing flexibility in choosing and switching LLMs.
*   **Stateful Memory:** The bot maintains conversation history and context using a memory management system, enabling more coherent interactions.
*   **Tool Integration:** The bot can leverage external tools (like calculators or web search) to enhance its capabilities.

## Key Components

*(Refer to `architecture/components.md` for a more detailed breakdown and diagram).*

1.  **Discord Interface (`discord/`)**: Handles raw communication with the Discord API, including receiving events and sending responses.
2.  **Processing Pipeline (`processing/`)**: Orchestrates the handling of incoming events, routing them to appropriate handlers (commands, reasoning, etc.).
3.  **Command Subsystem (`commands/`)**: Manages the definition and execution of bot commands.
4.  **Reasoning Engine (`reasoning/`)**: Handles more complex interactions that may require LLM reasoning beyond simple commands.
5.  **LLM Providers (`providers/`)**: Abstracts the communication with various LLM APIs.
6.  **Memory Manager (`memory/`)**: Manages the storage and retrieval of conversation history and context.
7.  **Tool Registry (`core/toolRegistry.ts`, `tools/`)**: Manages the available tools and their execution.

*(This section provides a brief overview. More details and diagrams can be found in the dedicated architecture documents.)*