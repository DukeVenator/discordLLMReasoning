# Installation Guide

This guide covers how to install and run LLMCord.

## Prerequisites

*   **Python:** Version 3.9 or higher.
*   **Git:** For cloning the repository.
*   **(Optional) Docker:** For containerized deployment.

## Standard Installation (Recommended)

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/jakobdylanc/llmcord.git
    cd llmcord
    ```

2.  **Install Dependencies:**
    It's recommended to use a virtual environment.
    ```bash
    # Create a virtual environment (optional but recommended)
    python -m venv venv
    source venv/bin/activate  # On Windows use `venv\Scripts\activate`

    # Install the package and its dependencies
    pip install -e .
    ```
    This installs the package in "editable" mode, meaning changes you make to the source code will be reflected immediately when you run the bot.

3.  **Configure the Bot:**
    Copy the example configuration file and edit it with your settings (Bot Token, API Keys, etc.).
    ```bash
    cp config-example.yaml config.yaml
    # Now edit config.yaml with your preferred text editor
    ```
    See the [Configuration Guide](./configuration.md) for details on all options.

4.  **Run the Bot:**
    ```bash
    llmcord
    ```
    Alternatively, you can run it as a module:
    ```bash
    python -m llmcord.main
    ```

## Docker Installation

1.  **Build the Docker Image:**
    From the project's root directory:
    ```bash
    docker build -t llmcord .
    ```

2.  **Configure the Bot:**
    You still need a `config.yaml` file. Create one locally as described in the Standard Installation section.

3.  **Run the Container:**
    Mount your local `config.yaml` into the container.
    ```bash
    docker run -d --name llmcord-bot \
      -v $(pwd)/config.yaml:/app/config.yaml \
      llmcord
    ```
    *Note: The `CMD` in the provided `Dockerfile` might need adjustment to use `llmcord` or `python -m llmcord.main` instead of `python llmcord.py` for consistency with the project structure.*

## Development Setup

Follow the **Standard Installation** steps. The `pip install -e .` command installs the project in editable mode, which is ideal for development as code changes are immediately effective without reinstalling.