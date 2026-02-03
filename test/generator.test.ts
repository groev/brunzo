import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSchemas } from '../src/generator';
import { BruFile } from '../src/parser';
import fs from 'fs-extra';
import path from 'path';

vi.mock('fs-extra');

describe('Generator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should generate schemas for a simple body', async () => {
    const mockFile: BruFile = {
      path: 'test.bru',
      name: 'Get User',
      method: 'get',
      url: '/user',
      body: {
        id: 1,
        name: 'Alice'
      }
    };

    const stats = await generateSchemas([mockFile], 'dist');

    expect(stats.documentedEndpoints).toBe(1);
    expect(fs.emptyDir).toHaveBeenCalledWith('dist');
    expect(fs.writeFile).toHaveBeenCalledTimes(1);

    const [filePath, content] = vi.mocked(fs.writeFile).mock.calls[0];
    expect(filePath).toContain('GetUser.ts');

    // Check Content
    const strContent = content as string;
    expect(strContent).toContain('export const getUserBodySchema');
    expect(strContent).toContain('z.object');
    expect(strContent).toContain('"id": z.number()');
    expect(strContent).toContain('"name": z.string()');

    // Check Types
    expect(strContent).toContain('export type GetUserBody = z.infer<typeof getUserBodySchema>');
  });

  it('should extract array items into named definitions', async () => {
    const mockFile: BruFile = {
      path: 'posts.bru',
      name: 'List Posts',
      method: 'get',
      url: '/posts',
      body: {
        posts: [
          { id: 1, title: 'Hi' }
        ]
      }
    };

    await generateSchemas([mockFile], 'dist');

    const [filePath, content] = vi.mocked(fs.writeFile).mock.calls[0];
    const strContent = content as string;

    // Check Array Item Schema
    expect(strContent).toContain('export const getPostsBodyPostsItemSchema');
    expect(strContent).toContain('z.object({ "id": z.number().int(), "title": z.string() })');

    // Check Array Schema
    expect(strContent).toContain('export const getPostsBodyPostsSchema = z.array(z.lazy(() => getPostsBodyPostsItemSchema))');

    // Check Root Schema links to Array Schema
    expect(strContent).toContain('"posts": z.lazy(() => getPostsBodyPostsSchema)');

    // Check Types
    expect(strContent).toContain('export type GetPostsBodyPostsItem');
    expect(strContent).toContain('export type GetPostsBodyPosts');
    expect(strContent).toContain('export type GetPostsBody');
  });

  it('should generate schemas for headers, query, and params', async () => {
    const mockFile: BruFile = {
      path: 'full.bru',
      name: 'Full Req',
      method: 'post',
      url: '/',
      headers: { 'X-Key': 'abc' },
      query: { page: 1 },
      params: { id: 100 }
    };

    await generateSchemas([mockFile], 'dist');

    const [filePath, content] = vi.mocked(fs.writeFile).mock.calls[0];
    const strContent = content as string;

    // Header
    expect(strContent).toContain('export const postHeaderSchema');
    expect(strContent).toContain('"X-Key": z.string()');

    // Query
    expect(strContent).toContain('export const postQuerySchema');
    expect(strContent).toContain('"page": z.number()');

    // Params
    expect(strContent).toContain('export const postParamsSchema');
    expect(strContent).toContain('"id": z.number()');
  });

  it('should skip files with no data', async () => {
    const mockFile: BruFile = {
      path: 'empty.bru',
      name: 'Empty',
      method: 'get',
      url: '/'
    };

    const stats = await generateSchemas([mockFile], 'dist');
    expect(stats.documentedEndpoints).toBe(0);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('should clean the output directory by default', async () => {
    const mockFile: BruFile = {
      path: 'test.bru',
      name: 'Test',
      method: 'get',
      url: '/test',
      body: { id: 1 }
    };

    await generateSchemas([mockFile], 'dist');
    expect(fs.emptyDir).toHaveBeenCalledWith('dist');
    expect(fs.ensureDir).not.toHaveBeenCalled();
  });

  it('should not clean the output directory when keep flag is true', async () => {
    const mockFile: BruFile = {
      path: 'test.bru',
      name: 'Test',
      method: 'get',
      url: '/test',
      body: { id: 1 }
    };

    await generateSchemas([mockFile], 'dist', true);
    expect(fs.emptyDir).not.toHaveBeenCalled();
    expect(fs.ensureDir).toHaveBeenCalledWith('dist');
  });
});
