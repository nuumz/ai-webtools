// Runs every e2e suite and exits non-zero if any check failed.
import mutation from './mutation.e2e.mjs';
import capture from './capture.e2e.mjs';
import story from './story.e2e.mjs';

const suites = [mutation, capture, story];
let failures = 0;
for (const suite of suites) failures += await suite();

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\nAll checks passed.');
}
