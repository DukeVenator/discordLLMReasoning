import { ToolImplementation } from '../types/tools';

/**
 * Tool implementation for performing basic arithmetic calculations.
 */
export const calculatorTool: ToolImplementation = {
    name: 'simple_calculator',
    description: 'Performs basic arithmetic operations (add, subtract, multiply, divide).',
    parameters: {
        type: 'object',
        properties: {
            operation: {
                type: 'string',
                enum: ['add', 'subtract', 'multiply', 'divide'],
                description: 'The arithmetic operation to perform.',
            },
            operand1: {
                type: 'number',
                description: 'The first number.',
            },
            operand2: {
                type: 'number',
                description: 'The second number.',
            },
        },
        required: ['operation', 'operand1', 'operand2'],
    },
    async execute(args: { operation: string; operand1: number; operand2: number }): Promise<number | string> {
        const { operation, operand1, operand2 } = args;
        let result: number | string;

        switch (operation) {
            case 'add':
                result = operand1 + operand2;
                break;
            case 'subtract':
                result = operand1 - operand2;
                break;
            case 'multiply':
                result = operand1 * operand2;
                break;
            case 'divide':
                if (operand2 === 0) {
                    result = 'Error: Division by zero';
                } else {
                    result = operand1 / operand2;
                }
                break;
            default:
                result = `Error: Unknown operation '${operation}'`;
        }
        return result; // Return the raw result, not stringified
    },
};