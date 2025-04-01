# LLMcordTS

A versatile Discord bot, rewritten in TypeScript, that connects to various LLM (Large Language Model) providers, offering features like persistent memory, vision support, flexible configuration, multi-model reasoning, and more.

## Key Features

*   **🤖 Multiple LLM Provider Support:**
    *   Connects seamlessly to **OpenAI (GPT models)**, **Google Gemini**, **Anthropic Claude**, and various **OpenAI-compatible APIs** (like Groq, Mistral AI, local Ollama instances, etc.).
    *   Provides flexibility to choose models based on cost, performance, and specific capabilities (e.g., vision).
*   **🖼️ Vision Support:**
    *   Interact with **vision-capable models** (like GPT-4 Vision, Gemini Pro Vision, Claude 3).
    *   Simply **attach images** directly to your Discord messages along with your text prompt. The bot handles sending the image data to the LLM.
*   **🧠 Persistent Memory:**
    *   Remembers **user-specific notes** across conversations and sessions using a JSON file (`memory.json`).
    *   Memory content is automatically included in the context sent to the LLM, allowing for personalized responses.
    *   Supports **LLM-driven memory updates**: The LLM can suggest additions (`[MEM_APPEND]`) or replacements (`[MEM_REPLACE]`) to your notes within its response.
    *   Manage your memory easily using the `/memory` and `/memory_edit` slash commands.
*   **💬 Conversation Context:**
    *   Maintains a history of recent messages in the channel/DM.
    *   Provides the LLM with context for more relevant and coherent follow-up responses.
*   **⚙️ Flexible Configuration:**
    *   Extensive customization options via a `config.yaml` file.
    *   Configure **API keys**, **model parameters** (temperature, max tokens), **system prompts**, **permissions** (users, roles, channels), **rate limits**, **memory behavior** (enable/disable, max length), **multimodel reasoning settings**, and more. See `config-example.yaml` for details.
*   **✨ Multimodel Reasoning:**
    *   Optional feature to leverage a **secondary, potentially more powerful LLM** (e.g., GPT-4 or Claude Opus) for complex tasks.
    *   The primary (cheaper/faster) model can **automatically signal** when a task requires deeper reasoning, triggering the secondary model.
    *   Provides enhanced capabilities without incurring the cost of the powerful model for every interaction.
*   **⌨️ Commands:**
    *   **Slash Commands:**
        *   `/memory <view|update|clear> [content]`: View, replace, or clear your entire memory notes.
        *   `/memory_edit`: Start an interactive session to view, edit specific lines, or delete specific lines from your memory.
        *   `/imagine`: Generate images using configured image generation providers.
        *   `/status`: View the current status and configuration of the bot.
        *   `/help`: Display help information about commands.

## Installation

1.  **Clone the repository:**
    ```bash
    git clone <repository_url>
    cd LLMcordTS
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```

## Configuration

1.  **Copy the example configuration:**
    ```bash
    cp ../config-example.yaml config.yaml
    ```
    *(Note: The `config.yaml` should be placed in the `LLMcordTS` directory or the parent directory)*
2.  **Edit `config.yaml`:**
    *   Add your Discord Bot Token (`discord_token`).
    *   Configure your desired LLM providers (e.g., add API keys for OpenAI, Anthropic, Google).
    *   Adjust other settings like permissions, rate limits, model parameters, etc., as needed. Refer to the comments within `config.yaml` for guidance.
3.  **(Optional) Environment Variables:** Some settings might be configurable via environment variables (check the specific implementation if applicable).

## Running the Bot

*   **Development Mode (with hot-reloading):**
    ```bash
    npm run dev
    ```
*   **Production Mode:**
    1.  Build the TypeScript code:
        ```bash
        npm run build
        ```
    2.  Start the bot:
        ```bash
        npm start
        ```

## Contributing

Contributions are welcome! Please refer to the main project's contribution guidelines if available, or open an issue/pull request.

## License

LLMcordTS is licensed under the MIT License. See the main project's `LICENSE.md` file for details.
