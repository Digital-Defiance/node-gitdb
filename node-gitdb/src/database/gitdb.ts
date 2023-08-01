import { readdirSync, statSync } from 'fs';
import { connect } from 'mongoose';
import { join } from 'path';
import { GitOperations } from './gitOperations';
import { GitDBIndex } from './gitdb-index';
import { environment } from '../environment';

/**
 * GitDB is the Git-based on-disk component of node-gitdb. It is responsible for
 * checking out the git repository containing the markdown formatted database
 * and providing methods to index (into mongo) and query the database.
 * 
 * GitDB refers to the on-disk part, and GitDBIndex refers to the mongo index.
 */
export class GitDB {
  public readonly gitDatabase: GitOperations;
  public readonly index: GitDBIndex;
  private mongo?: typeof import('mongoose');
  public get mongoConnector(): typeof import('mongoose') {
    if (!this.mongo) {
      throw new Error('Mongo has not been initialized');
    }
    return this.mongo;
  }

  constructor(gitDatabase: GitOperations) {
    this.gitDatabase = gitDatabase;
    this.index = new GitDBIndex(this);
  }

  public async init() {
    await this.gitDatabase.ensureCheckedOutLatest();
    this.mongo = await connect(environment.mongo.uri);
    await this.index.init();
  }

  /**
   * Get a list of all tables in the database
   * @returns a list of all tables in the database
   */
  public getTables(): string[] {
    const tables = readdirSync(this.gitDatabase.fullPath);
    return tables.filter((table) => !table.startsWith('.'));
  }

  /**
   * Recurse into the specified table and return a list of all files
   */
  public getTableFiles(table: string): string[] {
    console.log(`Getting files in table: ${table}`);
    const tablePath = join(this.gitDatabase.fullPath, table);
    const files = readdirSync(tablePath);
    const returnedFiles: string[] = [];
    files.forEach((file) => {
      if (file.startsWith('.')) {
        return;
      }
      const fullPath = join(tablePath, file);
      const relativePath = join(table, file);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        // ignore nested directories
        console.log(`Ignoring nested directory: ${relativePath}`);
      } else {
        returnedFiles.push(file);
      }
    });
    return returnedFiles;
  }



  public async getChangedTables(
    table: string,
    sinceRevision: string
  ): Promise<string[]> {
    console.log(`Checking for changes in table: ${table}`);
    const git = this.gitDatabase.getSimpleGit();
    const tablePath = join(this.gitDatabase.fullPath, table);
    try {
      const diff = await git.diff([
        `${sinceRevision}..HEAD`,
        '--name-only',
        '--',
        tablePath,
      ]);
      if (diff.trim().length === 0) {
        console.log(`No changes in table: ${table}`);
        return [];
      } else {
        const changedFiles = diff
          .split('\n')
          .map((filePath) => filePath.replace(`${tablePath}/`, ''));
        return changedFiles;
      }
    } catch (error) {
      console.error(`Failed to get changes in table: ${table}`, error);
      throw error;
    }
  }

  public static async new(): Promise<GitDB> {
    const gitDatabase = new GitOperations(environment.gitdb);
    const gitDb = new GitDB(gitDatabase);
    await gitDb.init();
    return gitDb;
  }
}
