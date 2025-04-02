# LLMCordBot.ts Refactoring Status

This document tracks the progress of the staged refactoring of `LLMcordTS/src/core/LLMCordBot.ts` based on the plan outlined in `RefactoringPlan.md` (if saved) or the initial discussion.

## Current Progress

*   **Stage 1: Extract Message Processing Module**
    *   **Status:** ✅ Completed and Verified.
    *   **Details:** The `MessageProcessor` class has been created in `LLMcordTS/src/processing/`, relevant logic moved from `LLMCordBot`, unit tests added, and integration completed. The application builds and runs correctly with this change.

*   **Stage 2: Extract Response Management**
    *   **Status:** ⏸️ Paused.
    *   **Details:** Implementation of `ResponseManager` in `LLMcordTS/src/discord/` was started. However, a bug was identified where placeholder messages ("Thinking deeper...") are not correctly replaced by the initial response stream content. Debugging and fixing this, along with a related enhancement (cycling GLaDOS quotes), has been deferred to be addressed later, after the main refactoring stages are complete.

## Next Objectives (Remaining Refactoring Stages)

The immediate next steps involve resuming the planned refactoring stages:

1.  **Stage 3: Extract Memory Management**
    *   Create `MemoryManager` class in `LLMcordTS/src/memory/`.
    *   Move memory-related logic (`_processMemorySuggestions`, `_formatMemoryForSystemPrompt`, etc.) from `LLMCordBot`.
    *   Define types/interfaces in `LLMcordTS/src/types/memory.ts`.
    *   Add unit tests (`LLMcordTS/tests/memory/MemoryManager.test.ts`).
    *   Integrate into `LLMCordBot`.
    *   Verify build, tests, and functionality.

2.  **Stage 4: Create Provider Abstraction Layer**
    *   Create `ProviderManager` class in `LLMcordTS/src/providers/`.
    *   Move provider selection, initialization, capability checking, and stream handling logic from `LLMCordBot`.
    *   Define types/interfaces in `LLMcordTS/src/types/provider.ts`.
    *   Add unit tests (`LLMcordTS/tests/providers/ProviderManager.test.ts`).
    *   Integrate into `LLMCordBot`.
    *   Verify build, tests, and functionality.

3.  **Stage 5: Extract Tool Execution Logic**
    *   Create `ToolExecutor` class in `LLMcordTS/src/tools/`.
    *   Move `_executeToolCall` and related logic from `LLMCordBot`.
    *   Augment types/interfaces in `LLMcordTS/src/types/tools.ts`.
    *   Add unit tests (`LLMcordTS/tests/tools/ToolExecutor.test.ts`).
    *   Integrate into `LLMCordBot`.
    *   Verify build, tests, and functionality.

4.  **Stage 6: Refactor Event Handling**
    *   Create `EventHandler` class in `LLMcordTS/src/discord/`.
    *   Move event registration and handling logic from `LLMCordBot`.
    *   Augment types/interfaces in `LLMcordTS/src/types/discord.ts`.
    *   Add unit tests (`LLMcordTS/tests/discord/EventHandler.test.ts`).
    *   Integrate into `LLMCordBot`.
    *   Verify build, tests, and functionality.

5.  **Stage 7: Final Core Cleanup**
    *   Refactor `LLMCordBot` to be a coordinator using Dependency Injection.
    *   Update application entry point (`index.ts`) for DI setup.
    *   Add integration tests.
    *   Verify build, tests, and functionality.

## Deferred Tasks

*   **Debug/Fix `ResponseManager` Placeholder Issue:** Address the bug where initial stream content appends to, rather than replaces, the "Thinking deeper..." placeholder.
*   **Implement GLaDOS Quotes:** Replace the static "Thinking deeper..." fallback with cycling GLaDOS quotes.

These deferred tasks should be revisited after the main refactoring stages (3-7) are complete.