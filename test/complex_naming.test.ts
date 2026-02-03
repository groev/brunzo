import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseBruFile } from '../src/parser';
import { generateSchemas } from '../src/generator';
import fs from 'fs-extra';

vi.mock('fs-extra');

describe('Complex Naming Tests', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    const postsBruContent = `meta {
  name: GetPosts
}

get {
  url: {{systemurl}}/posts
}

example {
  name: example
  response: {
    status: { code: 200 }
    body: {
      type: json
      content: '''
        {
          "data": {
            "posts": [
              { "id": 1, "title": "Hello" }
            ]
          }
        }
      '''
    }
  }
}
`;

    it('should generate names like GetPosts200DataPostsItem', async () => {
        vi.mocked(fs.readFile).mockResolvedValue(postsBruContent);
        const parsed = await parseBruFile('posts.bru');
        if (!parsed) throw new Error("Parsed result is null");

        await generateSchemas([parsed], 'dist');

        const [filePath, content] = vi.mocked(fs.writeFile).mock.calls[0];
        const strContent = content as string;

        // Expecting:
        // getPosts200Schema
        // getPosts200DataSchema
        // getPosts200DataPostsSchema
        // getPosts200DataPostsItemSchema

        expect(strContent).toContain('export const getPosts200Schema');
        expect(strContent).toContain('export const getPosts200DataSchema');
        expect(strContent).toContain('export const getPosts200DataPostsSchema');
        expect(strContent).toContain('export const getPosts200DataPostsItemSchema');

        expect(strContent).toContain('export type GetPosts200 = z.infer<typeof getPosts200Schema>');
        expect(strContent).toContain('export type GetPosts200Data = z.infer<typeof getPosts200DataSchema>');
        expect(strContent).toContain('export type GetPosts200DataPosts = z.infer<typeof getPosts200DataPostsSchema>');
        expect(strContent).toContain('export type GetPosts200DataPostsItem = z.infer<typeof getPosts200DataPostsItemSchema>');
    });
});
