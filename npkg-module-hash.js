var path = require('path');

module.exports = function(mod) {
  var out;

  if (mod.substr(0,1) === '.') out = path.resolve(process.cwd(), mod);
  else                         out = mod;

  return out;
};
