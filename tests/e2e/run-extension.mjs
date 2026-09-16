import { runSuites } from './harness.mjs';
import suite from './extension.e2e.mjs';

const failures = await runSuites([['extension', suite]]);
if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\nAll checks passed.');
}
