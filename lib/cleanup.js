import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';

class Cleanup extends EventEmitter {
  async run(directory, olderThanDays, confirm = false) {
    const resolvedPath = path.resolve(directory);
    this.emit('cleanup-start', { directory: resolvedPath, olderThanDays, confirm });

    const stats = {
      filesToDelete: [],
      totalSizeToFree: 0,
      totalDeleted: 0,
      freedSize: 0
    };

    try {
      const entries = await fs.readdir(resolvedPath, { recursive: true });

      for (const entry of entries) {
        const fullPath = path.join(resolvedPath, entry);
        try {
          const fileStat = await fs.stat(fullPath);
          if (fileStat.isFile()) {
            const ageMs = Date.now() - fileStat.mtime.getTime();
            const ageDays = ageMs / (1000 * 60 * 60 * 24);

            if (ageDays > olderThanDays) {
              const fileData = {
                 path: entry,
                 fullPath,
                 size: fileStat.size,
                 mtime: fileStat.mtime,
                 daysOld: Math.floor(ageDays)
              };
              stats.filesToDelete.push(fileData);
              stats.totalSizeToFree += fileStat.size;
              this.emit('file-found', fileData);
            }
          }
        } catch (err) { }
      }

      // delete if confirmed
      if (confirm && stats.filesToDelete.length > 0) {
        for (const file of stats.filesToDelete) {
          try {
            await fs.unlink(file.fullPath);
            stats.totalDeleted++;
            stats.freedSize += file.size;
            this.emit('file-deleted', { 
               path: file.path, 
               current: stats.totalDeleted, 
               total: stats.filesToDelete.length 
            });
          } catch (error) {
            this.emit('error', { path: file.path, error: error.message });
          }
        }
      }

      this.emit('cleanup-complete', stats);
      return stats;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }
}

export default Cleanup;
