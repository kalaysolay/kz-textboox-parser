#!/usr/bin/env node
// Compatibility entrypoint; the only implementation is the ESM .js module.
import('./read-textbook-pages.js').then(module => module.main()).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
