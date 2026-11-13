# n8n-nodes-flurryport-locker

Archive every run of a workflow, signed and kept, with a receipt you can check without
FlurryPORT.

Runs are kept for as long as you subscribe and handed back as a bundle with the verifier if you
leave. Every run gets a signed receipt and a verify link that works without us.

Help: flurryport.io/docs/locker. Support: the link in the app.

## What it does

Drop the **FlurryPORT Locker** node at the end of a workflow. On each execution it builds one run
document (what went in, what came out, the status, the binaries by hash), posts it to Locker with
your install key, and writes the receipt onto every item for the next node:

```json
{ "locker": { "archived": true, "receiptId": "2BsK…", "verifyUrl": "https://flurryport.io/receipts/2BsK…", "chainPosition": 12 } }
```

It never breaks the workflow unless you ask: when the archive cannot be written the items pass
through with `locker.archived: false` and a reason. **Fail Workflow On Error** in the options
turns that into a stop.

## Install (self-hosted n8n)

Settings, Community nodes, Install, `n8n-nodes-flurryport-locker`. n8n Cloud does not list
unverified nodes; this node is for self-hosted instances.

## Credential

**FlurryPORT Locker API**: the install key from the install's key page in FlurryPORT (it starts
with `fp_`, shown once), and the API base URL (leave it). The credential test reads your installs.

## Operations

- **Archive** (`Archive run in locker`): inputs (JSON, optional), outputs (JSON, default: the
  items reaching the node), run status, labels, and options: hash binary files (default on), max
  section kilobytes (default 256; inputs and outputs are each cut at whole items past it, with the
  count and the SHA-256 of the full thing kept), fail workflow on error (default off).
- **Get Receipt** (`Get receipt for run`): one archived run and its receipt by id.

## Sizes

Each of inputs and outputs is measured in canonical JSON; a section over the cap keeps the first
whole items that fit, then `truncated: true`, the counts, and the fingerprint of the full
serialisation, so a holder of the original can show it matches later. Binary files are never
uploaded: each is recorded by name, type, size and SHA-256 (files over 25 MB are listed without a
hash). The whole document is capped at 1 MB; past it, and on a 413, the node sends a metadata-only
stub (hashes kept) so the run still gets a receipt and the chain has no hole.

## Known limit

A step that never fails cannot prove that a run it never saw was missing. The Locker reader
lists runs per workflow; reconciliation against n8n's execution list is not part of this node.

## Development

```bash
npm install
npm test        # builds with tsc, copies the icons and the codex file into dist, then node --test
```

Tested against n8n 2.47.7: the node and its credential load, the credential test passes, an
archive returns a receipt that verifies, and a failed archive passes the items through.

Installing by hand outside n8n: a plain `npm install` tries to build a native part of the
`n8n-workflow` peer dependency. n8n's own installer skips build scripts; do the same with
`npm install n8n-nodes-flurryport-locker --ignore-scripts`.

## Source

This repository is a read-only mirror of the node's source, published as a snapshot with each
release. Releases are on npm as `n8n-nodes-flurryport-locker`. MIT licensed.
