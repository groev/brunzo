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
                    // It's an array! Extract logic.
                    // Name for the array: Parent + Pascal(Key) e.g. GetPostsBody + Posts
                    const arrayName = currentName + toPascalCase(key);
                    // Name for the item: ArrayName + Item e.g. GetPostsBodyPosts + Item
                    const itemName = arrayName + 'Item';

                    // 1. Handle Item Definition
                    // Resolve item schema
                    let itemSchema = prop.items;
                    
                    // If item is a ref, we want to rename/clone the target
                    if (itemSchema.$ref) {
                         const oldRef = itemSchema.$ref.replace('#/definitions/', '');
                         if (definitions[oldRef]) {
                             // Clone the definition to new name to enforce strict naming context
                             definitions[itemName] = JSON.parse(JSON.stringify(definitions[oldRef]));
                             // Recurse into the new item definition
                             processObject(definitions[itemName], itemName);
                         } else {
                             // Ref broken? Just keep as is or create empty?
                         }
                    } else {
                        // Inline schema. Extract it.
                        definitions[itemName] = itemSchema;
                        // Recurse
                        processObject(definitions[itemName], itemName);
                    }

                    // 2. Handle Array Definition
                    // We create a definition for the array itself
                    definitions[arrayName] = {
                        type: 'array',
                        items: { $ref: `#/definitions/${itemName}` }
                    };

                    // 3. Update Property to point to Array Definition
                    obj.properties[key] = { $ref: `#/definitions/${arrayName}` };

                } else if (prop.type === 'object') {
                    // Inline object?
                    // Maybe we should name it too? User didn't strictly ask, but we can recurse.
                    processObject(prop, currentName + toPascalCase(key));
                } else if (prop.$ref) {
                    // Ref to object?
                    const refName = prop.$ref.replace('#/definitions/', '');
                    if (definitions[refName]) {
                        // We might want to rename this too to maintain context naming?
                        // For now, just recurse.
                        // processObject(definitions[refName], refName);
                        // Avoiding infinite recursion if circular.
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

export async function generateSchemas(bruFiles: BruFile[], outPath: string): Promise<GenStats> {
    await fs.ensureDir(outPath);
    
    let documentedEndpoints = 0;
    let createdSchemas = 0;

    for (const file of bruFiles) {
        const cleanName = toPascalCase(file.name);
        const fileName = `${cleanName}.ts`;
        const outFilePath = path.join(outPath, fileName); 

        const allZodSegments: string[] = [];
        const allTypeExports: string[] = [];
        
        // Helper to run generation and accumulate
        const runGen = async (suffix: string, data: any) => {
            if (!data) return;
            // name: e.g. GetPostsBody
            const componentName = cleanName + suffix;
            const res = await generateComponentSchema(componentName, data);
            allZodSegments.push(...res.zodSegments);
            allTypeExports.push(...res.typeExports);
        };

        // Generate for each component
        await runGen('Body', file.body);
        await runGen('Header', file.headers);
        await runGen('Query', file.query);
        await runGen('Params', file.params);

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