import { EventEmitter } from 'events';
import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import path from 'path';

class Organizer extends EventEmitter {
  static CATEGORIES = {
    Documents: ['.pdf', '.docx', '.doc', '.txt', '.md', '.xlsx', '.pptx'],
    Images: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp'],
    Archives: ['.zip', '.rar', '.tar', '.gz', '.7z'],
    Code: ['.js', '.py', '.java', '.cpp', '.html', '.css', '.json'],
    Videos: ['.mp4', '.avi', '.mkv', '.mov', '.webm'],
    Other: []
  };

  async organize(source, target) {
    const resolvedSource = path.resolve(source);
    const resolvedTarget = path.resolve(target);

    this.emit('organize-start', { source: resolvedSource, target: resolvedTarget });

    const stats = {
      totalCopied: 0,
      totalSize: 0,
      categories: {}
    };

    for (const catName of Object.keys(Organizer.CATEGORIES)) {
      stats.categories[catName] = 0;
    }

    try {
      // prepare dirs
      for (const catName of Object.keys(Organizer.CATEGORIES)) {
        await fs.mkdir(path.join(resolvedTarget, catName), { recursive: true });
      }

      const entries = await fs.readdir(resolvedSource, { recursive: true });
      const filesOnly = [];

      for (const entry of entries) {
        const fullSourcePath = path.join(resolvedSource, entry);
        try {
          const fileStat = await fs.stat(fullSourcePath);
          if (fileStat.isFile()) {
            filesOnly.push({ entry, fullSourcePath, size: fileStat.size });
          }
        } catch (err) { }
      }

      for (const file of filesOnly) {
        const extension = path.extname(file.entry).toLowerCase();
        let category = 'Other';

        for (const [catName, extensions] of Object.entries(Organizer.CATEGORIES)) {
          if (extensions.includes(extension)) {
            category = catName;
            break;
          }
        }

        const fileName = path.basename(file.entry);
        let targetFilePath = path.join(resolvedTarget, category, fileName);

        // name clash helper
        const nameParsed = path.parse(fileName);
        let counter = 1;
        while (true) {
          try {
            await fs.access(targetFilePath);
            targetFilePath = path.join(
              resolvedTarget, 
              category, 
              `${nameParsed.name}(${counter})${nameParsed.ext}`
            );
            counter++;
          } catch {
            break;
          }
        }

        this.emit('copy-start', { 
          path: file.entry, 
          size: file.size, 
          current: stats.totalCopied + 1, 
          total: filesOnly.length 
        });

        try {
          if (file.size < 10 * 1024 * 1024) {
            await fs.copyFile(file.fullSourcePath, targetFilePath);
          } else {
            await pipeline(
              createReadStream(file.fullSourcePath),
              createWriteStream(targetFilePath)
            );
          }

          stats.totalCopied++;
          stats.totalSize += file.size;
          stats.categories[category]++;

          this.emit('copy-complete', { 
            path: file.entry, 
            target: targetFilePath, 
            current: stats.totalCopied, 
            total: filesOnly.length 
          });
        } catch (error) {
          this.emit('copy-error', { path: file.entry, error: error.message });
        }
      }

      this.emit('organization-complete', stats);
      return stats;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }
}

export default Organizer;
