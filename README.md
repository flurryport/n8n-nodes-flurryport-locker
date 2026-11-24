# n8n-nodes-flurryport-locker

An n8n community node for [FlurryPORT Locker](https://flurryport.io/docs/locker/n8n). It sends
the result of a workflow to Locker and gets back a signed receipt that anyone can check, with or
without FlurryPORT.

Use it when someone outside your n8n has to be able to trust what a workflow did: a client you
run automations for, a customer who asks what happened to their order, an auditor.

Receipts are kept while you subscribe, run data for fourteen months, and the export checks
without us, so keep it as long as your rules require.

Help: [flurryport.io/docs/locker/n8n](https://flurryport.io/docs/locker/n8n).

## What it does

Put the **FlurryPORT Locker** node where the result of the workflow is known, usually last. It
sends one document to Locker (what you mapped into **Inputs** and **Outputs**, the status you
chose, your labels) and writes the receipt onto every item for the next node:

```json
{ "locker": { "archived": true, "receiptId": "2BsK…", "verifyUrl": "https://flurryport.io/receipts/2BsK…", "chainPosition": 12 } }
```

The receipt page opens without signing in. Send the link to whoever needs the proof.

It never breaks the workflow unless you ask: when Locker cannot be reached the items pass
through with `locker.archived: false` and a reason. **Fail Workflow On Error** in the options
turns that into a stop.

## What it is not

This node is an ordinary app node for an outside service. It sends the data you map into it,
the status and labels you set, the workflow's name and ID, the execution ID and how the run was
started. For binary files on the items it sends the name, type, size and a SHA-256 fingerprint,
never the file. With each run it also sends one key, a SHA-256 fingerprint made from your n8n
instance ID, the workflow ID, the execution ID and the data being recorded. The instance ID
itself is not sent. The key is how Locker knows a repeat of the same run from a new one.

- It does not read n8n's execution history, its logs or its settings.
- It is not a log stream and not an audit log of n8n itself. It records the outcome you choose
  to record, in a place the people you answer to can check for themselves.
- It does not list or compare n8n's executions. A step cannot prove that a run it never saw
  was missing.

## Install

The node is verified by n8n and works on n8n Cloud and on self-hosted n8n. Open the nodes
panel, search for **FlurryPORT Locker**, and install it. The owner of the instance may need to
turn on verified community nodes first.

On a self-hosted n8n you can also use **Settings**, **Community nodes**, **Install**, and enter
`n8n-nodes-flurryport-locker`.

## Credential

**FlurryPORT Locker API** takes two values:

- **Install key**: it starts with `fp_`. Create a free account at
  [flurryport.io](https://flurryport.io), open **Locker**, choose the **Any HTTP** connector,
  name the install (the name of your n8n server works), choose **Create install**, and copy
  the key. You can show it again later from the install.
- **API base URL**: leave it as it is.

The credential test reads your installs. Locker starts free with 250 runs or 14 days, whichever
comes first.

## Operations

- **Archive** (`Archive run in locker`): **Inputs** (JSON, optional), **Outputs** (JSON, default:
  the items reaching the node), **Run Status**, **Labels**, and options: **Hash Binary Files**
  (default on), **Max Section Kilobytes** (default 256), **Fail Workflow On Error** (default off).
- **Find** (`Find runs by label`): the runs that carry one label, such as an order number, newest
  first. **Label Name** and **Label Value** are matched exactly and with case, so `1001` does not
  find `10010`. **Limit** (default 50, at most 100), and the filters **Since** and **Until**.
  Each item is a receipt: `receiptId`, `verifyUrl`, `chainPosition`, `archivedAt`,
  `workflowName`, `runId`, `status`. It never carries what went in or came out; use
  **Get Receipt** with the `receiptId` for that. No match emits no item.
- **Get Receipt** (`Get receipt for run`): one run and its receipt, by receipt ID.

Find opens the newest 2,000 runs of the install on each call. If the install holds more and
nothing was found, the node says so with `found: false` and `truncated: true`; set **Since** and
**Until** to look further back. Find needs Locker's free allowance or a plan, like reading a run.

A retry of the same execution returns the first receipt and records nothing new. The same
execution number on another n8n instance, in another workflow, or after a restore with other
data, is a different run and is archived as one (from 0.1.4).

## Example workflow

A webhook receives an order, the workflow does its work, and the last node records the result.
Copy this into n8n (**Import from clipboard**), then choose your credential on the Locker node.

```json
{
  "name": "Order received, with a receipt",
  "nodes": [
    {
      "parameters": { "httpMethod": "POST", "path": "order", "options": {} },
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [0, 0]
    },
    {
      "parameters": {
        "assignments": {
          "assignments": [
            { "id": "1", "name": "orderId", "value": "={{ $json.body.orderId }}", "type": "string" },
            { "id": "2", "name": "accepted", "value": true, "type": "boolean" }
          ]
        },
        "options": {}
      },
      "name": "Accept order",
      "type": "n8n-nodes-base.set",
      "typeVersion": 3.4,
      "position": [220, 0]
    },
    {
      "parameters": {
        "resource": "run",
        "operation": "archive",
        "inputs": "={{ $('Webhook').item.json.body }}",
        "outputs": "={{ $input.all() }}",
        "runStatus": "success",
        "labels": { "label": [{ "name": "orderId", "value": "={{ $json.orderId }}" }] }
      },
      "name": "Locker",
      "type": "n8n-nodes-flurryport-locker.flurryPortLocker",
      "typeVersion": 1,
      "position": [440, 0]
    }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "Accept order", "type": "main", "index": 0 }]] },
    "Accept order": { "main": [[{ "node": "Locker", "type": "main", "index": 0 }]] }
  }
}
```

After a run, the Locker node's output carries `locker.verifyUrl`. Open it to see the receipt.

## Sizes

Inputs and outputs are each measured as canonical JSON. A section over the cap keeps the first
whole items that fit, then `truncated: true`, the counts, and the fingerprint of the full
section, so a holder of the original can show it matches later. Binary files are never uploaded:
each is recorded by name, type, size and SHA-256 (files over 25 MB are listed without a hash).
The whole document is capped at 1 MB. Past that the node sends the fingerprints without the
items, so the run still gets a receipt.

## Development

```bash
npm install --ignore-scripts
npm run lint    # n8n's linter, through @n8n/node-cli
npm test        # builds with n8n-node build, then node --test
npm run dev     # runs n8n with the node loaded
```

`--ignore-scripts` skips building a native part of the `n8n-workflow` peer dependency, which
the node does not use. n8n's own installer skips it too.

Tested against n8n 2.47.7: the node and its credential load, the credential test passes, an
archive returns a receipt that verifies, and a failed archive passes the items through.

## Releases

Releases are built and published to npm from this repository by a GitHub Action
(`.github/workflows/publish.yml`), on a version tag, with an npm provenance statement.

MIT licensed.
