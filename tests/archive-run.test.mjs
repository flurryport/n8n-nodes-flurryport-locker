import test from 'node:test';
import assert from 'node:assert/strict';

const { FlurryPortLocker } = await import('../dist/nodes/FlurryPortLocker/FlurryPortLocker.node.js');

/** A fake IExecuteFunctions: parameters, credentials, the items, and the HTTP helper answering by script. */
function context({ items = [], params = {}, responses = [], binaries = {} } = {}) {
  const calls = [];
  let n = 0;
  const defaults = { resource: 'run', operation: 'archive', inputs: '', outputs: '', runStatus: 'success', labels: {}, options: {} };
  const ctx = {
    calls,
    getInputData: () => items,
    getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : name in defaults ? defaults[name] : fallback),
    getCredentials: async () => ({ installKey: 'fp_test', baseUrl: 'https://api.test' }),
    getWorkflow: () => ({ id: 'wf_9', name: 'Order to invoice' }),
    getExecutionId: () => 'exec_42',
    getMode: () => 'trigger',
    getNode: () => ({ name: 'Locker', type: 'flurryPortLocker', typeVersion: 1 }),
    continueOnFail: () => false,
    helpers: {
      httpRequestWithAuthentication: async function (credential, options) {
        calls.push({ credential, options });
        const r = responses[Math.min(n++, responses.length - 1)];
        if (r instanceof Error) throw r;
        return { statusCode: r.status, body: r.body, headers: r.headers ?? {} };
      },
      getBinaryDataBuffer: async (i, property) => binaries[`${i}:${property}`] ?? Buffer.from(''),
    },
  };
  return ctx;
}

const receipt = { ReceiptId: '2BsKb3W3pL6qkbnuH7yJGg', VerifyUrl: 'https://flurryport.io/receipts/2BsKb3W3pL6qkbnuH7yJGg', ChainIndex: 1, Hash: 'abc', Allowance: { State: 'free', RunsRemaining: 249 } };

test('archive posts one document for the execution and writes the receipt onto every item', async () => {
  const node = new FlurryPortLocker();
  const items = [{ json: { a: 1 } }, { json: { b: 2 } }];
  const ctx = context({ items, responses: [{ status: 201, body: receipt, headers: { 'x-flurryport-node-notice': 'A newer node is available.' } }] });

  const [out] = await node.execute.call(ctx, []);

  assert.equal(ctx.calls.length, 1);
  const { credential, options } = ctx.calls[0];
  assert.equal(credential, 'flurryPortLockerApi');
  assert.equal(options.method, 'POST');
  assert.equal(options.url, 'https://api.test/api/v1/locker/runs');
  assert.equal(options.headers['Idempotency-Key'], 'exec_42');
  assert.equal(options.body.schema, 'locker.run/1');
  assert.equal(options.body.platform, 'n8n');
  assert.deepEqual(options.body.workflow, { id: 'wf_9', name: 'Order to invoice' });
  assert.equal(options.body.run.id, 'exec_42');
  assert.deepEqual(options.body.outputs.items, [{ a: 1 }, { b: 2 }], 'outputs default to the items reaching the node');
  assert.equal(out.length, 2);
  assert.equal(out[0].json.a, 1, 'the items pass through');
  assert.equal(out[0].json.locker.archived, true);
  assert.equal(out[0].json.locker.receiptId, receipt.ReceiptId);
  assert.equal(out[1].json.locker.chainPosition, 1);
  assert.equal(out[0].json.locker.notice, 'A newer node is available.');
  assert.equal(items[0].json.locker, undefined, 'the incoming items are never changed');
});

test('the allowance on the item is in the same casing as the rest of locker', async () => {
  const node = new FlurryPortLocker();
  const ctx = context({ items: [{ json: { a: 1 } }], responses: [{ status: 201, body: { ...receipt, Allowance: { State: 'free', PlanName: 'Free', RunsRemaining: 249, DaysRemaining: 14, Locked: false, PlanUrl: 'https://flurryport.io/billing/locker' } } }] });

  const [out] = await node.execute.call(ctx, []);

  assert.deepEqual(out[0].json.locker.allowance, { state: 'free', planName: 'Free', runsRemaining: 249, daysRemaining: 14, locked: false, planUrl: 'https://flurryport.io/billing/locker' });
});

test('outputs handed over as n8n item wrappers are stored as their data, not the wrappers', async () => {
  // What `{{ $input.all() }}`, the Outputs default, evaluates to in a real n8n.
  const node = new FlurryPortLocker();
  const wrappers = [{ json: { a: 1 }, pairedItem: { item: 0 } }, { json: { b: 2 }, pairedItem: { item: 1 } }];
  const ctx = context({ items: [{ json: { a: 1 } }, { json: { b: 2 } }], params: { outputs: wrappers }, responses: [{ status: 201, body: receipt }] });

  await node.execute.call(ctx, []);

  assert.deepEqual(ctx.calls[0].options.body.outputs.items, [{ a: 1 }, { b: 2 }]);
});

