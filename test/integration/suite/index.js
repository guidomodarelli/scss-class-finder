const commandIntegration = require('./command.integration.test');

async function run() {
  await commandIntegration.run();
}

module.exports = { run };
