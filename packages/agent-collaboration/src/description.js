'use strict';

// An advertised capability summary, not system instructions or a tool grant.
function normalizeDescription(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error('description must be a string');
  const description = value.replace(/\r\n?/g, '\n').trim();
  if ([...description].length > 4000 || description.includes('\0')) {
    throw new Error('description must contain at most 4000 characters and no NUL characters');
  }
  return description;
}

function descriptionArgs(value) {
  const description = normalizeDescription(value);
  return description === undefined ? [] : ['--description', description];
}

module.exports = { normalizeDescription, descriptionArgs };
