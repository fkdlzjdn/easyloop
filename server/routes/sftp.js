const express = require('express');
const path = require('path');
const fs = require('fs');
const {
  VALIDATION_LIMITS,
  badRequest,
  validateStringField
} = require('../validation');

function createSftpRouter({ sshConnections, upload }) {
  const router = express.Router();

  router.post('/list', (req, res) => {
    const { sessionId, remotePath } = req.body;

    const sessionError = validateStringField('sessionId', sessionId, {
      required: true,
      maxLength: VALIDATION_LIMITS.sessionId
    });
    if (sessionError) return badRequest(res, sessionError);

    const pathError = validateStringField('remotePath', remotePath, {
      required: true,
      maxLength: VALIDATION_LIMITS.remotePath
    });
    if (pathError) return badRequest(res, pathError);

    const session = sshConnections.get(sessionId);

    if (!session) {
      return res.json({ success: false, message: 'Not connected' });
    }

    session.conn.sftp((err, sftp) => {
      if (err) return res.json({ success: false, message: err.message });

      sftp.readdir(remotePath, (err2, list) => {
        if (err2) return res.json({ success: false, message: err2.message });

        const files = list.map(item => ({
          name: item.filename,
          size: item.attrs.size,
          isDirectory: item.attrs.isDirectory(),
          modifyTime: item.attrs.mtime * 1000,
          permissions: item.attrs.mode
        }));

        res.json({ success: true, files });
      });
    });
  });

  router.post('/download', (req, res) => {
    const { sessionId, remotePath } = req.body;

    const sessionError = validateStringField('sessionId', sessionId, {
      required: true,
      maxLength: VALIDATION_LIMITS.sessionId
    });
    if (sessionError) return badRequest(res, sessionError);

    const pathError = validateStringField('remotePath', remotePath, {
      required: true,
      maxLength: VALIDATION_LIMITS.remotePath
    });
    if (pathError) return badRequest(res, pathError);

    const session = sshConnections.get(sessionId);

    if (!session) {
      return res.json({ success: false, message: 'Not connected' });
    }

    // B5 fix: 다운로드 최대 100MB 제한 + 메모리 누적 방지
    const MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024; // 100MB

    session.conn.sftp((err, sftp) => {
      if (err) return res.json({ success: false, message: err.message });

      // 먼저 파일 크기 확인
      sftp.stat(remotePath, (statErr, stats) => {
        if (statErr) return res.json({ success: false, message: statErr.message });

        if (stats.size > MAX_DOWNLOAD_SIZE) {
          return res.json({
            success: false,
            message: `File too large (${(stats.size / 1024 / 1024).toFixed(1)}MB). Max ${MAX_DOWNLOAD_SIZE / 1024 / 1024}MB.`
          });
        }

        const chunks = [];
        let totalSize = 0;
        const readStream = sftp.createReadStream(remotePath);

        readStream.on('data', (chunk) => {
          totalSize += chunk.length;
          if (totalSize > MAX_DOWNLOAD_SIZE) {
            readStream.destroy();
            return res.json({ success: false, message: 'Download aborted: file size exceeds limit during transfer' });
          }
          chunks.push(chunk);
        });
        readStream.on('end', () => {
          const buffer = Buffer.concat(chunks);
          res.json({
            success: true,
            filename: path.basename(remotePath),
            content: buffer.toString('base64'),
            size: buffer.length
          });
        });
        readStream.on('error', (err2) => {
          res.json({ success: false, message: err2.message });
        });
      });
    });
  });

  router.post('/upload', upload.single('file'), (req, res) => {
    const { sessionId, remotePath } = req.body;

    const sessionError = validateStringField('sessionId', sessionId, {
      required: true,
      maxLength: VALIDATION_LIMITS.sessionId
    });
    if (sessionError) return badRequest(res, sessionError);

    const pathError = validateStringField('remotePath', remotePath, {
      required: true,
      maxLength: VALIDATION_LIMITS.remotePath
    });
    if (pathError) return badRequest(res, pathError);

    const session = sshConnections.get(sessionId);

    if (!session) {
      return res.json({ success: false, message: 'Not connected' });
    }

    if (!req.file) {
      return badRequest(res, 'No file provided');
    }

    session.conn.sftp((err, sftp) => {
      if (err) return res.json({ success: false, message: err.message });

      const localPath = req.file.path;
      const fullRemotePath = path.posix.join(remotePath, req.file.originalname);

      sftp.fastPut(localPath, fullRemotePath, (err2) => {
        // B1 fix: 임시파일은 성공/실패 관계없이 항상 정리
        try { fs.unlinkSync(localPath); } catch (unlinkErr) { /* ignore */ }

        if (err2) return res.json({ success: false, message: err2.message });
        res.json({ success: true, message: 'File uploaded successfully' });
      });
    });
  });

  return router;
}

module.exports = { createSftpRouter };
