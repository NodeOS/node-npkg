var assert   = require('assert');
var path     = require('path');
var fs       = require('fs');

var mkdirp   = require('lib-mkdirp');

var graceful = require('./lib-graceful-json.js');
var fmtenvs  = require('./lib-format-envs.js');
var fmtlist  = require('./lib-format-list.js');

function NPKGConfig() {
  assert(root, 'npkg config root required');

  this.config = null;
}

NPKGConfig.prototype.get = function get(key) {
  return this.config[key];
};

NPKGConfig.prototype.set = function set(key, val) {
  this.config[key] = val;
};

NPKGConfig.prototype.cat = function cat() {
  return fmtenvs(this.config);
};

NPKGConfig.prototype.list = function list() {
  return fmtlist(Object.keys(this.config));
};

NPKGConfig.prototype.remove = function remove(key) {
  delete this.config[key];
};

NPKGConfig.Save = function (filepath, inst) {
  var dir = path.dirname(filepath);

  mkdirp(dir);

  fs.writeFileSync(filepath, JSON.stringify(inst.config), 'utf-8');
};

NPKGConfig.Load = function (filepath) {
  
  // the config file can either come from the default,
  // $HOME/etc/defaults.json or a package-specific location
  // $HOME/etc/$PKG/defaults.json
  // either way, we keep our stories straight here
  var nconfig    = new NPKGConfig();
  var config     = graceful(filepath);

  nconfig.config = config;

  return nconfig;
}

module.exports = NPKGConfig;