test('an outputs list that is not made of item wrappers is stored as given', async () => {
  const node = new FlurryPortLocker();
  const ctx = context({ items: [{ json: { a: 1 } }], params: { outputs: [{ invoiceId: 'INV-7' }, 'note'] }, responses: [{ status: 201, body: receipt }] });

  await node.execute.call(ctx, []);

  assert.deepEqual(ctx.calls[0].options.body.outputs.items, [{ invoiceId: 'INV-7' }, 'note']);
});

test('a failed archive passes the items through with the reason, and the workflow goes on', async () => {
  const node = new FlurryPortLocker();
  const ctx = context({ items: [{ json: { a: 1 } }], responses: [{ status: 401, body: { title: 'unauthorized' } }] });

  const [out] = await node.execute.call(ctx, []);

  assert.equal(out[0].json.locker.archived, false);
  assert.equal(out[0].json.locker.code, 'unauthorized');
  assert.match(out[0].json.locker.reason, /install key/);
});

test('with Fail Workflow On Error the node throws instead', async () => {
  const node = new FlurryPortLocker();
  const ctx = context({ items: [{ json: {} }], params: { options: { failWorkflowOnError: true } }, responses: [{ status: 400, body: { title: 'locker_run_invalid', detail: 'schema' } }] });

  await assert.rejects(node.execute.call(ctx, []), (err) => /did not accept/.test(err.message));
});

test('a 413 is retried once with the metadata-only stub', async () => {
  const node = new FlurryPortLocker();
  const ctx = context({ items: [{ json: { big: 'x'.repeat(100) } }], responses: [{ status: 413, body: { title: 'locker_run_too_large' } }, { status: 201, body: receipt }] });

  const [out] = await node.execute.call(ctx, []);

  assert.equal(ctx.calls.length, 2);
  assert.equal(ctx.calls[1].options.body.stub, true);
  assert.equal(ctx.calls[1].options.body.outputs.stub, true);
  assert.equal(typeof ctx.calls[1].options.body.outputs.sha256, 'string');
  assert.equal(out[0].json.locker.archived, true);
});

test('a 429 waits for Retry-After and tries again', async () => {
  const node = new FlurryPortLocker();
  const ctx = context({ items: [{ json: {} }], responses: [{ status: 429, body: {}, headers: { 'retry-after': '0' } }, { status: 201, body: receipt }] });

  const [out] = await node.execute.call(ctx, []);

  assert.equal(ctx.calls.length, 2);
  assert.equal(out[0].json.locker.archived, true);
});

test('a duplicate (200) is archived: true, duplicate: true', async () => {
  const node = new FlurryPortLocker();
  const ctx = context({ items: [{ json: {} }], responses: [{ status: 200, body: { ...receipt, Duplicate: true } }] });
  const [out] = await node.execute.call(ctx, []);
  assert.equal(out[0].json.locker.duplicate, true);
});

test('binaries are summarised by hash, never uploaded', async () => {
  const node = new FlurryPortLocker();
  const bytes = Buffer.from('hello');
  const items = [{ json: {}, binary: { data: { fileName: 'a.txt', mimeType: 'text/plain', fileSize: '5 B', data: '' } } }];
  const ctx = context({ items, responses: [{ status: 201, body: receipt }], binaries: { '0:data': bytes } });

  await node.execute.call(ctx, []);

  const doc = ctx.calls[0].options.body;
  assert.equal(doc.binaries.length, 1);
  assert.equal(doc.binaries[0].fileName, 'a.txt');
  assert.equal(doc.binaries[0].hashed, true);
  assert.equal(doc.binaries[0].sha256, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  assert.equal(JSON.stringify(doc).includes('hello'), false);
});

test('no input items still archives one run and emits one item with the receipt', async () => {
  const node = new FlurryPortLocker();
  const ctx = context({ items: [], responses: [{ status: 201, body: receipt }] });
  const [out] = await node.execute.call(ctx, []);
  assert.equal(out.length, 1);
  assert.equal(out[0].json.locker.archived, true);
});

test('the network down is a soft failure with retryable: true', async () => {
  const node = new FlurryPortLocker();
  const ctx = context({ items: [{ json: {} }], responses: [new Error('ECONNREFUSED')] });
  const [out] = await node.execute.call(ctx, []);
  assert.equal(out[0].json.locker.archived, false);
  assert.equal(out[0].json.locker.retryable, true);
});

test('get receipt reads one run by id', async () => {
  const node = new FlurryPortLocker();
  const ctx = context({ items: [], params: { operation: 'getReceipt', receiptId: '2BsKb3W3pL6qkbnuH7yJGg' }, responses: [{ status: 200, body: { ReceiptId: '2BsKb3W3pL6qkbnuH7yJGg', Kind: 'run' } }] });
  const [out] = await node.execute.call(ctx, []);
  assert.equal(ctx.calls[0].options.method, 'GET');
  assert.equal(ctx.calls[0].options.url, 'https://api.test/api/v1/locker/runs/2BsKb3W3pL6qkbnuH7yJGg');
  assert.equal(out[0].json.Kind, 'run');
});
