import assert from 'node:assert/strict';
import test from 'node:test';

import { runCli } from '../helpers/cli.mjs';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseIssueFromBranch } = require('../../dist/commands/end.js');

// ── CLI integration ───────────────────────────────────────────

test('collab end --help shows description and options', () => {
  const result = runCli(['end', '--help']);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('Finalize current work'), 'should show description');
  assert.ok(result.stdout.includes('--dry-run'), 'should show --dry-run option');
  assert.ok(result.stdout.includes('--skip-canon-sync'), 'should show --skip-canon-sync option');
  assert.ok(result.stdout.includes('--title'), 'should show --title option');
  assert.ok(result.stdout.includes('--base'), 'should show --base option');
});

test('collab --help lists end command', () => {
  const result = runCli(['--help']);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('end'), 'should list end command');
});

// ── parseIssueFromBranch ──────────────────────────────────────

test('parseIssueFromBranch extracts issue from feature branch', () => {
  assert.equal(parseIssueFromBranch('feature/42-add-login'), 42);
});

test('parseIssueFromBranch extracts issue from fix branch', () => {
  assert.equal(parseIssueFromBranch('fix/88-align-flow'), 88);
});

test('parseIssueFromBranch extracts issue from refactor branch', () => {
  assert.equal(parseIssueFromBranch('refactor/10-cleanup'), 10);
});

test('parseIssueFromBranch extracts issue from chore branch', () => {
  assert.equal(parseIssueFromBranch('chore/5-update-deps'), 5);
});

test('parseIssueFromBranch returns null for development', () => {
  assert.equal(parseIssueFromBranch('development'), null);
});

test('parseIssueFromBranch returns null for main', () => {
  assert.equal(parseIssueFromBranch('main'), null);
});

test('parseIssueFromBranch returns null for branch without issue number', () => {
  assert.equal(parseIssueFromBranch('feature/add-login'), null);
});

test('parseIssueFromBranch handles docs and test prefixes', () => {
  assert.equal(parseIssueFromBranch('docs/7-readme'), 7);
  assert.equal(parseIssueFromBranch('test/12-coverage'), 12);
});
