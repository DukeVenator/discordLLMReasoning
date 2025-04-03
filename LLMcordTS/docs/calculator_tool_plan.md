# Plan: Upgrade Calculator Tool

**Goal:** Enhance the calculator tool to parse and evaluate mathematical expressions (including simple arithmetic, complex functions, units) and solve algebraic equations, using the `math.js` library. Intermediate steps for equation solving will be attempted on a best-effort basis.

**Library:** `math.js`

**Plan Details:**

1.  **Add Dependency:**
    *   Add `mathjs` to `devDependencies` or `dependencies` in `LLMcordTS/package.json`.
    *   Run `npm install` or `yarn install`.

2.  **Update Tool Definition (`LLMcordTS/src/tools/calculatorTool.ts`):**
    *   **Rename:** Change `name` to `calculator`.
    *   **Update Description:** Set `description` to: "Evaluates mathematical expressions (simple arithmetic, complex functions, units like cm/inch/kg) and solves algebraic equations."
    *   **Modify Parameters:** Use a single required `string` parameter `expression`.
        ```json
        {
            "type": "object",
            "properties": {
                "expression": {
                    "type": "string",
                    "description": "The mathematical expression or equation (e.g., '2+2', 'sin(pi/4)', '5 cm + 2 inch', '2x+5=10')."
                }
            },
            "required": ["expression"]
        }
        ```

3.  **Implement Execution Logic (`execute` function):**
    *   Import `mathjs`: `import * as math from 'mathjs';`
    *   Parse input: `math.parse(args.expression)`.
    *   Check if the input is an equation (e.g., contains an assignment or comparison operator recognized by `math.js`).
    *   **If Equation:**
        *   Attempt symbolic solving using relevant `math.js` functions (e.g., `math.simplify`, potentially custom logic or exploring specific solving functions if available).
        *   Attempt step generation by applying simplification rules sequentially and capturing intermediate string representations. This is best-effort.
        *   Format output string with steps (if generated) and solution(s).
    *   **If Expression:**
        *   Evaluate using `math.evaluate(args.expression)`. This handles arithmetic, functions, constants, and units automatically.
        *   Format the result (which might include units).
    *   Implement comprehensive error handling for parsing, evaluation (e.g., incompatible units), and solving issues.

4.  **Testing (`LLMcordTS/tests/`):**
    *   Create/update unit tests for the `calculator` tool.
    *   Include test cases for:
        *   Simple arithmetic (`2+2`, `5*3-1`).
        *   Complex functions (`sin(pi/2)`, `log(100, 10)`, `sqrt(16)`).
        *   Constants (`2 * pi`).
        *   Unit calculations (`'5 cm + 2 inch'`, `'1 meter / 2 seconds'`).
        *   Unit conversions (`'1 mile to km'`).
        *   Equation solving (linear: `'2x + 3 = 11'`, quadratic: `'x^2 - 4 = 0'`).
        *   Invalid inputs and error conditions (syntax errors, incompatible units, unsolvable equations).

**Flow Diagram:**

```mermaid
graph TD
    A[Start: User provides expression string] --> B(Add math.js Dependency);
    B --> C{Update Tool Definition (incl. Units)};
    C --> D[Implement execute Logic];
    D -- Parses --> E{Parse Expression (math.js)};
    E -- Success --> F{Is it an equation?};
    F -- Yes --> G{Solve Equation (math.js)};
    G -- Success --> H{Attempt Step Generation (Best Effort)};
    H --> I[Format Output (Steps? + Solution)];
    F -- No --> P{Evaluate Expression (math.js - Handles Units)};
    P -- Success --> Q[Format Output (Result with Units?)];
    E -- Error --> K[Handle Parsing Error];
    G -- Error --> L[Handle Solving Error];
    P -- Error --> R[Handle Evaluation/Unit Error];
    I --> M[Return Result String];
    Q --> M;
    K --> M;
    L --> M;
    R --> M;
    D --> N(Add Unit Tests - incl. Units);
    N --> M;