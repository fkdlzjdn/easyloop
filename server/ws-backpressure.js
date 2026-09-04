'use strict';

const DEFAULT_HIGH_WATER_BYTES = 2 * 1024 * 1024;
const DEFAULT_LOW_WATER_BYTES = 512 * 1024;
const DEFAULT_MAX_BUFFERED_BYTES = 32 * 1024 * 1024;
const DEFAULT_STALL_TIMEOUT_MS = 15000;

function createWebSocketForwarder(source, destination, options = {}) {
  const label = options.label || 'websocket proxy';
  const openState = options.openState ?? 1;
  const highWaterBytes = options.highWaterBytes ?? DEFAULT_HIGH_WATER_BYTES;
  const lowWaterBytes = options.lowWaterBytes ?? DEFAULT_LOW_WATER_BYTES;
  const maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
  const stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
  const onFatal = typeof options.onFatal === 'function' ? options.onFatal : () => {};
  let paused = false;
  let stallTimer = null;
  let fatalRaised = false;
  let cleaned = false;

  const bufferedAmount = () => Number(destination?.bufferedAmount) || 0;
  const destinationNeedsDrain = () => Boolean(destination?._socket?.writableNeedDrain);

  const clearStallTimer = () => {
    if (!stallTimer) return;
    clearTimeout(stallTimer);
    stallTimer = null;
  };

  const fail = (reason, error = null) => {
    if (fatalRaised || cleaned) return;
    fatalRaised = true;
    clearStallTimer();
    onFatal({ label, reason, error, bufferedAmount: bufferedAmount() });
  };

  const resumeIfDrained = () => {
    if (!paused || bufferedAmount() > lowWaterBytes || destinationNeedsDrain()) return;
    clearStallTimer();
    paused = false;
    try { source?._socket?.resume?.(); } catch (error) { fail('source resume failed', error); }
  };

  const pauseForPressure = () => {
    if (!paused) {
      paused = true;
      try { source?._socket?.pause?.(); } catch (error) {
        fail('source pause failed', error);
        return;
      }
    }
    if (!stallTimer && stallTimeoutMs > 0) {
      stallTimer = setTimeout(() => {
        fail(`backpressure stalled for ${stallTimeoutMs}ms`);
      }, stallTimeoutMs);
      stallTimer.unref?.();
    }
  };

  const handleMessage = (data, isBinary) => {
    if (cleaned || fatalRaised || destination?.readyState !== openState) return;
    if (bufferedAmount() >= maxBufferedBytes) {
      fail('maximum buffered amount exceeded');
      return;
    }

    try {
      destination.send(data, { binary: isBinary }, error => {
        if (error) {
          fail('send failed', error);
          return;
        }
        resumeIfDrained();
      });
    } catch (error) {
      fail('send threw', error);
      return;
    }

    if (bufferedAmount() >= maxBufferedBytes) {
      fail('maximum buffered amount exceeded');
    } else if (bufferedAmount() >= highWaterBytes || destinationNeedsDrain()) {
      pauseForPressure();
    }
  };

  const drainSocket = destination?._socket;
  source.on('message', handleMessage);
  drainSocket?.on?.('drain', resumeIfDrained);

  return {
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      clearStallTimer();
      source.off?.('message', handleMessage);
      drainSocket?.off?.('drain', resumeIfDrained);
      if (paused) {
        paused = false;
        try { source?._socket?.resume?.(); } catch (error) { /* closing */ }
      }
    },
    isPaused() {
      return paused;
    }
  };
}

module.exports = {
  createWebSocketForwarder,
  DEFAULT_HIGH_WATER_BYTES,
  DEFAULT_LOW_WATER_BYTES,
  DEFAULT_MAX_BUFFERED_BYTES,
  DEFAULT_STALL_TIMEOUT_MS
};
