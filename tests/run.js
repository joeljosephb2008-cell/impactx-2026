// Run the evaluation harness from the command line: node tests/run.js
require('../js/sha256.js');
require('../js/engine.js');
require('../js/scenario.js');
require('../js/tests.js');
const r = TestHarness.runAll(Engine, Scenario);
for (const c of r.cases) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.id.padEnd(12)} ${c.name}${c.detail ? '  [' + c.detail + ']' : ''}`);
console.log(`\n${r.passed}/${r.total} passed (${Math.round(r.rate * 100)}%)`);
for (const m of Object.values(r.metrics)) console.log(`${m.name}: ${m.value}`);
process.exit(r.passed === r.total ? 0 : 1);
