import { config as loadDotenv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  probeIFindCapabilities,
  readIFindConfigFromEnv,
  readIFindRequestFile,
  writeIFindCapabilityMatrix,
} from '../services/ifindProbe';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(scriptDir, '..');
const workspaceRoot = resolve(serverRoot, '..');

loadDotenv({ path: resolve(serverRoot, '.env') });

async function main(): Promise<void> {
  const config = readIFindConfigFromEnv();
  const requestFileValue = process.env.IFIND_PROBE_REQUEST_FILE?.trim();
  const requestFile = requestFileValue
    ? resolve(workspaceRoot, requestFileValue)
    : undefined;
  const customRequests = requestFile ? await readIFindRequestFile(requestFile) : undefined;
  const matrix = await probeIFindCapabilities({ ...config, customRequests });
  const researchRoot = resolve(workspaceRoot, process.env.IFIND_RESEARCH_ROOT?.trim() || 'docs/research');
  const paths = await writeIFindCapabilityMatrix(researchRoot, matrix);

  console.log(`iFinD shadow capability probe completed: ${matrix.results.length} checks`);
  for (const result of matrix.results) {
    console.log(`${result.capability}\t${result.status}${result.message ? `\t${result.message}` : ''}`);
  }
  console.log(`JSON: ${paths.jsonPath}`);
  console.log(`Markdown: ${paths.markdownPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`iFinD capability probe failed: ${message}`);
  process.exitCode = 1;
});
