# Development Environment Setup Guide

This guide explains how to set up your local environment to develop and run the LLMcordTS bot.

## Prerequisites

*   **Node.js:** Ensure you have Node.js installed. Version 18.x or later is recommended. You can download it from [nodejs.org](https://nodejs.org/).
*   **npm (or Yarn):** Node.js comes bundled with npm (Node Package Manager). You can use npm or optionally install [Yarn](https://yarnpkg.com/).
*   **Git:** You need Git for cloning the repository and managing versions. Download it from [git-scm.com](https://git-scm.com/).
*   **Discord Bot Token:** You need a bot token from the Discord Developer Portal. See [Discord's documentation](https://discord.com/developers/docs/topics/oauth2#bots) on creating a bot application.
*   **LLM API Key(s):** Depending on the LLM provider(s) you intend to use (e.g., OpenAI, Google Gemini), you will need API keys from their respective platforms.

## Setup Steps

1.  **Clone the Repository:**
    Open your terminal or command prompt and clone the project repository:
    ```bash
    git clone <repository-url> # Replace <repository-url> with the actual URL
    cd LLMcordTS
    ```

2.  **Install Dependencies:**
    Install the necessary Node.js packages defined in `package.json`:
    ```bash
    npm install
    # or if using Yarn:
    # yarn install
    ```

3.  **Configure the Bot:**
    *   Copy the example configuration file:
        ```bash
        cp config-example.yaml config.yaml
        ```
        *(Note: On Windows Command Prompt, use `copy` instead of `cp`)*
    *   Open `config.yaml` in a text editor.
    *   Fill in the required fields:
        *   `discord_token`: Your Discord bot token.
        *   `llm_providers`: Configure at least one LLM provider with its API key and any other required settings (e.g., model name). Refer to `src/types/config.ts` for the exact structure.
        *   *(Optional)* Adjust other settings like command prefix (if applicable), logging levels, memory settings, etc.
    *   **Alternatively, use Environment Variables:** You can often override `config.yaml` settings using environment variables. Check the configuration loading logic (`src/core/config.ts`) for details on variable names.

4.  **Build the Project (if necessary):**
    While `npm start` often handles this via `ts-node-dev` or similar for development, you might need a build step for production or specific workflows:
    ```bash
    npm run build
    ```
    This typically compiles the TypeScript code in `src/` to JavaScript in a `dist/` directory.

5.  **Run the Bot (Development):**
    To run the bot in development mode, which usually includes hot-reloading:
    ```bash
    npm run dev
    ```
    *(Check the `scripts` section in `package.json` for the exact command)*

6.  **Run the Bot (Production):**
    After building the project (`npm run build`), you can run the compiled JavaScript:
    ```bash
    npm start
    ```
    *(Check the `scripts` section in `package.json` for the exact command, it might be `node dist/index.js` or similar)*

## Troubleshooting

*   **Missing Dependencies:** If you encounter errors related to missing modules, ensure `npm install` completed successfully. Try deleting `node_modules` and `package-lock.json` and running `npm install` again.
*   **Configuration Errors:** Double-check your `config.yaml` or environment variables for typos or incorrect values (especially API keys and tokens).
*   **Discord Permissions:** Ensure your bot has the necessary permissions (Intents) enabled in the Discord Developer Portal (e.g., Message Content Intent if reading message content). Also, make sure the bot has been invited to your server with the correct scopes.

You should now have a running instance of the LLMcordTS bot connected to Discord!