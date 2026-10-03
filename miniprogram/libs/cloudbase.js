const cloudbasePackage = require('@cloudbase/js-sdk');
const adapterPackage = require('@cloudbase/adapter-wx_mp');
const config = require('../config/index');

const cloudbase = cloudbasePackage.default || cloudbasePackage;
const adapter = adapterPackage.default || adapterPackage;

cloudbase.useAdapters(adapter);

const app = cloudbase.init({
  env: config.envId,
  region: config.region
});
const auth = app.auth({ persistence: 'local' });

module.exports = { app, auth };
