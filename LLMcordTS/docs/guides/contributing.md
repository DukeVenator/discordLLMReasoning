# Contributing Guide

We welcome contributions to the LLMcordTS project! Please follow these guidelines to ensure a smooth development process.

## Development Workflow

1.  **Fork the Repository:** Start by forking the main repository to your own GitHub account.
2.  **Clone Your Fork:** Clone your forked repository to your local machine.
    ```bash
    git clone <your-fork-repository-url>
    cd LLMcordTS
    ```
3.  **Create a Feature Branch:** Create a new branch for your changes, based on the `main` or relevant development branch. Use a descriptive name.
    ```bash
    git checkout -b feature/your-amazing-feature
    # or
    git checkout -b fix/issue-description
    ```
4.  **Make Your Changes:** Implement your feature or bug fix. Ensure your code adheres to the project's style guidelines.
5.  **Run Linters/Formatters:** Ensure your code conforms to the project's style.
    ```bash
    npm run lint
    npm run format
    ```
6.  **Run Tests:** Execute the test suite to ensure your changes haven't broken existing functionality. Add new tests for your changes.
    ```bash
    npm test
    ```
7.  **Commit Your Changes:** Commit your changes with a clear and concise commit message, following conventional commit standards if applicable.
    ```bash
    git add .
    git commit -m 'feat: Add amazing feature'
    # or
    git commit -m 'fix: Resolve issue with command parsing'
    ```
8.  **Push to Your Branch:** Push your changes to your forked repository.
    ```bash
    git push origin feature/your-amazing-feature
    ```
9.  **Open a Pull Request (PR):** Go to the original LLMcordTS repository on GitHub and open a Pull Request from your feature branch to the main repository's `main` branch. Provide a clear description of your changes in the PR.

## Code Style

*   **TypeScript Standards:** Follow standard TypeScript best practices.
*   **ESLint & Prettier:** Adhere to the configurations defined in `.eslintrc.json` and `.prettierrc.json`. Use `npm run lint` and `npm run format` to check and fix your code.
*   **Meaningful Names:** Use clear and descriptive names for variables, functions, classes, etc.
*   **Commit Messages:** Write clear, concise, and informative commit messages. Consider using the [Conventional Commits](https://www.conventionalcommits.org/) specification.

## Testing

*   **Unit Tests:** Write unit tests using Vitest for any new functions, classes, or significant logic changes. Place tests in the relevant directory within `tests/`.
*   **Integration Tests:** For larger features or changes affecting multiple components, consider adding integration tests.
*   **Ensure Tests Pass:** All existing and new tests must pass before your PR can be merged. Run `npm test` locally.

## Documentation

*   **Update Existing Docs:** If your changes affect existing functionality, update the relevant documentation files in the `docs/` directory.
*   **Document New Features:** Add documentation for new features, commands, configuration options, or APIs.
*   **TSDoc/JSDoc Comments:** Include clear TSDoc/JSDoc comments for all exported functions, classes, methods, and complex code sections. This helps with code understanding and automated API documentation generation.

Thank you for contributing!