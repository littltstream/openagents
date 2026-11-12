'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const turns = new AsyncLocalStorage();

// Channels execute concurrently. Capture this turn when each CLI child is
// spawned, rather than mutating the adapter's shared process environment.
function withCollaborationTurn({ triggerId, channel }, run) {
  return turns.run({ triggerId, channel }, run);
}

function turnEnvironment(env) {
  const result = { ...env };
  Object.defineProperties(result, {
    OA_COLLABORATION_TRIGGER_ID: { enumerable: true, get: () => turns.getStore()?.triggerId },
    OA_COLLABORATION_CHANNEL: { enumerable: true, get: () => turns.getStore()?.channel },
  });
  return result;
}

module.exports = { withCollaborationTurn, turnEnvironment };
