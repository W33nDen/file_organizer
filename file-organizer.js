import Scanner from './lib/scanner.js';
import DuplicateFinder from './lib/duplicates.js';
import Organizer from './lib/organizer.js';
import Cleanup from './lib/cleanup.js';
import path from 'path';


function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}


function drawProgressBar(current, total, width = 20) {
  if (total === 0) return '░'.repeat(width) + ' 0/0';
  const percentage = Math.min(current / total, 1);
  const filled = Math.round(percentage * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return `${bar} ${current}/${total}`;
}


function handleError(error, target) {
  process.stdout.write('\n');
  if (error.code === 'ENOENT') {
    console.error(`❌ Error: Path not found: ${target}`);
  } else if (error.code === 'EACCES') {
    console.error(`❌ Error: Permission denied: ${target}`);
  } else {
    console.error(`❌ Unexpected error: ${error.message}`);
  }
  process.exit(1);
}

const args = process.argv.slice(2);
const command = args[0];
const targetDir = args[1];

if (!command || !targetDir) {
  console.log('Usage: node file-organizer.js <command> <directory> [options]');
  console.log('Commands:');
  console.log('  scan <dir>             Analyze directory statistics');
  console.log('  duplicates <dir>       Find duplicate files (SHA-256)');
  console.log('  organize <dir> --output <out_dir> Sort files into categories');
  console.log('  cleanup <dir> --older-than <days> [--confirm] Remove old files');
  process.exit(0);
}

(async () => {
  switch (command) {
    case 'scan':
      await runScan(targetDir);
      break;
    case 'duplicates':
      await runDuplicates(targetDir);
      break;
    case 'organize':
      const outIndex = args.indexOf('--output');
      const outputDir = outIndex !== -1 ? args[outIndex + 1] : null;
      if (!outputDir) {
        console.error('❌ Error: --output directory is required for organize command.');
        process.exit(1);
      }
      await runOrganize(targetDir, outputDir);
      break;
    case 'cleanup':
      const ageIndex = args.indexOf('--older-than');
      const days = ageIndex !== -1 ? parseInt(args[ageIndex + 1]) : null;
      if (days === null || isNaN(days)) {
        console.error('❌ Error: --older-than <days> is required for cleanup command.');
        process.exit(1);
      }
      const confirm = args.includes('--confirm');
      await runCleanup(targetDir, days, confirm);
      break;
    default:
      console.error(`❌ Unknown command: ${command}`);
      process.exit(1);
  }
})();

async function runScan(directory) {
  const scanner = new Scanner();
  
  scanner.on('scan-start', (data) => console.log(`📂 Scanning: ${data.directory}`));
  scanner.on('file-found', (data) => {
    process.stdout.write(`\rProcessing... ${drawProgressBar(data.current, data.total)} files`);
  });

  try {
    const stats = await scanner.scan(directory);
    process.stdout.write('\n\n📊 Scan Results:\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Total files: ${stats.totalFiles}`);
    console.log(`Total size:  ${formatSize(stats.totalSize)}\n`);

    console.log('By File Type:');
    const sortedTypes = [...stats.byType.entries()]
      .sort((a, b) => b[1].size - a[1].size);
    
    for (const [ext, info] of sortedTypes) {
      console.log(`  ${ext.padEnd(8)} ${info.count.toString().padStart(4)} files   ${formatSize(info.size).padStart(10)}`);
    }

    console.log('\nFile Age:');
    console.log(`  Last 7 days:    ${stats.byAge.last7} files`);
    console.log(`  Last 30 days:   ${stats.byAge.last30} files`);
    console.log(`  Older than 90:  ${stats.byAge.older90} files`);

    console.log('\nLargest files:');
    stats.largestFiles.forEach((f, i) => {
      console.log(`  ${i + 1}. ${path.basename(f.name).padEnd(25)} ${formatSize(f.size).padStart(10)}`);
    });

    if (stats.oldestFile) {
      const ageDays = Math.floor((Date.now() - stats.oldestFile.mtime) / (1000 * 60 * 60 * 24));
      console.log(`\nOldest file: ${path.basename(stats.oldestFile.name)} (modified ${ageDays} days ago)`);
    }
  } catch (error) {
    handleError(error, directory);
  }
}

async function runDuplicates(directory) {
  const finder = new DuplicateFinder();
  
  finder.on('duplicates-start', (data) => console.log(`🔍 Searching for duplicates in: ${data.directory}`));
  finder.on('file-processed', (data) => {
    process.stdout.write(`\rCalculating hashes... ${drawProgressBar(data.current, data.total)} files`);
  });

  try {
    const stats = await finder.find(directory);
    process.stdout.write('\n\n');
    
    if (stats.duplicateGroups.length === 0) {
      console.log('✅ No duplicates found.');
      return;
    }

    console.log(`Found ${stats.duplicateGroups.length} duplicate groups (${formatSize(stats.wastedSpace)} wasted):`);

    stats.duplicateGroups.forEach((group, index) => {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`Group ${index + 1} (${group.count} copies, ${formatSize(group.size)} each):`);
      console.log(`  SHA-256: ${group.hash.slice(0, 16)}...`);
      group.files.forEach(f => console.log(`  📄 ${f}`));
      console.log(`\n  Wasted space: ${formatSize(group.wasted)}`);
    });

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`💾 Total wasted space: ${formatSize(stats.wastedSpace)}`);
  } catch (error) {
    handleError(error, directory);
  }
}

