import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const { jcs, sizeSection, buildRunDocument, stubOf, utf8Bytes, MAX_DOCUMENT_BYTES } = await import('../dist/nodes/FlurryPortLocker/sizing.js');

test('jcs sorts keys at every level and writes no whitespace', () => {
  assert.equal(jcs({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' } }), '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
  assert.equal(jcs(null), 'null');
  assert.throws(() => jcs(Number.NaN));
});

test('a section under the cap passes through untouched', () => {
  const s = sizeSection([{ a: 1 }, { b: 2 }], 1024);
  assert.equal(s.truncated, false);
  assert.deepEqual(s.value, [{ a: 1 }, { b: 2 }]);
});

test('a section over the cap keeps whole items only, with the count and the fingerprint of the full thing', () => {
  const items = Array.from({ length: 50 }, (_, i) => ({ i, text: 'x'.repeat(40) }));
  const s = sizeSection(items, 600);
  assert.equal(s.truncated, true);
  assert.equal(s.itemCount, 50);
  assert.ok(s.keptCount > 0 && s.keptCount < 50);
  assert.ok(utf8Bytes(jcs(s.value)) <= 600, 'the kept items fit');
  assert.deepEqual(s.value, items.slice(0, s.keptCount), 'the first N whole items, never half of one');
  assert.equal(s.sha256, createHash('sha256').update(jcs(items), 'utf8').digest('hex'));
});

test('a non-array over the cap is replaced by its fingerprint alone', () => {
  const s = sizeSection({ blob: 'y'.repeat(2000) }, 100);
  assert.equal(s.truncated, true);
  assert.equal(s.value, null);
  assert.equal(typeof s.sha256, 'string');
});

test('the document is locker.run/1 with the sections in place; the stub keeps the hashes and drops the items', () => {
  const doc = buildRunDocument({
    clientVersion: '0.1.0',
    workflowId: 'wf_1',
    workflowName: 'Order to invoice',
    executionId: '123',
    mode: 'trigger',
    status: 'success',
    finishedAt: '2026-11-07T00:00:00.000Z',
    inputs: sizeSection([{ orderId: 1 }], 1024),
    outputs: sizeSection([{ invoiceId: 'INV-7' }], 1024),
    binaries: [],
    labels: { env: 'prod' },
  });
  assert.equal(doc.schema, 'locker.run/1');
  assert.equal(doc.platform, 'n8n');
  assert.deepEqual(doc.workflow, { id: 'wf_1', name: 'Order to invoice' });
  assert.equal(doc.run.id, '123');
  assert.deepEqual(doc.inputs, { items: [{ orderId: 1 }], truncated: false });
  assert.equal(doc.binaries, undefined);
  assert.deepEqual(doc.labels, { env: 'prod' });
  assert.ok(utf8Bytes(jcs(doc)) < MAX_DOCUMENT_BYTES);

  const stub = stubOf(doc);
  assert.equal(stub.stub, true);
  assert.equal(stub.inputs.stub, true);
  assert.equal(stub.inputs.sha256, createHash('sha256').update(jcs(doc.inputs), 'utf8').digest('hex'));
  assert.equal(stub.outputs.stub, true);
  assert.equal(stub.schema, 'locker.run/1');
});
