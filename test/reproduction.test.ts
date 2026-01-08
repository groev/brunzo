import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseBruFile } from '../src/parser';
import { generateSchemas } from '../src/generator';
import fs from 'fs-extra';
import path from 'path';

vi.mock('fs-extra');

describe('Reproduction Tests', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    const loginBruContent = `meta {
  name: Login
  type: http
  seq: 4
}

post {
  url: {{systemurl}}/login
  body: json
  auth: inherit
}

body:json {
  {
    "email": "test@test.com",
    "password": "password"
  }
}

example {
  name: example
  
  response: {
    headers: {
      content-type: application/json
    }
  
    status: {
      code: 200
      text: OK
    }
  
    body: {
      type: json
      content: '''
        {
          "success": true
        }
      '''
    }
  }
}
`;

    it('should NOT parse headers from example block as top-level headers', async () => {
        vi.mocked(fs.readFile).mockResolvedValue(loginBruContent);
        const result = await parseBruFile('login.bru');
        
        // This is expected to FAIL currently because of the bug
        expect(result?.headers).toBeUndefined();
    });

    it('should generate response schemas with concise naming (Login200)', async () => {
        vi.mocked(fs.readFile).mockResolvedValue(loginBruContent);
        const parsed = await parseBruFile('login.bru');
        
        if (!parsed) throw new Error("Parsed result is null");

        await generateSchemas([parsed], 'dist');

        const [filePath, content] = vi.mocked(fs.writeFile).mock.calls[0];
        const strContent = content as string;

        // This is expected to FAIL currently because name is LoginResponse200Body
        expect(strContent).toContain('export const login200Schema'); 
        expect(strContent).toContain('export type Login200 = z.infer<typeof login200Schema>');
    });
});
