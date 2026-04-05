import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

class DuplicateFinder extends EventEmitter {
  async find(directory) {
    const resolvedPath = path.resolve(directory);
    this.emit('duplicates-start', { directory: resolvedPath });

    const hashToFiles = new Map();
    const stats = {
      totalProcessed: 0,
      totalDuplicates: 0,
      wastedSpace: 0,
      duplicateGroups: []
    };

    try {
      const entries = await fs.promises.readdir(resolvedPath, { recursive: true });
      const filesOnly = [];

      for (const entry of entries) {
        const fullPath = path.join(resolvedPath, entry);
        try {
          const fileStat = await fs.promises.stat(fullPath);
          if (fileStat.isFile()) {
            filesOnly.push({ path: entry, fullPath, size: fileStat.size });
          }
        } catch (err) { }
      }

      for (const file of filesOnly) {
        try {
          const hash = await this.calculateHash(file.fullPath);
          const group = hashToFiles.get(hash) || [];
          group.push(file);
          hashToFiles.set(hash, group);
        } catch (err) {
          this.emit('file-error', { path: file.path, error: err.message });
        }

        stats.totalProcessed++;
        this.emit('file-processed', { 
          path: file.path, 
          current: stats.totalProcessed, 
          total: filesOnly.length 
        });
      }

      for (const [hash, group] of hashToFiles.entries()) {
        if (group.length > 1) {
          const fileSize = group[0].size;
          const count = group.length;
          const wasted = fileSize * (count - 1);
          
          stats.totalDuplicates += count;
          stats.wastedSpace += wasted;
          stats.duplicateGroups.push({
            hash,
            count,
            size: fileSize,
            wasted,
            files: group.map(f => f.path)
          });
        }
      }

      this.emit('duplicates-found', stats);
      return stats;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  calculateHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }
}

export default DuplicateFinder;
