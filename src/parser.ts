import fs from 'fs-extra';
import path from 'path';
import JSON5 from 'json5';

export interface BruFile {
  path: string;
  name: string;
  method: string;
  url: string;
  body?: any;
  headers?: Record<string, any>;
  query?: Record<string, any>;
  params?: Record<string, any>;
}

function extractBlockContent(content: string, blockStartName: string): string | null {
    // Escaping regex special chars in blockStartName (like :) 
    const escapedName = blockStartName.replace(/[.*+?^${}()|[\\]/g, '\\$&');
    // We want to match: name \s* { 
    // So regex source: name\s*\{ 
    // In string literal: "name\\s*\\{" 
    const regex = new RegExp(`${escapedName}\\s*\\{`);
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

  // Extract Body
  let body = null;
  const bodyContent = extractBlockContent(content, 'body:json');
  if (bodyContent) {
      try {
          body = JSON5.parse(bodyContent);
      } catch (e) {}
  }

  // Extract Key-Value Blocks
  const headersStr = extractBlockContent(content, 'headers');
  const headers = headersStr ? parseKvContent(headersStr) : undefined;
  
  const queryStr = extractBlockContent(content, 'params:query');
  const query = queryStr ? parseKvContent(queryStr) : undefined;
  
  const paramsStr = extractBlockContent(content, 'params:path');
  const params = paramsStr ? parseKvContent(paramsStr) : undefined;

  return {
    path: filePath,
    name,
    method,
    url,
    body,
    headers,
    query,
    params
  };
}