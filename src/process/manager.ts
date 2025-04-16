const { execa } = await import('execa');
import { ProcessInfo, DEFAULT_COMMAND_TIMEOUT, SERVER_START_TIMEOUT, MAX_TOOL_RESULT_LENGTH, ToolResult } from '../config';
import * as logger from '../utils/logger';

// Map to store repoPath -> ProcessInfo for detached processes
export const runningProcesses = new Map<string, ProcessInfo>();

/**
 * Terminates a tracked process gracefully (SIGTERM).
 * @param repoPath The path associated with the process to terminate.
 * @param processMap The map holding the tracked processes.
 */
export async function terminateTrackedProcess(repoPath: string, processMap: Map<string, ProcessInfo>): Promise<void> {
    if (processMap.has(repoPath)) {
        const processInfo = processMap.get(repoPath)!;
        logger.log(`Attempting to terminate tracked process PID: ${processInfo.pid} (Command: "${processInfo.command}") for repo ${repoPath}...`);
        try {
            process.kill(processInfo.pid, 'SIGTERM');
            logger.log(`Sent SIGTERM to PID ${processInfo.pid}.`);
        } catch (killError: any) {
            if (killError.code === 'ESRCH') {
                logger.log(`Process PID ${processInfo.pid} not found (likely already stopped).`);
            } else {
                logger.error(`Error sending SIGTERM to process PID ${processInfo.pid}: ${killError.message} (Code: ${killError.code})`);
            }
        } finally {
            processMap.delete(repoPath);
            logger.log(`Removed PID ${processInfo.pid} from tracking for ${repoPath}.`);
        }
    } else {
        logger.log(`No tracked running process found for ${repoPath} to terminate.`);
    }
}

/**
 * Executes a shell command, handling both normal and long-running (detached) cases.
 * @param repoPath CWD for the command.
 * @param command The command executable.
 * @param args Command arguments.
 * @param isLongRunning If true, run detached and monitor initial output.
 * @param timeoutOverride Optional timeout override (ms). Ignored for long-running.
 * @returns A ToolResult object.
 */
