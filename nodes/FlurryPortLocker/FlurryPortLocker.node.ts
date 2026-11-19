import type {
  IExecuteFunctions,
  IHttpRequestOptions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  IDataObject,
  JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionType, NodeOperationError, sleep } from 'n8n-workflow';
import { createHash } from 'node:crypto';
import { version as packageVersion } from '../../package.json';
import { describeFailure, retryAfterSeconds, type ProblemDetails } from './errors';
import { buildRunDocument, jcs, MAX_DOCUMENT_BYTES, sizeSection, stubOf, utf8Bytes, type BinarySummary } from './sizing';

const MAX_BINARY_HASH_BYTES = 25 * 1024 * 1024;

interface ArchiveOptions {
  hashBinaryFiles: boolean;
  maxSectionKilobytes: number;
  failWorkflowOnError: boolean;
}

interface HttpOutcome {
  status: number | undefined;
  body: IDataObject | ProblemDetails | undefined;
  headers: Record<string, string>;
}

/**
 * The FlurryPORT Locker node:
 * one run document per execution, sized at item boundaries, binaries summarised by hash, posted
 * with the install key, and a receipt written onto every item for the next node. Never breaks
 * the workflow unless asked: a failed archive passes the items through with `json.locker`
 * saying why. Self-hosted n8n installs it as a community node.
 */
