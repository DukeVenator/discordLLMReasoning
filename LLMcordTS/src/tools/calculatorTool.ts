import { ToolImplementation } from '../types/tools';
import * as math from 'mathjs';
// Import specific node types for instanceof checks and manipulation
import { FunctionNode, OperatorNode, SymbolNode, ConstantNode } from 'mathjs';

/**
 * Tool implementation for evaluating mathematical expressions, simplifying equations,
 * and attempting to solve simple linear equations using derivatives.
 * Uses math.js library. NOTE: Does not perform full symbolic solving for complex/non-linear equations.
 */
export const calculatorTool: ToolImplementation = {
    name: 'calculator',
    description: 'Evaluates expressions (arithmetic, functions, units), simplifies equations, and attempts to solve simple linear equations (e.g., ax+b=c) using derivatives. Returns simplified equation if solving fails.',
    parameters: {
        type: 'object',
        properties: {
            expression: {
                type: 'string',
                description: "Expression or equation (e.g., \\'2+2\\', \\'sin(pi/4)\\', \\'5 cm + 2 inch\\', \\'(x^2+2x+1)/(x+1)=5\\', \\'2x+3=11\\'). Tries to solve simple linear equations.",
            },
        },
        required: ['expression'],
    },
    async execute(args: { expression: string }): Promise<string> {
        const { expression } = args;
        let resultString: string = ''; // Initialize to empty string

        try {
            // Check if it's an equation by looking for '=' NOT inside function calls like simplify()
            const equalsIndex = expression.indexOf('=');
            const isLikelyEquation = equalsIndex > 0 && equalsIndex < expression.length - 1 &&
                                     !expression.toLowerCase().trim().startsWith('simplify(') &&
                                     !expression.toLowerCase().trim().startsWith('solve(');

            if (isLikelyEquation) {
                // --- Equation Handling ---
                const lhsString = expression.substring(0, equalsIndex).trim();
                const rhsString = expression.substring(equalsIndex + 1).trim();

                if (!lhsString || !rhsString) { throw new Error("Invalid equation format."); }

                // Simplify the LHS and RHS strings directly first
                const simplifiedLHSNode = math.simplify(lhsString);
                const simplifiedRHSNode = math.simplify(rhsString);
                const simplifiedEquationString = `${simplifiedLHSNode.toString()} = ${simplifiedRHSNode.toString()}`;

                let solved = false;
                let variableName: string | null = null;

                try {
                    // --- Attempt Linear Solve using Derivatives ---
                    const simplifiedEqNode = math.parse(simplifiedEquationString);

                    // 1. Check structure and find single variable
                    if (simplifiedEqNode instanceof OperatorNode && simplifiedEqNode.op === '=') {
                        const symbols = simplifiedEqNode.filter(node => node instanceof SymbolNode);
                        if (symbols.length === 1 && symbols[0] instanceof SymbolNode) { // Ensure the filtered node is SymbolNode
                             variableName = symbols[0].name;

                             // 2. Create expression node: LHS - RHS = 0
                             const exprNode = new OperatorNode('-', 'subtract', [simplifiedEqNode.args[0], simplifiedEqNode.args[1]]);

                             // 3. Calculate derivative w.r.t the variable
                             const derivativeNode = math.derivative(exprNode, variableName);

                             // 4. Simplify derivative
                             const simplifiedDerivativeNode = math.simplify(derivativeNode);

                             // 5. Check if derivative is a non-zero constant (linear equation)
                             if (simplifiedDerivativeNode instanceof ConstantNode && simplifiedDerivativeNode.value !== 0) {
                                 const a = simplifiedDerivativeNode.value; // Coefficient of x

                                 // 6. Calculate constant term 'b' by evaluating exprNode at variable = 0
                                 const scope = { [variableName]: 0 };
                                 const b = exprNode.evaluate(scope); // Evaluate LHS-RHS at x=0

                                 // 7. Calculate solution: x = -b / a
                                 const solutionValue = math.divide(math.unaryMinus(b), a);

                                 // 8. Format result
                                 resultString = `${variableName} = ${math.format(solutionValue, { precision: 14 })}`;
                                 solved = true;
                             }
                        }
                    }
                } catch (solveError: any) {
                     console.warn(`Linear equation solving failed for "${simplifiedEquationString}": ${solveError.message}`);
                     // Fall through to return simplified equation if solving fails
                }

                // If not solved, return the simplified equation string
                if (!solved) {
                    resultString = simplifiedEquationString;
                    // Add note if simplification occurred but solving didn't happen
                    if (expression !== resultString) {
                         if (simplifiedLHSNode.equals(simplifiedRHSNode)) {
                             resultString += " (This equation is true for all valid values)";
                         } else if (variableName) { // Add note only if we identified a variable
                            resultString += " (Simplified, could not solve for variable)";
                         } else {
                            resultString += " (Simplified)"; // Generic simplification note
                         }
                    } else if (simplifiedLHSNode.equals(simplifiedRHSNode)) {
                         resultString += " (This equation is true for all valid values)";
                    }
                }

            } else {
                // --- Expression Handling ---
                const node = math.parse(expression);

                if (node instanceof FunctionNode && node.fn.name === 'simplify') {
                    const simplified = math.simplify(node.args[0]);
                    resultString = simplified.toString();
                } else if (node instanceof FunctionNode && node.fn.name === 'solve') {
                    resultString = "Error: Use standard equation format (e.g., '2x+1=5') instead of solve().";
                } else {
                    // Assume it's a standard expression to evaluate
                    const evaluatedResult = math.evaluate(expression);
                    resultString = math.format(evaluatedResult, { precision: 14 });
                }
            }

        } catch (error: any) {
            console.error(`Calculator tool error processing "${expression}": ${error.message}`);
            resultString = `Error: ${error.message}`;
            // Add specific error hints
            if (error.message.includes('Undefined symbol')) { resultString += " (Check variables)"; }
            else if (error.message.includes('Units do not match')) { resultString += " (Incompatible units)"; }
            else if (error.message.includes('Invalid left hand side')) { resultString = `Error: Equation structure error. (${error.message})`; }
            else if (error.message.includes('Unexpected end of expression')) { resultString += " (Check syntax)"; }
            else if (error.message.includes('No overload matches')) { resultString += " (Function arguments might be incorrect)"; }
            else if (error.message.includes("Cannot evaluate")) { resultString += " (Evaluation failed, check expression)"; }

        }

        return String(resultString);
    },
};