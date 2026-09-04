const express = require('express');
const path = require('path');
const fs = require('fs');
const {
  VALIDATION_LIMITS,
  badRequest,
  validateStringField
} = require('../validation');

function createSftpCloser(sftp) {
  let closed = false;

  return () => {
    if (closed) return;
    closed = true;

    if (typeof sftp?.end !== 'function') return;

    try {
      sftp.end();
    } catch (err) {
      console.warn('[SFTP] Failed to close channel:', err.message);
    }
  };
}

function removeUploadTempFile(file) {
  if (!file?.path) return;
  try { fs.unlinkSync(file.path); } catch (err) { /* ignore */ }
}

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
      const closeSftp = createSftpCloser(sftp);

      try {
        sftp.readdir(remotePath, (err2, list) => {
          closeSftp();
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
      } catch (err2) {
        closeSftp();
        res.json({ success: false, message: err2.message });
      }
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
      const closeSftp = createSftpCloser(sftp);
      let completed = false;

      const finish = (payload) => {
        if (completed) return;
        completed = true;
        closeSftp();
        res.json(payload);
      };

      // 먼저 파일 크기 확인
      try {
        sftp.stat(remotePath, (statErr, stats) => {
          if (statErr) return finish({ success: false, message: statErr.message });

          if (stats.size > MAX_DOWNLOAD_SIZE) {
            return finish({
              success: false,
              message: `File too large (${(stats.size / 1024 / 1024).toFixed(1)}MB). Max ${MAX_DOWNLOAD_SIZE / 1024 / 1024}MB.`
            });
          }

          const chunks = [];
          let totalSize = 0;
          let readStream;

          try {
            readStream = sftp.createReadStream(remotePath);
          } catch (streamErr) {
            return finish({ success: false, message: streamErr.message });
          }

          readStream.on('data', (chunk) => {
            if (completed) return;
            totalSize += chunk.length;
            if (totalSize > MAX_DOWNLOAD_SIZE) {
              readStream.destroy();
              return finish({
                success: false,
                message: 'Download aborted: file size exceeds limit during transfer'
              });
            }
            chunks.push(chunk);
          });
          readStream.on('end', () => {
            if (completed) return;
            const buffer = Buffer.concat(chunks);
            finish({
              success: true,
              filename: path.basename(remotePath),
              content: buffer.toString('base64'),
              size: buffer.length
            });
          });
          readStream.on('error', (err2) => {
            finish({ success: false, message: err2.message });
          });
          readStream.on('close', () => {
            if (!completed) {
              finish({ success: false, message: 'Download stream closed unexpectedly' });
            }
          });
        });
      } catch (statErr) {
        finish({ success: false, message: statErr.message });
      }
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
      if (err) {
        removeUploadTempFile(req.file);
        return res.json({ success: false, message: err.message });
      }

      const closeSftp = createSftpCloser(sftp);
      const localPath = req.file.path;
      const fullRemotePath = path.posix.join(remotePath, req.file.originalname);
      let completed = false;

      const finish = (payload) => {
        if (completed) return;
        completed = true;
        closeSftp();
        removeUploadTempFile(req.file);
        res.json(payload);
      };

      try {
        sftp.fastPut(localPath, fullRemotePath, (err2) => {
          if (err2) return finish({ success: false, message: err2.message });
          finish({ success: true, message: 'File uploaded successfully' });
        });
      } catch (err2) {
        finish({ success: false, message: err2.message });
      }
    });
  });

  return router;
}

module.exports = { createSftpRouter };
