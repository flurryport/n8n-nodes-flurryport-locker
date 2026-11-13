'use strict';

// n8n loads nodes and credentials from the paths in package.json's "n8n" block; this file is
// the package entry for tooling that requires it directly.
module.exports = {
  nodes: [require('./dist/nodes/FlurryPortLocker/FlurryPortLocker.node.js').FlurryPortLocker],
  credentials: [require('./dist/credentials/FlurryPortLockerApi.credentials.js').FlurryPortLockerApi],
};
