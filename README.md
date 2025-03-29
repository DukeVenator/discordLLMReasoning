# LLMCord

A versatile Discord bot that connects to various LLM (Large Language Model) providers, offering features like persistent memory, vision support, flexible configuration, multi-model reasoning, and more.

## Key Features

*   **🤖 Multiple LLM Provider Support:**
    *   Connects seamlessly to **OpenAI (GPT models)**, **Google Gemini**, and various **OpenAI-compatible APIs** (like Groq, Mistral AI, local Ollama instances, etc.).
    *   Provides flexibility to choose models based on cost, performance, and specific capabilities (e.g., vision).

*   **🖼️ Vision Support:**
    *   Interact with **vision-capable models** (like GPT-4 Vision, Gemini Pro Vision, Claude 3).
    *   Simply **attach images** directly to your Discord messages along with your text prompt. The bot handles sending the image data to the LLM.

*   **🧠 Persistent Memory:**
    *   Remembers **user-specific notes** across conversations and sessions.
    *   Memory content is automatically included in the context sent to the LLM, allowing for personalized responses.
    *   Supports **LLM-driven memory updates**: The LLM can suggest additions (`[MEM_APPEND]`) or replacements (`[MEM_REPLACE]`) to your notes within its response.
    *   Manage your memory easily using the `/memory` and `/memory_edit` slash commands.

*   **💬 Conversation Context:**
    *   Maintains a history of recent messages in the channel/DM.
    *   Provides the LLM with context for more relevant and coherent follow-up responses.

*   **⚙️ Flexible Configuration:**
    *   Extensive customization options via a `config.yaml` file.
    *   Configure **API keys**, **model parameters** (temperature, max tokens), **system prompts**, **permissions** (users, roles, channels), **rate limits**, **memory behavior** (enable/disable, max length, auto-condensation), **multimodel reasoning settings**, and more.

*   **✨ Multimodel Reasoning:**
    *   Optional feature to leverage a **secondary, potentially more powerful LLM** (e.g., GPT-4 or Claude Opus) for complex tasks.
    *   The primary (cheaper/faster) model can **automatically signal** when a task requires deeper reasoning, triggering the secondary model.
    *   Provides enhanced capabilities without incurring the cost of the powerful model for every interaction.

*   **⌨️ Commands:**
    *   **Slash Commands (Recommended):**
        *   `/memory <view|update|clear> [content]`: View, replace, or clear your entire memory notes.
        *   `/memory_edit`: Start an interactive session to view, edit specific lines, or delete specific lines from your memory.
    *   **Legacy Prefix Commands:** Older `!memory` and `!forget` commands might still be available but slash commands are the preferred interface.

## Documentation

**For detailed information on installation, configuration, usage, and development, please see the full documentation [here](./docs/index.md).**

## Contributing

Contributions are welcome! Please see the [Development Guide](./docs/development.md) for details on how to contribute.

## License

LLMCord is licensed under the MIT License. See the [LICENSE.md](./LICENSE.md) file for details.
