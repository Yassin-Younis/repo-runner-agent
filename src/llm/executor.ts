import { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';
import { promises as fs } from 'fs';
import path from 'path';
import * as logger from '../utils/logger';
import { resolveSecurePath } from '../utils/pathUtils';
import { executeCommand, runningProcesses, terminateTrackedProcess } from '../process/manager';
import { MAX_FILE_CONTENT_LENGTH, ToolResult, ProcessInfo } from '../config';

/**
 * Executes a tool call requested by the LLM.
 * @param toolCall The tool call object from the LLM response.
 * @param repoPath The absolute path to the repository working directory.
 * @returns A promise resolving to a ToolResult object.
 */
export async function executeToolCall(
    toolCall: ChatCompletionMessageToolCall,
    repoPath: string
): Promise<ToolResult> {
    const functionName = toolCall.function.name;
    let args: any;

    try {
        args = JSON.parse(toolCall.function.arguments);
    } catch (parseError: any) {
        logger.error(`Error parsing arguments for tool ${functionName}: ${parseError}`);
        return { success: false, error: `Failed to parse arguments: ${parseError.message}` };
    }

    logger.log(`\nEXECUTING TOOL: ${functionName}`);
    logger.log(`Arguments: ${JSON.stringify(args)}`);

    try {
        // --- File Operations ---
        if (["inspectFile", "createFile", "editFile"].includes(functionName)) {
            if (!args.filePath) {
                throw new Error("filePath argument is missing.");
            }
            const safeFilePath = resolveSecurePath(repoPath, args.filePath);

            if (functionName === "inspectFile") {
                const content = await fs.readFile(safeFilePath, 'utf-8');
                logger.log(`inspectFile: Read ${args.filePath}, returning ${Math.min(content.length, MAX_FILE_CONTENT_LENGTH)} chars.`);
                return { success: true, content: content.substring(0, MAX_FILE_CONTENT_LENGTH) };
            } else { // createFile or editFile
                if (typeof args.content !== 'string') {
                    throw new Error("content argument must be a string for file creation/editing.");
                }
                if (functionName === "createFile") {
                    await fs.mkdir(path.dirname(safeFilePath), { recursive: true });
                }
                await fs.writeFile(safeFilePath, args.content);
                const action = functionName === 'createFile' ? 'created' : 'edited';
                logger.log(`${functionName}: File ${args.filePath} ${action}.`);
                return { success: true, message: `File ${args.filePath} ${action}.` };
            }
        }
        // --- Command Execution ---
        else if (functionName === "runCommand") {
            if (!args.command || !Array.isArray(args.args)) {
                throw new Error("command (string) and args (array) are required for runCommand.");
            }
            // Directly call the process manager function
            // The process manager now handles killing previous long-running processes internally
            return await executeCommand(repoPath, args.command, args.args, args.isLongRunning, args.timeout);
        }
        // --- Final Outcome Markers ---
        else if (functionName === "markRunning") {
            if (!args.deploymentUrl) throw new Error("deploymentUrl argument is missing.");
            logger.log(`✅ LLM marked project as running: ${args.deploymentUrl}`);
            const runningProcInfo = runningProcesses.get(repoPath); // Get info if tracked
            const notes = `${args.notes || 'None'} ${runningProcInfo ? `(Tracked background process PID: ${runningProcInfo.pid})` : '(No tracked background process)'}`;
            logger.log(`Notes: ${notes}`);
            // Return the special structure indicating a final outcome
            return { success: true, finalOutcome: { status: 'success', url: args.deploymentUrl, notes: notes } };
        } else if (functionName === "markUnrunnable") {
            if (!args.reason) throw new Error("reason argument is missing.");
            logger.log(`❌ LLM marked project as unrunnable: ${args.reason}`);
            // Attempt cleanup kill for any tracked process for this repo when marked unrunnable
            await terminateTrackedProcess(repoPath, runningProcesses);
            return { success: true, finalOutcome: { status: 'failure', url: null, notes: args.reason } };
        }
        // --- Unknown Tool ---
        else {
            logger.error(`Unknown tool function called: ${functionName}`);
            throw new Error(`Unknown tool: ${functionName}`);
        }
    } catch (error: any) {
        logger.error(`Error executing tool ${functionName}:`, error);
        // Return a standard error result format
        return { success: false, error: `Tool execution failed: ${error.message}` };
    }
}