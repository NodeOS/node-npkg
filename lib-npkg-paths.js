var join = require('path').join;

var Interpoalte = require('lib-interpolate');

var params = {
  home : process.env.HOME,
  pwd  : process.cwd(),
};

var map = {
  node_modules           : "%{home}/lib/node_modules",
  config_root            : "%{home}/etc/",
  config_defaults        : "%{home}/etc/defaults.json",
  config_defaults_module : "%{home}/etc/%{package}/defaults.json",
  service_log_file       : "%{logdir}/%{key}.log"
};

var globals = new Interpoalte(params);

module.exports = function lookup(key, extras) {
  var line = map[key];
  
  if (!line) throw new Error("no mapping for", key);

  var partial = globals.expand(line);

  if (extras) {
    var locals  = new Interpoalte(extras);
    return locals.expand(partial);
  } else {
    return partial;
  }
  
};
