# Bot Tools Reference

This document describes the tools available to the LLMcordTS bot, which can be invoked by command handlers or the reasoning engine, often guided by LLM suggestions.

## Overview

Tools extend the bot's capabilities beyond simple text generation by allowing it to interact with external systems or perform specific computations. The tool system is managed by the `ToolRegistry` (`src/core/toolRegistry.ts`), and individual tool implementations are located in the `src/tools/` directory.

The structure and interface for tools are defined in `src/types/tools.ts`.

## Available Tools

*(This section should be populated with details for each tool defined in `src/tools/`)*

*   **Calculator (`src/tools/calculatorTool.ts`)**
    *   **Description:** Performs mathematical calculations.
    *   **Input:** A string representing a mathematical expression (e.g., "2 + 2 * 5").
    *   **Output:** The numerical result of the calculation.

*   **Web Search (`src/tools/webSearchTool.ts`)**
    *   **Description:** Performs a web search using a configured search engine API.
    *   **Input:** A string representing the search query.
    *   **Output:** A summary of search results, potentially including snippets and links.

*   *... (List other available tools)*

## Tool Definition and Usage

*   **Definition:** Each tool has a definition (likely in `src/types/tools.ts` or within the tool file itself) specifying its name, description, and input schema (parameters). This definition is used by the LLM to understand when and how to request the tool's use.
*   **Registration:** Tools must be registered with the `ToolRegistry` (`src/core/toolRegistry.ts`) during bot initialization to be available.
*   **Invocation:** When the LLM decides a tool is needed, it typically outputs a specific format indicating the tool name and arguments. The bot's reasoning or command logic parses this, calls the `ToolRegistry` to execute the tool with the provided arguments, and then feeds the tool's output back to the LLM to inform the final response.

## Adding New Tools

1.  Create a new tool implementation file in `src/tools/`.
2.  Define the tool's logic, ensuring it adheres to the expected input/output structure (see `src/types/tools.ts`).
3.  Define the tool's schema (name, description, parameters) for the LLM.
4.  Register the new tool instance within the `ToolRegistry` (likely during its initialization in `src/core/LLMCordBot.ts` or a dedicated setup function).
5.  Update this documentation (`tools.md`) to include the new tool.