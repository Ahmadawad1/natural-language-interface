import { defineConfig } from 'tsup';

export default defineConfig({
  // node:sqlite has no unprefixed alias; stripping node: breaks packed consumers.
  removeNodeProtocol: false,
  target: 'node24',
});
