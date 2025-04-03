# Bot Tools Reference

This document describes the tools available to the LLMcordTS bot, which can be invoked by command handlers or the reasoning engine, often guided by LLM suggestions. Tools extend the bot's capabilities beyond simple text generation.

## Overview

Tools are managed by the `ToolRegistry` (`src/core/toolRegistry.ts`), and individual tool implementations are located in the `src/tools/` directory. The structure and interface for tools, including their definition format (used by LLMs), are defined in `src/types/tools.ts`.

When an LLM decides to use a tool, it typically includes a `tool_calls` section in its response. The `LLMCordBot` core logic detects this, executes the requested tool via the `ToolRegistry`, adds the tool's result back into the conversation history (with `role: 'tool'`), and then calls the LLM again with the updated history.

## Available Tools

### 1. Simple Calculator (`src/tools/calculatorTool.ts`)

*   **Tool Name (for LLM):** `simple_calculator`
*   **Description:** Performs basic arithmetic operations (add, subtract, multiply, divide).
*   **Parameters (JSON Schema):**
    ```json
    {
      "type": "object",
      "properties": {
        "operation": {
          "type": "string",
          "enum": ["add", "subtract", "multiply", "divide"],
          "description": "The arithmetic operation to perform."
        },
        "operand1": {
          "type": "number",
          "description": "The first number."
        },
        "operand2": {
          "type": "number",
          "description": "The second number."
        }
      },
      "required": ["operation", "operand1", "operand2"]
    }
    ```
*   **Execution Logic:** Takes the operation and two operands. Performs the calculation.
*   **Output:** Returns the numerical result of the calculation. Returns an error string `Error: Division by zero` if division by zero is attempted or `Error: Unknown operation '...'` for invalid operations. The raw number or error string is returned (it will be stringified before being sent back to the LLM in the 'tool' role message).

### 2. Web Search (`src/tools/webSearchTool.ts`)

*   **Tool Name (for LLM):** `web_search`
*   **Description:** Performs a web search for a given query using the configured provider (currently supports Brave Search).
*   **Parameters (JSON Schema):**
    ```json
    {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "The search query."
        }
      },
      "required": ["query"]
    }
    ```
*   **Execution Logic:**
    *   Takes the search `query`.
    *   Reads configuration: `search.provider`, `search.brave.apiKey`, `search.maxResults`.
    *   Checks if `search.provider` is set to `'brave'`. If not, returns an error message.
    *   Checks if `search.brave.apiKey` is configured and valid. If not, returns an error message.
    *   Makes a GET request to the Brave Search API (`https://api.search.brave.com/res/v1/web/search`).
    *   Parses the results and takes the top `search.maxResults` (default 3).
    *   Formats the results into a string: `Result N: [Title](URL) - Snippet`, separated by double newlines.
*   **Output:** Returns a string containing the formatted search results (e.g., `Web search results for "query":\n\nResult 1: ...\n\nResult 2: ...`) or an error message string if the search fails, no results are found, or configuration is invalid.

## Adding New Tools

1.  Create a new tool implementation file in `src/tools/` that exports an object conforming to the `ToolImplementation` interface from `src/types/tools.ts`. This includes:
    *   `name`: A unique identifier for the tool (used by the LLM).
    *   `description`: A clear description for the LLM explaining what the tool does.
    *   `parameters`: A JSON Schema object defining the input arguments the tool expects.
    *   `execute`: An async function that takes the parsed arguments and performs the tool's action, returning the result (usually as a string or simple object/primitive that can be stringified).
2.  Register the new tool instance within the `ToolRegistry` (likely during its initialization in `src/core/LLMCordBot.ts` or a dedicated setup function).
3.  Update this documentation (`tools.md`) to include the new tool's details.
4.  Ensure the LLM provider being used supports tool calling (`supportsTools()` returns true) and that the tool definitions are passed correctly during the `generateStream` call in `LLMCordBot.ts`.