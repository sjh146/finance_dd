import { assertMcpApiKeyConfigured } from './main';

describe('assertMcpApiKeyConfigured', () => {
  const original = process.env['MCP_API_KEY'];

  afterEach(() => {
    if (original === undefined) {
      delete process.env['MCP_API_KEY'];
    } else {
      process.env['MCP_API_KEY'] = original;
    }
  });

  it('accepts a configured MCP_API_KEY', () => {
    process.env['MCP_API_KEY'] = 'some-real-key';
    expect(() => assertMcpApiKeyConfigured()).not.toThrow();
  });

  it('refuses to start when MCP_API_KEY is missing (no hardcoded fallback)', () => {
    delete process.env['MCP_API_KEY'];
    expect(() => assertMcpApiKeyConfigured()).toThrow(/MCP_API_KEY is not set/);
  });

  it('refuses to start when MCP_API_KEY is empty', () => {
    process.env['MCP_API_KEY'] = '';
    expect(() => assertMcpApiKeyConfigured()).toThrow(/MCP_API_KEY is not set/);
  });
});
