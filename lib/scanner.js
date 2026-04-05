import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';

class Scanner extends EventEmitter {
  async scan(directory) {
    this.emit('scan-start', { directory });

    const stats = {
      totalFiles: 0,
      totalSize: 0,
      byType: new Map(),
      byAge: {
        last7: 0,
        last30: 0,
        older90: 0
      },
      largestFiles: [],
      oldestFile: null
    };

    try {
      // normalize 
      const resolvedPath = path.resolve(directory);
      
      const entries = await fs.readdir(resolvedPath, { recursive: true });

      for (const entry of entries) {
        const fullPath = path.join(resolvedPath, entry);
        const fileStat = await fs.stat(fullPath);

        if (fileStat.isDirectory()) continue;

        stats.totalFiles++;
        stats.totalSize += fileStat.size;

        const ext = path.extname(entry).toLowerCase() || '(no-extension)';
        const typeStat = stats.byType.get(ext) || { count: 0, size: 0 };
        typeStat.count++;
        typeStat.size += fileStat.size;
        stats.byType.set(ext, typeStat);

        const now = new Date();
        const mtime = fileStat.mtime;
        const diffMs = now - mtime;
        const diffDays = diffMs / (1000 * 60 * 60 * 24);

        if (diffDays <= 7) stats.byAge.last7++;
        if (diffDays <= 30) stats.byAge.last30++;
        if (diffDays > 90) stats.byAge.older90++;

        stats.largestFiles.push({ name: entry, size: fileStat.size });
        stats.largestFiles.sort((a, b) => b.size - a.size);
        if (stats.largestFiles.length > 3) stats.largestFiles.splice(3);

        if (!stats.oldestFile || mtime < stats.oldestFile.mtime) {
          stats.oldestFile = { name: entry, mtime: mtime };
        }

        this.emit('file-found', { 
          path: entry, 
          size: fileStat.size, 
          current: stats.totalFiles,
          total: entries.length
        });
      }

      this.emit('scan-complete', stats);
      return stats;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }
}

export default Scanner;