export async function executeCommand(
    repoPath: string,
    command: string,
    args: string[],
    isLongRunning: boolean = false,
    timeoutOverride?: number
): Promise<Omit<ToolResult, 'finalOutcome'>> { // Exclude finalOutcome as this tool doesn't set it
    const commandStr = `${command} ${args.join(' ')}`;
    logger.warn(`Executing command: ${commandStr} in ${repoPath} (isLongRunning: ${isLongRunning})`);

    // Kill existing tracked process for this repo if starting a new long-running one
    if (isLongRunning) {
        await terminateTrackedProcess(repoPath, runningProcesses);
    }

    if (isLongRunning) {
        // --- Handle Detached Long-Running Process ---
        return new Promise((resolve) => {
            let stdoutData = '';
            let stderrData = '';
            let processExited = false;
            let exitCode: number | null = null;
            let pid: number | undefined;
            let notes = '';
            let detectedPort: string | null = null;
            let timer: NodeJS.Timeout | null = null;
            let resultSent = false;
            let childProcess: any = null;


            const cleanupListeners = () => {
                if (!childProcess) return;
                childProcess.stdout?.removeAllListeners('data');
                childProcess.stderr?.removeAllListeners('data');
                childProcess.removeAllListeners('exit');
                childProcess.removeAllListeners('error');
                if(pid) logger.log(`[PID ${pid}] Removed output/exit listeners.`);
            };

            try {
                childProcess = execa(command, args, {
                    cwd: repoPath,
                    detached: true,
                    stdio: ['ignore', 'pipe', 'pipe'], // Detached requires specific stdio
                    reject: false, // Handle errors manually
                    env: { ...process.env, FORCE_COLOR: '0' }, // Prevent ANSI color codes
                    windowsHide: true, // Hide window on Windows
                });

                pid = childProcess.pid;
                if (pid === undefined) {
                    throw new Error("Failed to get PID for detached process.");
                }
                logger.log(`Started detached process with PID: ${pid}`);

                childProcess.on('exit', (code, signal) => {
                    processExited = true;
                    exitCode = code;
                    if (!resultSent) {
                        logger.warn(`Detached process PID ${pid} exited early with code ${code}, signal ${signal}.`);
                        notes = `Detached process exited prematurely (code: ${code}, signal: ${signal}). Startup failed.`;
                        resolve({ success: false, pid: pid, exitCode: exitCode, stdout: stdoutData.slice(-MAX_TOOL_RESULT_LENGTH / 2), stderr: stderrData.slice(-MAX_TOOL_RESULT_LENGTH / 2), notes: notes, isRunningDetached: true });
                        resultSent = true;
                        if (timer) clearTimeout(timer);
                        cleanupListeners();
                    } else {
                        logger.log(`[PID ${pid}] Detached process exited (code ${code}, signal ${signal}) after initial check.`);
                        // Process exited after we assumed it was running, remove from tracking
                        if (runningProcesses.has(repoPath) && runningProcesses.get(repoPath)?.pid === pid) {
                            logger.warn(`[PID ${pid}] Removing process from tracking as it exited after being marked as running.`);
                            runningProcesses.delete(repoPath);
                        }
                    }
                    // If the process exits cleanly or otherwise, we need to ensure it's not tracked anymore
                    if(runningProcesses.has(repoPath) && runningProcesses.get(repoPath)?.pid === pid) {
                        runningProcesses.delete(repoPath);
                    }
                });

                childProcess.on('error', (err) => {
                    if (!resultSent) {
                        processExited = true; // Treat error as exit
                        logger.error(`Error spawning/running detached process PID ${pid}: ${err.message}`);
                        notes = `Error running detached command: ${err.message}`;
                        resolve({ success: false, pid: pid, error: err.message, stdout: stdoutData.slice(-MAX_TOOL_RESULT_LENGTH / 2), stderr: stderrData.slice(-MAX_TOOL_RESULT_LENGTH / 2), notes: notes, isRunningDetached: true });
                        resultSent = true;
                        if (timer) clearTimeout(timer);
                        cleanupListeners();
                    }
                    // Ensure not tracked on error
                    if(pid && runningProcesses.has(repoPath) && runningProcesses.get(repoPath)?.pid === pid) {
                        runningProcesses.delete(repoPath);
                    }
                });

                // Capture initial output
                childProcess.stdout?.on('data', (data) => { stdoutData += data.toString(); });
                childProcess.stderr?.on('data', (data) => { stderrData += data.toString(); });

                // Detach the child process properly so it continues running after the parent exits
                childProcess.unref(); // Allows parent to exit independently

                // Check output after timeout
                timer = setTimeout(() => {
                    if (processExited || resultSent) return; // Already handled

                    logger.log(`${SERVER_START_TIMEOUT / 1000}s check timeout reached for PID ${pid}. Analyzing captured output...`);
                    const combinedOutput = `stdout:\n${stdoutData}\n\nstderr:\n${stderrData}`;

                    const portRegex = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{4,5})|on port (\d{4,5})/i;
                    const successRegex = /compiled successfully|ready on|listening on|server started|development server is running at|started successfully/i;
                    const portMatch = combinedOutput.match(portRegex);
                    const successMatch = combinedOutput.match(successRegex);
                    detectedPort = portMatch ? (portMatch[1] || portMatch[2]) : null;
                    let successDetected = false;

                    if (successMatch || detectedPort) {
                        successDetected = true;
                        notes = `Detached process (PID: ${pid}) started. Initial output within ${SERVER_START_TIMEOUT / 1000}s suggests success. ${successMatch ? `Found pattern: "${successMatch[0]}"` : ''} ${detectedPort ? `Detected port: ${detectedPort}.` : ''} Process continues in background.`;
                        logger.log(`Success pattern or port found for PID ${pid}. Assuming successful start.`);
                        // Track the process
                        runningProcesses.set(repoPath, { pid: pid!, command: commandStr });
                        logger.log(`Added PID ${pid} to tracking for ${repoPath}.`);
                    } else {
                        successDetected = false;
                        notes = `Detached process (PID: ${pid}) started, but no clear success message or port found in initial output within ${SERVER_START_TIMEOUT / 1000}s. Assuming startup failed or is unrecognized. Process may still be running but is NOT tracked.`;
                        logger.warn(`No success patterns found for PID ${pid}. Assuming failed start. Process will NOT be tracked.`);
                        // DO NOT add to runningProcesses map if startup looks failed
                    }

                    resolve({
                        success: successDetected,
                        pid: pid,
                        stdout: stdoutData.slice(-MAX_TOOL_RESULT_LENGTH / 2),
                        stderr: stderrData.slice(-MAX_TOOL_RESULT_LENGTH / 2),
                        notes: notes,
                        detectedPort: detectedPort,
                        isRunningDetached: true
                    });
                    resultSent = true;
                    cleanupListeners(); // Stop listening to output after the check

                }, SERVER_START_TIMEOUT);

            } catch (error: any) {
                // Handle errors during setup (e.g., execa call fails immediately)
                logger.error(`Failed to initiate detached process: ${error.message}`);
                resolve({ success: false, error: `Failed to start detached process: ${error.message}`, isRunningDetached: true });
                resultSent = true; // Ensure promise resolves
                if (timer) clearTimeout(timer); // Clean up timer if it was set
                cleanupListeners(); // Attempt cleanup just in case
            }
        }); // End Promise

    } else {
        // --- Handle Normal (Non-Detached) Command ---
        const timeout = timeoutOverride || DEFAULT_COMMAND_TIMEOUT;
        logger.log(`Using timeout: ${timeout}ms`);
        try {
            const result = await execa(command, args, {
                cwd: repoPath,
                timeout: timeout,
                reject: false, // Don't throw on non-zero exit code
                stripFinalNewline: true,
                env: { ...process.env, FORCE_COLOR: '0' },
            });

            const truncatedStdout = result.stdout.slice(-MAX_TOOL_RESULT_LENGTH / 2);
            const truncatedStderr = result.stderr.slice(-MAX_TOOL_RESULT_LENGTH / 2);
            logger.log(`runCommand Result: Exit Code=${result.exitCode}, TimedOut=${result.timedOut}, Signal=${result.signal || 'none'}`);
            logger.logPreview(`runCommand Stdout`, truncatedStdout);
            logger.logPreview(`runCommand Stderr`, truncatedStderr);


            let success = result.exitCode === 0 && !result.timedOut;
            let notes = "";
            if (success) { notes = "Command completed successfully."; }
            else if (result.timedOut) { notes = `Command timed out after ${timeout}ms.`; success = false; } // Ensure success is false on timeout
            else { notes = `Command failed with exit code ${result.exitCode}. Check stderr.`; }

            return { success: success, stdout: truncatedStdout, stderr: truncatedStderr, exitCode: result.exitCode, timedOut: result.timedOut ?? false, signal: result.signal, notes: notes, isRunningDetached: false };

        } catch (error: any) {
            // Catch errors from execa itself (e.g., command not found)
            logger.error(`Execa failed for non-detached command: ${error.message}`);
            return { success: false, error: `Command execution failed: ${error.message}`, stderr: error.stderr || '', stdout: error.stdout || '', isRunningDetached: false, notes: `Command execution failed: ${error.message}` };
        }
    }
}

/**
 * Cleans up ALL tracked processes. Useful for application shutdown.
 */
export async function cleanupAllTrackedProcesses(): Promise<void> {
    logger.warn(`Attempting to clean up ALL ${runningProcesses.size} tracked processes...`);
    const cleanupPromises = Array.from(runningProcesses.keys()).map(repoPath =>
        terminateTrackedProcess(repoPath, runningProcesses)
    );
    await Promise.allSettled(cleanupPromises); // Wait for all termination attempts
    if (runningProcesses.size > 0) {
        logger.error(`Failed to terminate all processes. ${runningProcesses.size} remain tracked.`);
    } else {
        logger.log(`All tracked processes terminated successfully.`);
    }
}