export class FlurryPortLocker implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'FlurryPORT Locker',
    name: 'flurryPortLocker',
    icon: { light: 'file:flurryport-locker.svg', dark: 'file:flurryport-locker.dark.svg' },
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Send a run to FlurryPORT Locker and get a signed receipt back',
    defaults: { name: 'Locker' },
    inputs: [NodeConnectionType.Main],
    outputs: [NodeConnectionType.Main],
    usableAsTool: true,
    credentials: [{ name: 'flurryPortLockerApi', required: true }],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        options: [{ name: 'Run', value: 'run' }],
        default: 'run',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['run'] } },
        options: [
          { name: 'Archive', value: 'archive', action: 'Archive run in locker', description: 'Keep this run with a signed receipt' },
          { name: 'Get Receipt', value: 'getReceipt', action: 'Get receipt for run', description: 'Read one archived run and its receipt' },
        ],
        default: 'archive',
      },
      {
        displayName: 'Inputs',
        name: 'inputs',
        type: 'json',
        default: '',
        displayOptions: { show: { operation: ['archive'] } },
        description: 'What the run started from, such as the body a webhook received. Map only what should be kept. Leave empty to omit.',
      },
      {
        displayName: 'Outputs',
        name: 'outputs',
        type: 'json',
        default: '={{ $input.all() }}',
        displayOptions: { show: { operation: ['archive'] } },
        description: 'What the run produced. Defaults to the items reaching this node.',
      },
      {
        displayName: 'Run Status',
        name: 'runStatus',
        type: 'options',
        default: 'success',
        displayOptions: { show: { operation: ['archive'] } },
        options: [
          { name: 'Success', value: 'success' },
          { name: 'Error', value: 'error' },
          { name: 'Unknown', value: 'unknown' },
        ],
      },
      {
        displayName: 'Labels',
        name: 'labels',
        type: 'fixedCollection',
        default: {},
        typeOptions: { multipleValues: true, maxValue: 20 },
        displayOptions: { show: { operation: ['archive'] } },
        options: [
          {
            name: 'label',
            displayName: 'Label',
            values: [
              { displayName: 'Name', name: 'name', type: 'string', default: '' },
              { displayName: 'Value', name: 'value', type: 'string', default: '' },
            ],
          },
        ],
      },
      {
        displayName: 'Options',
        name: 'options',
        type: 'collection',
        placeholder: 'Add option',
        default: {},
        displayOptions: { show: { operation: ['archive'] } },
        options: [
          { displayName: 'Hash Binary Files', name: 'hashBinaryFiles', type: 'boolean', default: true, description: 'Whether to record a SHA-256 of each binary file' },
          { displayName: 'Max Section Kilobytes', name: 'maxSectionKilobytes', type: 'number', default: 256, description: 'Inputs and outputs are each cut at whole items past this size' },
          { displayName: 'Fail Workflow On Error', name: 'failWorkflowOnError', type: 'boolean', default: false, description: 'Whether the workflow stops when the archive cannot be written' },
        ],
      },
      {
        displayName: 'Receipt ID',
        name: 'receiptId',
        type: 'string',
        default: '',
        required: true,
        displayOptions: { show: { operation: ['getReceipt'] } },
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const operation = this.getNodeParameter('operation', 0) as string;
    const credentials = (await this.getCredentials('flurryPortLockerApi')) as { installKey: string; baseUrl: string };
    const baseUrl = String(credentials.baseUrl || 'https://api.flurryport.io').replace(/\/$/, '');

    if (operation === 'getReceipt') {
      const receiptId = this.getNodeParameter('receiptId', 0) as string;
      const outcome = await request.call(this, { method: 'GET', url: `${baseUrl}/api/v1/locker/runs/${encodeURIComponent(receiptId)}` });
      if (outcome.status !== 200) throw new NodeApiError(this.getNode(), (outcome.body ?? {}) as JsonObject, { message: describeFailure(outcome.status, outcome.body as ProblemDetails).reason });
      return [[{ json: outcome.body as IDataObject, pairedItem: { item: 0 } }]];
    }

    const options = { hashBinaryFiles: true, maxSectionKilobytes: 256, failWorkflowOnError: false, ...(this.getNodeParameter('options', 0, {}) as Partial<ArchiveOptions>) } as ArchiveOptions;
    const maxSectionBytes = Math.max(1, options.maxSectionKilobytes) * 1024;
    const status = this.getNodeParameter('runStatus', 0, 'success') as string;
    const labels: Record<string, string> = {};
    const labelCollection = this.getNodeParameter('labels', 0, {}) as { label?: Array<{ name: string; value: string }> };
    for (const l of labelCollection.label ?? []) if (l.name) labels[l.name] = String(l.value ?? '');

    const workflow = this.getWorkflow();
    const executionId = this.getExecutionId();
    const inputs = sizeSection(unwrapItems(parseJsonParameter(this.getNodeParameter('inputs', 0, ''))), maxSectionBytes);
    const outputs = sizeSection(unwrapItems(parseJsonParameter(this.getNodeParameter('outputs', 0, ''))) ?? items.map((i) => i.json), maxSectionBytes);
    const binaries = options.hashBinaryFiles ? await summariseBinaries.call(this, items) : [];
    // The execution id is the idempotency key. A finish time stamped here would differ on a
    // retry of the same execution, and the same key with a different document is refused. So
    // the time is sent only when there is no execution id to repeat (#535).
    const finishedAt = executionId ? undefined : new Date().toISOString();

    let document = buildRunDocument({
      clientVersion: packageVersion,
      workflowId: workflow.id ? String(workflow.id) : undefined,
      workflowName: workflow.name,
      executionId,
      mode: this.getMode(),
      status,
      finishedAt,
      inputs,
      outputs,
      binaries,
      labels,
    });
    if (utf8Bytes(jcs(document)) > MAX_DOCUMENT_BYTES) document = stubOf(document);

    const headers: Record<string, string> = { 'X-FlurryPort-Node-Version': packageVersion };
    if (executionId) headers['Idempotency-Key'] = String(executionId).slice(0, 64);

    let outcome = await request.call(this, { method: 'POST', url: `${baseUrl}/api/v1/locker/runs`, body: document, headers });
    if (outcome.status === 413) outcome = await request.call(this, { method: 'POST', url: `${baseUrl}/api/v1/locker/runs`, body: stubOf(document), headers });
    if (outcome.status === 429) {
      await sleep(retryAfterSeconds(outcome.headers['retry-after']) * 1000);
      outcome = await request.call(this, { method: 'POST', url: `${baseUrl}/api/v1/locker/runs`, body: document, headers });
    }

    const out: INodeExecutionData[] = items.length
      ? items.map((item, index) => ({ json: { ...item.json }, binary: item.binary, pairedItem: { item: index } }))
      : [{ json: {} as IDataObject, pairedItem: { item: 0 } }];
    if (outcome.status === 201 || outcome.status === 200) {
      const r = outcome.body as IDataObject;
      const locker: IDataObject = {
        archived: true,
        duplicate: outcome.status === 200,
        receiptId: r.ReceiptId,
        verifyUrl: r.VerifyUrl,
        chainPosition: r.ChainIndex,
        hash: r.Hash,
        allowance: allowanceOf(r.Allowance),
      };
      const notice = outcome.headers['x-flurryport-node-notice'];
      if (notice) locker.notice = notice;
      for (const o of out) o.json.locker = locker;
      return [out];
    }

    const failure = describeFailure(outcome.status, outcome.body as ProblemDetails);
    if (options.failWorkflowOnError && !this.continueOnFail()) {
      if (outcome.status === undefined) throw new NodeOperationError(this.getNode(), failure.reason);
      throw new NodeApiError(this.getNode(), (outcome.body ?? {}) as JsonObject, { message: failure.reason, httpCode: String(outcome.status) });
    }
    for (const o of out) o.json.locker = failure as unknown as IDataObject;
    return [out];
  }
}

