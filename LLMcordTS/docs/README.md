# LLMcordTS Project Documentation

## Introduction

Welcome to the documentation for LLMcordTS, a TypeScript-based Discord bot designed for intelligent interactions powered by Large Language Models (LLMs). This documentation provides a comprehensive guide to understanding, setting up, contributing to, and deploying the bot.

## Quick Links

*   **Overview:**
    *   [Project Structure](overview/project_structure.md) - Understand how the codebase is organized.
    *   [Architecture](overview/architecture.md) - Get a high-level view of the system design.
    *   [Tech Stack](overview/tech_stack.md) - See the technologies used.
*   **Guides:**
    *   [Setup Guide](guides/setup.md) - Set up your development environment.
    *   [Contributing Guide](guides/contributing.md) - Learn how to contribute to the project.
    *   [Deployment Guide](guides/deployment.md) - Instructions for deploying the bot.
*   **Architecture Details:**
    *   [Message Flow](architecture/message_flow.md) - Follow the journey of a message through the system.
    *   [Components](architecture/components.md) - Learn about the major parts of the bot.
    *   [Data Model](architecture/data_model.md) - Understand the data structures used.
*   **API & Reference:**
    *   [Commands](api/commands.md) - Reference for available bot commands.
    *   [Configuration](reference/configuration.md) - Details on configuring the bot.
    *   [Providers](api/providers.md) - Information on LLM provider integrations.
    *   [Tools](api/tools.md) - Documentation for available bot tools.

## Getting Started

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd LLMcordTS
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Configure the bot:** Copy `config-example.yaml` to `config.yaml` (or set environment variables) and fill in your details (Discord token, LLM API keys, etc.). See the [Configuration Guide](reference/configuration.md) for details.
4.  **Run the bot:**
    ```bash
    npm start
    ```

For more detailed instructions, please refer to the [Setup Guide](guides/setup.md).