async function runOrganize(source, target) {
  const organizer = new Organizer();

  organizer.on('organize-start', (data) => {
    console.log(`📦 Organizing: ${data.source}`);
    console.log(`Target:      ${data.target}\n`);
    console.log('Creating folders...');
  });

  organizer.on('copy-start', (data) => {
    process.stdout.write(`\rCopying files... ${drawProgressBar(data.current, data.total)}`);
  });

  try {
    const stats = await organizer.organize(source, target);
    process.stdout.write('\n\n✅ Organization complete!\n\nSummary:');
    
    for (const [name, count] of Object.entries(stats.categories)) {
      console.log(`  ${name.padEnd(12)}: ${count.toString().padStart(4)} files → Organized/${name}/`);
    }

    console.log(`\nTotal copied: ${stats.totalCopied} files (${formatSize(stats.totalSize)})`);
  } catch (error) {
    handleError(error, source);
  }
}

async function runCleanup(directory, days, confirm) {
  const cleanup = new Cleanup();
  
  cleanup.on('cleanup-start', (data) => {
    console.log(`🧹 Cleanup: ${data.directory}`);
    console.log(`Looking for files older than ${data.olderThanDays} days...\n`);
  });

  const foundFiles = [];
  cleanup.on('file-found', (data) => {
    foundFiles.push(data);
  });

  cleanup.on('file-deleted', (data) => {
    process.stdout.write(`\rDeleting... ${drawProgressBar(data.current, data.total)}`);
  });

  try {
    const stats = await cleanup.run(directory, days, confirm);
    
    if (foundFiles.length === 0) {
      console.log('✅ No old files found.');
      return;
    }

    console.log(`Found ${foundFiles.length} files to delete:\n`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    foundFiles.forEach(f => {
      console.log(`${f.path}`);
      console.log(`  Size: ${formatSize(f.size)}`);
      console.log(`  Modified: ${f.daysOld} days ago (${f.mtime.toISOString().split('T')[0]})\n`);
    });
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Total: ${foundFiles.length} files (${formatSize(stats.totalSizeToFree)})`);

    if (!confirm) {
      console.log('\n⚠️  DRY RUN MODE: No files were deleted.');
      console.log('To actually delete these files, run with --confirm flag.');
    } else {
      process.stdout.write('\n✅ Cleanup complete!');
      console.log(`\nDeleted: ${stats.totalDeleted} files (${formatSize(stats.freedSize)} freed)`);
    }
  } catch (error) {
    handleError(error, directory);
  }
}