/**
 * n8n hands `{{ $input.all() }}` (the Outputs default) over as its own item wrappers,
 * `{ json, pairedItem, binary }`. The archive keeps the data, not the wrapper, so a list made
 * only of such wrappers is stored as the list of their `json` (otherwise the default stores
 * `pairedItem` beside every item). Anything else passes as is.
 */
function unwrapItems(value: unknown): unknown {
  if (!Array.isArray(value) || value.length === 0) return value;
  const wrapped = value.every((v) => v !== null && typeof v === 'object' && !Array.isArray(v) && 'json' in (v as object));
  return wrapped ? value.map((v) => (v as { json: unknown }).json) : value;
}

/** The plan facts the next node can act on, in the casing the rest of `locker` uses. */
function allowanceOf(value: unknown): IDataObject | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const a = value as Record<string, unknown>;
  return {
    state: a.State,
    planName: a.PlanName,
    runsRemaining: a.RunsRemaining,
    daysRemaining: a.DaysRemaining,
    locked: a.Locked,
    planUrl: a.PlanUrl,
  } as IDataObject;
}

function parseJsonParameter(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function summariseBinaries(this: IExecuteFunctions, items: INodeExecutionData[]): Promise<BinarySummary[]> {
  const out: BinarySummary[] = [];
  for (let i = 0; i < items.length; i++) {
    const binary = items[i].binary;
    if (!binary) continue;
    for (const property of Object.keys(binary)) {
      const meta = binary[property];
      const size = Number(meta.fileSize ?? NaN);
      let sha256: string | undefined;
      let hashed = false;
      if (!(Number.isFinite(size) && size > MAX_BINARY_HASH_BYTES)) {
        try {
          const buffer = await this.helpers.getBinaryDataBuffer(i, property);
          if (buffer.length <= MAX_BINARY_HASH_BYTES) {
            sha256 = createHash('sha256').update(buffer).digest('hex');
            hashed = true;
          }
        } catch {
          hashed = false;
        }
      }
      out.push({ item: i, property, fileName: meta.fileName, mimeType: meta.mimeType, fileSize: meta.fileSize, sha256, hashed });
    }
  }
  return out;
}

/** One request through n8n's own helper, the status and body read whatever the answer; nothing thrown here. */
async function request(this: IExecuteFunctions, options: { method: 'GET' | 'POST'; url: string; body?: unknown; headers?: Record<string, string> }): Promise<HttpOutcome> {
  const requestOptions: IHttpRequestOptions = {
    method: options.method,
    url: options.url,
    headers: { Accept: 'application/json', ...(options.headers ?? {}) },
    json: true,
    returnFullResponse: true,
    ignoreHttpStatusErrors: true,
  };
  if (options.body !== undefined) requestOptions.body = options.body as IDataObject;
  try {
    const response = (await this.helpers.httpRequestWithAuthentication.call(this, 'flurryPortLockerApi', requestOptions)) as {
      statusCode?: number;
      body?: unknown;
      headers?: Record<string, string>;
    };
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(response.headers ?? {})) headers[k.toLowerCase()] = String(v);
    return { status: response.statusCode, body: response.body as IDataObject | undefined, headers };
  } catch {
    return { status: undefined, body: undefined, headers: {} };
  }
}
