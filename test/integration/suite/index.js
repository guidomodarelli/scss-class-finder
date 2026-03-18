const commandIntegration = require('./command.integration.test');
const definitionIntegration = require('./definition.integration.test');

async function run() {
  await commandIntegration.run();
  await definitionIntegration.run();
}

module.exports = { run };
