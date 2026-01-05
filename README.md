> **Note:** This project was completely vibe coded with Gemini. 🤖✨

# Brunzo

**Brunzo** is a CLI tool that automatically generates **Zod schemas** and **TypeScript types** from your **Bruno** API collections. 

It parses your `.bru` files, infers schemas from your request bodies (JSON), headers, query parameters, and path parameters, and outputs ready-to-use Zod schemas and TypeScript type definitions.

## Features

- **Automated Inference**: Generates schemas from request bodies (`body:json`), headers, query params (`params:query`), and path params (`params:path`).
- **Loose JSON Support**: Handles comments and relaxed JSON syntax (JSON5) commonly used in Bruno configuration files.
- **Smart Array Extraction**: Automatically extracts array items into their own named definitions (e.g., `GetPostsBodyPostsItem`) for cleaner, reusable types.
- **Orval-style Naming**: Follows a consistent naming convention:
  - Schemas: `camelCase` + `Schema` (e.g., `getPostsBodySchema`)
  - Types: `PascalCase` (e.g., `GetPostsBody`)
- **Lazy Evaluation**: Uses `z.lazy()` to handle recursive or complex nested structures without runtime errors.

## Installation

You can run it directly using `npx` or install it globally.

### Global Installation (Recommended)

If you are developing locally:

```bash
git clone <your-repo-url>
cd brunzo
npm install
npm run build
npm link
```

Now you can use the `brunzo` command anywhere.

## Usage

```bash
brunzo -i <path-to-bruno-collection> -o <path-to-output-dir>
```

### Options

| Option | Alias | Description | Required |
| :--- | :--- | :--- | :--- |
| `--in` | `-i` | Input directory containing `.bru` files | Yes |
| `--out` | `-o` | Output directory where `.ts` files will be saved | Yes |
| `--keep` | `-k` | Keep existing files in output directory | No |
| `--help` | `-h` | Display help information | No |

### Example

Given a Bruno file `GetPosts.bru` with a JSON body:

```bash
brunzo -i ./my-bruno-api -o ./src/generated/types
```

**Output (`src/generated/types/GetPosts.ts`):**

```typescript
import { z } from "zod";

// Extracted Item Schema
export const getPostsBodyPostsItemSchema = z.object({ 
  id: z.number().int(), 
  title: z.string() 
}).strict();

// Extracted Array Schema
export const getPostsBodyPostsSchema = z.array(z.lazy(() => getPostsBodyPostsItemSchema));

// Root Schema
export const getPostsBodySchema = z.object({ 
  posts: z.lazy(() => getPostsBodyPostsSchema) 
}).strict();

// TS Types
export type GetPostsBodyPostsItem = z.infer<typeof getPostsBodyPostsItemSchema>;
export type GetPostsBodyPosts = z.infer<typeof getPostsBodyPostsSchema>;
export type GetPostsBody = z.infer<typeof getPostsBodySchema>;
```

## Development

1.  **Install Dependencies**:
    ```bash
    npm install
    ```

2.  **Build**:
    ```bash
    npm run build
    ```

3.  **Run Locally**:
    ```bash
    node dist/index.js -i ./test/input -o ./test/output
    ```

## License

ISC
