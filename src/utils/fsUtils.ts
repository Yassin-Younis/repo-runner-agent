import { promises as fs } from 'fs';
import path from 'path';
import * as logger from './logger';
import { MAX_DIR_LISTING_DEPTH, MAX_DIR_ITEMS } from '../config';
import { terminateTrackedProcess } from '../process/manager'; // Import process termination logic

/**
 * Lists directory structure recursively up to a max depth and item count.
 */
export async function listDirectoryStructure(
    dirPath: string,
    maxDepth = MAX_DIR_LISTING_DEPTH,
    currentDepth = 0,
    itemCount = { count: 0 },
    maxItems = MAX_DIR_ITEMS,
    repoRoot = dirPath // Keep track of the root for relative paths
): Promise<string[]> {
    if (currentDepth > maxDepth || itemCount.count >= maxItems) {
        return [];
    }
    let structure: string[] = [];
    try {
        const dirents = await fs.readdir(dirPath, { withFileTypes: true });
        for (const dirent of dirents) {
            if (itemCount.count >= maxItems) break;
            // Skip common ignored directories/files
            if (['.git', 'node_modules', '.DS_Store', '.next', '.vercel'].includes(dirent.name)) {
                continue;
            }

            const entryPath = path.join(dirPath, dirent.name);
            const relativePath = path.relative(repoRoot, entryPath); // Get path relative to repo root
            const prefix = '  '.repeat(currentDepth);
            itemCount.count++;

            if (dirent.isDirectory()) {
                structure.push(`${prefix}📁 ${dirent.name}/`);
                // Pass repoRoot down recursively
                const subStructure = await listDirectoryStructure(entryPath, maxDepth, currentDepth + 1, itemCount, maxItems, repoRoot);
                structure = structure.concat(subStructure);
            } else {
                structure.push(`${prefix}📄 ${dirent.name}`);
            }
        }
    } catch (error: any) {
        logger.warn(`Could not read directory ${dirPath}: ${error.message}`);
        structure.push(`${'  '.repeat(currentDepth)}⚠️ Error reading directory: ${path.basename(dirPath)}`);
    }
    return structure;
}


/**
 * Cleans up the repository directory, attempting to terminate any tracked processes first.
 * @param repoPath Absolute path to the directory to delete.
 * @param runningProcesses A map containing tracked processes for potentially multiple repos.
 */
export async function cleanupRepo(repoPath: string, runningProcesses: Map<string, any>): Promise<void> {
    if (!repoPath) {
        logger.warn(`Cleanup requested, but repoPath is invalid.`);
        return;
    }

    // Attempt to terminate tracked process associated *specifically* with this repoPath
    await terminateTrackedProcess(repoPath, runningProcesses); // Use the dedicated function

    logger.log(`Deleting repository directory: ${repoPath}`);
    try {
        let attempts = 0;
        const maxAttempts = 3;
        const delay = 1000; // 1 second delay

        while (attempts < maxAttempts) {
            try {
                await fs.rm(repoPath, { recursive: true, force: true });
                logger.log(`Cleanup complete for ${repoPath}.`);
                return; // Success
            } catch (rmError: any) {
                attempts++;
                if (attempts >= maxAttempts) {
                    throw rmError; // Rethrow error after last attempt
                }
                logger.warn(`Attempt ${attempts}/${maxAttempts} failed to delete ${repoPath}: ${rmError.message}. Retrying in ${delay / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    } catch (cleanupError: any) {
        logger.error(`Failed to clean up directory ${repoPath}:`, cleanupError);
        // Decide if this should throw or just log
    }
}