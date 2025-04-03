# Technology Stack

This document outlines the primary technologies, frameworks, and libraries used in the LLMcordTS project.

## Core Technologies

*   **Language:** [TypeScript](https://www.typescriptlang.org/) - Superset of JavaScript adding static typing for enhanced code quality and maintainability.
*   **Runtime:** [Node.js](https://nodejs.org/) - JavaScript runtime environment used to execute the bot server-side.
*   **Package Manager:** [npm](https://www.npmjs.com/) (or potentially Yarn) - Used for managing project dependencies.

## Key Frameworks & Libraries

*   **Discord Interaction:** [Discord.js](https://discord.js.org/) - The primary library for interacting with the Discord API (handling events, commands, responses, etc.).
*   **LLM Integration:**
    *   *(Specific SDKs depend on configured providers, e.g., `openai`, `@google/generative-ai`, potentially others for Ollama)* - Libraries used to communicate with different Large Language Model APIs.
*   **Database (for Memory):** [SQLite](https://www.sqlite.org/index.html) via `sqlite3` or a similar Node.js package - Used as the default persistent storage for conversation memory. *(May be configurable for other adapters in the future)*.
*   **Linting:** [ESLint](https://eslint.org/) - For identifying and reporting on patterns found in ECMAScript/JavaScript code, improving code quality.
*   **Formatting:** [Prettier](https://prettier.io/) - An opinionated code formatter ensuring consistent code style across the project.
*   **Testing:** [Vitest](https://vitest.dev/) (as indicated by `vitest.config.ts`) - A fast unit testing framework.

## Development Tools

*   **TypeScript Compiler (`tsc`)**: Compiles TypeScript code down to JavaScript.
*   **Git**: For version control.

*(This list may evolve as the project grows. Specific versions are managed in `package.json`.)*