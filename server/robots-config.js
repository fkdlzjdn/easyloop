const fs = require('fs');
const path = require('path');

/**
 * Create a robots config store for load/save.
 * @param {string} baseDir
 * @returns {{load: Function, save: Function, robotsConfigPath: string}}
 */
function createRobotsConfigStore(baseDir) {
  const robotsConfigPath = path.join(baseDir, 'config', 'robots.json');

  function load() {
    try {
      if (fs.existsSync(robotsConfigPath)) {
        return JSON.parse(fs.readFileSync(robotsConfigPath, 'utf8'));
      }
    } catch (e) {
      console.error('Error loading robots config:', e);
    }
    return { robots: [] };
  }

  function save(config) {
    fs.writeFileSync(robotsConfigPath, JSON.stringify(config, null, 2));
  }

  return { load, save, robotsConfigPath };
}

module.exports = { createRobotsConfigStore };
