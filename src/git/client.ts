import { simpleGit, SimpleGit, SimpleGitOptions } from 'simple-git';
import * as logger from '../utils/logger';

/**
 * Clones a repository and checks out a specific commit/branch.
 * @param repoUrl URL of the repository.
 * @param targetPath Absolute path where the repo should be cloned.
 * @param commitHash Specific commit or branch name to checkout.
 * @param accessToken Optional GitHub access token.
 * @returns SimpleGit instance for the cloned repo.
 * @throws Error if cloning or checkout fails.
 */
export async function cloneAndCheckout(
    repoUrl: string,
    targetPath: string,
    commitHash: string,
    accessToken: string | null = null
): Promise<SimpleGit> {
    logger.log(`Cloning ${repoUrl}#${commitHash} into ${targetPath}...`);

    const gitOptions: Partial<SimpleGitOptions> = {
        baseDir: process.cwd(), // Or decide where simpleGit commands run from
        binary: 'git',
        maxConcurrentProcesses: 6, // Default
    };

    const cloneOptions: Record<string, string | null> = {
        '--no-checkout': null, // Clone without checking out files initially
        '--depth': '1', // Shallow clone
        // Note: Cloning directly to a commit hash might require fetching first or different strategy
        // Cloning a branch and then checking out the hash is more reliable with shallow clones
        // '--branch': commitHash, // This works for branches or tags, maybe not specific commit SHAs with depth 1
    };

    // Add token header if provided (Handle GitHub vs other providers if necessary)
    if (accessToken) {
        // This specific header is common for GitHub HTTPS
        cloneOptions['--config'] = `http.extraheader=Authorization: Bearer ${accessToken}`;
        logger.log('Using GitHub token for cloning.');
    } else {
        logger.log('Cloning without authentication token.');
    }

    const git = simpleGit(gitOptions);

    try {
        // Clone the default branch first (more reliable with --depth 1)
        await git.clone(repoUrl, targetPath, { '--depth': '1', ...cloneOptions });
        logger.log(`Repository structure cloned to ${targetPath}.`);

        const repoGit = simpleGit(targetPath);

        // Fetch the specific commit if it's not a branch head (needed for --depth 1)
        // We might need to fetch before checkout if commitHash is not the head of default branch
        // try {
        //     logger.log(`Fetching commit ${commitHash}...`);
        //     await repoGit.fetch('origin', commitHash, { '--depth': '1'});
        // } catch(fetchError: any) {
        //     logger.warn(`Could not fetch specific commit ${commitHash} directly (might be branch head or tag): ${fetchError.message}`);
        //     // Proceed to checkout anyway, hoping it's the branch head
        // }

        logger.log(`Checking out ${commitHash}...`);
        await repoGit.checkout(commitHash);
        logger.log(`Checked out ${commitHash} successfully.`);
        return repoGit; // Return git instance scoped to the new repo path
    } catch (error: any) {
        logger.error(`Git operation failed: ${error.message}`);
        // Clean up partial clone? Maybe leave it for the main cleanup function.
        throw new Error(`Failed during git operations: ${error.message}`);
    }
}