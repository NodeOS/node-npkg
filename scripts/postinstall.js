var fs     = require('fs');
var path   = require('path');

var mkdirp = require('lib-mkdirp');
var HOME   = process.env.HOME;
var npkgd  = path.join(HOME, 'etc');

mkdirp(npkgd);

var defaults = path.join(HOME, 'etc', 'defaults.json');
var source   = path.join(__dirname, '..', 'etc', 'defaults.json');

fs.createReadStream(source).pipe(fs.createWriteStream(defaults));
