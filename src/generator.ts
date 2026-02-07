import { quicktype, InputData, jsonInputForTargetLanguage } from "quicktype-core";
import { jsonSchemaToZod } from "json-schema-to-zod";
import { BruFile } from "./parser";
import fs from "fs-extra";
import path from "path";

function toPascalCase(str: string) {
  return str
    .replace(/(?:^\w|[A-Z]|\b\w)/g, (word) => word.toUpperCase())
    .replace(/\s+/g, '')
    .replace(/[^a-zA-Z0-9]/g, '');
}

function toCamelCase(str: string) {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function urlToPathName(url: string): string {
  // Remove template variables like {{systemurl}}
  let cleaned = url.replace(/\{\{[^}]+\}\}/g, '');

  // Remove protocol + host if present
  cleaned = cleaned.replace(/^https?:\/\/[^/]*/, '');

  // Remove query string and hash
  cleaned = cleaned.replace(/[?#].*$/, '');

  // Remove leading/trailing slashes
  cleaned = cleaned.replace(/^\/+|\/+$/g, '');

  if (!cleaned) return '';

  // Split by / and normalize each segment
  // Handle path params: :id → id, {id} → id
  const segments = cleaned.split('/').filter(Boolean).map(segment => {
    return segment
      .replace(/^:/, '')
      .replace(/^\{|\}$/g, '');
  });

  return segments.map(s => toPascalCase(s)).join('');
}

// Recursively walk the schema and replace $ref with const marker
function replaceRefsWithMarkers(obj: any, map: Record<string, string>) {
  if (typeof obj !== 'object' || obj === null) return;

  if (Array.isArray(obj)) {
    for (const item of obj) replaceRefsWithMarkers(item, map);
    return;
  }

  // Check if this object is a reference
  if (obj['$ref'] && typeof obj['$ref'] === 'string') {
      const refVal = obj['$ref'];
      const refName = refVal.replace('#/definitions/', '');
      
      if (map[refName]) {
          // Replace with const marker
          delete obj['$ref'];
          obj['const'] = `__REF__${map[refName]}`;
      }
      return;
  }

  for (const key in obj) {
      replaceRefsWithMarkers(obj[key], map);
  }
}

// Post-process schema to extract arrays and rename definitions
function restructureArrays(schema: any, rootName: string) {
    if (!schema.definitions) schema.definitions = {};
    const definitions = schema.definitions;

    // Helper to process a schema object
    function processObject(obj: any, currentName: string) {
        if (!obj || typeof obj !== 'object') return;
        
        // Process properties if object
        if (obj.properties) {
            for (const key of Object.keys(obj.properties)) {
                const prop = obj.properties[key];
                
                if (prop.type === 'array') {
                    const arrayName = currentName + toPascalCase(key);
                    const itemName = arrayName + 'Item';

                    let itemSchema = prop.items;
                    
                    if (itemSchema.$ref) {
                         const oldRef = itemSchema.$ref.replace('#/definitions/', '');
                         if (definitions[oldRef]) {
                             definitions[itemName] = JSON.parse(JSON.stringify(definitions[oldRef]));
                             processObject(definitions[itemName], itemName);
                         }
                    } else {
                        definitions[itemName] = itemSchema;
                        processObject(definitions[itemName], itemName);
                    }

                    obj.properties[key] = {
                        type: 'array',
                        items: { $ref: `#/definitions/${itemName}` }
                    };

                } else if (prop.type === 'object' && prop.properties) {
                    const objectName = currentName + toPascalCase(key);
                    
                    definitions[objectName] = JSON.parse(JSON.stringify(prop));
                    obj.properties[key] = { $ref: `#/definitions/${objectName}` };
                    
                    processObject(definitions[objectName], objectName);

                } else if (prop.$ref) {
                    const oldRef = prop.$ref.replace('#/definitions/', '');
                    const objectName = currentName + toPascalCase(key);

                    if (definitions[oldRef] && oldRef !== objectName) {
                        definitions[objectName] = JSON.parse(JSON.stringify(definitions[oldRef]));
                        obj.properties[key] = { $ref: `#/definitions/${objectName}` };
                        processObject(definitions[objectName], objectName);
                    }
                }
            }
        }
    }

    // Start with Root
    processObject(schema, rootName);
}


interface ComponentResult {
    zodSegments: string[];
    typeExports: string[];
}

async function generateComponentSchema(name: string, data: any): Promise<ComponentResult> {
    if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
        return { zodSegments: [], typeExports: [] };
    }

    const baseName = toPascalCase(name); // e.g. GetPostsBody

    // 1. Generate JSON Schema
    const jsonInput = jsonInputForTargetLanguage("schema");
    await jsonInput.addSource({
        name: baseName,
        samples: [JSON.stringify(data)]
    });

    const inputData = new InputData();
    inputData.addInput(jsonInput);

    const result = await quicktype({
        inputData,
        lang: "schema",
        rendererOptions: { "just-types": "false" } 
    });

    let jsonSchema = JSON.parse(result.lines.join("\n"));

    // Unwrap root ref if necessary
    if (jsonSchema.$ref && jsonSchema.$ref.startsWith('#/definitions/') && jsonSchema.definitions) {
        const refName = jsonSchema.$ref.replace('#/definitions/', '');
        if (jsonSchema.definitions[refName]) {
             jsonSchema = {
                 ...jsonSchema.definitions[refName],
                 definitions: jsonSchema.definitions,
                 $schema: jsonSchema.$schema
             };
             delete jsonSchema.definitions[refName];
        }
    }

    // 2. Restructure Arrays and Rename
    restructureArrays(jsonSchema, baseName);

    // 3. Prepare Definitions Mapping
    // Now definitions should have correct names like GetPostsBodyPosts, GetPostsBodyPostsItem
    const definitions = jsonSchema.definitions || {};
    const refMap: Record<string, string> = {}; // OldDefName -> NewSchemaName
    const defKeys = Object.keys(definitions);
    const typeExports: string[] = [];

    for (const key of defKeys) {
        // We assume keys are now PascalCase from our restructuring or Quicktype defaults.
        // We enforce the Schema Naming: camelCase + Schema
        const newTypeName = toPascalCase(key);
        const newSchemaName = `${toCamelCase(newTypeName)}Schema`;

        refMap[key] = newSchemaName;
        typeExports.push(`export type ${newTypeName} = z.infer<typeof ${newSchemaName}>;`);
    }

    // Main Root Export
    const mainSchemaName = `${toCamelCase(baseName)}Schema`; // getPostsBodySchema
    const mainTypeName = baseName; // GetPostsBody
    typeExports.push(`export type ${mainTypeName} = z.infer<typeof ${mainSchemaName}>;`);

    // 4. Generate Zod Code for Definitions
    const zodSegments: string[] = [];

    for (const key of defKeys) {
        const defSchema = definitions[key];
        const newSchemaName = refMap[key];
        
        replaceRefsWithMarkers(defSchema, refMap);

        const code = jsonSchemaToZod(defSchema, {
            module: "esm", 
            name: newSchemaName,
            type: false 
        });
        const cleanCode = code.replace(/import \{ z \} from \"zod\"[\s\S]*?\n/, '').trim();
        zodSegments.push(cleanCode);
    }

    // 5. Generate Zod Code for Root
    const rootSchema = { ...jsonSchema };
    delete rootSchema.definitions;
    
    replaceRefsWithMarkers(rootSchema, refMap);

    const rootCode = jsonSchemaToZod(rootSchema, {
        module: "esm", 
        name: mainSchemaName,
        type: false 
    });
    const cleanRootCode = rootCode.replace(/import \{ z \} from \"zod\"[\s\S]*?\n/, '').trim();
    zodSegments.push(cleanRootCode);

    return { zodSegments, typeExports };
}

export interface GenStats {
    documentedEndpoints: number;
    createdSchemas: number;
}

export async function generateSchemas(bruFiles: BruFile[], outPath: string, keep: boolean = false): Promise<GenStats> {
    if (!keep) {
        await fs.emptyDir(outPath);
    } else {
        await fs.ensureDir(outPath);
    }
    
    let documentedEndpoints = 0;
    let createdSchemas = 0;

    for (const file of bruFiles) {
        const methodPrefix = toPascalCase(file.method);
        const pathName = urlToPathName(file.url);
        const baseName = methodPrefix + pathName;
        const fileName = `${baseName}.ts`;
        const outFilePath = path.join(outPath, fileName);

        const allZodSegments: string[] = [];
        const allTypeExports: string[] = [];

        // Helper to run generation and accumulate
        const runGen = async (suffix: string, data: any) => {
            if (!data) return;
            const componentName = baseName + suffix;
            const res = await generateComponentSchema(componentName, data);
            allZodSegments.push(...res.zodSegments);
            allTypeExports.push(...res.typeExports);
        };

        // Generate for each component
        await runGen('Body', file.body);
        await runGen('Header', file.headers);
        await runGen('Query', file.query);
        await runGen('Params', file.params);

        // Generate for Responses
        if (file.responses) {
            for (const response of file.responses) {
                await runGen(`${response.statusCode}`, response.body);
                await runGen(`${response.statusCode}Header`, response.headers);
            }
        }

        if (allZodSegments.length === 0) {
            // Skipping silently
            continue;
        }
        
        // Documented this endpoint
        documentedEndpoints++;
        
        // Count schemas (assuming 1 type export = 1 schema approx, or use zodSegments length)
        // Each zodSegment corresponds to one exported Zod schema.
        createdSchemas += allZodSegments.length;

        // Assemble Final Content
        let fullContent = `import { z } from "zod";\n\n` + allZodSegments.join('\n\n');
        
        // Replace markers with lazy refs
        fullContent = fullContent.replace(/z\.literal\(['"]__REF__(.+?)['"]\)/g, "z.lazy(() => $1)");

        // Deduplicate Type Exports
        const uniqueTypeExports = Array.from(new Set(allTypeExports));
        fullContent += `\n\n${uniqueTypeExports.join('\n')}\n`;
        
        await fs.writeFile(outFilePath, fullContent);
        // Silent: console.log(`Generated ${outFilePath}`);
    }

    return { documentedEndpoints, createdSchemas };
}