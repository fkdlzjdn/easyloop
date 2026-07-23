const express = require('express');
const {
  VALIDATION_LIMITS,
  badRequest,
  validateStringField,
  validateNumberField,
  validateSteps
} = require('../validation');

function createSshRouter({ sshConnections, createSSHConnection }) {
  const router = express.Router();

  router.post('/connect', (req, res) => {
    const { host, port, username, password, sessionId } = req.body;

    const hostError = validateStringField('host', host, {
      required: true,
      maxLength: VALIDATION_LIMITS.host
    });
    if (hostError) return badRequest(res, hostError);

    const userError = validateStringField('username', username, {
      required: true,
      maxLength: VALIDATION_LIMITS.username
    });
    if (userError) return badRequest(res, userError);

    const sessionError = validateStringField('sessionId', sessionId, {
      required: true,
      maxLength: VALIDATION_LIMITS.sessionId
    });
    if (sessionError) return badRequest(res, sessionError);

    const portError = validateNumberField('port', port, { min: 1, max: 65535 });
    if (portError) return badRequest(res, portError);

    const passwordError = validateStringField('password', password, {
      maxLength: VALIDATION_LIMITS.command,
      allowEmpty: true
    });
    if (passwordError) return badRequest(res, passwordError);

    if (sshConnections.has(sessionId)) {
      return res.json({ success: true, message: 'Already connected' });
    }

    const conn = createSSHConnection(
      { host, port, username, password },
      () => {
        sshConnections.set(sessionId, { conn, host, username });
        res.json({ success: true, message: 'Connected' });
      },
      (err) => {
        res.json({ success: false, needPassword: err.needPassword, message: err.message });
      }
    );

    if (!conn) {
      // Handled in createSSHConnection
    }
  });

  router.post('/exec', (req, res) => {
    const { sessionId, command } = req.body;

    const sessionError = validateStringField('sessionId', sessionId, {
      required: true,
      maxLength: VALIDATION_LIMITS.sessionId
    });
    if (sessionError) return badRequest(res, sessionError);

    const commandError = validateStringField('command', command, {
      required: true,
      maxLength: VALIDATION_LIMITS.command
    });
    if (commandError) return badRequest(res, commandError);

    const session = sshConnections.get(sessionId);

    if (!session) {
      return res.json({ success: false, message: 'Not connected' });
    }

    // B2 fix: SSH exec 30초 타임아웃 추가
    const EXEC_TIMEOUT = 30000;

    session.conn.exec(command, (err, stream) => {
      if (err) {
        return res.json({ success: false, message: err.message });
      }

      let stdout = '';
      let stderr = '';
      let responded = false;

      const timeout = setTimeout(() => {
        if (!responded) {
          responded = true;
          try { stream.close(); } catch (e) { /* ignore */ }
          res.json({ success: false, message: 'Command timed out (30s)', stdout, stderr, exitCode: -1 });
        }
      }, EXEC_TIMEOUT);

      stream.on('close', (code) => {
        if (!responded) {
          responded = true;
          clearTimeout(timeout);
          res.json({ success: true, stdout, stderr, exitCode: code });
        }
      });

      stream.on('data', (data) => {
        stdout += data.toString();
      });

      stream.stderr.on('data', (data) => {
        stderr += data.toString();
      });
    });
  });

  router.post('/exec-sequence', async (req, res) => {
    const { sessionId, steps } = req.body;

    const sessionError = validateStringField('sessionId', sessionId, {
      required: true,
      maxLength: VALIDATION_LIMITS.sessionId
    });
    if (sessionError) return badRequest(res, sessionError);

    const stepsError = validateSteps(steps);
    if (stepsError) return badRequest(res, stepsError);

    const session = sshConnections.get(sessionId);

    if (!session) {
      return res.json({ success: false, message: 'Not connected' });
    }

    const results = [];

    for (const step of steps) {
      try {
        const result = await new Promise((resolve, reject) => {
          session.conn.exec(step.cmd, (err, stream) => {
            if (err) return reject(err);

            let stdout = '';
            let stderr = '';

            // B2 fix: exec-sequence에도 30초 타임아웃
            const timeout = setTimeout(() => {
              try { stream.close(); } catch (e) { /* ignore */ }
              resolve({ cmd: step.cmd, stdout, stderr, exitCode: -1, error: 'Command timed out (30s)' });
            }, 30000);

            stream.on('close', (code) => {
              clearTimeout(timeout);
              resolve({ cmd: step.cmd, stdout, stderr, exitCode: code });
            });

            stream.on('data', (data) => { stdout += data.toString(); });
            stream.stderr.on('data', (data) => { stderr += data.toString(); });
          });
        });

        results.push(result);

        if (step.wait > 0) {
          await new Promise(r => setTimeout(r, step.wait));
        }
      } catch (err) {
        results.push({ cmd: step.cmd, error: err.message });
        break;
      }
    }

    res.json({ success: true, results });
  });

  router.post('/disconnect', (req, res) => {
    const { sessionId } = req.body;

    const sessionError = validateStringField('sessionId', sessionId, {
      required: true,
      maxLength: VALIDATION_LIMITS.sessionId
    });
    if (sessionError) return badRequest(res, sessionError);

    const session = sshConnections.get(sessionId);

    if (session) {
      session.conn.end();
      sshConnections.delete(sessionId);
    }

    res.json({ success: true });
  });

  return router;
}

module.exports = { createSshRouter };
