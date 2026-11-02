// Errors that map to a result classification rather than a generic crash.

export class EnvBlockedError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'EnvBlockedError';
    this.hint = hint;
  }
}

export class TestDefinitionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TestDefinitionError';
  }
}
