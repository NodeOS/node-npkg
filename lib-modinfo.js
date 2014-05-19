var util = require('util');
var path = require('path');
var fs   = require('fs');

module.exports = function modinfo(pkg_path) {
  var pkg_json = path.join(pkg_path, 'package.json');
  try {
    var json = fs.readFileSync(pkg_json);
  } catch (e) {
    var msg = util.format('Cannot find package.json in module %s', pkg_path);
    throw new Error(msg);
  }
  try {
    var pkg = JSON.parse(json);
  } catch (e) {
    throw new Error('Cannot parse package.json');
  }
  return pkg;
};
