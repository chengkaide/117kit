import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import Busboy from 'busboy';
import { config } from './config.js';
import { badRequest } from './middleware.js';

// 允许的文件类型白名单（按用途区分）
const EXT_WHITELIST = {
  experiment_data: ['.csv', '.txt', '.xlsx', '.xls', '.zip', '.rar', '.7z', '.pdf', '.doc', '.docx', '.dmf', '.prj', '.dat', '.raw'],
  result: ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.csv', '.zip', '.txt', '.png', '.jpg', '.jpeg'],
  logbook: ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'],
  equipment: ['.jpg', '.jpeg', '.png', '.webp'],
  qtegra: ['.csv'],
};

/**
 * 处理 multipart 上传。返回 { fields, file }。
 * file 存到 uploadDir/<kind>/ 下，使用随机名，原始文件名只记录在数据库。
 */
export function handleUpload(req, kinds) {
  return new Promise((resolve, reject) => {
    const allowedKinds = Array.isArray(kinds) ? kinds : [kinds];
    let busboy;
    try {
      busboy = Busboy({
        headers: req.headers,
        limits: { fileSize: config.maxUploadMB * 1024 * 1024, files: 1 },
      });
    } catch {
      return reject(badRequest('不是合法的文件上传请求'));
    }

    const fields = {};
    let fileResult = null;
    let finished = false;
    let parsedDone = false;
    let pendingWrites = 0;
    const fail = (err) => { if (!finished) { finished = true; reject(err); } };

    // 解析完成 && 所有写盘完成 才返回（否则小文件会在落盘前被误判为空）
    const checkDone = () => {
      if (finished || !parsedDone || pendingWrites > 0) return;
      if (fileResult) { finished = true; resolve({ fields, file: fileResult }); }
      else fail(badRequest('没有收到文件'));
    };

    busboy.on('field', (name, val) => { fields[name] = val; });

    busboy.on('file', (name, stream, info) => {
      const origName = path.basename(info.filename || 'unnamed');
      const ext = path.extname(origName).toLowerCase() || '';
      const kind = fields.kind && allowedKinds.includes(fields.kind) ? fields.kind : allowedKinds[0];

      if (!EXT_WHITELIST[kind]?.includes(ext)) {
        stream.resume();
        return fail(badRequest(`不允许的文件类型 ${ext || '(无扩展名)'}，允许：${EXT_WHITELIST[kind].join(' ')}`));
      }
      const storedName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
      const kindDir = path.join(config.uploadDir, kind);
      fs.mkdirSync(kindDir, { recursive: true });
      const storePath = path.join(kindDir, storedName);
      const out = fs.createWriteStream(storePath);
      let truncated = false;
      pendingWrites += 1;
      stream.on('limit', () => { truncated = true; out.destroy(); fs.rmSync(storePath, { force: true }); fail(badRequest(`文件超过 ${config.maxUploadMB}MB 限制`)); });
      stream.pipe(out);
      out.on('error', () => { pendingWrites -= 1; fail(badRequest('文件保存失败')); });
      out.on('finish', () => {
        pendingWrites -= 1;
        if (truncated) return;
        fileResult = { kind, origName, storedName: `${kind}/${storedName}`, storePath, size: out.bytesWritten, mime: info.mimeType || 'application/octet-stream' };
        checkDone();
      });
    });

    busboy.on('error', () => fail(badRequest('上传流错误')));
    busboy.on('close', () => { parsedDone = true; checkDone(); });
    req.pipe(busboy);
  });
}
