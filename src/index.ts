import { runTest } from './yaml-runner';

const yamlPath = process.argv[2];

if (!yamlPath) {
  console.log('');
  console.log('  QAA — Quality Assurance Agent');
  console.log('');
  console.log('  Usage:  bun src/index.ts <test-file.yaml>');
  console.log('  Example: bun src/index.ts tests/example.yaml');
  console.log('');
  console.log('  YAML format:');
  console.log('    name: "My Test"');
  console.log('    steps:');
  console.log('      - Navigate to https://example.com');
  console.log('      - Click the Sign In button');
  console.log('      - Type "user@email.com" in the email field');
  console.log('');
  process.exit(0);
}

runTest(yamlPath).catch(err => {
  console.error('\n  Fatal error:', err.message);
  process.exit(1);
});
