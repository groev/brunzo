#!/usr/bin/env node
import { Command } from 'commander';
import { glob } from 'glob';
import path from 'path';
import { parseBruFile } from './parser';
import { generateSchemas } from './generator';
import fs from 'fs-extra';

const program = new Command();

program
  .name('brunzo')
  .description('Generate Zod schemas and Types from Bruno files')
  .requiredOption('-i, --in <path>', 'Input path to Bruno folder')
  .requiredOption('-o, --out <path>', 'Output path for generated files')
  .action(async (options) => {
    const inDir = path.resolve(options.in);
    const outDir = path.resolve(options.out);

    if (!fs.existsSync(inDir)) {
        console.error(`Input directory does not exist: ${inDir}`);
        process.exit(1);
    }

    // Silent: console.log(`Searching for .bru files in ${inDir}...`);

    const pattern = path.join(inDir, '**/*.bru').replace(/\\/g, '/');

    try {
        const files = await glob(pattern);

        if (files.length === 0) {
            console.log('No .bru files found.');
            return;
        }

        // Silent: console.log(`Found ${files.length} .bru files.`);
        
        const parsedFiles = [];
        for (const file of files) {
            try {
                const parsed = await parseBruFile(file);
                if (parsed) {
                    parsedFiles.push(parsed);
                }
            } catch (e) {
                // Keep error logs? Or suppress? 
                // "Debugging by default off" usually means errors are still important.
                console.error(`Error parsing ${file}:`, e);
            }
        }

        // Silent: console.log(`Parsed ${parsedFiles.length} files. Generating schemas...`);
        const stats = await generateSchemas(parsedFiles, outDir);
        
        console.log(`Documented ${stats.documentedEndpoints} endpoints and created ${stats.createdSchemas} schemas.`);

    } catch (err) {
        console.error('Error finding files:', err);
        process.exit(1);
    }
  });

program.parse(process.argv);
