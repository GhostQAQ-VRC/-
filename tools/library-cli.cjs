#!/usr/bin/env node
'use strict';

/**
 * Standalone storage-library CLI. It uses the exact same engine as the desktop
 * client, proving the library folder is independent from the app UI.
 *
 *   node tools/library-cli.cjs scan    <folder> [--previews]
 *   node tools/library-cli.cjs previews <folder>
 *   node tools/library-cli.cjs stats   <folder>
 *   node tools/library-cli.cjs inspect <image-file>
 */

const path = require('node:path');
const repository = require('../desktop/library/repository.cjs');
const scanLib = require('../desktop/library/scan.cjs');
const previewLib = require('../desktop/library/preview.cjs');
const metadataLib = require('../desktop/library/metadata.cjs');

function usage() {
  console.log(`星屑手帖 · 存储库命令行

用法：
  node tools/library-cli.cjs scan <文件夹> [--previews]   扫描并索引
  node tools/library-cli.cjs previews <文件夹>            生成缺失的预览
  node tools/library-cli.cjs stats <文件夹>               查看库统计
  node tools/library-cli.cjs inspect <图片文件>           查看单张图片的识别结果
`);
}

function requireTarget(target) {
  if (!target) {
    usage();
    process.exit(1);
  }
  return path.resolve(target);
}

async function runScan(root, withPreviews) {
  const wrapper = await repository.ensureLibrary(root, { name: path.basename(root) });
  const previewOptions = repository.previewOptionsFor(wrapper);
  const queue = new previewLib.PreviewQueue({
    previewDir: repository.previewDir(root, wrapper),
    maxEdge: previewOptions.previewMaxEdge,
    quality: previewOptions.previewQuality,
    concurrency: 2,
    onReady: () => {},
    onProgress: ({ done, failed, pending }) => {
      if ((done + failed) % 25 === 0) {
        process.stdout.write(`\r预览：完成 ${done}，失败 ${failed}，待处理 ${pending}   `);
      }
    },
  });

  let last = Date.now();
  const result = await scanLib.scanLibrary({
    root,
    previewQueue: queue,
    onProgress: ({ current, total }) => {
      const now = Date.now();
      if (now - last > 300 || current === total) {
        last = now;
        process.stdout.write(`\r索引：${current}/${total}   `);
      }
    },
  });

  console.log('\n');
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        complete: result.complete,
        stats: result.stats,
        worlds: result.worlds.length,
        seeds: result.seeds.length,
      },
      null,
      2,
    ),
  );

  if (withPreviews) {
    await queue.drain();
    console.log('\n预览生成完成。');
  }
}

async function runPreviews(root) {
  const wrapper = await repository.ensureLibrary(root, { name: path.basename(root) });
  const previewOptions = repository.previewOptionsFor(wrapper);
  const cache = await repository.readScanCache(root);
  const queue = new previewLib.PreviewQueue({
    previewDir: repository.previewDir(root, wrapper),
    maxEdge: previewOptions.previewMaxEdge,
    quality: previewOptions.previewQuality,
    concurrency: 2,
    onProgress: ({ done, failed }) => {
      if ((done + failed) % 10 === 0) {
        process.stdout.write(`\r预览：完成 ${done}，失败 ${failed}   `);
      }
    },
  });

  for (const [relative, entry] of Object.entries(cache.files || {})) {
    if (!entry || !entry.hash) continue;
    queue.enqueue({ absPath: path.join(root, relative), hash: entry.hash });
  }
  await queue.drain();
  console.log(`\n预览处理完成：成功 ${queue.done}，失败 ${queue.failed}。`);
}

async function runStats(root) {
  const stats = await repository.computeLibraryStats(root);
  console.log(JSON.stringify(stats, null, 2));
}

async function runInspect(file) {
  const metadata = await metadataLib.readPhotoMetadata(file, {
    fileName: path.basename(file),
  });
  const dimensions = await previewLib.readImageDimensions(file);
  console.log(
    JSON.stringify(
      {
        file,
        capturedAt: metadata.capturedAt,
        metaSource: metadata.metaSource,
        dateSource: metadata.dateSource,
        worldId: metadata.worldId,
        worldName: metadata.worldName,
        worldInstanceId: metadata.worldInstanceId,
        dimensions,
        diagnostics: metadata.diagnostics,
      },
      null,
      2,
    ),
  );
}

async function main() {
  const command = process.argv[2];
  const target = process.argv[3];
  if (!command || command === '--help' || command === '-h') {
    usage();
    return;
  }

  if (command === 'inspect') {
    await runInspect(requireTarget(target));
    return;
  }

  const root = requireTarget(target);
  if (command === 'scan') {
    await runScan(root, process.argv.includes('--previews'));
  } else if (command === 'previews') {
    await runPreviews(root);
  } else if (command === 'stats') {
    await runStats(root);
  } else {
    usage();
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('\n[library-cli]', error && error.stack ? error.stack : error);
  process.exit(1);
});
