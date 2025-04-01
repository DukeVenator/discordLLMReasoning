import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { pathToFileURL } from 'url'; // Import pathToFileURL
import { ToolRegistry } from '../../src/core/toolRegistry';
import { ToolImplementation } from '../../src/types/tools';

// Mock the entire fs/promises module *before* importing it
vi.mock('fs/promises');

// Now import the mocked module
import * as fsPromises from 'fs/promises';

// Helper to create a mock tool implementation
const createMockTool = (name: string, description: string = 'Mock tool description', executeResult: any = 'mock result'): { default: ToolImplementation } => ({
    default: {
        name,
        description,
        parameters: { type: 'object', properties: {} },
        execute: vi.fn().mockResolvedValue(executeResult),
    },
});

describe('ToolRegistry', () => {
    const testToolsDir = path.resolve(__dirname, 'mock_tools');
    let toolRegistry: ToolRegistry;

    beforeEach(() => {
        // Reset mocks and modules before each test
        vi.resetAllMocks(); // Resets spies, mocks
        vi.resetModules(); // Important for vi.doMock
        toolRegistry = new ToolRegistry(testToolsDir);
    });

    afterEach(() => {
        // No need for vi.restoreAllMocks() when using vi.mock at top level
    });

    describe('loadTools', () => {
        it('should load valid tool files from the specified directory', async () => {
            const mockToolFiles = ['toolA.ts', 'toolBTool.ts', 'notATool.js', 'toolC.ts'];
            const toolBPath = path.resolve(testToolsDir, 'toolBTool.ts');
            const mockToolB = createMockTool('toolB');

            // Configure the mocked readdir for this test
            vi.mocked(fsPromises.readdir).mockResolvedValue(mockToolFiles as any);

            // Mock the global import function for this test
            const importMock = vi.fn().mockImplementation(async (url: string) => {
                if (url === pathToFileURL(toolBPath).href) {
                    return mockToolB;
                }
                // Optionally, throw an error for unexpected imports or return an empty object
                throw new Error(`Unexpected dynamic import in test: ${url}`);
                // return {};
            });
            vi.stubGlobal('import', importMock);

            await toolRegistry.loadTools();

            expect(fsPromises.readdir).toHaveBeenCalledWith(testToolsDir);
            expect(toolRegistry.getToolCount()).toBe(1);
            expect(toolRegistry.getTool('toolB')).toBeDefined();
            expect(toolRegistry.getTool('toolB')?.description).toBe(mockToolB.default.description);
        });

        it('should handle errors when reading the directory', async () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const testError = new Error('Failed to read directory');

            // Configure the mocked readdir to reject
            vi.mocked(fsPromises.readdir).mockRejectedValue(testError);

            await toolRegistry.loadTools();

            expect(fsPromises.readdir).toHaveBeenCalledWith(testToolsDir);
            expect(toolRegistry.getToolCount()).toBe(0);
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error reading tools directory'), testError);
            consoleErrorSpy.mockRestore();
        });

         it('should handle ENOENT error specifically when directory not found', async () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const testError = new Error('ENOENT error') as NodeJS.ErrnoException;
            testError.code = 'ENOENT';

            // Configure the mocked readdir to reject with ENOENT
            vi.mocked(fsPromises.readdir).mockRejectedValue(testError);

            await toolRegistry.loadTools();

            expect(fsPromises.readdir).toHaveBeenCalledWith(testToolsDir);
            expect(toolRegistry.getToolCount()).toBe(0);
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining(`Tools directory not found: ${testToolsDir}`));
            consoleWarnSpy.mockRestore();
        });

        it('should skip files with invalid tool structure', async () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const mockToolFiles = ['invalidTool.ts'];
            const invalidToolPath = path.resolve(testToolsDir, 'invalidTool.ts');
            const invalidToolModule = { default: { name: 'invalid' } }; // Missing description/execute

            // Configure the mocked readdir
            vi.mocked(fsPromises.readdir).mockResolvedValue(mockToolFiles as any);

            // Mock the dynamic import for invalidTool.ts
            // Use the file URL format for vi.doMock
            vi.doMock(pathToFileURL(invalidToolPath).href, () => invalidToolModule);

            await toolRegistry.loadTools();

            expect(fsPromises.readdir).toHaveBeenCalledWith(testToolsDir);
            expect(toolRegistry.getToolCount()).toBe(0);
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Warning: Invalid tool structure in invalidTool.ts. Skipping.'));
            consoleWarnSpy.mockRestore();
        });

        it('should handle errors during dynamic import', async () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const mockToolFiles = ['errorTool.ts'];
            // const errorToolPath = path.resolve(testToolsDir, 'errorTool.ts'); // Unused
            // const importError = new Error('Module resolution failed'); // Unused

            // Configure the mocked readdir
            vi.mocked(fsPromises.readdir).mockResolvedValue(mockToolFiles as any);

            // Don't mock the dynamic import for errorTool.ts; let it fail naturally
            // vi.doMock(errorToolPath, () => { ... }); // Removed

            await toolRegistry.loadTools();

            expect(fsPromises.readdir).toHaveBeenCalledWith(testToolsDir);
            expect(toolRegistry.getToolCount()).toBe(0);
            // Expect console.error to be called with a message indicating the load failure for errorTool.ts
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Error loading tool from errorTool.ts:'),
                // Match the actual error message logged by the catch block in toolRegistry.ts
                expect.stringContaining('Failed to load url')
            );
            consoleErrorSpy.mockRestore();
        });

         it('should warn and overwrite on duplicate tool names', async () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const mockToolFiles = ['toolADupe1Tool.ts', 'toolADupe2Tool.ts'];
            const toolAPath1 = path.resolve(testToolsDir, 'toolADupe1Tool.ts');
            const toolAPath2 = path.resolve(testToolsDir, 'toolADupe2Tool.ts');
            const mockToolA1 = createMockTool('toolA', 'Description 1');
            const mockToolA2 = createMockTool('toolA', 'Description 2'); // Same name

            // Configure the mocked readdir
            vi.mocked(fsPromises.readdir).mockResolvedValue(mockToolFiles as any);

            // Mock the dynamic imports
            // Use the file URL format for vi.doMock
            vi.doMock(pathToFileURL(toolAPath1).href, () => mockToolA1);
            vi.doMock(pathToFileURL(toolAPath2).href, () => mockToolA2);

            await toolRegistry.loadTools();

            expect(fsPromises.readdir).toHaveBeenCalledWith(testToolsDir);
            expect(toolRegistry.getToolCount()).toBe(1);
            expect(toolRegistry.getTool('toolA')?.description).toBe('Description 2'); // The last one loaded wins
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Warning: Duplicate tool name "toolA" found in toolADupe2Tool.ts. Overwriting.'));
            consoleWarnSpy.mockRestore();
        });
    });

    describe('getToolDefinitions', () => {
        it('should return an empty array if no tools are loaded', () => {
            expect(toolRegistry.getToolDefinitions()).toEqual([]);
        });

        it('should return definitions for all loaded tools', async () => {
            const mockToolFiles = ['toolXTool.ts', 'toolYTool.ts'];
            // Removed unused variables toolXPath, toolYPath
            const mockToolX = createMockTool('toolX', 'Desc X', 'resX');
            mockToolX.default.parameters = {
                type: 'object',
                properties: { paramX: { type: 'string', description: 'pX' } },
                required: ['paramX']
            };
            const mockToolY = createMockTool('toolY', 'Desc Y', 'resY');

            // Configure the mocked readdir
            vi.mocked(fsPromises.readdir).mockResolvedValue(mockToolFiles as any);

            // Manually add tools, bypassing loadTools
            (toolRegistry as any).tools.set(mockToolX.default.name, mockToolX.default);
            (toolRegistry as any).tools.set(mockToolY.default.name, mockToolY.default);

            const definitions = toolRegistry.getToolDefinitions();
            // expect(fsPromises.readdir).toHaveBeenCalledWith(testToolsDir); // No longer relevant
            expect(definitions).toHaveLength(2);
            expect(definitions).toEqual(expect.arrayContaining([
                { name: 'toolX', description: 'Desc X', parameters: mockToolX.default.parameters },
                { name: 'toolY', description: 'Desc Y', parameters: { type: 'object', properties: {} } }, // Default parameters
            ]));
        });
    });

    describe('getTool', () => {
        it('should return undefined if the tool is not found', () => {
            expect(toolRegistry.getTool('nonExistentTool')).toBeUndefined();
        });

        it('should return the correct tool implementation if found', async () => {
             const mockToolFiles = ['myToolTool.ts'];
             // Removed unused variable myToolPath
             const mockMyTool = createMockTool('myTool');

            // Configure the mocked readdir
            vi.mocked(fsPromises.readdir).mockResolvedValue(mockToolFiles as any);

            // Manually add tool, bypassing loadTools
            (toolRegistry as any).tools.set(mockMyTool.default.name, mockMyTool.default);

            const tool = toolRegistry.getTool('myTool');
            // expect(fsPromises.readdir).toHaveBeenCalledWith(testToolsDir); // No longer relevant
            expect(tool).toBeDefined();
            expect(tool?.name).toBe('myTool');
            expect(tool?.execute).toBe(mockMyTool.default.execute);
        });
    });

    describe('executeTool', () => {
        let mockExecTool: { default: ToolImplementation };

        beforeEach(async () => {
            // Outer beforeEach resets mocks/modules

            // Pre-load a tool for execution tests
            // Removed unused variables mockToolFiles, execToolPath
            mockExecTool = createMockTool('execTool', 'Executable Tool', 'execution success');

            // Manually add the tool to the registry, bypassing loadTools for this test suite
            (toolRegistry as any).tools.set(mockExecTool.default.name, mockExecTool.default);

            // Clear mock calls from setup to isolate execution test assertions
            vi.mocked(mockExecTool.default.execute).mockClear();
        });

        it('should execute the specified tool with given arguments', async () => {
            const args = { input: 'test data' };
            const result = await toolRegistry.executeTool('execTool', args);

            // Access the mocked execute function directly from the stored mock
            expect(mockExecTool.default.execute).toHaveBeenCalledWith(args);
            expect(result).toBe('execution success');
        });

        it('should throw an error if the tool is not found', async () => {
            // No need to load tools again, beforeEach handles it
            await expect(toolRegistry.executeTool('notFoundTool', {})).rejects.toThrow(
                'Tool "notFoundTool" not found.'
            );
        });

        it('should throw an error if the tool execution fails', async () => {
            const executionError = new Error('Tool failed');
            // Mock the rejection on the stored mock's execute function
            vi.mocked(mockExecTool.default.execute).mockRejectedValue(executionError);

            await expect(toolRegistry.executeTool('execTool', {})).rejects.toThrow(
                'Execution failed for tool "execTool": Tool failed'
            );
        });
    });
});