import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_ARTIFACT_FILES,
  shouldExcludeDir,
  shouldExcludeFile,
  walkWorkspaceFiles,
} from './artifactScanner';

describe('artifactScanner', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  async function makeTempDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'goose-artifacts-'));
    tempDirs.push(dir);
    return dir;
  }

  it('excludes dotfiles, node_modules, target, and .git', () => {
    expect(shouldExcludeDir('.git')).toBe(true);
    expect(shouldExcludeDir('node_modules')).toBe(true);
    expect(shouldExcludeDir('target')).toBe(true);
    expect(shouldExcludeDir('.hidden')).toBe(true);
    expect(shouldExcludeDir('src')).toBe(false);

    expect(shouldExcludeFile('.env')).toBe(true);
    expect(shouldExcludeFile('script.py')).toBe(false);
  });

  it('walks workspace files with excludes applied', async () => {
    const root = await makeTempDir();
    await fs.mkdir(path.join(root, 'src'));
    await fs.mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    await fs.mkdir(path.join(root, '.git'));
    await fs.writeFile(path.join(root, 'src', 'main.py'), 'print("hi")');
    await fs.writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), 'x');
    await fs.writeFile(path.join(root, '.env'), 'SECRET=1');
    await fs.writeFile(path.join(root, 'README.md'), '# hi');

    const { files, truncated } = await walkWorkspaceFiles(root);

    expect(truncated).toBe(false);
    expect(files.map((f) => f.relativePath).sort()).toEqual(['README.md', 'src/main.py']);
  });

  it('limits the number of returned files', async () => {
    const root = await makeTempDir();
    for (let i = 0; i < MAX_ARTIFACT_FILES + 5; i++) {
      await fs.writeFile(path.join(root, `file-${i}.txt`), 'x');
    }

    const { files, truncated } = await walkWorkspaceFiles(root, 10);

    expect(files).toHaveLength(10);
    expect(truncated).toBe(true);
  });
});
