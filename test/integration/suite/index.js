const commandIntegration = require('./command.integration.test');
const definitionIntegration = require('./definition.integration.test');
const reverseIntegration = require('./reverse.integration.test');

async function run() {
  await commandIntegration.run();
  await definitionIntegration.run();
  await reverseIntegration.run();
}

module.exports = { run };
