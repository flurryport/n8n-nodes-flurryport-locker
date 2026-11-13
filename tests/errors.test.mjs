import test from 'node:test';
import assert from 'node:assert/strict';

const { describeFailure, retryAfterSeconds } = await import('../dist/nodes/FlurryPortLocker/errors.js');

test('every status maps to a reason that says what happened and what to do, never the forbidden words', () => {
  for (const [status, body] of [
    [400, { title: 'locker_run_invalid', detail: 'schema must be "locker.run/1".' }],
    [401, {}],
    [404, {}],
    [409, { title: 'locker_run_conflict', detail: 'send a new key' }],
    [410, { title: 'locker_install_revoked' }],
    [413, { title: 'locker_run_too_large' }],
    [429, {}],
    [500, {}],
    [undefined, undefined],
  ]) {
    const f = describeFailure(status, body);
    assert.equal(f.archived, false);
    assert.ok(f.reason.length > 10, `status ${status} has a reason`);
    assert.doesNotMatch(f.reason, /\b(error|problem|failure)\b/i, `status ${status}: ${f.reason}`);
  }
  assert.equal(describeFailure(400, { title: 'locker_run_invalid' }).code, 'locker_run_invalid');
  assert.equal(describeFailure(429, {}).retryable, true);
  assert.equal(describeFailure(503, {}).retryable, true);
  assert.equal(describeFailure(409, {}).retryable, false);
  assert.equal(describeFailure(undefined, undefined).retryable, true);
  assert.equal(describeFailure(undefined, undefined).code, 'network');
});

test('Retry-After is honoured and bounded at 30 seconds', () => {
  assert.equal(retryAfterSeconds('7'), 7);
  assert.equal(retryAfterSeconds('120'), 30);
  assert.equal(retryAfterSeconds(undefined), 5);
  assert.equal(retryAfterSeconds('nope'), 5);
});
