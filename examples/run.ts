import * as dotenv from 'dotenv';
import {cloneAndRun} from "../src/index.ts";

dotenv.config();
async function runExample() {
    const options = {
        repoUrl: process.env.REPO_URL || "https://github.com/andrewagain/calculator.git", // Example repo
        commitHash: process.env.COMMIT_HASH || "a19f37a", // Example commit
        githubToken: process.env.GITHUB_TOKEN || null, // Optional: For private repos
        openaiApiKey: process.env.OPENAI_API_KEY || "", // Mandatory
    };

    if (!options.openaiApiKey) {
        console.error("Error: OPENAI_API_KEY environment variable is not set.");
        process.exit(1);
    }

    console.log(`[ExampleRunner] ===============================================`);
    console.log(`[ExampleRunner] Starting analysis with options:`);
    console.log(`[ExampleRunner]   Repo URL: ${options.repoUrl}`);
    console.log(`[ExampleRunner]   Commit/Branch: ${options.commitHash}`);
    console.log(`[ExampleRunner]   Using GitHub Token: ${options.githubToken ? 'Yes' : 'No'}`);
    console.log(`[ExampleRunner] ===============================================\n`);

    let result = null;

    try {
        result = await cloneAndRun(options);

        // --- Logging Final Result ---
        console.log(`\n[ExampleRunner] ===============================================`);
        console.log(`[ExampleRunner] Analysis Finished.`);
        if (result?.status === 'success') {
            console.log(`[ExampleRunner] Final Result: Successfully determined run URL: ${result.url}`);
        } else {
            console.log(`[ExampleRunner] Final Result: Failed or marked unrunnable.`);
        }
        console.log(`[ExampleRunner] Notes: ${result?.notes || 'N/A'}`);
        console.log(`[ExampleRunner] Repository Location: ${result?.repoPath || 'N/A (Error occurred early?)'}`);
        console.log(`[ExampleRunner] ===============================================\n`);

    } catch (err) {
        // Catch errors that might escape analyzeAndRunRepo (should be rare)
        console.error(`[ExampleRunner] Critical script execution error:`, err);
        console.log(`\n[ExampleRunner] ===============================================`);
        console.log(`[ExampleRunner] Final Result: Critical failure during execution.`);
        console.log(`[ExampleRunner] Repository Location (if known): ${result?.repoPath || 'N/A'}`);
        console.log(`[ExampleRunner] ===============================================\n`);
        process.exitCode = 1; // Indicate failure
    }
    // Note: Cleanup is handled *inside* analyzeAndRunRepo's finally block now.
}

runExample().catch(err => {
    console.error(`[ExampleRunner] Top-level unhandled rejection:`, err);
    process.exit(1);
});