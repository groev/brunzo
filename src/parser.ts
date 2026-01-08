import fs from 'fs-extra';
import path from 'path';
import JSON5 from 'json5';

export interface Response {
  statusCode: number;
  body?: any;
  headers?: Record<string, any>;
}

export interface BruFile {
  path: string;
  name: string;
  method: string;
  url: string;
  body?: any;
  headers?: Record<string, any>;
  query?: Record<string, any>;
  params?: Record<string, any>;
  responses?: Response[];
}

function extractBlockContent(content: string, blockStartName: string): string | null {
    // Escaping regex special chars in blockStartName (like :) 
    const escapedName = blockStartName.replace(/[.*+?^${}()|[\\]/g, '\\$&');
    // We want to match: name \s* { 
    // or name \s* : \s* {
    // So regex source: name\s*:?\s*\{ 
    const regex = new RegExp(`${escapedName}\\s*:?\\s*\\{`);
    const match = content.match(regex);
    
    if (!match || match.index === undefined) return null;
    
    const openBraceIndex = content.indexOf('{', match.index);
    if (openBraceIndex === -1) return null;
    
    let braceCount = 1;
    let i = openBraceIndex + 1;
    while (i < content.length && braceCount > 0) {
        if (content[i] === '{') braceCount++;
        else if (content[i] === '}') braceCount--;
        i++;
    }
    
    if (braceCount === 0) {
        return content.substring(openBraceIndex + 1, i - 1);
    }
    
    return null;
}

function stripBlocks(content: string, blockStartName: string): string {
    let newContent = content;
    const escapedName = blockStartName.replace(/[.*+?^${}()|[\\]/g, '\\$&');
    
    while (true) {
        const regex = new RegExp(`${escapedName}\\s*:?\\s*\\{`);
        const match = newContent.match(regex);
        
        if (!match || match.index === undefined) break;
        
        const openBraceIndex = newContent.indexOf('{', match.index);
        if (openBraceIndex === -1) break;
        
        let braceCount = 1;
        let i = openBraceIndex + 1;
        while (i < newContent.length && braceCount > 0) {
            if (newContent[i] === '{') braceCount++;
            else if (newContent[i] === '}') braceCount--;
            i++;
        }
        
        if (braceCount === 0) {
            newContent = newContent.substring(0, match.index) + newContent.substring(i);
        } else {
            break;
        }
    }
    return newContent;
}

function parseKvContent(blockContent: string): Record<string, any> | undefined {
    const lines = blockContent.split('\n');
    const result: Record<string, any> = {};
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
        
        const colonIndex = trimmed.indexOf(':');
        if (colonIndex !== -1) {
            const key = trimmed.substring(0, colonIndex).trim();
            let value = trimmed.substring(colonIndex + 1).trim();
            
            if (value === 'true') result[key] = true;
            else if (value === 'false') result[key] = false;
            else if (!isNaN(Number(value)) && value !== '') result[key] = Number(value);
            else result[key] = value;
        }
    }
    return Object.keys(result).length > 0 ? result : undefined;
}

export async function parseBruFile(filePath: string): Promise<BruFile | null> {
  const content = await fs.readFile(filePath, 'utf-8');

  // Extract Name from meta
  const metaBlockMatch = content.match(/meta\s*\{([\s\S]*?)\}/);
  let name = path.basename(filePath, '.bru');
  if (metaBlockMatch) {
    const nameLineMatch = metaBlockMatch[1].match(/name:\s*(.+)/);
    if (nameLineMatch) {
      name = nameLineMatch[1].trim();
    }
  }

  // Extract Method
  const methodMatch = content.match(/^(get|post|put|delete|patch|options|head)\s*\{/m);
  const method = methodMatch ? methodMatch[1].toLowerCase() : 'unknown';
  
  // Extract URL
  const urlMatch = content.match(/url:\s*(.+)/);
  const url = urlMatch ? urlMatch[1].trim() : '';

  // Extract Examples (Before stripping them)
  const responses: Response[] = [];
  const statusCodesSeen = new Set<number>();
  
  const exampleRegex = /example\s*\{/g;
  let exampleMatch;

  while ((exampleMatch = exampleRegex.exec(content)) !== null) {
      const exampleContent = extractBlockContent(content.substring(exampleMatch.index), 'example');
      if (exampleContent) {
          const responseContent = extractBlockContent(exampleContent, 'response');
          if (responseContent) {
              // Extract Status Code
              const statusBlock = extractBlockContent(responseContent, 'status');
              let statusCode: number | undefined;
              if (statusBlock) {
                  const codeMatch = statusBlock.match(/code:\s*(\d+)/);
                  if (codeMatch) statusCode = parseInt(codeMatch[1], 10);
              }

              if (statusCode && !statusCodesSeen.has(statusCode)) {
                  // Extract Body
                  const bodyBlock = extractBlockContent(responseContent, 'body');
                  let responseBody: any = undefined;
                  if (bodyBlock) {
                      // Check for content: ''' ... ''' or content: "..."
                      const contentMatch = bodyBlock.match(/content:\s*'''([\s\S]*?)'''/) || 
                                         bodyBlock.match(/content:\s*"([\s\S]*?)"/) ||
                                         bodyBlock.match(/content:\s*([\s\S]+)/);
                      
                      if (contentMatch) {
                          try {
                              responseBody = JSON5.parse(contentMatch[1].trim());
                          } catch (e) {
                              // If it fails, maybe it's not JSON5 but raw string?
                          }
                      }
                  }

                  // Extract Headers (optional)
                  const headersBlock = extractBlockContent(responseContent, 'headers');
                  const responseHeaders = headersBlock ? parseKvContent(headersBlock) : undefined;

                  responses.push({
                      statusCode,
                      body: responseBody,
                      headers: responseHeaders
                  });
                  statusCodesSeen.add(statusCode);
              }
          }
      }
      // Ensure we don't get stuck in an infinite loop if something goes wrong
      if (exampleRegex.lastIndex === exampleMatch.index) exampleRegex.lastIndex++;
  }

  // Strip examples to avoid polluting top-level parsing
  const cleanContent = stripBlocks(content, 'example');

  // Extract Body
  let body = null;
  const bodyContent = extractBlockContent(cleanContent, 'body:json');
  if (bodyContent) {
      try {
          body = JSON5.parse(bodyContent);
      } catch (e) {}
  }

  // Extract Key-Value Blocks
  const headersStr = extractBlockContent(cleanContent, 'headers');
  const headers = headersStr ? parseKvContent(headersStr) : undefined;
  
  const queryStr = extractBlockContent(cleanContent, 'params:query');
  const query = queryStr ? parseKvContent(queryStr) : undefined;
  
  const paramsStr = extractBlockContent(cleanContent, 'params:path');
  const params = paramsStr ? parseKvContent(paramsStr) : undefined;

  return {
    path: filePath,
    name,
    method,
    url,
    body,
    headers,
    query,
    params,
    responses: responses.length > 0 ? responses : undefined
  };
}