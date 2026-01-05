import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseBruFile } from '../src/parser';
import fs from 'fs-extra';

vi.mock('fs-extra');

describe('Parser', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should parse metadata correctly', async () => {
    const mockContent = `
meta {
  name: Test Request
  type: http
  seq: 1
}
get {
  url: https://api.example.com
}
    `;
    vi.mocked(fs.readFile).mockResolvedValue(mockContent);

    const result = await parseBruFile('test.bru');
    expect(result).toMatchObject({
      name: 'Test Request',
      method: 'get',
      url: 'https://api.example.com'
    });
  });

  it('should parse body:json with standard JSON', async () => {
    const mockContent = `
post { url: / }
body:json {
  {
    "foo": "bar"
  }
}
    `;
    vi.mocked(fs.readFile).mockResolvedValue(mockContent);

    const result = await parseBruFile('test.bru');
    expect(result?.body).toEqual({ foo: 'bar' });
  });

  it('should parse body:json with comments (Loose JSON)', async () => {
    const mockContent = `
post { url: / }
body:json {
  {
    "foo": "bar", // comment
    "num": 123,
    /* block */
    "bool": true,
  }
}
    `;
    vi.mocked(fs.readFile).mockResolvedValue(mockContent);

    const result = await parseBruFile('test.bru');
    expect(result?.body).toEqual({ foo: 'bar', num: 123, bool: true });
  });

  it('should parse headers', async () => {
    const mockContent = `
headers {
  Content-Type: application/json
  Authorization: Bearer 123
}
    `;
    vi.mocked(fs.readFile).mockResolvedValue(mockContent);

    const result = await parseBruFile('test.bru');
    expect(result?.headers).toEqual({
      'Content-Type': 'application/json',
      'Authorization': 'Bearer 123'
    });
  });

  it('should parse query params', async () => {
    const mockContent = `
params:query {
  page: 1
  sort: desc
  active: true
}
    `;
    vi.mocked(fs.readFile).mockResolvedValue(mockContent);

    const result = await parseBruFile('test.bru');
    expect(result?.query).toEqual({
      page: 1,
      sort: 'desc',
      active: true
    });
  });

  it('should parse path params', async () => {
    const mockContent = `
params:path {
  id: 100
}
    `;
    vi.mocked(fs.readFile).mockResolvedValue(mockContent);

    const result = await parseBruFile('test.bru');
    expect(result?.params).toEqual({
      id: 100
    });
  });

  it('should handle nested braces in JSON body correctly', async () => {
    const mockContent = `
body:json {
  {
    "nested": {
       "a": 1
    }
  }
}
    `;
    vi.mocked(fs.readFile).mockResolvedValue(mockContent);
    const result = await parseBruFile('test.bru');
    expect(result?.body).toEqual({ nested: { a: 1 } });
  });

  it('should return null/undefined for missing blocks', async () => {
    const mockContent = `meta { name: Foo }`;
    vi.mocked(fs.readFile).mockResolvedValue(mockContent);
    const result = await parseBruFile('test.bru');
    expect(result?.body).toBeNull();
    expect(result?.headers).toBeUndefined();
  });
});
