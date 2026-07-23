const express = require('express');
const tunnelManager = require('../tunnel-manager');

function createTunnelRouter() {
  const router = express.Router();

  // Start a tunnel
  router.post('/start', async (req, res) => {
    const { tunnelId, robotIp, robotNumber, sshPort, sshUser, sshPassword } = req.body;

    if (!tunnelId || !robotIp || !robotNumber) {
      return res.status(400).json({
        success: false,
        message: 'tunnelId, robotIp, and robotNumber are required'
      });
    }

    // S2 fix: IP 주소 형식 검증
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(robotIp)) {
      return res.status(400).json({ success: false, message: 'Invalid robotIp format' });
    }
    // S2 fix: sshPort 범위 검증
    if (sshPort !== undefined && (isNaN(Number(sshPort)) || Number(sshPort) < 1 || Number(sshPort) > 65535)) {
      return res.status(400).json({ success: false, message: 'Invalid sshPort' });
    }

    try {
      const result = await tunnelManager.startTunnel(tunnelId, {
        robotIp,
        robotNumber,
        sshPort: sshPort || 22,
        sshUser: sshUser || 'syscon',
        sshPassword
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({
        success: false,
        message: err.message
      });
    }
  });

  // Stop a tunnel
  router.post('/stop', (req, res) => {
    const { tunnelId } = req.body;

    if (!tunnelId) {
      return res.status(400).json({
        success: false,
        message: 'tunnelId is required'
      });
    }

    const result = tunnelManager.stopTunnel(tunnelId);
    res.json(result);
  });

  // Stop all tunnels
  router.post('/stop-all', (req, res) => {
    const result = tunnelManager.stopAllTunnels();
    res.json(result);
  });

  // Get tunnel status
  router.get('/status/:tunnelId', (req, res) => {
    const { tunnelId } = req.params;
    const status = tunnelManager.getTunnelStatus(tunnelId);

    if (!status) {
      return res.json({
        success: true,
        active: false,
        tunnelId
      });
    }

    res.json({
      success: true,
      active: true,
      ...status
    });
  });

  // Get all tunnels
  router.get('/list', (req, res) => {
    const tunnels = tunnelManager.getAllTunnels();
    res.json({
      success: true,
      tunnels
    });
  });

  return router;
}

module.exports = { createTunnelRouter };
