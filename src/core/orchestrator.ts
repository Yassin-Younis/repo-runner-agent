import { promises as fs } from 'fs';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { initializeOpenAI, getOpenAIClient } from '../llm/openaiClient';
import { tools } from '../llm/tools';
import { cloneAndCheckout } from '../git/client';
import { listDirectoryStructure, cleanupRepo } from '../utils/fsUtils';
import { runningProcesses } from '../process/manager'; // Import map and cleanupAll
import * as logger from '../utils/logger';
import {
    TEMP_DIR_PREFIX,
    MAX_LLM_TURNS,
    MAX_TOOL_RESULT_LENGTH,
    LLM_MODEL,
    FinalOutcome,
    RunOptions
} from '../config';
import {getInitialUserPrompt, getSystemPrompt} from "../llm/prompts";
import {executeToolCall} from "../llm/executor";

/**
 * Main orchestration function to clone and attempt to run a repository.
 * @param options Configuration options including repo details and API keys.
 * @returns A Promise resolving to the FinalOutcome object.
 */
export async function cloneAndRun(options: RunOptions): Promise<FinalOutcome> {
    const { repoUrl, commitHash, openaiApiKey, githubToken } = options;
    let tempRepoPath: string | undefined;
    let finalOutcome: FinalOutcome | null = null; // Use null initially

    // Ensure OpenAI client is ready
    initializeOpenAI(openaiApiKey);
    const openai = getOpenAIClient();

    try {
        // 1. Create Temporary Directory
        tempRepoPath = await fs.mkdtemp(TEMP_DIR_PREFIX);
        logger.log(`Created temporary directory: ${tempRepoPath}`);
        logger.log(`Starting analysis for ${repoUrl}#${commitHash}`);

        // Set default failure outcome (repoPath needs to be set here)
        finalOutcome = { status: 'failure', url: null, notes: 'Analysis did not complete successfully.', repoPath: tempRepoPath };


        // 2. Clone & Checkout
        await cloneAndCheckout(repoUrl, tempRepoPath, commitHash, githubToken);

        // 3. Get Initial File Structure
        const dirStructureArray = await listDirectoryStructure(tempRepoPath); // Pass only the path
        const initialStructure = dirStructureArray.join('\n') || "[Empty Directory or Listing Failed]";
        logger.logPreview("Initial Directory Structure", initialStructure);


        // 4. Prepare LLM Conversation
        const messages: ChatCompletionMessageParam[] = [
            {
                role: "system",
                content: getSystemPrompt(tempRepoPath),
            },
            {
                role: "user",
                content: getInitialUserPrompt(tempRepoPath, initialStructure),
            },
        ];

        // 5. LLM Interaction Loop
        let loopCompleted = false;
        for (let i = 0; i < MAX_LLM_TURNS; i++) {
            logger.log(`\n--- Turn ${i + 1}/${MAX_LLM_TURNS} ---`);
            const lastMessage = messages[messages.length - 1];
            logger.logPreview(`Sending ${lastMessage.role} message to LLM`, lastMessage.content || '[Tool Call/Response]');

            const response = await openai.chat.completions.create({
                model: LLM_MODEL, // Use configured model
                messages: messages,
                tools: tools,
                tool_choice: "auto",
            });

            const responseMessage = response.choices[0].message;

            if (!responseMessage) {
                logger.warn("LLM response message is empty. Stopping.");
                finalOutcome.notes = 'LLM response was empty.';
                loopCompleted = true;
                break;
            }

            messages.push(responseMessage); // Add assistant's response

            if (responseMessage.tool_calls) {
                logger.log(`LLM requested tool(s): ${responseMessage.tool_calls.map(tc => tc.function.name).join(', ')}`);
                // Prepare array for tool results to be pushed back
                const toolResultsMessages: ChatCompletionMessageParam[] = [];

                for (const toolCall of responseMessage.tool_calls) {
                    if (!toolCall.id) {
                        logger.error("Tool call missing 'id'. Skipping.");
                        continue; // Should not happen with OpenAI API
                    }

                    const toolResult = await executeToolCall(toolCall, tempRepoPath);

                    // Check if the tool signaled a final outcome
                    if (toolResult.finalOutcome) {
                        logger.log(`Tool '${toolCall.function.name}' signaled end of process.`);
                        // Update the final outcome, preserving repoPath
                        finalOutcome = { ...toolResult.finalOutcome, repoPath: tempRepoPath };
                        loopCompleted = true;
                        break; // Break from processing tool calls for this turn
                    }

                    // Truncate result before sending back to LLM
                    const toolResultString = JSON.stringify(toolResult);
                    const truncatedResultString = toolResultString.length > MAX_TOOL_RESULT_LENGTH
                        ? toolResultString.substring(0, MAX_TOOL_RESULT_LENGTH) + "... (truncated)"
                        : toolResultString;

                    logger.logPreview(`Tool result for ${toolCall.function.name}`, toolResult); // Log full result preview locally

                    toolResultsMessages.push({
                        tool_call_id: toolCall.id,
                        role: "tool",
                        content: truncatedResultString,
                    });
                }
                messages.push(...toolResultsMessages);

                if (loopCompleted) break;

            } else if (responseMessage.content) {
                logger.log(`LLM Text Response: ${responseMessage.content}`);
                // Optional: Check if the LLM is giving up or asking for clarification
            } else {
                logger.warn("LLM response has neither content nor tool_calls. Stopping.");
                finalOutcome.notes = 'LLM response had no content or tool calls.';
                loopCompleted = true;
                break;
            }

            if (loopCompleted) break; // Exit if finalOutcome set by tool call processing
        }

        // 6. Handle Max Turns Reached
        if (!loopCompleted) {
            logger.warn(`Max turns (${MAX_LLM_TURNS}) reached without conclusive result.`);
            finalOutcome.notes = `Max turns (${MAX_LLM_TURNS}) reached without a conclusive 'markRunning' or 'markUnrunnable' call.`;
            // The 'finally' block will handle cleanup of repo and any tracked processes
        }

        // 7. Log Final Outcome
        logger.log(`\n--- Analysis Complete ---`);
        if (finalOutcome.status === 'success') {
            logger.log(`✅ Status: Success`);
            logger.log(`✅ URL: ${finalOutcome.url}`);
        } else {
            logger.error(`❌ Status: Failure`);
        }
        logger.log(`ℹ️ Notes: ${finalOutcome.notes || 'None'}`);
        logger.log(`ℹ️ Repo Location: ${finalOutcome.repoPath}`);

        return finalOutcome; // Return the determined outcome

    } catch (error: any) {
        logger.error(`\n--- 💥 Unhandled Error During Orchestration ---`);
        logger.error(`An unexpected error occurred: ${error.message}`, error);
        // Ensure finalOutcome exists and includes repoPath if available
        const notes = `Unhandled exception during analysis: ${error.message}`;
        if (finalOutcome) {
            finalOutcome.status = 'failure';
            finalOutcome.notes = notes;
        } else {
            // If error happened before finalOutcome was initialized (e.g., mkdtemp fails)
            finalOutcome = { status: 'failure', url: null, notes: notes, repoPath: tempRepoPath || 'unknown' };
        }
        await terminateTrackedProcess(tempRepoPath || '')
        return finalOutcome; // Return failure outcome
    }
}

export async function terminateTrackedProcess(repoPath: string): Promise<void> {
    if (repoPath) {
        logger.log(`--- Initiating Cleanup for ${repoPath} ---`);
        // Pass the global runningProcesses map to cleanupRepo
        await cleanupRepo(repoPath, runningProcesses);
    } else {
        logger.log("--- No temporary directory path found for cleanup ---");
    }
}