#!/usr/bin/env node
/**
 * ncm2mp3 — 网易云 .ncm 加密音乐 → 原格式(MP3/FLAC) 本地离线解密工具
 *
 * 纯本地、零依赖（仅需 Node.js 内置 crypto / fs / path），不上传任何服务器。
 * 算法：
 *   1) 文件结构解析：magic(8B) + 2B + keyLen + keyData + metaLen + metaData
 *                          + 5B + imageSpace + imageSize + image + (imageSpace-imageSize) 跳转 → 音频起点
 *   2) keyData：逐字节 XOR 0x64 → AES-128-ECB(CORE_KEY) 解密 → 去 PKCS#7 填充 → 去掉前 17 字节 = RC4 密钥
 *   3) 音频：定制 RC4 密钥流（rotate 左移 1 位、重复至 16384B）逐字节 XOR → 还原原格式
 *
 * 用法：
 *   node ncm2mp3.js <文件.ncm> [输出.mp3]
 *   node ncm2mp3.js --dir <目录> [--out <输出目录>] [--force]
 *   node ncm2mp3.js --help
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ncmdump 标准硬编码密钥
const CORE_KEY = Buffer.from('687A4852416D736F356B496E62617857', 'hex');

function genKeystream(key) {
  let S = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xFF;
    [S[i], S[j]] = [S[j], S[i]];
  }
  const stream = Buffer.alloc(256);
  for (let i = 0; i < 256; i++) {
    stream[i] = S[(S[i] + S[(i + S[i]) & 0xFF]) & 0xFF];
  }
  // 左移 1 位（首字节移到末尾），再重复铺满 16384 字节
  const rotated = Buffer.concat([stream.subarray(1), stream.subarray(0, 1)]);
  const ks = Buffer.alloc(16384);
  for (let k = 0; k < 16384; k++) ks[k] = rotated[k % 256];
  return ks;
}

function detectExt(audio) {
  const head = audio.subarray(0, 4).toString('hex');
  if (head === '664c6143') return 'flac'; // fLaC
  if (head.startsWith('494433') || (audio[0] === 0xFF && (audio[1] & 0xE0) === 0xE0)) return 'mp3'; // ID3 / MPEG frame
  return null;
}

function validateMp3(audio) {
  // 有 ID3v2 标签：跳过标签后找首个 MPEG 帧同步字 0xFFE0..0xFFFB
  if (audio.subarray(0, 3).toString('ascii') === 'ID3') {
    const size = ((audio[6] & 0x7F) << 21) | ((audio[7] & 0x7F) << 14) |
                 ((audio[8] & 0x7F) << 7) | (audio[9] & 0x7F);
    let p = 10 + size;
    while (p + 1 < audio.length && !(audio[p] === 0xFF && (audio[p + 1] & 0xE0) === 0xE0)) p++;
    return p < audio.length;
  }
  return audio[0] === 0xFF && (audio[1] & 0xE0) === 0xE0;
}

function convertOne(ncmPath, outPath) {
  const data = fs.readFileSync(ncmPath);
  if (data.subarray(0, 4).toString('ascii') !== 'CTEN') {
    throw new Error('不是有效的 .ncm 文件（缺少 CTEN 文件头）');
  }

  // ---- 1) 解析文件结构 ----
  let pos = 8; pos += 2;                       // 跳过 8 字节 magic + 2 字节
  let keyLen = data.readUInt32LE(pos); pos += 4;
  let keyData = data.subarray(pos, pos + keyLen); pos += keyLen;
  let metaLen = data.readUInt32LE(pos); pos += 4; pos += metaLen;   // 跳过 metadata
  pos += 5;
  let imageSpace = data.readUInt32LE(pos); pos += 4;
  let imageSize = data.readUInt32LE(pos); pos += 4;
  pos += imageSize;
  pos += (imageSpace - imageSize);            // 关键：额外跳转到音频起点
  const audioEnc = data.subarray(pos);

  // ---- 2) 还原 RC4 密钥 ----
  const xored = Buffer.from(keyData.map(b => b ^ 0x64));
  const decipher = crypto.createDecipheriv('aes-128-ecb', CORE_KEY, null);
  const dec = Buffer.concat([decipher.update(xored), decipher.final()]);
  const rc4Key = dec.subarray(17);            // 去掉 PKCS#7 填充后，再去掉前 17 字节

  // ---- 3) 解密音频 ----
  const ks = genKeystream(rc4Key);
  const audio = Buffer.alloc(audioEnc.length);
  for (let k = 0; k < audioEnc.length; k++) audio[k] = audioEnc[k] ^ ks[k % ks.length];

  const ext = detectExt(audio);
  if (!ext) {
    throw new Error('解密后无法识别格式（可能是更新/变体 .ncm）。前 8 字节: ' + audio.subarray(0, 8).toString('hex'));
  }

  // ---- 输出路径解析 ----
  let finalOut = outPath;
  if (!finalOut) {
    const dir = path.dirname(ncmPath);
    const base = path.basename(ncmPath, path.extname(ncmPath));
    finalOut = path.join(dir, base + '.' + ext);
  } else {
    // 若指定的是目录，则放到该目录下、沿用原名
    if (fs.existsSync(finalOut) && fs.statSync(finalOut).isDirectory()) {
      const base = path.basename(ncmPath, path.extname(ncmPath));
      finalOut = path.join(finalOut, base + '.' + ext);
    } else {
      const givenExt = path.extname(finalOut).toLowerCase().replace(/^\./, '');
      if (givenExt && givenExt !== ext && ['mp3', 'flac'].includes(givenExt)) {
        // 用户给的扩展名与真实格式不符（如 .mp3 实为 flac）→ 纠正
        finalOut = finalOut.replace(/\.(mp3|flac)$/i, '.' + ext);
      } else if (!givenExt) {
        // 用户只给了无扩展名路径（stem）→ 补上检测到的扩展名
        finalOut = finalOut + '.' + ext;
      }
    }
  }

  fs.writeFileSync(finalOut, audio);
  const valid = ext === 'mp3' ? validateMp3(audio) : true;
  return { out: finalOut, ext, size: audio.length, valid };
}

// ============ CLI ============
function printHelp() {
  console.log(`ncm2mp3 — 网易云 .ncm 加密音乐 → MP3/FLAC 本地离线解密工具

用法：
  node ncm2mp3.js <文件.ncm> [输出路径]
      将单个 .ncm 转成原格式。不指定输出路径时，输出到源文件同目录、同名扩展名。

  node ncm2mp3.js --dir <目录> [--out <输出目录>] [--force]
      批量转换目录内所有 .ncm。默认跳过已存在的输出文件，--force 覆盖。

  node ncm2mp3.js --help | -h
      显示本帮助。

说明：
  - 纯本地离线解密，不上传任何服务器，请仅转换你本人账号已下载的文件。
  - 输出格式由文件本身决定（网易云下载多为 MP3，无损专辑为 FLAC）。
`);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printHelp();
    process.exit(argv.length === 0 ? 1 : 0);
  }

  if (argv[0] === '--dir') {
    const dir = argv[1];
    if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      console.error('错误：--dir 需要有效的目录路径');
      process.exit(1);
    }
    let outDir = null;
    let force = false;
    for (let i = 2; i < argv.length; i++) {
      if (argv[i] === '--out') outDir = argv[++i];
      else if (argv[i] === '--force') force = true;
    }
    if (outDir && !fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.ncm'))
      .map(f => path.join(dir, f));
    if (files.length === 0) {
      console.log('该目录下没有找到 .ncm 文件。');
      process.exit(0);
    }
    console.log(`开始批量转换：${dir}（共 ${files.length} 个 .ncm）\n`);
    let ok = 0, skip = 0, fail = 0;
    for (const f of files) {
      const base = path.basename(f, '.ncm');
      const target = outDir ? path.join(outDir, base) : f.replace(/\.ncm$/i, '');
      // 目标扩展名未知，先按可能扩展名探测是否已存在
      const exists = ['.mp3', '.flac'].some(ext => fs.existsSync(target + ext));
      if (exists && !force) {
        console.log(`[跳过] 已存在：${base}（用 --force 覆盖）`);
        skip++;
        continue;
      }
      try {
        const r = convertOne(f, target);
        console.log(`[成功] ${path.basename(f)} → ${path.basename(r.out)} (${r.ext}, ${(r.size / 1048576).toFixed(2)} MB, 校验=${r.valid ? 'OK' : 'FAIL'})`);
        ok++;
      } catch (e) {
        console.error(`[失败] ${path.basename(f)}：${e.message}`);
        fail++;
      }
    }
    console.log(`\n完成：成功 ${ok} / 跳过 ${skip} / 失败 ${fail}`);
    process.exit(fail > 0 ? 1 : 0);
  }

  // 单文件模式
  const input = argv[0];
  if (!fs.existsSync(input)) {
    console.error(`错误：找不到文件 ${input}`);
    process.exit(1);
  }
  const out = argv[1];
  try {
    const r = convertOne(input, out);
    console.log(`[成功] ${path.basename(input)} → ${r.out} (${r.ext}, ${(r.size / 1048576).toFixed(2)} MB, 校验=${r.valid ? 'OK' : 'FAIL'})`);
  } catch (e) {
    console.error(`[失败] ${e.message}`);
    process.exit(1);
  }
}

main();
